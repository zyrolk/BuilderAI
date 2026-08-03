import { DEFAULT_CONTEXT_LIMITS } from '../../core/context-builder';
import { DEFAULT_PROMPT_ORCHESTRATOR_CONFIGURATION } from '../../core/prompt-orchestrator';
import {
  assertBudgetOrdering,
  MINIMUM_CONTEXT_TO_PROMPT_HEADROOM_CHARACTERS,
  MINIMUM_PROMPT_TO_PROVIDER_HEADROOM_CHARACTERS,
} from './budget-invariant';

describe('assertBudgetOrdering', () => {
  it('proves the current default Context < Prompt ordering holds with the required headroom', () => {
    const headroom =
      DEFAULT_PROMPT_ORCHESTRATOR_CONFIGURATION.maximumCharacters -
      DEFAULT_CONTEXT_LIMITS.maxCharacters;
    expect(headroom).toBeGreaterThanOrEqual(MINIMUM_CONTEXT_TO_PROMPT_HEADROOM_CHARACTERS);
  });

  it('does not throw for a provider limit with sufficient reserved headroom above the Prompt budget', () => {
    const sufficientLimit =
      DEFAULT_PROMPT_ORCHESTRATOR_CONFIGURATION.maximumCharacters +
      MINIMUM_PROMPT_TO_PROVIDER_HEADROOM_CHARACTERS;
    expect(() => assertBudgetOrdering(sufficientLimit)).not.toThrow();
  });

  it('throws when the provider maximumInputCharacters is below the Prompt budget', () => {
    expect(() =>
      assertBudgetOrdering(DEFAULT_PROMPT_ORCHESTRATOR_CONFIGURATION.maximumCharacters - 1),
    ).toThrow('BUILDERAI_PROVIDER_MAX_INPUT_CHARACTERS');
  });

  it('throws when the provider maximumInputCharacters exceeds the Prompt budget but not by enough headroom', () => {
    const insufficientLimit =
      DEFAULT_PROMPT_ORCHESTRATOR_CONFIGURATION.maximumCharacters +
      MINIMUM_PROMPT_TO_PROVIDER_HEADROOM_CHARACTERS -
      1;
    expect(() => assertBudgetOrdering(insufficientLimit)).toThrow('reserved headroom');
  });

  it('reports the exact configured numbers in the failure message', () => {
    const tooLow = 1;
    expect(() => assertBudgetOrdering(tooLow)).toThrow(String(tooLow));
  });
});
