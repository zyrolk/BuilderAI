import {
  ProjectBrainValidationError,
  parseProjectBrain,
  type ProjectBrain,
} from '../../project-brain';
import { MANDATORY_DOCUMENT_KINDS } from '../config';
import { isSafeProjectPath, normalizeProjectPath } from '../internal/path';
import type {
  ContextBuildInput,
  ContextLimits,
  ContextValidationIssue,
  ValidatedContextInput,
} from '../types';
import { ContextBuilderValidationError } from '../types';

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateLimits(limits: ContextLimits, issues: ContextValidationIssue[]): void {
  const values: readonly [keyof ContextLimits, number, number][] = [
    ['maxCharacters', limits.maxCharacters, 1],
    ['maxFiles', limits.maxFiles, 0],
    ['maxDocuments', limits.maxDocuments, MANDATORY_DOCUMENT_KINDS.length],
    ['maxSourcePaths', limits.maxSourcePaths, 0],
    ['maxSourceReads', limits.maxSourceReads, 0],
  ];
  for (const [name, value, minimum] of values) {
    if (!Number.isSafeInteger(value) || value < minimum) {
      issues.push({
        code: 'INVALID_CONTEXT_LIMIT',
        path: `$.limits.${name}`,
        message: `must be a safe integer greater than or equal to ${minimum}`,
      });
    }
  }
}

function validateSourcePaths(
  sourcePaths: readonly string[],
  issues: ContextValidationIssue[],
): readonly string[] {
  const normalized = sourcePaths.map(normalizeProjectPath);
  const seen = new Set<string>();
  for (const [index, sourcePath] of normalized.entries()) {
    if (!isSafeProjectPath(sourcePath)) {
      issues.push({
        code: 'INVALID_REFERENCE',
        path: `$.sourceFileSource.paths[${index}]`,
        message: 'must be a safe repository-relative path',
      });
    }
    if (seen.has(sourcePath)) {
      issues.push({
        code: 'DUPLICATE_CONTEXT',
        path: `$.sourceFileSource.paths[${index}]`,
        message: `duplicates source path '${sourcePath}'`,
      });
    }
    seen.add(sourcePath);
  }
  return normalized;
}

export class ContextInputValidator {
  validate(
    input: ContextBuildInput,
    limits: ContextLimits,
    listedSourcePaths: readonly string[],
  ): ValidatedContextInput {
    const issues: ContextValidationIssue[] = [];
    validateLimits(limits, issues);

    let brain: ProjectBrain | undefined;
    try {
      brain = parseProjectBrain(input.projectBrain);
    } catch (error: unknown) {
      const message =
        error instanceof ProjectBrainValidationError
          ? error.issues.map((issue) => `${issue.path} ${issue.message}`).join('; ')
          : error instanceof Error
            ? error.message
            : 'unknown validation error';
      issues.push({
        code: 'INVALID_REFERENCE',
        path: '$.projectBrain',
        message: `Project Brain is invalid: ${message}`,
      });
      brain = undefined;
    }

    const reader = input.blueprintReaderOutput;
    if (!reader.valid) {
      issues.push({
        code: 'MISSING_REQUIRED_CONTEXT',
        path: '$.blueprintReaderOutput',
        message: 'Blueprint Reader output must be valid before context can be built',
      });
    }
    if (reader.diagnostics.some(({ severity }) => severity === 'ERROR')) {
      issues.push({
        code: 'CONFLICTING_CONTEXT',
        path: '$.blueprintReaderOutput.diagnostics',
        message: 'Blueprint Reader output contains error diagnostics',
      });
    }
    if (reader.analysis === undefined || reader.summary === undefined) {
      issues.push({
        code: 'MISSING_REQUIRED_CONTEXT',
        path: '$.blueprintReaderOutput',
        message: 'Blueprint Reader analysis and summary are required',
      });
    }

    const documentKinds = new Set(reader.documents.map(({ kind }) => kind));
    const documentPaths = reader.documents.map(({ path }) => normalizeProjectPath(path));
    for (const kind of MANDATORY_DOCUMENT_KINDS) {
      if (!documentKinds.has(kind)) {
        issues.push({
          code: 'MISSING_REQUIRED_CONTEXT',
          path: '$.blueprintReaderOutput.documents',
          message: `Required context document '${kind}' is missing`,
        });
      }
    }
    if (documentKinds.size !== reader.documents.length) {
      issues.push({
        code: 'DUPLICATE_CONTEXT',
        path: '$.blueprintReaderOutput.documents',
        message: 'Blueprint Reader output contains duplicate document kinds',
      });
    }
    if (new Set(documentPaths).size !== documentPaths.length) {
      issues.push({
        code: 'DUPLICATE_CONTEXT',
        path: '$.blueprintReaderOutput.documents',
        message: 'Blueprint Reader output contains duplicate document paths',
      });
    }

    const mandatoryFingerprints = reader.documents
      .filter(({ kind }) => MANDATORY_DOCUMENT_KINDS.includes(kind))
      .map(({ content }) => content.trim().replace(/\s+/g, ' ').toLowerCase());
    if (new Set(mandatoryFingerprints).size !== mandatoryFingerprints.length) {
      issues.push({
        code: 'DUPLICATE_CONTEXT',
        path: '$.blueprintReaderOutput.documents',
        message: 'Mandatory context documents contain duplicate information',
      });
    }

    const currentTask = brain?.tasks.find(({ id }) => id === input.currentTaskId);
    if (currentTask === undefined) {
      issues.push({
        code: 'INVALID_REFERENCE',
        path: '$.currentTaskId',
        message: `references unknown task '${input.currentTaskId}'`,
      });
    }

    if (brain !== undefined && reader.analysis !== undefined && reader.summary !== undefined) {
      const conflicts: readonly [string, unknown, unknown][] = [
        ['project ID', brain.blueprint.projectId, reader.analysis.projectId],
        ['project name', brain.blueprint.name, reader.analysis.projectName],
        ['project vision', brain.blueprint.vision, reader.analysis.vision],
        ['current milestone', brain.progressLog.currentMilestone, reader.summary.currentMilestone],
        ['goals', brain.blueprint.goals, reader.analysis.goals],
        ['constraints', brain.blueprint.constraints, reader.analysis.constraints],
        ['module ownership', brain.blueprint.folderOwnership, reader.analysis.modules],
      ];
      for (const [name, canonical, analyzed] of conflicts) {
        if (!sameValue(canonical, analyzed)) {
          issues.push({
            code: 'CONFLICTING_CONTEXT',
            path: '$.blueprintReaderOutput',
            message: `${name} conflicts with canonical Project Brain state`,
          });
        }
      }
    }

    const sourcePaths = validateSourcePaths(listedSourcePaths, issues);
    if (sourcePaths.length > limits.maxSourcePaths) {
      issues.push({
        code: 'CONTEXT_SIZE_EXCEEDED',
        path: '$.sourceFileSource.paths',
        message: `lists ${sourcePaths.length} source paths but the limit is ${limits.maxSourcePaths}`,
      });
    }
    const documentedPaths = new Set(documentPaths);
    for (const [index, sourcePath] of sourcePaths.entries()) {
      if (documentedPaths.has(sourcePath)) {
        issues.push({
          code: 'DUPLICATE_CONTEXT',
          path: `$.sourceFileSource.paths[${index}]`,
          message: `duplicates document path '${sourcePath}'`,
        });
      }
    }
    if (
      issues.length > 0 ||
      brain === undefined ||
      currentTask === undefined ||
      reader.analysis === undefined ||
      reader.summary === undefined
    ) {
      throw new ContextBuilderValidationError(issues);
    }

    return {
      brain,
      reader: { ...reader, analysis: reader.analysis, summary: reader.summary },
      currentTask,
      sourceFileSource: input.sourceFileSource,
      sourcePaths,
      iterationPathHints: validateIterationPathHints(input.iterationPathHints, issues),
    };
  }
}

function validateIterationPathHints(
  value: readonly string[] | undefined,
  issues: ContextValidationIssue[],
): readonly string[] {
  if (value === undefined || value.length === 0) return [];
  const hints: string[] = [];
  const seen = new Set<string>();
  for (const [index, candidate] of value.entries()) {
    if (typeof candidate !== 'string') continue;
    const normalized = normalizeProjectPath(candidate);
    if (!isSafeProjectPath(normalized)) {
      issues.push({
        code: 'INVALID_REFERENCE',
        path: `$.iterationPathHints[${index}]`,
        message: 'must be a safe repository-relative path',
      });
      continue;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    hints.push(normalized);
    if (hints.length >= 8) break;
  }
  return hints;
}
