import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { ExecutionCancellationToken } from '../../../core/execution-engine';
import { ProjectFileSourceAccessDeniedError } from '../../../core/context-builder';
import { OpenAIProvider } from '../../../providers/openai';
import {
  createOpenAIConfiguration,
  FakeOpenAIResponsesClient,
} from '../../../providers/openai/test/openai-provider.fixture';
import { GeminiProvider } from '../../../providers/gemini';
import {
  createGeminiConfiguration,
  FakeGeminiClient,
} from '../../../providers/gemini/test/gemini-provider.fixture';
import { OpenRouterProvider } from '../../../providers/openrouter';
import {
  createOpenRouterConfiguration,
  FakeOpenRouterChatClient,
} from '../../../providers/openrouter/test/openrouter-provider.fixture';
import { ExternalTargetReadinessService } from '../external-target-readiness';
import { WorkspaceAuthorizationService } from '../workspace-authorization.service';
import type { ToolExecutionContext } from './tool-registry.types';
import { createB1ProofToolRegistry } from './create-b1-proof-registry';
import { ToolPolicyGate } from './tool-policy';
import { ToolRegistry } from './tool-registry';
import { ToolExecutor } from './tool-executor';

function neverCancelled(): ExecutionCancellationToken {
  return { cancelled: false, subscribe: () => () => undefined };
}

function cancellableToken(): ExecutionCancellationToken & { cancel(reason?: string): void } {
  let cancelled = false;
  let reason: string | undefined;
  const listeners: Array<(r?: string) => void> = [];
  return {
    get cancelled() {
      return cancelled;
    },
    get reason() {
      return reason;
    },
    subscribe(listener) {
      listeners.push(listener);
      return () => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
    cancel(nextReason = 'test cancel') {
      cancelled = true;
      reason = nextReason;
      for (const listener of listeners) listener(reason);
    },
  };
}

function authService(projectId = 'proj-a'): WorkspaceAuthorizationService {
  return new WorkspaceAuthorizationService({
    profile: 'TRUSTED_LOCAL',
    projectId,
    principalId: 'local-operator',
  });
}

function baseContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    runId: 'run-1',
    projectId: 'proj-a',
    projectRoot: process.cwd(),
    phase: 'UNDERSTANDING',
    principal: { principalId: 'local-operator', projectId: 'proj-a' },
    securityProfile: 'TRUSTED_LOCAL',
    securityEvidence: { operatorApproved: true },
    cancellation: neverCancelled(),
    ...overrides,
  };
}

describe('ToolExecutor policy and lifecycle', () => {
  it('rejects unknown tools and disallowed phases', async () => {
    const authorization = authService();
    const policy = new ToolPolicyGate(authorization);
    const registry = new ToolRegistry(policy);
    registry.register({
      definition: {
        toolId: 'search_repository',
        name: 'Search',
        description: 't',
        inputSchema: {},
        outputSchema: {},
        capabilityClass: 'SEARCH',
        readOnly: true,
        riskLevel: 'LOW',
        authorizationAction: 'INVESTIGATE',
        requiresGate2: false,
        approvalRequirement: 'NONE',
        workspaceScoped: true,
        timeoutMs: 5_000,
        supportsCancellation: true,
        evidencePolicy: 'SUMMARY',
        auditPolicy: 'DIGEST',
        allowedPhases: ['UNDERSTANDING'],
      },
      execute: async () => ({ summary: 'ok', structured: { ok: true } }),
    });
    const executor = new ToolExecutor(registry, policy);

    const unknown = await executor.execute(
      { callId: 'c1', toolId: 'not_a_tool', args: {} },
      baseContext(),
    );
    expect(unknown.status).toBe('REJECTED_BY_POLICY');
    expect(unknown.errorCode).toBe('UNKNOWN_TOOL');

    const phase = await executor.execute(
      { callId: 'c2', toolId: 'search_repository', args: {} },
      baseContext({ phase: 'AWAITING_GATE2' }),
    );
    expect(phase.status).toBe('REJECTED_BY_POLICY');
    expect(phase.errorCode).toBe('PHASE_NOT_ALLOWED');
  });

  it('honors cancellation and timeout', async () => {
    const authorization = authService();
    const policy = new ToolPolicyGate(authorization);
    const registry = new ToolRegistry(policy);
    registry.register({
      definition: {
        toolId: 'search_repository',
        name: 'Search',
        description: 't',
        inputSchema: {},
        outputSchema: {},
        capabilityClass: 'SEARCH',
        readOnly: true,
        riskLevel: 'LOW',
        authorizationAction: 'INVESTIGATE',
        requiresGate2: false,
        approvalRequirement: 'NONE',
        workspaceScoped: true,
        timeoutMs: 50,
        supportsCancellation: true,
        evidencePolicy: 'SUMMARY',
        auditPolicy: 'DIGEST',
        allowedPhases: ['UNDERSTANDING'],
      },
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return { summary: 'late' };
      },
    });
    const executor = new ToolExecutor(registry, policy);

    const timedOut = await executor.execute(
      { callId: 't1', toolId: 'search_repository', args: {} },
      baseContext(),
    );
    expect(timedOut.status).toBe('TIMEOUT');

    const token = cancellableToken();
    token.cancel('stop');
    const cancelled = await executor.execute(
      { callId: 't2', toolId: 'search_repository', args: {} },
      baseContext({ cancellation: token }),
    );
    expect(cancelled.status).toBe('CANCELLED');
  });

  it('replays idempotent successful calls process-locally', async () => {
    const authorization = authService();
    const policy = new ToolPolicyGate(authorization);
    const registry = new ToolRegistry(policy);
    let calls = 0;
    registry.register({
      definition: {
        toolId: 'inspect_readiness',
        name: 'Inspect',
        description: 't',
        inputSchema: {},
        outputSchema: {},
        capabilityClass: 'INSPECT',
        readOnly: true,
        riskLevel: 'LOW',
        authorizationAction: 'READINESS',
        requiresGate2: false,
        approvalRequirement: 'NONE',
        workspaceScoped: true,
        timeoutMs: 5_000,
        supportsCancellation: true,
        evidencePolicy: 'SUMMARY',
        auditPolicy: 'DIGEST',
        allowedPhases: ['UNDERSTANDING'],
      },
      execute: async () => {
        calls += 1;
        return { summary: 'ready', structured: { status: 'READY' } };
      },
    });
    const executor = new ToolExecutor(registry, policy);
    const first = await executor.execute(
      { callId: 'i1', toolId: 'inspect_readiness', args: {}, idempotencyKey: 'k1' },
      baseContext(),
    );
    const second = await executor.execute(
      { callId: 'i2', toolId: 'inspect_readiness', args: {}, idempotencyKey: 'k1' },
      baseContext(),
    );
    expect(first.status).toBe('SUCCEEDED');
    expect(second).toEqual(first);
    expect(calls).toBe(1);
  });
});

describe('B1 proof tools composition', () => {
  it('executes SEARCH/READ/INSPECT without FileApply and keeps providers toolCalling:false', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'builderai-b1-tools-'));
    try {
      await mkdir(path.join(root, 'src'), { recursive: true });
      await writeFile(
        path.join(root, 'package.json'),
        JSON.stringify({ name: 'fixture', private: true, scripts: { build: 'echo ok' } }),
        'utf8',
      );
      await writeFile(
        path.join(root, 'src', 'hello.ts'),
        'export const hello = "world";\n',
        'utf8',
      );

      const files = new Map<string, string>([['src/hello.ts', 'export const hello = "world";\n']]);
      const fileApply = { apply: vi.fn() };

      const authorization = authService('proj-a');
      const { registry, executor } = createB1ProofToolRegistry({
        authorization,
        search: {
          listSourcePaths: async () => [...files.keys()],
          readSourceFile: async (logicalPath) => {
            const content = files.get(logicalPath);
            if (content === undefined) throw new ProjectFileSourceAccessDeniedError();
            return content;
          },
        },
        read: {
          readSourceFile: async (logicalPath) => {
            const content = files.get(logicalPath);
            if (content === undefined) throw new ProjectFileSourceAccessDeniedError();
            return content;
          },
        },
        readiness: {
          project: async ({ projectRoot }) =>
            new ExternalTargetReadinessService().project({ projectRoot }),
        },
      });

      expect(registry.listDefinitions().every((d) => d.readOnly)).toBe(true);
      expect(registry.listDefinitions().every((d) => d.authorizationAction !== 'APPLY')).toBe(true);
      expect(registry.dependencySurface().join(',')).not.toMatch(/FileApply|fileApply/i);

      const search = await executor.execute(
        { callId: 's1', toolId: 'search_repository', args: { query: 'hello' } },
        baseContext({ projectRoot: root }),
      );
      expect(search.status).toBe('SUCCEEDED');
      expect(search.structured).toMatchObject({ matchCount: expect.any(Number) });
      expect(JSON.stringify(search).includes('"fileContents"')).toBe(false);

      const read = await executor.execute(
        { callId: 'r1', toolId: 'read_source_file', args: { logicalPath: 'src/hello.ts' } },
        baseContext({ projectRoot: root }),
      );
      expect(read.status).toBe('SUCCEEDED');
      expect(read.structured).toMatchObject({
        logicalPath: 'src/hello.ts',
        preview: expect.stringContaining('hello'),
        contentDigest: expect.any(String),
      });
      expect(JSON.stringify(read).includes('"fileContents"')).toBe(false);

      const denied = await executor.execute(
        { callId: 'r2', toolId: 'read_source_file', args: { logicalPath: 'secret.env' } },
        baseContext({ projectRoot: root }),
      );
      expect(denied.status).toBe('FAILED');
      expect(denied.errorCode).toBe('ACCESS_DENIED');

      const inspect = await executor.execute(
        { callId: 'n1', toolId: 'inspect_readiness', args: {} },
        baseContext({ projectRoot: root }),
      );
      expect(inspect.status).toBe('SUCCEEDED');
      expect(inspect.structured).toMatchObject({
        status: expect.any(String),
        verification: expect.any(Object),
      });

      expect(fileApply.apply).not.toHaveBeenCalled();

      expect(
        new OpenAIProvider(createOpenAIConfiguration(), new FakeOpenAIResponsesClient()).descriptor
          .capabilities.toolCalling,
      ).toBe(false);
      expect(
        new GeminiProvider(createGeminiConfiguration(), new FakeGeminiClient()).descriptor
          .capabilities.toolCalling,
      ).toBe(false);
      expect(
        new OpenRouterProvider(createOpenRouterConfiguration(), new FakeOpenRouterChatClient())
          .descriptor.capabilities.toolCalling,
      ).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
