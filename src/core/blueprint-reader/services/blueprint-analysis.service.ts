import type { ProjectBrain } from '../../project-brain';
import { normalizeHeading } from '../parsers';
import type { ArchitectureAnalysis, BlueprintAnalysis, ParsedMarkdownDocument } from '../types';

function sectionContent(document: ParsedMarkdownDocument | undefined, heading: string): string {
  return (
    document?.sections.find((section) => section.normalizedHeading === normalizeHeading(heading))
      ?.content ?? ''
  );
}

function parseList(content: string): readonly string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(?:[-*]|\d+\.)\s+(.+?)\s*$/)?.[1])
    .filter((item): item is string => item !== undefined);
}

export class BlueprintAnalysisService {
  analyze(brain: ProjectBrain, documents: readonly ParsedMarkdownDocument[]): BlueprintAnalysis {
    const architectureDocument = documents.find(({ kind }) => kind === 'architecture');
    const architecture: ArchitectureAnalysis = {
      scope: sectionContent(architectureDocument, 'Status and scope'),
      principles: parseList(sectionContent(architectureDocument, 'Architectural principles')),
    };

    return {
      projectId: brain.blueprint.projectId,
      projectName: brain.blueprint.name,
      vision: brain.blueprint.vision,
      goals: brain.blueprint.goals,
      architecture,
      modules: brain.blueprint.folderOwnership,
      milestones: {
        current: brain.progressLog.currentMilestone,
        completed: brain.progressLog.completedSprints.map(({ id, name, outcome }) => ({
          id,
          name,
          outcome,
        })),
      },
      features: brain.blueprint.features,
      requirements: brain.blueprint.requirements,
      constraints: brain.blueprint.constraints,
      techStack: brain.blueprint.techStack,
    };
  }
}
