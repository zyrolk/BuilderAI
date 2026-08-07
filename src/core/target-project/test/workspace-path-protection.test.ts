import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { FileApplyEngineService } from '../../file-apply';
import {
  InMemoryFileSystemPort,
  createPlan,
  createOperation,
} from '../../file-apply/test/file-apply.fixture';
import {
  createWorkspacePathProtectionPolicyFromManifest,
  DEFAULT_WORKSPACE_PATH_PROTECTION,
} from '../workspace-path-protection';
import { loadWorkspacePathProtectionPolicy } from '../workspace-path-protection.loader';
import { Gate2ReviewProjectionService } from '../../../application/workspace/gate2-review/gate2-review-projection.service';
import {
  createPlanFromOperations,
  createUpdateOperation,
} from '../../../application/workspace/gate2-review/gate2-review.fixture';
import { ZYRO_STYLE_FIXTURE_ROOT } from './external-target.fixture';

describe('workspace path protection policy', () => {
  it('keeps mandatory protections non-overridable and adds manifest restrictions', () => {
    const policy = createWorkspacePathProtectionPolicyFromManifest(['infra/', 'server/secrets/']);
    expect(policy.isNeverExpose('project-brain.json')).toBe(true);
    expect(policy.isMutationProtected('infra/deploy.ts')).toBe(true);
    expect(policy.isNeverExpose('server/secrets/api-config.json')).toBe(true);
    expect(policy.isContentEligible('firestore.rules')).toBe(true);
  });

  it('normalizes Windows and POSIX paths consistently for matching', () => {
    const policy = createWorkspacePathProtectionPolicyFromManifest(['infra/']);
    expect(policy.isMutationProtected('infra\\deploy.ts')).toBe(true);
    expect(policy.isMutationProtected('infra/deploy.ts')).toBe(true);
  });

  it('loads external-target manifest protected areas from disk', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'builderai-path-protection-'));
    try {
      cpSync(ZYRO_STYLE_FIXTURE_ROOT, root, { recursive: true });
      writeFileSync(
        path.join(root, '.builderai', 'target-project.json'),
        JSON.stringify({
          schemaVersion: 1,
          projectId: 'zyro-style-fixture',
          name: 'Fixture',
          vision: 'CP10 path protection fixture.',
          currentMilestone: 'CP10',
          protectedAreas: ['infra/', 'server/secrets/'],
        }),
        'utf8',
      );
      const policy = loadWorkspacePathProtectionPolicy(root, 'EXTERNAL_TARGET');
      expect(policy.isMutationProtected('infra/pipeline.ts')).toBe(true);
      expect(policy.isNeverExpose('server/secrets/api-config.json')).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('masks only never-expose paths in Gate 2 while allowing mutation-protected diffs', () => {
    const policy = createWorkspacePathProtectionPolicyFromManifest(['infra/', 'server/secrets/']);
    const gate2 = new Gate2ReviewProjectionService(undefined, policy);
    const review = gate2.project(
      createPlanFromOperations([
        createUpdateOperation('infra/pipeline.ts', 'old\n', 'new\n'),
        createUpdateOperation('server/secrets/api-config.json', '{"a":1}\n', '{"a":2}\n'),
        createUpdateOperation('project-brain.json', '{}\n', '{"tamper":true}\n'),
      ]),
      {
        readTextBaseline(logicalPath) {
          if (logicalPath === 'infra/pipeline.ts') {
            return {
              logicalPath,
              content: 'old\n',
              checksum: { algorithm: 'SHA-256', value: 'a'.repeat(64) },
              sizeBytes: 4,
            };
          }
          if (logicalPath === 'server/secrets/api-config.json') {
            return {
              logicalPath,
              content: '{"a":1}\n',
              checksum: { algorithm: 'SHA-256', value: 'b'.repeat(64) },
              sizeBytes: 8,
            };
          }
          if (logicalPath === 'project-brain.json') {
            return {
              logicalPath,
              content: '{}\n',
              checksum: { algorithm: 'SHA-256', value: 'c'.repeat(64) },
              sizeBytes: 3,
            };
          }
          return null;
        },
      },
    );

    const infra = review.operationDiffs.find(
      ({ logicalPath }) => logicalPath === 'infra/pipeline.ts',
    );
    const secret = review.operationDiffs.find(
      ({ logicalPath }) => logicalPath === 'server/secrets/api-config.json',
    );
    const brain = review.operationDiffs.find(
      ({ logicalPath }) => logicalPath === 'project-brain.json',
    );
    expect(infra?.format).toBe('UNIFIED');
    expect(secret?.format).toBe('PROTECTED');
    expect(brain?.format).toBe('PROTECTED');
    expect(JSON.stringify(review)).not.toContain('super-secret-token');
  });

  it('rejects manifest protected mutations during apply preflight', async () => {
    const policy = createWorkspacePathProtectionPolicyFromManifest(['infra/']);
    const fileSystem = new InMemoryFileSystemPort();
    const result = await new FileApplyEngineService(
      fileSystem,
      policy.toFileApplyConfiguration(),
    ).apply(createPlan([createOperation('UPDATE_FILE', 'infra/pipeline.ts', 'next\n')]));
    expect(result.status).toBe('REJECTED');
    expect(result.errors[0]?.code).toBe('PROTECTED_PATH');
    expect(fileSystem.mutationCalls).toEqual([]);
  });

  it('preserves BUILDERAI_SELF mandatory-only behavior by default', () => {
    expect(DEFAULT_WORKSPACE_PATH_PROTECTION.isMutationProtected('src/app.ts')).toBe(false);
    expect(DEFAULT_WORKSPACE_PATH_PROTECTION.isNeverExpose('.env.local')).toBe(true);
    expect(loadWorkspacePathProtectionPolicy(process.cwd(), 'BUILDERAI_SELF')).toBe(
      DEFAULT_WORKSPACE_PATH_PROTECTION,
    );
  });
});
