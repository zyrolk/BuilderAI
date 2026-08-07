import type { PromptOutputContract } from '../../../core/prompt-orchestrator';

/** Explicit JSON shape instruction for provider responses (field names are normative). */
export const INVESTIGATION_OUTPUT_JSON_SHAPE = [
  'Return JSON only with this exact InvestigationReport shape:',
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
  'Use logicalPath (never path/filePath). Every evidence item needs non-empty logicalPath and reason.',
].join('\n');

export const INVESTIGATION_PROMPT_OUTPUT_CONTRACT: PromptOutputContract = {
  schemaVersion: 1,
  type: 'OBJECT',
  fields: [
    {
      name: 'schemaVersion',
      description: 'Investigation report schema version.',
      type: 'NUMBER',
      required: true,
    },
    {
      name: 'summary',
      description: 'Concise investigation summary.',
      type: 'STRING',
      required: true,
    },
    {
      name: 'confidence',
      description: 'Confidence level: LOW, MEDIUM, or HIGH.',
      type: 'STRING',
      required: true,
    },
    {
      name: 'hypotheses',
      description:
        'Array of { summary: string, claimKind: FACT|INFERENCE|UNKNOWN, supportingEvidencePaths: string[] }.',
      type: 'ARRAY',
      required: true,
    },
    {
      name: 'evidence',
      description:
        'Array of { logicalPath: string, reason: string, claimKind: FACT|INFERENCE|UNKNOWN, lineStart?, lineEnd?, excerpt? }.',
      type: 'ARRAY',
      required: true,
    },
    {
      name: 'likelyRootCause',
      description: 'Likely root cause when evidence supports it.',
      type: 'STRING',
      required: false,
    },
    {
      name: 'affectedAreas',
      description: 'Repository areas affected by the investigation.',
      type: 'ARRAY',
      required: true,
    },
    {
      name: 'recommendedNextSteps',
      description: 'Bounded recommended next steps for the operator.',
      type: 'ARRAY',
      required: true,
    },
    {
      name: 'suggestedFixScope',
      description: 'Suggested bounded fix scope for a follow-up prepare request.',
      type: 'STRING',
      required: false,
    },
    {
      name: 'limitations',
      description: 'Explicit investigation limitations and unknowns.',
      type: 'ARRAY',
      required: true,
    },
  ],
  allowAdditionalFields: false,
};
