import type { ControlledTerminalService } from '../../controlled-terminal/controlled-terminal.service';
import type {
  ToolDefinition,
  ToolHandler,
  ToolHandlerRawResult,
  ToolJsonValue,
} from '../tool-registry.types';

export interface RunVerificationCommandToolDeps {
  readonly controlledTerminal: ControlledTerminalService;
}

const DEFINITION: ToolDefinition = {
  toolId: 'run_verification_command',
  name: 'Run verification command',
  description:
    'Run one catalog-only allowlisted verification command via SafeVerificationRunner (no shell).',
  inputSchema: {
    type: 'object',
    properties: {
      commandId: {
        type: 'string',
        description:
          'Catalog id: npm-ls-omit-dev-json | npm-run-build | npm-run-test | npm-run-lint | npm-run-typecheck | npm-run-format',
      },
    },
    required: ['commandId'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      commandId: { type: 'string' },
      stage: { type: 'string' },
      executionStatus: { type: 'string' },
      exitCode: { type: ['number', 'null'] },
      timedOut: { type: 'boolean' },
      cancelled: { type: 'boolean' },
      policyBlocked: { type: 'boolean' },
      policyBlockCode: { type: 'string' },
      outputDigest: { type: 'string' },
      diagnosticSummary: { type: 'string' },
      outputLimited: { type: 'boolean' },
      networkPolicy: { type: 'string' },
    },
  },
  capabilityClass: 'VERIFY',
  readOnly: true,
  riskLevel: 'HIGH',
  authorizationAction: 'PREPARE',
  requiresGate2: false,
  approvalRequirement: 'NONE',
  workspaceScoped: true,
  timeoutMs: 120_000,
  supportsCancellation: true,
  evidencePolicy: 'DIGEST',
  auditPolicy: 'DIGEST',
  allowedPhases: ['UNDERSTANDING', 'VERIFYING', 'DIAGNOSING', 'CORRECTING'],
};

export function createRunVerificationCommandTool(
  deps: RunVerificationCommandToolDeps,
): ToolHandler {
  return {
    definition: DEFINITION,
    async execute(args, context): Promise<ToolHandlerRawResult> {
      if (context.cancellation.cancelled) {
        return {
          summary: 'Verification command cancelled.',
          errorCode: 'CANCELLED',
          errorMessage: context.cancellation.reason ?? 'cancelled',
        };
      }

      const projectRoot = context.projectRoot.trim();
      if (projectRoot.length === 0) {
        return {
          summary: 'Missing projectRoot in tool context.',
          errorCode: 'INVALID_CONTEXT',
          errorMessage: 'projectRoot is required for run_verification_command.',
        };
      }

      if (args === null || typeof args !== 'object' || Array.isArray(args)) {
        return {
          summary: 'Invalid arguments.',
          errorCode: 'INVALID_ARGS',
          errorMessage: 'Expected object with commandId.',
        };
      }

      const record = args as Record<string, unknown>;
      // Reject free-form shell fields before any spawn.
      for (const forbidden of [
        'command',
        'argv',
        'args',
        'shell',
        'executable',
        'cwd',
        'env',
        'script',
      ]) {
        if (forbidden in record) {
          return {
            summary: 'Free-form command fields are forbidden.',
            errorCode: 'FORBIDDEN_ARGUMENT',
            errorMessage: `Argument "${forbidden}" is not allowed; use catalog commandId only.`,
          };
        }
      }

      const result = await deps.controlledTerminal.runCommand({
        commandId: record.commandId,
        projectRoot,
        cancellation: context.cancellation,
      });

      const structured: ToolJsonValue = {
        commandId: result.commandId,
        stage: result.stage,
        executionStatus: result.executionStatus,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        cancelled: result.cancelled,
        policyBlocked: result.policyBlocked,
        ...(result.policyBlockCode !== undefined
          ? { policyBlockCode: result.policyBlockCode }
          : {}),
        outputDigest: result.outputDigest,
        diagnosticSummary: result.diagnosticSummary,
        outputLimited: result.outputLimited,
        networkPolicy: result.networkPolicy,
      };

      if (result.executionStatus === 'REJECTED_BY_POLICY') {
        return {
          summary: `Verification command rejected by policy (${result.policyBlockCode ?? 'blocked'}).`,
          structured,
          errorCode: result.policyBlockCode ?? 'REJECTED_BY_POLICY',
          errorMessage: result.diagnosticSummary,
        };
      }
      if (result.executionStatus === 'CANCELLED') {
        return {
          summary: 'Verification command cancelled.',
          structured,
          errorCode: 'CANCELLED',
          errorMessage: 'cancelled',
        };
      }
      if (result.executionStatus === 'TIMEOUT') {
        return {
          summary: 'Verification command timed out.',
          structured,
          errorCode: 'TIMEOUT',
          errorMessage: 'timed out',
        };
      }
      if (result.executionStatus === 'FAILED') {
        return {
          summary: `Verification command failed (exit ${String(result.exitCode)}).`,
          structured,
          errorCode: 'COMMAND_FAILED',
          errorMessage: `exitCode=${String(result.exitCode)}`,
        };
      }

      return {
        summary: `Verification command ${result.commandId} succeeded.`,
        structured,
      };
    },
  };
}

export function runVerificationCommandToolDefinition(): ToolDefinition {
  return DEFINITION;
}
