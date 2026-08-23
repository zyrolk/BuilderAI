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

/**
 * B4 catalog-only VERIFY tools (ADR-040): readOnly + HIGH + PREPARE + no Gate2 + NONE.
 * readOnly means no FileApply/APPLY/Gate2 bypass — not zero process side effects.
 */
export function isCatalogOnlyVerifyTool(definition: ToolDefinition): boolean {
  return (
    definition.capabilityClass === 'VERIFY' &&
    definition.readOnly === true &&
    definition.riskLevel === 'HIGH' &&
    definition.authorizationAction === 'PREPARE' &&
    definition.requiresGate2 === false &&
    definition.approvalRequirement === 'NONE'
  );
}

/**
 * B5 GIT_READ tools (ADR-041): readOnly + no Gate2 + NONE + not APPLY.
 */
export function isGitReadTool(definition: ToolDefinition): boolean {
  return (
    definition.capabilityClass === 'GIT_READ' &&
    definition.readOnly === true &&
    definition.requiresGate2 === false &&
    definition.approvalRequirement === 'NONE' &&
    definition.authorizationAction !== 'APPLY' &&
    definition.authorizationAction !== 'GIT_WRITE'
  );
}

/**
 * B5 GIT_WRITE tools (ADR-041): readOnly (no FileApply) + HIGH + OPERATOR + GIT_WRITE auth.
 */
export function isGitWriteTool(definition: ToolDefinition): boolean {
  return (
    definition.capabilityClass === 'GIT_WRITE' &&
    definition.readOnly === true &&
    definition.riskLevel === 'HIGH' &&
    definition.authorizationAction === 'GIT_WRITE' &&
    definition.requiresGate2 === false &&
    definition.approvalRequirement === 'OPERATOR'
  );
}

/**
 * B7 catalog tool (ADR-043): BROWSER + LOW + NONE + no APPLY/GIT_WRITE.
 */
export function isBrowserCatalogTool(definition: ToolDefinition): boolean {
  return (
    definition.capabilityClass === 'BROWSER' &&
    definition.readOnly === true &&
    definition.riskLevel === 'LOW' &&
    definition.requiresGate2 === false &&
    definition.approvalRequirement === 'NONE' &&
    definition.authorizationAction !== 'APPLY' &&
    definition.authorizationAction !== 'GIT_WRITE' &&
    definition.authorizationAction !== 'BROWSER_OBSERVE'
  );
}

/**
 * B7 observation tool (ADR-043): BROWSER + HIGH + OPERATOR + BROWSER_OBSERVE.
 */
export function isBrowserObservationTool(definition: ToolDefinition): boolean {
  return (
    definition.capabilityClass === 'BROWSER' &&
    definition.readOnly === true &&
    definition.riskLevel === 'HIGH' &&
    definition.authorizationAction === 'BROWSER_OBSERVE' &&
    definition.requiresGate2 === false &&
    definition.approvalRequirement === 'OPERATOR'
  );
}

function isRegistrableCapabilityClass(capabilityClass: ToolCapabilityClass): boolean {
  return (
    B1_CLASS_SET.has(capabilityClass) ||
    capabilityClass === 'PLAN' ||
    capabilityClass === 'VERIFY' ||
    capabilityClass === 'GIT_READ' ||
    capabilityClass === 'GIT_WRITE' ||
    capabilityClass === 'BROWSER'
  );
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

    if (definition.capabilityClass === 'GIT_WRITE') {
      if (!isGitWriteTool(definition)) {
        throw new ToolRegistryError(
          'INVALID_DEFINITION',
          `Tool ${definition.toolId} GIT_WRITE tools must be HIGH + OPERATOR + GIT_WRITE auth.`,
        );
      }
    } else if (definition.capabilityClass === 'BROWSER') {
      if (!isBrowserCatalogTool(definition) && !isBrowserObservationTool(definition)) {
        throw new ToolRegistryError(
          'INVALID_DEFINITION',
          `Tool ${definition.toolId} BROWSER tools must be catalog (LOW+NONE) or observation (HIGH+OPERATOR+BROWSER_OBSERVE).`,
        );
      }
      const phases = new Set(definition.allowedPhases);
      for (const phase of phases) {
        if (phase !== 'VERIFYING' && phase !== 'DIAGNOSING') {
          throw new ToolRegistryError(
            'INVALID_DEFINITION',
            `Tool ${definition.toolId} BROWSER tools may only allow VERIFYING/DIAGNOSING.`,
          );
        }
      }
    } else if (definition.approvalRequirement !== 'NONE') {
      throw new ToolRegistryError(
        'INVALID_DEFINITION',
        `Tool ${definition.toolId} must use approvalRequirement NONE.`,
      );
    }

    if (definition.capabilityClass === 'PLAN' && !isProposalOnlyPlanTool(definition)) {
      throw new ToolRegistryError(
        'INVALID_DEFINITION',
        `Tool ${definition.toolId} PLAN tools must be proposal-only (readOnly + PREPARE).`,
      );
    }
    if (definition.capabilityClass === 'VERIFY' && !isCatalogOnlyVerifyTool(definition)) {
      throw new ToolRegistryError(
        'INVALID_DEFINITION',
        `Tool ${definition.toolId} VERIFY tools must be catalog-only (readOnly + HIGH + PREPARE).`,
      );
    }
    if (definition.capabilityClass === 'GIT_READ' && !isGitReadTool(definition)) {
      throw new ToolRegistryError(
        'INVALID_DEFINITION',
        `Tool ${definition.toolId} GIT_READ tools must be read-only with approval NONE.`,
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

    if (definition.approvalRequirement === 'OPERATOR') {
      if (definition.authorizationAction === 'BROWSER_OBSERVE') {
        if (context.securityEvidence.browserObservationApproved !== true) {
          return {
            ok: false,
            code: 'BROWSER_OPERATOR_APPROVAL_REQUIRED',
            message:
              'Explicit browser observation approval is required (distinct from Gate2 and Git).',
          };
        }
      } else if (!context.securityEvidence.operatorApproved) {
        return {
          ok: false,
          code: 'OPERATOR_APPROVAL_REQUIRED',
          message: 'Explicit operator approval is required for this tool.',
        };
      }
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
