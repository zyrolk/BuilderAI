import {
  CONTEXT_PACKAGE_RESERVED_HEADROOM_CHARACTERS,
  DEFAULT_CONTEXT_LIMITS,
} from '../../core/context-builder';
import { DEFAULT_PROMPT_ORCHESTRATOR_CONFIGURATION } from '../../core/prompt-orchestrator';

export { CONTEXT_PACKAGE_RESERVED_HEADROOM_CHARACTERS };

/**
 * Minimum characters the Prompt Orchestrator's budget must exceed the Context Builder's budget
 * by. Real-repository measurement (P0-3, ADR-018) found the Context-to-Prompt reformatting
 * overhead to be under 1% (83,833 Context characters produced an 84,202-character Prompt
 * Package). 15,000 characters is a deliberately generous multiple of that measured overhead so
 * the invariant fails fast on a real miscalibration rather than a rounding difference.
 */
export const MINIMUM_CONTEXT_TO_PROMPT_HEADROOM_CHARACTERS = 15_000;

/**
 * Minimum characters the active AI provider's `maximumInputCharacters` must exceed the Prompt
 * Orchestrator's budget by. The provider mapper serializes only the Prompt Package
 * (`JSON.stringify(request.prompt)`), so this headroom is a deliberate operational safety margin
 * against misconfiguration, not a measured serialization-overhead requirement.
 */
export const MINIMUM_PROMPT_TO_PROVIDER_HEADROOM_CHARACTERS = 25_000;

/**
 * Proves, at composition time, that the safe ordering
 * `Context budget < Prompt budget < active provider maximumInputCharacters`
 * holds with explicit reserved headroom at each boundary. Context Builder and Prompt Orchestrator
 * remain provider-unaware: this check lives entirely in the infrastructure composition layer and
 * only reads their already-public default budgets plus the resolved provider configuration.
 *
 * Throws a plain `Error` (matching this module's existing configuration-error style) with the
 * exact configured numbers when the invariant does not hold, so a misconfigured
 * `BUILDERAI_PROVIDER_MAX_INPUT_CHARACTERS` (or a future change to either core default) fails
 * fast at startup instead of on a live user request.
 */
export function assertBudgetOrdering(providerMaximumInputCharacters: number): void {
  const contextLimit = DEFAULT_CONTEXT_LIMITS.maxCharacters;
  const promptLimit = DEFAULT_PROMPT_ORCHESTRATOR_CONFIGURATION.maximumCharacters;

  const contextToPromptHeadroom = promptLimit - contextLimit;
  if (contextToPromptHeadroom < MINIMUM_CONTEXT_TO_PROMPT_HEADROOM_CHARACTERS) {
    throw new Error(
      `Prompt Orchestrator budget (${promptLimit}) must exceed the Context Builder budget ` +
        `(${contextLimit}) by at least ${MINIMUM_CONTEXT_TO_PROMPT_HEADROOM_CHARACTERS} ` +
        `characters of reserved headroom, but only has ${contextToPromptHeadroom}.`,
    );
  }

  const promptToProviderHeadroom = providerMaximumInputCharacters - promptLimit;
  if (promptToProviderHeadroom < MINIMUM_PROMPT_TO_PROVIDER_HEADROOM_CHARACTERS) {
    throw new Error(
      `BUILDERAI_PROVIDER_MAX_INPUT_CHARACTERS (${providerMaximumInputCharacters}) must exceed ` +
        `the Prompt Orchestrator budget (${promptLimit}) by at least ` +
        `${MINIMUM_PROMPT_TO_PROVIDER_HEADROOM_CHARACTERS} characters of reserved headroom, but ` +
        `only has ${promptToProviderHeadroom}. Increase BUILDERAI_PROVIDER_MAX_INPUT_CHARACTERS.`,
    );
  }
}
