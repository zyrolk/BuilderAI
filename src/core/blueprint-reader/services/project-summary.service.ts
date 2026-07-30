import type { ProjectBrain } from '../../project-brain';
import type {
  BlueprintAnalysis,
  DiscoveryReport,
  DocumentDiagnostic,
  ProjectSummary,
} from '../types';

export class ProjectSummaryService {
  create(
    brain: ProjectBrain,
    analysis: BlueprintAnalysis,
    discovery: DiscoveryReport,
    diagnostics: readonly DocumentDiagnostic[],
  ): ProjectSummary {
    return {
      projectOverview: {
        id: analysis.projectId,
        name: analysis.projectName,
        vision: analysis.vision,
        goals: analysis.goals,
        techStack: analysis.techStack,
      },
      architectureOverview: analysis.architecture,
      moduleList: analysis.modules,
      featureList: analysis.features,
      currentMilestone: analysis.milestones.current,
      pendingWork: brain.memory.pendingWork,
      completedWork: brain.memory.completedWork,
      risks: diagnostics,
      missingDocumentation: discovery.missing.map(({ path }) => path),
    };
  }
}
