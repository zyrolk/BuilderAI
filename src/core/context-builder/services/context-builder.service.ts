import {
  CONTEXT_PACKAGE_RESERVED_HEADROOM_CHARACTERS,
  CONTEXT_PRIORITIES,
  DEFAULT_CONTEXT_LIMITS,
  DEFAULT_SOURCE_FILE_ADMISSION_QUOTAS,
  ContextBuilderValidationError,
} from '../types';
import type {
  ContextBuildInput,
  ContextLimits,
  ContextOmission,
  ContextPackage,
  ContextSourceFile,
  SourceFileAdmissionQuotas,
} from '../types';
import { admitSourceFilesByMeasuredBudget } from '../internal/source-file-admission';
import { applySourceContextPresentation } from '../internal/source-context-presentation';
import { ContextInputValidator, ContextPackageValidator } from '../validators';
import { ContextSelectionService } from './context-selection.service';
import { ContextSizeService, type ContextPackageDraft } from './context-size.service';

export interface ContextBuildOptions {
  readonly limitOverrides?: Partial<ContextLimits>;
  readonly admissionQuotas?: SourceFileAdmissionQuotas;
}

export class ContextBuilderService {
  constructor(
    private readonly inputValidator = new ContextInputValidator(),
    private readonly selectionService = new ContextSelectionService(),
    private readonly sizeService = new ContextSizeService(),
    private readonly packageValidator = new ContextPackageValidator(),
  ) {}

  async build(
    input: ContextBuildInput,
    options: ContextBuildOptions = {},
  ): Promise<ContextPackage> {
    const limits: ContextLimits = { ...DEFAULT_CONTEXT_LIMITS, ...options.limitOverrides };
    let sourcePaths: readonly string[];
    try {
      sourcePaths = await input.sourceFileSource.listSourcePaths();
    } catch (error: unknown) {
      throw new ContextBuilderValidationError([
        {
          code: 'INVALID_REFERENCE',
          path: '$.sourceFileSource',
          message: `Could not list source paths: ${error instanceof Error ? error.message : 'unknown error'}`,
        },
      ]);
    }
    const validated = this.inputValidator.validate(input, limits, sourcePaths);
    const selection = await this.selectionService.select(validated, limits);
    const pinnedPaths = new Set(
      (input.pinnedBaselineFiles ?? []).map(({ path }) => path.replaceAll('\\', '/')),
    );
    const rankedWithoutPinnedDuplicates = selection.files.filter(
      ({ path }) => !pinnedPaths.has(path.replaceAll('\\', '/')),
    );
    const pinnedBaselineFiles = [...(input.pinnedBaselineFiles ?? [])];
    const draftWithoutFiles: ContextPackageDraft = {
      schemaVersion: 1,
      priorityOrder: CONTEXT_PRIORITIES,
      projectIdentity: {
        id: validated.brain.blueprint.projectId,
        name: validated.brain.blueprint.name,
        vision: validated.brain.blueprint.vision,
      },
      currentMilestone: validated.brain.progressLog.currentMilestone,
      currentTask: selection.currentTask,
      relatedTasks: selection.relatedTasks,
      goals: selection.goals,
      constraints: selection.constraints,
      architectureSummary: validated.reader.analysis.architecture,
      relevantModules: selection.modules,
      relevantFiles: [],
      relevantDecisions: selection.decisions,
      codingStandards: selection.codingStandards,
      knownRisks: selection.risks,
      openBlockers: selection.blockers,
      relevantDocumentation: selection.documents,
    };
    const targetMaxCharacters = limits.maxCharacters - CONTEXT_PACKAGE_RESERVED_HEADROOM_CHARACTERS;
    const measureFiles = (
      files: readonly ContextSourceFile[],
      fileOmissions: readonly ContextOmission[],
    ) =>
      this.sizeService.measure(
        { ...draftWithoutFiles, relevantFiles: files },
        limits,
        [...selection.omissions, ...fileOmissions],
        selection.sourcePaths,
        selection.sourceReads,
      );
    const { admitted, omissions: fileOmissions } = admitSourceFilesByMeasuredBudget(
      rankedWithoutPinnedDuplicates,
      Math.max(0, limits.maxFiles - pinnedBaselineFiles.length),
      targetMaxCharacters,
      (files, omissions) => measureFiles([...pinnedBaselineFiles, ...files], omissions),
      options.admissionQuotas ?? DEFAULT_SOURCE_FILE_ADMISSION_QUOTAS,
    );
    const presentedFiles = applySourceContextPresentation(
      [...pinnedBaselineFiles, ...admitted],
      validated.sourceContextPolicy,
    );
    const mergedFiles = presentedFiles;
    const draft: ContextPackageDraft = {
      ...draftWithoutFiles,
      relevantFiles: mergedFiles,
    };
    const packageValue = this.sizeService.enforce(
      draft,
      limits,
      [...selection.omissions, ...fileOmissions],
      selection.sourcePaths,
      selection.sourceReads,
    );
    this.packageValidator.validate(packageValue, limits);
    return structuredClone(packageValue);
  }
}
