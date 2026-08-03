import {
  ContextBuilderValidationError,
  ContextPackageValidator,
  type ContextLimits,
} from '../../context-builder';
import { PromptSectionBuilder } from '../builders';
import {
  DEFAULT_PROMPT_ORCHESTRATOR_CONFIGURATION,
  type PromptOrchestratorConfiguration,
} from '../config';
import type { PromptTemplateCatalog } from '../ports';
import { DEFAULT_PROMPT_OUTPUT_CONTRACT, StaticPromptTemplateCatalog } from '../templates';
import {
  PromptOrchestratorValidationError,
  type PromptBuildInput,
  type PromptPackage,
} from '../types';
import {
  PromptOrchestratorConfigurationValidator,
  PromptOutputContractValidator,
  PromptPackageValidator,
} from '../validators';
import { PromptBudgetService, type PromptPackageDraft } from './prompt-budget.service';
import { PromptTemplateSelectorService } from './prompt-template-selector.service';

export class PromptOrchestratorService {
  private readonly configurationValidator: PromptOrchestratorConfigurationValidator =
    new PromptOrchestratorConfigurationValidator();
  private readonly contextValidator: ContextPackageValidator = new ContextPackageValidator();
  private readonly outputValidator: PromptOutputContractValidator =
    new PromptOutputContractValidator();
  private readonly packageValidator: PromptPackageValidator = new PromptPackageValidator();
  private readonly templateSelector: PromptTemplateSelectorService =
    new PromptTemplateSelectorService();
  private readonly sectionBuilder: PromptSectionBuilder = new PromptSectionBuilder();
  private readonly budgetService: PromptBudgetService = new PromptBudgetService();

  constructor(
    private readonly templateCatalog: PromptTemplateCatalog = new StaticPromptTemplateCatalog(),
  ) {}

  async build(
    input: PromptBuildInput,
    configuration: PromptOrchestratorConfiguration = DEFAULT_PROMPT_ORCHESTRATOR_CONFIGURATION,
  ): Promise<PromptPackage> {
    this.configurationValidator.validate(configuration);
    this.validateContext(input);
    const expectedOutput = input.expectedOutput ?? DEFAULT_PROMPT_OUTPUT_CONTRACT;
    this.outputValidator.validate(expectedOutput);
    const template = await this.templateSelector.select(
      this.templateCatalog,
      configuration.templateId,
      configuration.templateVersion,
    );
    const sections = this.sectionBuilder.build(
      template,
      input.context,
      expectedOutput,
      input.iterationFeedback,
    );
    const draft: PromptPackageDraft = {
      schemaVersion: 1,
      template: { id: template.id, version: template.version },
      sections,
      metadata: {
        sourceContextSchemaVersion: input.context.schemaVersion,
        sourceContextCharacters: input.context.size.characters,
        values: input.metadata ?? {},
      },
    };
    const packageValue = this.budgetService.enforce(draft, configuration.maximumCharacters);
    this.packageValidator.validate(packageValue);
    return structuredClone(packageValue);
  }

  private validateContext(input: PromptBuildInput): void {
    const limits: ContextLimits = {
      maxCharacters: input.context.size.maxCharacters,
      maxFiles: input.context.size.maxFiles,
      maxDocuments: input.context.size.maxDocuments,
      maxSourcePaths: input.context.size.maxSourcePaths,
      maxSourceReads: input.context.size.maxSourceReads,
    };
    try {
      this.contextValidator.validate(input.context, limits);
    } catch (error: unknown) {
      if (error instanceof ContextBuilderValidationError) {
        throw new PromptOrchestratorValidationError(
          error.issues.map((issue) => ({
            code: 'INVALID_PROMPT_STRUCTURE',
            path: `$.context${issue.path.slice(1)}`,
            message: issue.message,
          })),
        );
      }
      throw error;
    }
  }
}
