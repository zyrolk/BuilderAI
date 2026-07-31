import type { WorkspaceRuntimeLogger } from '../../application/workspace';

export class StructuredRuntimeLogger implements WorkspaceRuntimeLogger {
  record(event: Parameters<WorkspaceRuntimeLogger['record']>[0]): void {
    const entry = {
      timestamp: new Date().toISOString(),
      component: 'workspace-runtime',
      ...event,
    };
    if (event.outcome === 'FAILED') console.error(JSON.stringify(entry));
    else console.info(JSON.stringify(entry));
  }
}
