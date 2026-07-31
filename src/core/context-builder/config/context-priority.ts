import type { DocumentKind } from '../../blueprint-reader';
import type { ContextPriority } from '../types';

export const CONTEXT_PRIORITY_RANK: Readonly<Record<ContextPriority, number>> = {
  PROJECT_CONSTITUTION: 1,
  PROJECT_BRAIN: 2,
  CURRENT_TASK: 3,
  ARCHITECTURE: 4,
  BLUEPRINT: 5,
  DECISION_LOG: 6,
  PROGRESS: 7,
  CODING_STANDARDS: 8,
  AI_RULES: 9,
  RELATED_SOURCE_FILES: 10,
};

export const DOCUMENT_PRIORITY: Readonly<
  Record<Exclude<DocumentKind, 'project-brain'>, ContextPriority>
> = {
  'project-constitution': 'PROJECT_CONSTITUTION',
  'project-blueprint': 'BLUEPRINT',
  'project-memory': 'PROJECT_BRAIN',
  'decision-log': 'DECISION_LOG',
  'progress-log': 'PROGRESS',
  'task-system': 'PROGRESS',
  'domain-glossary': 'PROJECT_BRAIN',
  architecture: 'ARCHITECTURE',
  roadmap: 'BLUEPRINT',
  'coding-standards': 'CODING_STANDARDS',
  'ai-rules': 'AI_RULES',
};

export const MANDATORY_DOCUMENT_KINDS: readonly DocumentKind[] = [
  'project-constitution',
  'ai-rules',
];
