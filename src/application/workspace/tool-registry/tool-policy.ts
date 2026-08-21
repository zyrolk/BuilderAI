import type { WorkspaceAuthorizationService } from '../workspace-authorization.service';
import {
  B1_ALLOWED_CAPABILITY_CLASSES,
  ToolRegistryError,
  type ToolCapabilityClass,
  type ToolDefinition,
  type ToolExecutionContext,
  type ToolHandler,
} from './tool-registry.types';

const B1_CLASS_SET = new Set<string>(B1_ALLOWED_CAPABILITY_CLASSES);

/**
 * B3 proposal-only PLAN tools (ADR-039): readOnly + PREPARE + no Gate2 requirement on the tool
 * itself + approval NONE. MUTATE / APPLY remain rejected.
 */
export function isProposalOnlyPlanTool(definition: ToolDefinition): boolean {
  return (
    definition.capabilityClass === 'PLAN' &&
    definition.readOnly === true &&
    definition.authorizationAction === 'PREPARE' &&
    definition.requiresGate2 === false &&
    definition.approvalRequirement === 'NONE'
  );
}

function isRegistrableCapabilityClass(capabilityClass: ToolCapabilityClass): boolean {
  return B1_CLASS_SET.has(capabilityClass) || capabilityClass === 'PLAN';
}

/**
 * Validates ToolDefinition registration and per-invoke policy (phase + workspace auth).
 * Does not invent APPLY authority or Gate 2 approval.
 */
export class ToolPolicyGate {
  constructor(private readonly authorization: WorkspaceAuthorizationService) {}

  assertRegistrable(definition: ToolDefinition): void {
    if (!definition.readOnly) {
      throw new ToolRegistryError(
        'INVALID_DEFINITION',
        `Tool ${definition.toolId} must be readOnly.`,
      );
    }
    if (definition.requiresGate2) {
      throw new ToolRegistryError(
        'INVALID_DEFINITION',
        `Tool ${definition.toolId} must not require Gate 2 at registration.`,
      );
    }
    if (definition.approvalRequirement !== 'NONE') {
      throw new ToolRegistryError(
        'INVALID_DEFINITION',
        `Tool ${definition.toolId} must use approvalRequirement NONE.`,
      );
    }
    if (definition.authorizationAction === 'APPLY') {
      throw new ToolRegistryError(
        'INVALID_DEFINITION',
        `Tool ${definition.toolId} must not use APPLY authorization.`,
      );
    }
    if (!isRegistrableCapabilityClass(definition.capabilityClass)) {
      throw new ToolRegistryError(
        'INVALID_DEFINITION',
        `Tool ${definition.toolId} capabilityClass ${definition.capabilityClass} is unavailable.`,
      );
    }
    if (definition.capabilityClass === 'PLAN' && !isProposalOnlyPlanTool(definition)) {
      throw new ToolRegistryError(
        'INVALID_DEFINITION',
        `Tool ${definition.toolId} PLAN tools must be proposal-only (readOnly + PREPARE).`,
      );
    }
    if (!definition.workspaceScoped) {
      throw new ToolRegistryError(
        'INVALID_DEFINITION',
        `Tool ${definition.toolId} must be workspaceScoped.`,
      );
    }
    if (definition.timeoutMs <= 0 || definition.timeoutMs > 120_000) {
      throw new ToolRegistryError(
        'INVALID_DEFINITION',
        `Tool ${definition.toolId} timeoutMs must be in 1..120000.`,
      );
    }
    if (definition.allowedPhases.length === 0) {
      throw new ToolRegistryError(
        'INVALID_DEFINITION',
        `Tool ${definition.toolId} must declare allowedPhases.`,
      );
    }
  }

  authorizeInvoke(
    handler: ToolHandler,
    context: ToolExecutionContext,
  ):
    | { readonly ok: true }
    | { readonly ok: false; readonly code: string; readonly message: string } {
    const definition = handler.definition;

    if (context.principal.projectId !== context.projectId) {
      return {
        ok: false,
        code: 'PROJECT_MISMATCH',
        message: 'Principal projectId does not match tool execution context.',
      };
    }

    if (!definition.allowedPhases.includes(context.phase)) {
      return {
        ok: false,
        code: 'PHASE_NOT_ALLOWED',
        message: `Tool ${definition.toolId} is not allowed in phase ${context.phase}.`,
      };
    }

    const decision = this.authorization.authorize({
      profile: context.securityProfile,
      principal: context.principal,
      action: definition.authorizationAction,
      evidence: context.securityEvidence,
    });

    if (decision.outcome !== 'AUTHORIZED') {
      return {
        ok: false,
        code: decision.code ?? 'UNAUTHORIZED',
        message: decision.message ?? 'Workspace authorization rejected the tool invocation.',
      };
    }

    return { ok: true };
  }
}
