import { createHash } from 'node:crypto';

import type { ProjectChangePlan } from '../../../core/change-planner';
import { sanitizeUrlForEvidence } from '../../../core/runtime-verification/policy';
import {
  CORRECTION_LOOP_SCHEMA_VERSION,
  type CorrectionDiagnostic,
  type CorrectionDiagnosticEvidence,
  type CorrectionFailureCategory,
  type CorrectionLoopBeginInput,
} from './correction-loop.types';
import type { CorrectionFailureClassification } from './correction-failure-classifier';

const MAX_DIAGNOSTICS = 12 as const;
const MAX_AFFECTED_FILES = 20 as const;
const MAX_AFFECTED_ROUTES = 5 as const;
const MAX_EVIDENCE_REFERENCES = 8 as const;
const MAX_SUMMARY_CHARS = 500 as const;

export function buildCorrectionDiagnostic(input: {
  readonly workflowId: string;
  readonly attempt: number;
  readonly classification: CorrectionFailureClassification;
  readonly beginInput: CorrectionLoopBeginInput;
}): CorrectionDiagnostic {
  const diagnostics = collectDiagnostics(input.beginInput, input.classification.category);
  const affectedFiles = collectAffectedFiles(input.beginInput).slice(0, MAX_AFFECTED_FILES);
  const affectedRoutes = collectAffectedRoutes(input.beginInput).slice(0, MAX_AFFECTED_ROUTES);
  const sufficientEvidence =
    affectedFiles.length > 0 || diagnostics.length > 0 || affectedRoutes.length > 0;
  const diagnosticDigest = digestDiagnostic(
    input.classification.category,
    diagnostics,
    affectedFiles,
  );

  return {
    schemaVersion: CORRECTION_LOOP_SCHEMA_VERSION,
    workflowId: input.workflowId,
    attempt: input.attempt,
    failureStage: input.classification.failureStage,
    failureCategory: input.classification.category,
    summary: input.classification.summary.slice(0, MAX_SUMMARY_CHARS),
    affectedRoutes,
    affectedFiles,
    diagnostics,
    evidenceReferences: buildEvidenceReferences(input.beginInput).slice(0, MAX_EVIDENCE_REFERENCES),
    ...(input.beginInput.verificationReport === undefined
      ? {}
      : { verificationStatus: input.beginInput.verificationReport.status }),
    ...(input.beginInput.runtimeBrowserVerificationReport === undefined
      ? {}
      : {
          runtimeStatus: input.beginInput.runtimeBrowserVerificationReport.status,
          browserStatus: input.beginInput.runtimeBrowserVerificationReport.browser.status,
        }),
    diagnosticDigest,
    sufficientEvidence,
    metadata: {
      'correction-attempt': input.attempt,
      'failure-category': input.classification.category,
    },
    ...(input.beginInput.structuredFailureDiagnostics === undefined ||
    input.beginInput.structuredFailureDiagnostics.length === 0
      ? {}
      : { structuredFailureDiagnostics: input.beginInput.structuredFailureDiagnostics }),
  };
}

export function digestChangePlan(changePlan: ProjectChangePlan): string {
  const payload = changePlan.changeSet.operations
    .map(({ kind, logicalPath }) => `${kind}:${logicalPath}`)
    .sort((left, right) => left.localeCompare(right))
    .join('|');
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

export function digestDiagnostic(
  category: CorrectionFailureCategory,
  diagnostics: readonly CorrectionDiagnosticEvidence[],
  affectedFiles: readonly string[],
): string {
  const payload = [
    category,
    ...diagnostics.map(({ code, path }) => `${code}:${path ?? ''}`),
    ...affectedFiles,
  ].join('|');
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

function collectDiagnostics(
  input: CorrectionLoopBeginInput,
  category: CorrectionFailureCategory,
): readonly CorrectionDiagnosticEvidence[] {
  const items: CorrectionDiagnosticEvidence[] = [];
  const verification = input.verificationReport;
  if (verification !== undefined) {
    for (const stage of verification.stages) {
      if (stage.status === 'PASSED' || stage.status === 'SKIPPED') continue;
      for (const error of stage.errors) {
        items.push({
          code: error.code,
          message: sanitizeMessage(error.message),
        });
        if (items.length >= MAX_DIAGNOSTICS) return items;
      }
    }
    for (const error of verification.errors) {
      items.push({ code: error.code, message: sanitizeMessage(error.message) });
      if (items.length >= MAX_DIAGNOSTICS) return items;
    }
  }
  const runtime = input.runtimeBrowserVerificationReport;
  if (runtime !== undefined) {
    if (runtime.server.policyBlockCode !== undefined) {
      items.push({
        code: 'RUNTIME_SERVER_POLICY',
        message: runtime.server.policyBlockCode,
      });
    }
    for (const route of runtime.browser.routes) {
      for (const error of route.consoleErrors) {
        items.push({
          code: 'BROWSER_CONSOLE_ERROR',
          message: sanitizeMessage(error.message),
          route: route.path,
        });
        if (items.length >= MAX_DIAGNOSTICS) return items;
      }
      for (const exception of route.pageExceptions) {
        items.push({
          code: 'BROWSER_PAGE_ERROR',
          message: sanitizeMessage(exception),
          route: route.path,
        });
        if (items.length >= MAX_DIAGNOSTICS) return items;
      }
      for (const request of route.failedRequests) {
        items.push({
          code: 'BROWSER_NETWORK_ERROR',
          message: sanitizeUrlForEvidence(request.url),
          route: route.path,
        });
        if (items.length >= MAX_DIAGNOSTICS) return items;
      }
    }
    void category;
  }
  return items;
}

function collectAffectedFiles(input: CorrectionLoopBeginInput): readonly string[] {
  const paths = new Set<string>();
  for (const path of [...input.createdPaths, ...input.updatedPaths, ...input.deletedPaths]) {
    if (isSafeRelativePath(path)) paths.add(path);
  }
  return [...paths].sort((left, right) => left.localeCompare(right));
}

function collectAffectedRoutes(input: CorrectionLoopBeginInput): readonly string[] {
  const routes = input.runtimeBrowserVerificationReport?.browser.routes ?? [];
  return routes
    .filter(({ status }) => status !== 'PASSED')
    .map(({ path }) => path)
    .slice(0, MAX_AFFECTED_ROUTES);
}

function buildEvidenceReferences(input: CorrectionLoopBeginInput): readonly string[] {
  const references: string[] = [];
  if (input.verificationReport !== undefined) {
    references.push(`verification:${input.verificationReport.status}`);
  }
  if (input.runtimeBrowserVerificationReport !== undefined) {
    references.push(`runtime-browser:${input.runtimeBrowserVerificationReport.status}`);
  }
  for (const path of collectAffectedFiles(input).slice(0, 4)) {
    references.push(`path:${path}`);
  }
  return references;
}

function sanitizeMessage(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function isSafeRelativePath(value: string): boolean {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '').trim();
  return (
    normalized.length > 0 &&
    !normalized.startsWith('/') &&
    !/^[a-z]:\//i.test(normalized) &&
    !normalized.split('/').includes('..')
  );
}
