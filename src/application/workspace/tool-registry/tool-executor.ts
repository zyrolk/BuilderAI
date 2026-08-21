import type { ToolRegistry } from './tool-registry';
import type { ToolPolicyGate } from './tool-policy';
import {
  assertNoForbiddenToolResultPayload,
  digestToolStructured,
  sanitizeToolStructured,
  truncateToolSummary,
} from './tool-result-sanitizer';
import {
  TOOL_REGISTRY_SCHEMA_VERSION,
  ToolRegistryError,
  type ToolCallIntent,
  type ToolExecutionContext,
  type ToolHandlerRawResult,
  type ToolResult,
} from './tool-registry.types';

/**
 * Policy-gated tool executor. Process-local idempotency only (ADR-037).
 * Never imports or calls FileApply.
 */
export class ToolExecutor {
  private readonly idempotencyCache = new Map<string, ToolResult>();

  constructor(
    private readonly registry: ToolRegistry,
    private readonly policy: ToolPolicyGate,
  ) {}

  async execute(intent: ToolCallIntent, context: ToolExecutionContext): Promise<ToolResult> {
    const callId = intent.callId.trim();
    const toolId = intent.toolId.trim();
    if (callId.length === 0 || toolId.length === 0) {
      return policyRejected(
        callId || 'unknown',
        toolId || 'unknown',
        'INVALID_INTENT',
        'Invalid tool intent.',
      );
    }

    if (intent.idempotencyKey !== undefined && intent.idempotencyKey.trim().length > 0) {
      const cacheKey = `${context.runId}:${toolId}:${intent.idempotencyKey.trim()}`;
      const cached = this.idempotencyCache.get(cacheKey);
      if (cached !== undefined) return cached;
    }

    let handler;
    try {
      handler = this.registry.require(toolId);
    } catch (error) {
      if (error instanceof ToolRegistryError && error.code === 'UNKNOWN_TOOL') {
        return policyRejected(callId, toolId, 'UNKNOWN_TOOL', error.message);
      }
      throw error;
    }

    const auth = this.policy.authorizeInvoke(handler, context);
    if (!auth.ok) {
      return policyRejected(callId, toolId, auth.code, auth.message);
    }

    if (context.cancellation.cancelled) {
      return cancelledResult(callId, toolId, context.cancellation.reason);
    }

    const timeoutMs = Math.min(
      handler.definition.timeoutMs,
      context.timeoutMs ?? handler.definition.timeoutMs,
    );

    try {
      const outcome = await runWithTimeoutAndCancellation(
        () => handler.execute(intent.args, context),
        timeoutMs,
        context,
      );

      if (outcome.status === 'timeout') {
        return {
          schemaVersion: TOOL_REGISTRY_SCHEMA_VERSION,
          callId,
          toolId,
          status: 'TIMEOUT',
          summary: 'Tool invocation timed out.',
          errorCode: 'TIMEOUT',
          errorMessage: `Exceeded ${timeoutMs}ms.`,
        };
      }
      if (outcome.status === 'cancelled') {
        return cancelledResult(callId, toolId, outcome.reason);
      }

      const structured = sanitizeToolStructured(outcome.value.structured);
      const result: ToolResult = {
        schemaVersion: TOOL_REGISTRY_SCHEMA_VERSION,
        callId,
        toolId,
        status: outcome.value.errorCode !== undefined ? 'FAILED' : 'SUCCEEDED',
        summary: truncateToolSummary(outcome.value.summary),
        structured,
        digests:
          handler.definition.auditPolicy === 'NONE'
            ? undefined
            : { structuredDigest: digestToolStructured(structured) },
        errorCode: outcome.value.errorCode,
        errorMessage: outcome.value.errorMessage,
      };
      assertNoForbiddenToolResultPayload(result);

      if (intent.idempotencyKey !== undefined && intent.idempotencyKey.trim().length > 0) {
        const cacheKey = `${context.runId}:${toolId}:${intent.idempotencyKey.trim()}`;
        this.idempotencyCache.set(cacheKey, result);
      }
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message.slice(0, 240) : 'Tool execution failed.';
      return {
        schemaVersion: TOOL_REGISTRY_SCHEMA_VERSION,
        callId,
        toolId,
        status: 'FAILED',
        summary: 'Tool execution failed.',
        errorCode: 'EXECUTION_FAILED',
        errorMessage: message,
      };
    }
  }
}

function policyRejected(
  callId: string,
  toolId: string,
  errorCode: string,
  errorMessage: string,
): ToolResult {
  return {
    schemaVersion: TOOL_REGISTRY_SCHEMA_VERSION,
    callId,
    toolId,
    status: 'REJECTED_BY_POLICY',
    summary: 'Tool invocation rejected by policy.',
    errorCode,
    errorMessage,
  };
}

function cancelledResult(callId: string, toolId: string, reason: string | undefined): ToolResult {
  return {
    schemaVersion: TOOL_REGISTRY_SCHEMA_VERSION,
    callId,
    toolId,
    status: 'CANCELLED',
    summary: 'Tool invocation cancelled.',
    errorCode: 'CANCELLED',
    errorMessage: reason ?? 'cancelled',
  };
}

type TimeoutOutcome =
  | { readonly status: 'ok'; readonly value: ToolHandlerRawResult }
  | { readonly status: 'timeout' }
  | { readonly status: 'cancelled'; readonly reason?: string };

async function runWithTimeoutAndCancellation(
  start: () => Promise<ToolHandlerRawResult>,
  timeoutMs: number,
  context: ToolExecutionContext,
): Promise<TimeoutOutcome> {
  return new Promise<TimeoutOutcome>((resolve, reject) => {
    let settled = false;

    const finish = (outcome: TimeoutOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(outcome);
    };

    const timer = setTimeout(() => finish({ status: 'timeout' }), timeoutMs);
    const unsubscribe = context.cancellation.subscribe((reason) => {
      finish({ status: 'cancelled', reason });
    });

    if (context.cancellation.cancelled) {
      finish({ status: 'cancelled', reason: context.cancellation.reason });
      return;
    }

    start()
      .then((value) => finish({ status: 'ok', value }))
      .catch((error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        reject(error);
      });
  });
}
