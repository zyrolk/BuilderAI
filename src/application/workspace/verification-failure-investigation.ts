import type { VerificationReport, VerificationStage } from '../../core/verification';
import { redactVerificationOutput } from '../../infrastructure/verification/verification-output-sanitize';

const MAX_INVESTIGATION_DIAGNOSTIC_CHARS = 1_200;

export function buildVerificationFailureInvestigationRequest(input: {
  readonly report: VerificationReport;
  readonly priorRequestSummary?: string;
}): string {
  const failedStages = input.report.stages.filter(
    ({ status }) =>
      status === 'FAILED' ||
      status === 'TIMEOUT' ||
      status === 'PROCESS_FAILED' ||
      status === 'OUTPUT_LIMIT_EXCEEDED',
  );
  const lines = [
    'Investigate this verification failure using bounded command diagnostics as hints only.',
    'Current repository source evidence has higher authority than these diagnostics.',
  ];
  if (input.priorRequestSummary !== undefined && input.priorRequestSummary.trim().length > 0) {
    lines.push('', `Prior request: ${input.priorRequestSummary.trim().slice(0, 500)}`);
  }
  lines.push('', `Verification status: ${input.report.status}`);
  for (const stage of failedStages) {
    lines.push('', `Stage: ${stage.stage}`);
    for (const error of stage.errors) {
      lines.push(`Error: ${error.code} — ${error.message}`);
    }
    const diagnosticText = formatStageDiagnostic(stage.stage, stage.diagnostic);
    if (diagnosticText.length > 0) lines.push(diagnosticText);
  }
  return lines.join('\n').slice(0, 4_000);
}

function formatStageDiagnostic(
  stage: VerificationStage,
  diagnostic: VerificationReport['stages'][number]['diagnostic'],
): string {
  if (diagnostic === undefined) return '';
  const parts: string[] = [];
  if (diagnostic.commandDescriptorId !== undefined) {
    parts.push(`Command descriptor: ${diagnostic.commandDescriptorId}`);
  }
  if (diagnostic.exitCode !== undefined) {
    parts.push(`Exit code: ${diagnostic.exitCode}`);
  }
  if (diagnostic.stdoutExcerpt !== undefined) {
    parts.push(
      `Stdout excerpt (${stage}): ${redactVerificationOutput(diagnostic.stdoutExcerpt).slice(0, MAX_INVESTIGATION_DIAGNOSTIC_CHARS)}`,
    );
  }
  if (diagnostic.stderrExcerpt !== undefined) {
    parts.push(
      `Stderr excerpt (${stage}): ${redactVerificationOutput(diagnostic.stderrExcerpt).slice(0, MAX_INVESTIGATION_DIAGNOSTIC_CHARS)}`,
    );
  }
  if (diagnostic.truncated) {
    parts.push('Diagnostic output was truncated before investigation handoff.');
  }
  return parts.join('\n');
}
