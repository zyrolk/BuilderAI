import path from 'node:path';

export const DEFAULT_WORKFLOW_STATE_ROOT = '.builderai-runtime';

export interface WorkflowStateRootConfiguration {
  readonly stateRoot: string;
  readonly workflowsDirectoryName: string;
}

export const DEFAULT_WORKFLOW_STATE_ROOT_CONFIGURATION: WorkflowStateRootConfiguration = {
  stateRoot: resolveWorkflowStateRoot(),
  workflowsDirectoryName: 'workflows',
};

export function resolveWorkflowStateRoot(): string {
  const configured = process.env.BUILDERAI_WORKFLOW_STATE_ROOT?.trim();
  if (configured !== undefined && configured.length > 0) {
    return path.resolve(configured);
  }
  return path.resolve(process.cwd(), DEFAULT_WORKFLOW_STATE_ROOT);
}

export function workflowProjectDirectory(
  configuration: WorkflowStateRootConfiguration,
  projectId: string,
): string {
  return path.join(
    configuration.stateRoot,
    configuration.workflowsDirectoryName,
    sanitizeSegment(projectId),
  );
}

export function workflowDirectory(
  configuration: WorkflowStateRootConfiguration,
  projectId: string,
  workflowId: string,
): string {
  return path.join(workflowProjectDirectory(configuration, projectId), sanitizeSegment(workflowId));
}

function sanitizeSegment(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]/gu, '_');
  if (sanitized.length === 0) {
    throw new Error('Workflow path segment is empty after sanitization.');
  }
  return sanitized;
}
