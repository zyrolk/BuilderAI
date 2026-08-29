/**
 * ADR-051: server-only prepare envelope carrying optional verification planning DATA
 * alongside existing P0 / B1/B2 planning inputs — never client-supplied.
 */

import type { InvestigationHandoffFeedback } from '../investigation/investigation-handoff';
import {
  isOperatorToolPlanningMergeInput,
  type OperatorToolPlanningMergeInput,
} from './operator-tool-planning-prepare-input';
import type { VerificationPlanningProjection } from './verification-planning-projection';
import { validateVerificationPlanningProjection } from './verification-planning-projection';

export const AGENT_OPERATING_PLAN_PREPARE_KIND = 'AGENT_OPERATING_PLAN_PREPARE' as const;

export type AgentOperatingPlanningInner =
  OperatorToolPlanningMergeInput | InvestigationHandoffFeedback;

/** Server-only prepare input — never accepted from HTTP (ADR-051). */
export interface AgentOperatingPlanPrepareInput {
  readonly kind: typeof AGENT_OPERATING_PLAN_PREPARE_KIND;
  readonly planning?: AgentOperatingPlanningInner;
  readonly verificationPlanning: VerificationPlanningProjection;
}

export function isAgentOperatingPlanPrepareInput(
  value: unknown,
): value is AgentOperatingPlanPrepareInput {
  if (typeof value !== 'object' || value === null) return false;
  if (Reflect.get(value, 'kind') !== AGENT_OPERATING_PLAN_PREPARE_KIND) return false;
  const verification = Reflect.get(value, 'verificationPlanning');
  if (verification === undefined || typeof verification !== 'object' || verification === null) {
    return false;
  }
  return validateVerificationPlanningProjection(verification as VerificationPlanningProjection);
}

export function buildAgentOperatingPlanPrepareInput(input: {
  readonly planning?: AgentOperatingPlanningInner;
  readonly verificationPlanning: VerificationPlanningProjection;
}): AgentOperatingPlanPrepareInput {
  return {
    kind: AGENT_OPERATING_PLAN_PREPARE_KIND,
    ...(input.planning === undefined ? {} : { planning: input.planning }),
    verificationPlanning: input.verificationPlanning,
  };
}

export function unwrapPlanningInner(value: AgentOperatingPlanningInner | undefined): {
  readonly merge: OperatorToolPlanningMergeInput | undefined;
  readonly handoff: InvestigationHandoffFeedback | undefined;
} {
  if (value === undefined) return { merge: undefined, handoff: undefined };
  if (isOperatorToolPlanningMergeInput(value)) {
    return { merge: value, handoff: undefined };
  }
  return { merge: undefined, handoff: value };
}
