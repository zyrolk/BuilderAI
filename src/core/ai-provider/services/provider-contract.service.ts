import {
  ProviderContractViolationError,
  type AIProviderRequest,
  type AIProviderResponse,
  type ProviderValidationIssue,
} from '../types';
import { ProviderRequestValidator, ProviderResponseValidator } from '../validators';

export class ProviderContractService {
  private readonly requestValidator: ProviderRequestValidator = new ProviderRequestValidator();
  private readonly responseValidator: ProviderResponseValidator = new ProviderResponseValidator();

  validateExchange(request: AIProviderRequest, response: AIProviderResponse): void {
    this.requestValidator.validate(request);
    this.responseValidator.validate(response);
    const issues: ProviderValidationIssue[] = [];

    if (response.requestId !== request.requestId) {
      issues.push({ path: '$.requestId', message: 'must match the originating request' });
    }
    if (response.usage.promptCharacters !== request.prompt.budget.characters) {
      issues.push({
        path: '$.usage.promptCharacters',
        message: 'must match the originating Prompt Package size',
      });
    }
    if (response.usage.outputCharacters > request.constraints.maximumOutputCharacters) {
      issues.push({
        path: '$.usage.outputCharacters',
        message: 'exceeds the request output limit',
      });
    }
    const returnedKinds = new Set(response.artifacts.map(({ kind }) => kind));
    for (const requiredKind of request.constraints.requiredArtifactKinds) {
      if (!returnedKinds.has(requiredKind)) {
        issues.push({
          path: '$.artifacts',
          message: `is missing required artifact kind '${requiredKind}'`,
        });
      }
    }

    if (issues.length > 0) throw new ProviderContractViolationError('RESPONSE', issues);
  }
}
