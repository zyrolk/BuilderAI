import type { ExecutionCancellationToken } from '../../../core/execution-engine';

export type CorrectionCleanupHandler = () => void | Promise<void>;

interface CorrectionCancellationSession {
  cancelled: boolean;
  reason?: string;
  cleanups: CorrectionCleanupHandler[];
  tokenUnsubscribes: Array<() => void>;
}

/**
 * Process-local cancellation bridge for bounded correction workflows.
 * Reuses ExecutionCancellationToken from HTTP AbortSignal (P0-6/P0-7/P0-8).
 */
export class CorrectionCancellationRegistry {
  private readonly sessions = new Map<string, CorrectionCancellationSession>();

  register(
    workflowId: string,
    token: ExecutionCancellationToken,
    cleanup?: CorrectionCleanupHandler,
  ): void {
    let session = this.sessions.get(workflowId);
    if (session === undefined) {
      session = { cancelled: false, cleanups: [], tokenUnsubscribes: [] };
      this.sessions.set(workflowId, session);
    }
    if (cleanup !== undefined) session.cleanups.push(cleanup);
    if (session.cancelled) return;
    if (token.cancelled) {
      void this.cancel(workflowId, token.reason ?? 'request aborted');
      return;
    }
    const unsubscribe = token.subscribe((reason) => {
      void this.cancel(workflowId, reason ?? 'request aborted');
    });
    session.tokenUnsubscribes.push(unsubscribe);
  }

  registerCleanup(workflowId: string, cleanup: CorrectionCleanupHandler): void {
    let session = this.sessions.get(workflowId);
    if (session === undefined) {
      session = { cancelled: false, cleanups: [], tokenUnsubscribes: [] };
      this.sessions.set(workflowId, session);
    }
    session.cleanups.push(cleanup);
    if (session.cancelled) void runCleanup(cleanup);
  }

  isCancelled(workflowId: string): boolean {
    return this.sessions.get(workflowId)?.cancelled ?? false;
  }

  cancellationReason(workflowId: string): string | undefined {
    return this.sessions.get(workflowId)?.reason;
  }

  async cancel(workflowId: string, reason = 'correction cancelled'): Promise<void> {
    const session = this.sessions.get(workflowId);
    if (session === undefined || session.cancelled) return;
    session.cancelled = true;
    session.reason = reason;
    for (const unsubscribe of session.tokenUnsubscribes) unsubscribe();
    session.tokenUnsubscribes = [];
    const cleanups = [...session.cleanups];
    session.cleanups = [];
    for (const cleanup of cleanups) {
      await runCleanup(cleanup);
    }
  }

  clear(workflowId: string): void {
    const session = this.sessions.get(workflowId);
    if (session === undefined) return;
    for (const unsubscribe of session.tokenUnsubscribes) unsubscribe();
    this.sessions.delete(workflowId);
  }
}

async function runCleanup(cleanup: CorrectionCleanupHandler): Promise<void> {
  try {
    await cleanup();
  } catch {
    // Cleanup must not block cancellation completion.
  }
}
