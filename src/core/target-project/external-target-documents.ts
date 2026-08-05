import type { RequiredDocumentSpec } from '../blueprint-reader';

export const TARGET_PROJECT_MANIFEST_PATH = '.builderai/target-project.json';

const markdown = (
  kind: RequiredDocumentSpec['kind'],
  path: string,
  requiredSections: readonly string[],
): RequiredDocumentSpec => ({
  kind,
  path,
  format: 'MARKDOWN',
  supportedVersions: [1],
  requiredSections,
});

export const EXTERNAL_TARGET_REQUIRED_DOCUMENTS: readonly RequiredDocumentSpec[] = [
  markdown('architecture', 'docs/architecture.md', [
    'Status and scope',
    'Architectural principles',
    'Target source boundaries',
  ]),
  markdown('project-constitution', 'docs/project-constitution.md', [
    'Authority',
    'Precedence',
    'Non-negotiable principles',
    'Change protocol',
  ]),
  markdown('ai-rules', 'docs/ai-rules.md', [
    'Required behavior',
    'Prohibited actions without explicit approval',
    'Verification and handoff',
  ]),
] as const;
