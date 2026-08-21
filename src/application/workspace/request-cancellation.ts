import type { ExecutionCancellationToken } from '../../core/execution-engine';

/**
 * Creates an ExecutionCancellationToken from a Web API AbortSignal.
 * Bridges HTTP request disconnect into provider/retry cancellation.
 */
export function createCancellationTokenFromSignal(
  signal: AbortSignal | undefined,
): ExecutionCancellationToken {
  if (signal === undefined) {
    return { cancelled: false, subscribe: () => () => undefined };
  }

  const listeners: Array<(reason?: string) => void> = [];
  let cancelled = signal.aborted;
  let reason: string | undefined = cancelled ? 'request aborted' : undefined;

  const onAbort = (): void => {
    cancelled = true;
    reason = 'request aborted';
    for (const listener of listeners) listener(reason);
  };

  if (!cancelled) {
    signal.addEventListener('abort', onAbort, { once: true });
  }

  return {
    get cancelled() {
      return cancelled;
    },
    get reason() {
      return reason;
    },
    subscribe(listener: (r?: string) => void) {
      listeners.push(listener);
      return () => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
  };
}
