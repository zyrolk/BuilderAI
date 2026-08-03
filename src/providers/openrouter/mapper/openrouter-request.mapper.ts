import {
  ProviderCompatibilityService,
  ProviderContractViolationError,
  ProviderRequestValidator,
  type AIProviderDescriptor,
  type AIProviderRequest,
  type ProviderValidationIssue,
} from '../../../core/ai-provider';
import type {
  PromptOutputContract,
  PromptOutputContractSection,
  PromptOutputFieldType,
} from '../../../core/prompt-orchestrator';
import { toCoreProviderConfiguration } from '../config';
import type {
  OpenRouterChatCompletionRequest,
  OpenRouterJsonSchema,
  OpenRouterProviderConfiguration,
} from '../types';

export class OpenRouterRequestMapper {
  private readonly requestValidator: ProviderRequestValidator = new ProviderRequestValidator();
  private readonly compatibility = new ProviderCompatibilityService();

  constructor(
    private readonly descriptor: AIProviderDescriptor,
    private readonly configuration: OpenRouterProviderConfiguration,
  ) {}

  map(request: AIProviderRequest): OpenRouterChatCompletionRequest {
    this.requestValidator.validate(request);
    const compatibility = this.compatibility.evaluate(
      this.descriptor,
      toCoreProviderConfiguration(this.configuration),
      request,
    );
    this.compatibility.assertCapabilities(
      this.descriptor,
      toCoreProviderConfiguration(this.configuration),
      request,
    );
    const issues: ProviderValidationIssue[] = compatibility.reasons.map((reason) => ({
      path: '$',
      message: `provider request is incompatible: ${reason}`,
    }));
    if (request.constraints.maximumOutputCharacters > this.configuration.maximumOutputCharacters) {
      issues.push({
        path: '$.constraints.maximumOutputCharacters',
        message: 'exceeds the configured provider output limit',
      });
    }
    if (issues.length > 0) throw new ProviderContractViolationError('REQUEST', issues);

    const outputContract = findOutputContract(request);
    const content = JSON.stringify(request.prompt);
    if (content.length > this.configuration.maximumInputCharacters) {
      throw new ProviderContractViolationError('REQUEST', [
        {
          path: '$.prompt',
          message: 'serialized Prompt Package exceeds the configured provider input limit',
        },
      ]);
    }
    return {
      model: this.configuration.model,
      messages: [{ role: 'user', content }],
      max_tokens: this.configuration.maximumOutputTokens,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'builderai_response',
          description: 'BuilderAI Prompt Package output contract',
          strict: false,
          schema: toJsonSchema(outputContract),
        },
      },
    };
  }
}

function findOutputContract(request: AIProviderRequest): PromptOutputContract {
  const section = request.prompt.sections.find(
    (candidate): candidate is PromptOutputContractSection => candidate.kind === 'OUTPUT_CONTRACT',
  );
  if (section === undefined) {
    throw new ProviderContractViolationError('REQUEST', [
      { path: '$.prompt.sections', message: 'must contain an output contract section' },
    ]);
  }
  return section.expectedOutput;
}

function toJsonSchema(contract: PromptOutputContract): OpenRouterJsonSchema {
  return {
    type: 'object',
    properties: Object.fromEntries(
      contract.fields.map((field) => [field.name, { type: mapFieldType(field.type) }]),
    ),
    required: contract.fields.filter(({ required }) => required).map(({ name }) => name),
    additionalProperties: contract.allowAdditionalFields,
  };
}

function mapFieldType(type: PromptOutputFieldType): string {
  switch (type) {
    case 'STRING':
      return 'string';
    case 'NUMBER':
      return 'number';
    case 'BOOLEAN':
      return 'boolean';
    case 'OBJECT':
      return 'object';
    case 'ARRAY':
      return 'array';
  }
}
