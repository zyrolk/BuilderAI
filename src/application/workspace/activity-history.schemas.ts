import type { WorkspaceActivity, WorkspaceActivityHistory } from './activity-history.types';

const forbiddenKeys = new Set([
  'stdout',
  'stderr',
  'rawoutput',
  'rawresponse',
  'secret',
  'env',
  'environment',
  'apikey',
  'token',
  'password',
  'filecontent',
  'rawcontent',
]);

function isAbsolutePath(val: string): boolean {
  return val.startsWith('/') || /^[a-zA-Z]:\\/.test(val) || val.startsWith('\\');
}

function validateValue(val: unknown, path: string): void {
  if (val === null || val === undefined) {
    return;
  }

  if (typeof val === 'string') {
    if (isAbsolutePath(val)) {
      throw new Error(`Absolute path is forbidden: "${val}" at ${path}`);
    }
    return;
  }

  if (Array.isArray(val)) {
    val.forEach((item, index) => {
      validateValue(item, path ? `${path}.${index}` : `${index}`);
    });
    return;
  }

  if (typeof val === 'object') {
    Object.entries(val).forEach(([key, value]) => {
      if (forbiddenKeys.has(key.toLowerCase())) {
        throw new Error(`Forbidden field key: "${key}" at ${path ? `${path}.${key}` : key}`);
      }
      validateValue(value, path ? `${path}.${key}` : key);
    });
  }
}

export function parseWorkspaceActivity(value: unknown): WorkspaceActivity {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Activity must be an object');
  }

  const obj = value as Record<string, unknown>;

  if (typeof obj.activityId !== 'string' || obj.activityId.length === 0) {
    throw new Error('Invalid activityId');
  }
  if (typeof obj.correlationId !== 'string' || obj.correlationId.length === 0) {
    throw new Error('Invalid correlationId');
  }
  if (typeof obj.featurePlanId !== 'string' || obj.featurePlanId.length === 0) {
    throw new Error('Invalid featurePlanId');
  }
  if (typeof obj.taskId !== 'string' || obj.taskId.length === 0) {
    throw new Error('Invalid taskId');
  }
  if (typeof obj.timestamp !== 'string' || isNaN(Date.parse(obj.timestamp))) {
    throw new Error('Invalid timestamp');
  }

  const type = obj.type;
  if (typeof type !== 'string') {
    throw new Error('Invalid activity type');
  }

  const payload = obj.payload;
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Invalid payload');
  }

  switch (type) {
    case 'TASK_PREPARATION_STARTED': {
      const p = payload as Record<string, unknown>;
      if (p.promptBudgetCharacters !== undefined && typeof p.promptBudgetCharacters !== 'number') {
        throw new Error('Invalid promptBudgetCharacters');
      }
      break;
    }
    case 'TASK_PREPARATION_COMPLETED': {
      const p = payload as Record<string, unknown>;
      if (typeof p.durationMs !== 'number' || p.durationMs < 0) {
        throw new Error('Invalid durationMs');
      }
      const summary = p.changePlanSummary;
      if (typeof summary !== 'object' || summary === null) {
        throw new Error('Invalid changePlanSummary');
      }
      const s = summary as Record<string, unknown>;
      if (typeof s.createdCount !== 'number' || s.createdCount < 0) {
        throw new Error('Invalid createdCount');
      }
      if (typeof s.updatedCount !== 'number' || s.updatedCount < 0) {
        throw new Error('Invalid updatedCount');
      }
      if (typeof s.deletedCount !== 'number' || s.deletedCount < 0) {
        throw new Error('Invalid deletedCount');
      }
      if (!Array.isArray(s.affectedPaths) || !s.affectedPaths.every((x) => typeof x === 'string')) {
        throw new Error('Invalid affectedPaths');
      }
      break;
    }
    case 'TASK_PREPARATION_FAILED': {
      const p = payload as Record<string, unknown>;
      if (typeof p.durationMs !== 'number' || p.durationMs < 0) {
        throw new Error('Invalid durationMs');
      }
      if (typeof p.errorCode !== 'string' || p.errorCode.length === 0) {
        throw new Error('Invalid errorCode');
      }
      if (typeof p.errorMessage !== 'string' || p.errorMessage.length === 0) {
        throw new Error('Invalid errorMessage');
      }
      break;
    }
    case 'FILE_APPLICATION_STARTED': {
      const p = payload as Record<string, unknown>;
      if (p.changePlanId !== undefined && typeof p.changePlanId !== 'string') {
        throw new Error('Invalid changePlanId');
      }
      break;
    }
    case 'FILE_APPLICATION_COMPLETED': {
      const p = payload as Record<string, unknown>;
      if (typeof p.durationMs !== 'number' || p.durationMs < 0) {
        throw new Error('Invalid durationMs');
      }
      if (p.status !== 'APPLIED' && p.status !== 'PARTIALLY_APPLIED') {
        throw new Error('Invalid status');
      }
      if (!Array.isArray(p.createdFiles) || !p.createdFiles.every((x) => typeof x === 'string')) {
        throw new Error('Invalid createdFiles');
      }
      if (!Array.isArray(p.updatedFiles) || !p.updatedFiles.every((x) => typeof x === 'string')) {
        throw new Error('Invalid updatedFiles');
      }
      if (!Array.isArray(p.deletedFiles) || !p.deletedFiles.every((x) => typeof x === 'string')) {
        throw new Error('Invalid deletedFiles');
      }
      if (!Array.isArray(p.skippedFiles) || !p.skippedFiles.every((x) => typeof x === 'string')) {
        throw new Error('Invalid skippedFiles');
      }
      if (typeof p.warningCount !== 'number' || p.warningCount < 0) {
        throw new Error('Invalid warningCount');
      }
      if (typeof p.errorCount !== 'number' || p.errorCount < 0) {
        throw new Error('Invalid errorCount');
      }
      break;
    }
    case 'FILE_APPLICATION_FAILED': {
      const p = payload as Record<string, unknown>;
      if (typeof p.durationMs !== 'number' || p.durationMs < 0) {
        throw new Error('Invalid durationMs');
      }
      if (p.status !== 'REJECTED' && p.status !== 'FAILED') {
        throw new Error('Invalid status');
      }
      if (typeof p.errorCode !== 'string' || p.errorCode.length === 0) {
        throw new Error('Invalid errorCode');
      }
      if (typeof p.errorMessage !== 'string' || p.errorMessage.length === 0) {
        throw new Error('Invalid errorMessage');
      }
      if (p.failedPath !== undefined && typeof p.failedPath !== 'string') {
        throw new Error('Invalid failedPath');
      }
      break;
    }
    case 'VERIFICATION_STARTED': {
      break;
    }
    case 'VERIFICATION_COMPLETED': {
      const p = payload as Record<string, unknown>;
      if (typeof p.durationMs !== 'number' || p.durationMs < 0) {
        throw new Error('Invalid durationMs');
      }
      if (p.status !== 'PASSED' && p.status !== 'PARTIALLY_PASSED' && p.status !== 'FAILED') {
        throw new Error('Invalid status');
      }
      if (!Array.isArray(p.stages)) {
        throw new Error('Invalid stages');
      }
      p.stages.forEach((stage: unknown) => {
        if (typeof stage !== 'object' || stage === null) {
          throw new Error('Invalid stage');
        }
        const s = stage as Record<string, unknown>;
        if (
          s.name !== 'PROJECT' &&
          s.name !== 'DEPENDENCY' &&
          s.name !== 'BUILD' &&
          s.name !== 'TEST' &&
          s.name !== 'LINT' &&
          s.name !== 'TYPECHECK'
        ) {
          throw new Error('Invalid stage name');
        }
        if (s.status !== 'PASSED' && s.status !== 'FAILED' && s.status !== 'SKIPPED') {
          throw new Error('Invalid stage status');
        }
        if (typeof s.durationMs !== 'number' || s.durationMs < 0) {
          throw new Error('Invalid stage durationMs');
        }
        if (typeof s.findingCount !== 'number' || s.findingCount < 0) {
          throw new Error('Invalid stage findingCount');
        }
      });
      break;
    }
    case 'VERIFICATION_FAILED': {
      const p = payload as Record<string, unknown>;
      if (typeof p.durationMs !== 'number' || p.durationMs < 0) {
        throw new Error('Invalid durationMs');
      }
      if (typeof p.errorCode !== 'string' || p.errorCode.length === 0) {
        throw new Error('Invalid errorCode');
      }
      if (typeof p.errorMessage !== 'string' || p.errorMessage.length === 0) {
        throw new Error('Invalid errorMessage');
      }
      break;
    }
    default:
      throw new Error(`Unknown activity type: ${type}`);
  }

  validateValue(value, '');

  return value as WorkspaceActivity;
}

export function parseWorkspaceActivityHistory(value: unknown): WorkspaceActivityHistory {
  if (typeof value !== 'object' || value === null) {
    throw new Error('History must be an object');
  }
  const obj = value as Record<string, unknown>;
  if (obj.schemaVersion !== 1) {
    throw new Error('Invalid schemaVersion');
  }
  if (!Array.isArray(obj.activities)) {
    throw new Error('Invalid activities array');
  }
  const activities = obj.activities.map(parseWorkspaceActivity);
  return {
    schemaVersion: 1,
    activities,
  };
}

export const parseActivityHistoryEntry = parseWorkspaceActivity;
export const parseActivityHistory = parseWorkspaceActivityHistory;
