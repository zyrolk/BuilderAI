const inspectProject = vi.fn();

vi.mock('../../../../infrastructure/workspace/local-runtime-configuration', () => ({
  loadLocalWorkspaceRuntimeConfiguration: () => ({
    projectRoot: '/tmp/target-project',
    projectProfile: 'TRUSTED_LOCAL',
  }),
}));

vi.mock('../../../../core/target-project', () => ({
  readWorkspaceProjectId: () => 'project-a',
}));

vi.mock('../../../../infrastructure/workflow-ledger', () => ({
  DEFAULT_WORKFLOW_STATE_ROOT_CONFIGURATION: { stateRoot: '/tmp/builderai-state' },
  FilesystemWorkflowLedgerStore: vi.fn(),
  StartupRecoveryInspector: vi.fn(function StartupRecoveryInspectorMock(this: {
    inspectProject: typeof inspectProject;
  }) {
    this.inspectProject = inspectProject;
  }),
}));

vi.mock('../../../../infrastructure/workflow-ledger/durable-apply-checkpoint.store', () => ({
  DurableApplyCheckpointStore: vi.fn(function DurableApplyCheckpointStoreMock(this: {
    load: ReturnType<typeof vi.fn>;
  }) {
    this.load = vi.fn().mockResolvedValue(undefined);
  }),
}));

async function callGet(origin = 'http://localhost:3000'): Promise<Response> {
  const { GET } = await import('./route');
  return GET(
    new Request('http://localhost:3000/api/workspace/recovery', {
      method: 'GET',
      headers: { origin, Accept: 'application/json' },
    }),
  );
}

describe('GET /api/workspace/recovery', () => {
  beforeEach(() => {
    inspectProject.mockReset();
  });

  it('returns 403 LocalRequestRejected for missing or invalid origin', async () => {
    const { GET } = await import('./route');
    const untrusted = new Request('http://localhost:3000/api/workspace/recovery', {
      method: 'GET',
      headers: { origin: 'http://evil.example', Accept: 'application/json' },
    });

    const response = await GET(untrusted);
    const payload = (await response.json()) as { code: string; message: string };

    expect(response.status).toBe(403);
    expect(payload.code).toBe('LOCAL_REQUEST_REJECTED');
    expect(inspectProject).not.toHaveBeenCalled();
  });

  it('returns recovery inspection payload for trusted local GET requests', async () => {
    inspectProject.mockResolvedValueOnce([
      {
        workflowId: 'wf-1',
        classification: 'RECOVERY_REQUIRED',
        manifest: {
          workflowState: 'APPLYING',
          baselineDigest: 'baseline-digest',
        },
        hasIncompleteApply: true,
        hasBaselineDriftEvent: false,
        hasStaleApproval: false,
      },
    ]);

    const response = await callGet();
    const payload = (await response.json()) as {
      projectId: string;
      workflows: Array<{
        workflowId: string;
        classification: string;
        recoveryRequired: boolean;
        hasIncompleteApply: boolean;
      }>;
    };

    expect(response.status).toBe(200);
    expect(payload.projectId).toBe('project-a');
    expect(payload.workflows).toHaveLength(1);
    expect(payload.workflows[0]).toMatchObject({
      workflowId: 'wf-1',
      classification: 'RECOVERY_REQUIRED',
      recoveryRequired: true,
      hasIncompleteApply: true,
    });
    expect(inspectProject).toHaveBeenCalledWith('project-a', expect.any(Date));
  });
});
