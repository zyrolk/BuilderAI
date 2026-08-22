import type { AgentRunPhase } from '../agent-operating/agent-run.types';
import type { ToolDefinition } from '../tool-registry/tool-registry.types';
import { AUTONOMOUS_LOOP_PHASE_CAPABILITIES } from './agent-loop.types';

/**
 * Autonomous-loop phase policy (ADR-042).
 * GIT_WRITE is never permitted inside the autonomous loop (operator-driven outside).
 * Tool definition allowedPhases still apply via ToolPolicyGate.
 */
export function assertAutonomousLoopToolAllowed(
  phase: AgentRunPhase,
  definition: ToolDefinition,
): { readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string } {
  if (definition.capabilityClass === 'GIT_WRITE') {
    return {
      ok: false,
      code: 'GIT_WRITE_OUTSIDE_AUTONOMOUS_LOOP',
      message:
        'Controlled Git write tools require OPERATOR approval outside the autonomous B6 loop.',
    };
  }
  if (definition.toolId === 'file_apply' || definition.toolId === 'approve_and_apply') {
    return {
      ok: false,
      code: 'FORBIDDEN_TOOL',
      message: 'FileApply / approveAndApply are not tools.',
    };
  }

  const allowed = AUTONOMOUS_LOOP_PHASE_CAPABILITIES[phase];
  if (allowed === null) {
    return {
      ok: false,
      code: 'PHASE_TOOLS_FORBIDDEN',
      message: `Autonomous tool execution is forbidden in phase ${phase}.`,
    };
  }
  if (!allowed.includes(definition.capabilityClass)) {
    return {
      ok: false,
      code: 'PHASE_CAPABILITY_DENIED',
      message: `Capability ${definition.capabilityClass} is not allowed in autonomous phase ${phase}.`,
    };
  }
  return { ok: true };
}
