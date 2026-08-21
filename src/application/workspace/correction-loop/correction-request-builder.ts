import type { CorrectionDiagnostic } from './correction-loop.types';

const MAX_REQUEST_CHARS = 3_500 as const;

export function buildCorrectionRequest(input: {
  readonly diagnostic: CorrectionDiagnostic;
  readonly originalTaskSummary?: string;
  readonly priorRequestSummary?: string;
  readonly attempt: number;
  readonly maximumAttempts: number;
}): string {
  const lines = [
    `Correction attempt ${input.attempt}/${input.maximumAttempts}.`,
    'This is a bounded correction after an approved mutation was already applied.',
    'Previous unrelated work must be preserved. Only change files supported by evidence.',
    'Do not modify protected files or secrets. Do not claim tests passed without evidence.',
    '',
    `Failure category: ${input.diagnostic.failureCategory}`,
    `Summary: ${input.diagnostic.summary}`,
  ];
  if (input.originalTaskSummary !== undefined && input.originalTaskSummary.trim().length > 0) {
    lines.push('', `Original task: ${input.originalTaskSummary.trim().slice(0, 500)}`);
  }
  if (input.priorRequestSummary !== undefined && input.priorRequestSummary.trim().length > 0) {
    lines.push('', `Prior request: ${input.priorRequestSummary.trim().slice(0, 500)}`);
  }
  if (input.diagnostic.affectedFiles.length > 0) {
    lines.push('', 'Affected files:', ...input.diagnostic.affectedFiles.map((path) => `- ${path}`));
  }
  if (input.diagnostic.affectedRoutes.length > 0) {
    lines.push(
      '',
      'Affected routes:',
      ...input.diagnostic.affectedRoutes.map((route) => `- ${route}`),
    );
  }
  if (input.diagnostic.diagnostics.length > 0) {
    lines.push('', 'Evidence:');
    for (const item of input.diagnostic.diagnostics) {
      lines.push(
        `- ${item.code}${item.route === undefined ? '' : ` (${item.route})`}: ${item.message}`,
      );
    }
  }
  lines.push('', 'Return the smallest safe correction supported by this evidence.');
  return lines.join('\n').slice(0, MAX_REQUEST_CHARS);
}
