const FORBIDDEN_KEY_SUBSTRINGS = [
  'token',
  'secret',
  'password',
  'apikey',
  'api_key',
  'credential',
  'private_key',
  'authorization',
] as const;

const SECRET_VALUE_PATTERNS = [
  /\b(?:sk|pk)[-_][a-z0-9]{10,}\b/iu,
  /\bAIza[0-9A-Za-z_-]{20,}\b/u,
  /\bBearer\s+[A-Za-z0-9._-]{20,}\b/iu,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/u,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/iu,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./u,
  /\b(?:process\.env\.|import\.meta\.env\.)\w+/u,
  /\b[A-Z0-9_]{3,}=(?:['"][^'"]{8,}['"]|\S{8,})/u,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
] as const;

const REDACTION = '[REDACTED]';

export function containsSecretLikeVerificationOutput(text: string): boolean {
  const lower = text.toLowerCase();
  if (FORBIDDEN_KEY_SUBSTRINGS.some((fragment) => lower.includes(fragment))) return true;
  return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(text));
}

export function redactVerificationOutput(text: string): string {
  let redacted = text;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    redacted = redacted.replace(pattern, REDACTION);
  }
  const lower = redacted.toLowerCase();
  if (FORBIDDEN_KEY_SUBSTRINGS.some((fragment) => lower.includes(fragment))) {
    return redacted
      .split('\n')
      .map((line) => (containsSecretLikeVerificationOutput(line) ? REDACTION : line))
      .join('\n');
  }
  return redacted;
}
