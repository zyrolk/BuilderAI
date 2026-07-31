export const PROTECTED_PATH_RULE_KINDS = ['EXACT', 'SUBTREE', 'PATH_PREFIX'] as const;

export type ProtectedPathRuleKind = (typeof PROTECTED_PATH_RULE_KINDS)[number];

export interface ProtectedPathRule {
  readonly id: string;
  readonly kind: ProtectedPathRuleKind;
  readonly path: string;
  readonly rationale: string;
}

export interface FileApplyConfiguration {
  readonly maximumOperations: number;
  readonly additionalProtectedPathRules: readonly ProtectedPathRule[];
}

export const MANDATORY_PROTECTED_PATH_RULES: readonly ProtectedPathRule[] = [
  {
    id: 'git-internals',
    kind: 'SUBTREE',
    path: '.git',
    rationale: 'Git repository internals are outside the File Apply Engine boundary.',
  },
  {
    id: 'environment-secrets',
    kind: 'PATH_PREFIX',
    path: '.env',
    rationale: 'Environment files may contain credentials or deployment secrets.',
  },
  {
    id: 'canonical-project-brain',
    kind: 'EXACT',
    path: 'project-brain.json',
    rationale: 'Canonical Project Brain state changes require intent-based commands.',
  },
  {
    id: 'agent-governance',
    kind: 'EXACT',
    path: 'AGENTS.md',
    rationale: 'Repository agent governance requires explicit architectural review.',
  },
  {
    id: 'ci-workflows',
    kind: 'SUBTREE',
    path: '.github/workflows',
    rationale: 'CI workflow changes can alter trusted execution and credential access.',
  },
];

export const DEFAULT_FILE_APPLY_CONFIGURATION: FileApplyConfiguration = {
  maximumOperations: 100,
  additionalProtectedPathRules: [],
};
