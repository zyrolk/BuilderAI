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
  GeminiGenerateContentRequest,
  GeminiJsonSchema,
  GeminiProviderConfiguration,
} from '../types';

export class GeminiRequestMapper {
  private readonly requestValidator: ProviderRequestValidator = new ProviderRequestValidator();
  private readonly compatibility: ProviderCompatibilityService = new ProviderCompatibilityService();

  constructor(
    private readonly descriptor: AIProviderDescriptor,
    private readonly configuration: GeminiProviderConfiguration,
  ) {}

  map(request: AIProviderRequest): GeminiGenerateContentRequest {
    this.requestValidator.validate(request);
    const coreConfiguration = toCoreProviderConfiguration(this.configuration);
    const compatibility = this.compatibility.evaluate(this.descriptor, coreConfiguration, request);
    this.compatibility.assertCapabilities(this.descriptor, coreConfiguration, request);
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

    const input = JSON.stringify(request.prompt);
    if (input.length > this.configuration.maximumInputCharacters) {
      throw new ProviderContractViolationError('REQUEST', [
        {
          path: '$.prompt',
          message: 'serialized Prompt Package exceeds the configured provider input limit',
        },
      ]);
    }
    return {
      model: this.configuration.model,
      contents: input,
      config: {
        candidateCount: 1,
        maxOutputTokens: this.configuration.maximumOutputTokens,
        responseMimeType: 'application/json',
        responseJsonSchema: toJsonSchema(findOutputContract(request)),
        temperature: 0,
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

function toJsonSchema(contract: PromptOutputContract): GeminiJsonSchema {
  return {
    type: 'object',
    properties: Object.fromEntries(
      contract.fields.map((field) => [field.name, toFieldSchema(field)]),
    ),
    required: contract.fields.filter(({ required }) => required).map(({ name }) => name),
    additionalProperties: contract.allowAdditionalFields,
  };
}

function toFieldSchema(field: PromptOutputContract['fields'][number]): GeminiJsonSchema {
  if (field.name === 'artifacts' && field.type === 'ARRAY')
    return generatedArtifactsSchema(field.description);
  if (field.name === 'diagnostics' && field.type === 'ARRAY')
    return diagnosticsSchema(field.description);
  return { type: mapFieldType(field.type), description: field.description };
}

function generatedArtifactsSchema(description: string): GeminiJsonSchema {
  return {
    type: 'array',
    description,
    items: {
      type: 'object',
      properties: {
        logicalPath: {
          type: 'string',
          description: 'Normalized repository-relative POSIX path for the complete target file.',
        },
        type: {
          type: 'string',
          description: 'Closed BuilderAI artifact type.',
          enum: ['SOURCE_FILE', 'DOCUMENTATION', 'CONFIGURATION', 'TEST', 'PATCH'],
        },
        content: {
          type: 'string',
          description: 'Complete target file content; use an empty string only for DELETE_FILE.',
        },
        metadata: {
          type: 'object',
          description: 'Required human-readable description and explicit file-change intent.',
          properties: {
            description: { type: 'string', description: 'Non-empty artifact purpose.' },
            'change-operation': {
              type: 'string',
              description: 'Exact project change intent.',
              enum: ['CREATE_FILE', 'UPDATE_FILE', 'DELETE_FILE'],
            },
          },
          required: ['description', 'change-operation'],
          additionalProperties: false,
        },
      },
      required: ['logicalPath', 'type', 'content', 'metadata'],
      additionalProperties: false,
    },
  };
}

function diagnosticsSchema(description: string): GeminiJsonSchema {
  return {
    type: 'array',
    description,
    items: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        severity: { type: 'string', enum: ['INFO', 'WARNING', 'ERROR'] },
        message: { type: 'string' },
        path: { type: 'string' },
      },
      required: ['code', 'severity', 'message'],
      additionalProperties: false,
    },
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
