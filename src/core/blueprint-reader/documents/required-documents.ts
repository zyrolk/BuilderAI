import type { RequiredDocumentSpec } from '../types';

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

export const REQUIRED_DOCUMENTS: readonly RequiredDocumentSpec[] = [
  {
    kind: 'project-brain',
    path: 'project-brain.json',
    format: 'JSON',
    supportedVersions: [1],
    requiredSections: [],
  },
  markdown('project-constitution', 'docs/project-constitution.md', [
    'Authority',
    'Precedence',
    'Non-negotiable principles',
    'Change protocol',
  ]),
  markdown('project-blueprint', 'docs/project-blueprint.md', [
    'Canonical record',
    'Responsibilities',
    'Mutation policy',
  ]),
  markdown('project-memory', 'docs/project-memory.md', [
    'Canonical record',
    'Responsibilities',
    'Mutation policy',
  ]),
  markdown('decision-log', 'docs/decision-log.md', [
    'Canonical record',
    'Responsibilities',
    'History policy',
  ]),
  markdown('progress-log', 'docs/progress-log.md', [
    'Canonical record',
    'Responsibilities',
    'Mutation policy',
  ]),
  markdown('task-system', 'docs/task-system.md', [
    'Task contract',
    'States and transitions',
    'Invariants',
    'Operating procedure',
  ]),
  markdown('domain-glossary', 'docs/domain-glossary.md', [
    'Canonical record',
    'Responsibilities',
    'Mutation policy',
  ]),
  markdown('architecture', 'docs/architecture.md', [
    'Status and scope',
    'Architectural principles',
    'System context',
    'Target source boundaries',
    'Project Brain core',
    'Quality attributes',
    'Decision governance',
  ]),
  markdown('roadmap', 'docs/roadmap.md', [
    'Canonical planning state',
    'Planning rules',
    'Product AI gate',
    'Scope transition',
  ]),
  markdown('coding-standards', 'docs/coding-standards.md', [
    'Language and types',
    'Modules and dependencies',
    'Errors and observability',
    'Testing',
    'Definition of done',
  ]),
  markdown('ai-rules', 'docs/ai-rules.md', [
    'Required behavior',
    'Prohibited actions without explicit approval',
    'Verification and handoff',
    'Product AI boundary',
  ]),
] as const;

export function normalizeDocumentPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

export function documentBasename(path: string): string {
  return normalizeDocumentPath(path).split('/').at(-1) ?? '';
}
