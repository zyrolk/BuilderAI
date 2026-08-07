import { loadCanonicalProjectBrain, type ProjectBrain } from '../../core/project-brain';
import { ExternalTargetReadinessService } from '../../application/workspace/external-target-readiness';
import type { ExternalTargetReadiness } from '../../application/workspace/external-target-readiness';
import { loadWorkspaceProjectBrain } from '../../core/target-project';
import type { WorkspaceProjectView } from '../../ui/workspace/workspace.types';
import { loadLocalWorkspaceRuntimeConfiguration } from './local-runtime-configuration';
import type { WorkspacePageContext } from './workspace-page-context.types';

export function loadWorkspaceProjectBrainForView(): ProjectBrain {
  if (process.env.BUILDERAI_LIVE_WORKFLOW_ENABLED !== 'true') {
    return loadCanonicalProjectBrain();
  }
  const { projectRoot, projectProfile } = loadLocalWorkspaceRuntimeConfiguration();
  return loadWorkspaceProjectBrain(projectRoot, projectProfile);
}

export async function loadWorkspacePageContext(): Promise<WorkspacePageContext> {
  if (process.env.BUILDERAI_LIVE_WORKFLOW_ENABLED !== 'true') {
    return {
      runtimeAvailable: false,
      profile: 'BUILDERAI_SELF',
      project: mapBrainToProjectView(loadCanonicalProjectBrain()),
    };
  }

  try {
    const configuration = loadLocalWorkspaceRuntimeConfiguration();
    if (configuration.projectProfile === 'BUILDERAI_SELF') {
      const brain = loadWorkspaceProjectBrain(configuration.projectRoot, 'BUILDERAI_SELF');
      return {
        runtimeAvailable: true,
        profile: 'BUILDERAI_SELF',
        project: mapBrainToProjectView(brain),
      };
    }

    const readiness = await new ExternalTargetReadinessService().project({
      projectRoot: configuration.projectRoot,
      extraSourceScanRoots: configuration.extraSourceScanRoots,
      runtimeConnected: true,
    });
    return {
      runtimeAvailable: true,
      profile: 'EXTERNAL_TARGET',
      project: mapReadinessToProjectView(readiness),
      readiness,
    };
  } catch {
    return {
      runtimeAvailable: false,
      profile: 'BUILDERAI_SELF',
      project: mapBrainToProjectView(loadCanonicalProjectBrain()),
    };
  }
}

function mapBrainToProjectView(brain: ProjectBrain): WorkspaceProjectView {
  return {
    id: brain.blueprint.projectId,
    name: brain.blueprint.name,
    vision: brain.blueprint.vision,
    currentMilestone: brain.progressLog.currentMilestone,
    architectureStatus: 'Core boundaries validated',
    moduleCount: brain.blueprint.folderOwnership.filter(({ path }) => path.startsWith('src/'))
      .length,
    completedSprintCount: brain.progressLog.completedSprints.length,
  };
}

function mapReadinessToProjectView(readiness: ExternalTargetReadiness): WorkspaceProjectView {
  return {
    id: readiness.projectId,
    name: readiness.projectName,
    vision:
      readiness.status === 'BLOCKED'
        ? 'External target onboarding must be completed before workflow execution.'
        : 'External target connected for investigation, prepare, and apply workflows.',
    currentMilestone: readiness.projectRootDisplay,
    architectureStatus:
      readiness.status === 'READY'
        ? 'External target ready'
        : readiness.status === 'READY_WITH_WARNINGS'
          ? 'External target ready with warnings'
          : 'External target blocked',
    moduleCount: readiness.sourceRoots.length,
    completedSprintCount: readiness.indexedFileCount,
  };
}
