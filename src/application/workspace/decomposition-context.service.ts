import type { BlueprintReadResult } from '../../core/blueprint-reader';
import type { ProjectBrain } from '../../core/project-brain';
import type { ProjectFileSource } from '../../core/context-builder';
import { DECOMPOSITION_CONTEXT_LIMITS } from './feature-plan.types';

export interface DecompositionContextPackage {
  readonly schemaVersion: 1;
  readonly featureRequest: string;
  readonly project: {
    readonly id: string;
    readonly name: string;
    readonly vision: string;
    readonly milestone: string;
  };
  readonly goals: readonly string[];
  readonly constraints: readonly string[];
  readonly architecture: {
    readonly summary: string;
    readonly modules: readonly { readonly path: string; readonly responsibility: string }[];
  };
  readonly repository: {
    readonly totalSourcePaths: number;
    readonly topLevelAreas: readonly { readonly prefix: string; readonly count: number }[];
    readonly indicators: readonly string[];
  };
  readonly rootConfiguration: {
    readonly packageName?: string;
    readonly scripts: readonly string[];
    readonly frameworkHints: readonly string[];
  };
  readonly ownershipBoundaries: readonly string[];
}

export class DecompositionContextBuilder {
  async build(
    featureRequest: string,
    brain: ProjectBrain,
    reader: BlueprintReadResult,
    sourceFiles: ProjectFileSource,
    readRootFile: (relativePath: string) => Promise<string | undefined>,
  ): Promise<DecompositionContextPackage> {
    if (!reader.valid || reader.analysis === undefined || reader.summary === undefined) {
      throw new Error('Blueprint reader output is invalid.');
    }
    const sourcePaths = await sourceFiles.listSourcePaths();
    const context: DecompositionContextPackage = {
      schemaVersion: 1,
      featureRequest: featureRequest.trim(),
      project: {
        id: brain.blueprint.projectId,
        name: brain.blueprint.name,
        vision: brain.blueprint.vision,
        milestone: brain.progressLog.currentMilestone,
      },
      goals: brain.blueprint.goals.map(({ statement }) => statement).slice(0, 8),
      constraints: brain.blueprint.constraints.map(({ statement }) => statement).slice(0, 8),
      architecture: {
        summary:
          `${reader.analysis.architecture.scope} — ${reader.analysis.architecture.principles.join('; ')}`.slice(
            0,
            1_000,
          ),
        modules: reader.analysis.modules.slice(0, 24).map(({ path, responsibility }) => ({
          path,
          responsibility: responsibility.slice(0, 240),
        })),
      },
      repository: summarizeRepository(sourcePaths),
      rootConfiguration: await readRootConfiguration(readRootFile),
      ownershipBoundaries: buildOwnershipBoundaries(reader),
    };
    const serialized = JSON.stringify(context);
    if (serialized.length > DECOMPOSITION_CONTEXT_LIMITS.MAX_SERIALIZED_CHARACTERS) {
      return {
        ...context,
        architecture: {
          ...context.architecture,
          modules: context.architecture.modules.slice(0, 12),
        },
        goals: context.goals.slice(0, 4),
        constraints: context.constraints.slice(0, 4),
      };
    }
    return context;
  }
}

function summarizeRepository(
  sourcePaths: readonly string[],
): DecompositionContextPackage['repository'] {
  const counts = new Map<string, number>();
  const indicators = new Set<string>();
  for (const sourcePath of sourcePaths) {
    const prefix = sourcePath.split('/').slice(0, 2).join('/');
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    if (sourcePath.includes('prisma/') || sourcePath.endsWith('schema.prisma'))
      indicators.add('schema-root-present');
    if (sourcePath.startsWith('app/api/')) indicators.add('app-api-root-present');
    if (sourcePath.includes('/__tests__/') || /\.(test|spec)\.[cm]?tsx?$/u.test(sourcePath)) {
      indicators.add('tests-present');
    }
    if (sourcePath.startsWith('src/features/')) indicators.add('feature-modules-present');
    if (sourcePath.startsWith('.builderai/')) indicators.add('builderai-workflow-persistence');
  }
  const topLevelAreas = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 12)
    .map(([prefix, count]) => ({ prefix, count }));
  return {
    totalSourcePaths: sourcePaths.length,
    topLevelAreas,
    indicators: [...indicators].sort(),
  };
}

async function readRootConfiguration(
  readRootFile: (relativePath: string) => Promise<string | undefined>,
): Promise<DecompositionContextPackage['rootConfiguration']> {
  const packageJson = await readRootFile('package.json');
  if (packageJson === undefined) {
    return { scripts: [], frameworkHints: [] };
  }
  try {
    const parsed = JSON.parse(packageJson) as { name?: string; scripts?: Record<string, string> };
    const scripts = Object.keys(parsed.scripts ?? {})
      .slice(0, 12)
      .sort();
    const frameworkHints: string[] = [];
    const dependencies = JSON.stringify(parsed);
    if (dependencies.includes('next')) frameworkHints.push('next');
    if (dependencies.includes('react')) frameworkHints.push('react');
    if (dependencies.includes('prisma')) frameworkHints.push('prisma');
    if (dependencies.includes('vitest') || dependencies.includes('jest'))
      frameworkHints.push('tests');
    return {
      ...(typeof parsed.name === 'string' ? { packageName: parsed.name.slice(0, 120) } : {}),
      scripts,
      frameworkHints,
    };
  } catch {
    return { scripts: [], frameworkHints: [] };
  }
}

export function measureDecompositionContext(context: DecompositionContextPackage): number {
  return JSON.stringify(context).length;
}

const OWNERSHIP_BOUNDARY_LIMITS = {
  MAX_ENTRIES: 6,
  MAX_ENTRY_CHARACTERS: 240,
} as const;

function buildOwnershipBoundaries(reader: BlueprintReadResult): readonly string[] {
  const boundaries = [
    'Project Brain (project-brain.json, src/core/project-brain) is canonical durable governance—not generic workflow or transient execution state.',
    'Feature workflow plans persist under .builderai; they are local workflow state, not canonical Project Brain.',
    'src/application/workspace owns server-side workspace orchestration for operational workflow features.',
    'expectedAreas must align with architecture module responsibilities; propose Project Brain paths only when the task genuinely changes Project Brain governance, contracts, or canonical state.',
    'UI (src/ui, src/app) and infrastructure (src/infrastructure) follow their documented module responsibilities.',
  ];
  const moduleBoundaries = (reader.analysis?.modules ?? [])
    .slice(0, 2)
    .map(({ path, responsibility }) =>
      `${path} owns ${responsibility.slice(0, OWNERSHIP_BOUNDARY_LIMITS.MAX_ENTRY_CHARACTERS - path.length - 7)}.`.slice(
        0,
        OWNERSHIP_BOUNDARY_LIMITS.MAX_ENTRY_CHARACTERS,
      ),
    );
  return [...boundaries, ...moduleBoundaries]
    .slice(0, OWNERSHIP_BOUNDARY_LIMITS.MAX_ENTRIES)
    .map((entry) => entry.slice(0, OWNERSHIP_BOUNDARY_LIMITS.MAX_ENTRY_CHARACTERS));
}
