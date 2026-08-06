import type { InvestigationEvidence, RepositorySearchResult } from './investigation.types';

export function buildInvestigationPrompt(
  request: string,
  searchResult: RepositorySearchResult,
  evidence: readonly InvestigationEvidence[],
): string {
  const evidenceSection =
    evidence.length === 0
      ? 'No repository evidence was selected.'
      : evidence
          .map((entry) => {
            const location =
              entry.lineStart === undefined
                ? entry.logicalPath
                : `${entry.logicalPath}:${entry.lineStart}`;
            const excerpt = entry.excerpt === undefined ? '' : `\n${entry.excerpt}`;
            return `- [${entry.claimKind}] ${location} — ${entry.reason}${excerpt}`;
          })
          .join('\n');

  return [
    'You are performing a read-only repository investigation.',
    'Do not propose file mutations or a change plan.',
    'Classify each claim as FACT (directly supported by evidence), INFERENCE (reasonable interpretation), or UNKNOWN.',
    'If evidence is insufficient, set confidence to LOW, omit likelyRootCause, and state limitations explicitly.',
    '',
    'Return JSON only with this shape:',
    '{',
    '  "schemaVersion": 1,',
    '  "summary": string,',
    '  "confidence": "LOW" | "MEDIUM" | "HIGH",',
    '  "hypotheses": [{ "summary": string, "claimKind": "FACT"|"INFERENCE"|"UNKNOWN", "supportingEvidencePaths": string[] }],',
    '  "evidence": [{ "logicalPath": string, "lineStart?": number, "lineEnd?": number, "reason": string, "excerpt?": string, "claimKind": "FACT"|"INFERENCE"|"UNKNOWN" }],',
    '  "likelyRootCause?": string,',
    '  "affectedAreas": string[],',
    '  "recommendedNextSteps": string[],',
    '  "suggestedFixScope?": string,',
    '  "limitations": string[]',
    '}',
    '',
    `Operator request:\n${request.trim()}`,
    '',
    `Search queries:\n${searchResult.queries.join(', ') || '(none)'}`,
    '',
    `Repository evidence:\n${evidenceSection}`,
  ].join('\n');
}
