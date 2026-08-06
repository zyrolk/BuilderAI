import type { VerificationDiagnostic } from '../../core/verification';
import { redactVerificationOutput } from './verification-output-sanitize';

export interface VerificationDiagnosticLimits {
  readonly maximumStdoutCharacters: number;
  readonly maximumStderrCharacters: number;
  readonly maximumCombinedCharacters: number;
}

export interface BuildVerificationDiagnosticInput {
  readonly commandLabel: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly outputBytes: number;
  readonly outputTruncated: boolean;
  readonly limits: VerificationDiagnosticLimits;
}

export function buildVerificationDiagnostic(
  input: BuildVerificationDiagnosticInput,
): VerificationDiagnostic {
  const sanitizedStdout = redactVerificationOutput(input.stdout);
  const sanitizedStderr = redactVerificationOutput(input.stderr);
  const stdoutExcerpt = excerptStream(
    sanitizedStdout,
    input.limits.maximumStdoutCharacters,
    input.limits.maximumCombinedCharacters,
    0,
  );
  const stderrExcerpt = excerptStream(
    sanitizedStderr,
    input.limits.maximumStderrCharacters,
    input.limits.maximumCombinedCharacters,
    stdoutExcerpt.text.length,
  );
  const truncated =
    input.outputTruncated ||
    stdoutExcerpt.truncated ||
    stderrExcerpt.truncated ||
    sanitizedStdout.length > stdoutExcerpt.text.length ||
    sanitizedStderr.length > stderrExcerpt.text.length;
  const omittedBytes = truncated
    ? Math.max(
        0,
        input.outputBytes - Buffer.byteLength(stdoutExcerpt.text + stderrExcerpt.text, 'utf8'),
      )
    : undefined;

  return {
    commandLabel: input.commandLabel,
    ...(input.timedOut ? {} : { exitCode: input.exitCode ?? -1 }),
    ...(stdoutExcerpt.text.length === 0 ? {} : { stdoutExcerpt: stdoutExcerpt.text }),
    ...(stderrExcerpt.text.length === 0 ? {} : { stderrExcerpt: stderrExcerpt.text }),
    truncated,
    ...(omittedBytes === undefined || omittedBytes === 0 ? {} : { omittedBytes }),
  };
}

function excerptStream(
  text: string,
  maximumCharacters: number,
  maximumCombinedCharacters: number,
  combinedCharactersUsed: number,
): { readonly text: string; readonly truncated: boolean } {
  const remainingCombined = Math.max(0, maximumCombinedCharacters - combinedCharactersUsed);
  const budget = Math.min(maximumCharacters, remainingCombined);
  if (text.length <= budget) {
    return { text, truncated: false };
  }
  if (budget <= 1) {
    return { text: '…', truncated: true };
  }
  const tailBudget = Math.max(1, Math.floor(budget * 0.7));
  const headBudget = Math.max(1, budget - tailBudget - 1);
  const head = text.slice(0, headBudget);
  const tail = text.slice(-tailBudget);
  return { text: `${head}…${tail}`, truncated: true };
}
