import { describe, expect, it, vi } from 'vitest';

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
import { WorkspaceAuthorizationService } from '../workspace-authorization.service';
import type { ToolExecutionContext } from './tool-registry.types';
import { createB1ProofToolRegistry } from './create-b1-proof-registry';
import { createB2IntelligenceRegistryFromSource } from './create-b2-intelligence-registry';
import { RepositorySearchService } from '../investigation/repository-search.service';
import { DEFAULT_INVESTIGATION_CONFIGURATION } from '../investigation/investigation-configuration';
import type { ExecutionCancellationToken } from '../../../core/execution-engine';

function neverCancelled(): ExecutionCancellationToken {
  return { cancelled: false, subscribe: () => () => undefined };
}

function authService(projectId = 'proj-b2'): WorkspaceAuthorizationService {
  return new WorkspaceAuthorizationService({
    profile: 'TRUSTED_LOCAL',
    projectId,
    principalId: 'local-operator',
  });
}

function baseContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    runId: 'run-b2',
    projectId: 'proj-b2',
    projectRoot: '/tmp/proj-b2',
    phase: 'UNDERSTANDING',
    principal: { principalId: 'local-operator', projectId: 'proj-b2' },
    securityProfile: 'TRUSTED_LOCAL',
    securityEvidence: { operatorApproved: true },
    cancellation: neverCancelled(),
    ...overrides,
  };
}

function buildLargeCatalog(): Map<string, string> {
  const files = new Map<string, string>();
  for (let index = 0; index < 2_100; index += 1) {
    const id = String(index).padStart(5, '0');
    // Lexicographically early padding — former blind 15k cut would prefer these.
    files.set(`aaa/padding/file-${id}.ts`, `export const pad${id} = ${index};\n`);
  }
  // Planted targets — late lexicographic prefixes so they sit past a 15k-style alpha window
  // when mixed with large early padding (DoD inventory + recall).
  files.set(
    'zzz/api/ordersRoute.ts',
    'export function ordersRoute() { return handleOrdersApi(); }\n',
  );
  files.set(
    'zzz/api/ordersRoute.test.ts',
    'describe("ordersRoute", () => { it("covers api", () => {}); });\n',
  );
  files.set('zzz/prisma/schema.prisma', 'model Order { id String @id }\n');
  files.set('secret.env', 'API_KEY=should-never-leak\n');
  return files;
}

describe('B2 intelligence composition / DoD', () => {
  it('meets recall, boundedness, inventory, safety, and B1 freeze DoD', async () => {
    const files = buildLargeCatalog();
    expect(files.size).toBeGreaterThanOrEqual(2_000);

    const listSourcePaths = async () => [...files.keys()].filter((path) => path !== 'secret.env');
    const readSourceFile = async (logicalPath: string) => {
      if (logicalPath === 'secret.env' || logicalPath.includes('secret')) {
        throw new ProjectFileSourceAccessDeniedError();
      }
      const content = files.get(logicalPath);
      if (content === undefined) throw new ProjectFileSourceAccessDeniedError();
      return content;
    };

    const fileApply = { apply: vi.fn() };
    const authorization = authService();
    const { registry, executor } = createB2IntelligenceRegistryFromSource({
      authorization,
      listSourcePaths,
      readSourceFile,
      readiness: {
        project: async () => ({
          schemaVersion: 1,
          status: 'READY',
          profile: 'EXTERNAL_TARGET',
          projectId: 'proj-b2',
          projectName: 'proj-b2',
          projectRootDisplay: 'proj-b2',
          runtimeConnected: false,
          sourceRoots: ['src'],
          testRoots: ['tests'],
          governanceDocuments: [],
          indexedFileCount: files.size,
          protectedAreas: [],
          verification: {
            build: true,
            test: true,
            lint: true,
            typecheck: true,
            format: false,
            devServer: false,
            browserVerification: false,
          },
          warnings: [],
          blockers: [],
        }),
      },
    });

    const toolIds = registry
      .listDefinitions()
      .map((item) => item.toolId)
      .sort();
    expect(toolIds).toEqual([
      'find_related_files',
      'inspect_file_outline',
      'inspect_imports',
      'inspect_readiness',
      'read_source_file',
      'retrieve_relevant_context',
      'search_repository',
    ]);
    expect(registry.listDefinitions().every((d) => d.readOnly)).toBe(true);
    expect(registry.listDefinitions().every((d) => d.authorizationAction !== 'APPLY')).toBe(true);
    expect(registry.dependencySurface().join(',')).not.toMatch(/FileApply|fileApply/i);

    // Inventory regression via RepositorySearchService (shared foundation).
    const searchService = new RepositorySearchService({
      ...DEFAULT_INVESTIGATION_CONFIGURATION,
      maximumFilesScanned: 400,
      maximumCandidatePaths: 15_000,
    });
    const searchResult = await searchService.search(
      await listSourcePaths(),
      ['ordersRoute', 'orders'],
      readSourceFile,
      'Fix the orders API route handler',
    );
    expect(searchResult.filesScanned).toBeLessThanOrEqual(400);
    expect(searchResult.matches.some((m) => m.logicalPath === 'zzz/api/ordersRoute.ts')).toBe(true);

    // Recall DoD — three goals, planted targets in top-K (K<=16).
    const api = await executor.execute(
      {
        callId: 'c-api',
        toolId: 'retrieve_relevant_context',
        args: { goal: 'Update the orders API route handler' },
      },
      baseContext(),
    );
    expect(api.status).toBe('SUCCEEDED');
    const apiPaths = ((api.structured as { files: { logicalPath: string }[] }).files ?? []).map(
      (file) => file.logicalPath,
    );
    expect(apiPaths.length).toBeLessThanOrEqual(16);
    expect(apiPaths).toContain('zzz/api/ordersRoute.ts');

    const testGoal = await executor.execute(
      {
        callId: 'c-test',
        toolId: 'retrieve_relevant_context',
        args: { goal: 'Fix failing ordersRoute unit tests' },
      },
      baseContext(),
    );
    expect(testGoal.status).toBe('SUCCEEDED');
    const testPaths = (
      (testGoal.structured as { files: { logicalPath: string }[] }).files ?? []
    ).map((file) => file.logicalPath);
    expect(testPaths.length).toBeLessThanOrEqual(16);
    expect(testPaths.some((path) => path.includes('ordersRoute.test'))).toBe(true);

    const schema = await executor.execute(
      {
        callId: 'c-schema',
        toolId: 'retrieve_relevant_context',
        args: { goal: 'Update prisma Order schema model configuration' },
      },
      baseContext(),
    );
    expect(schema.status).toBe('SUCCEEDED');
    const schemaPaths = (
      (schema.structured as { files: { logicalPath: string }[] }).files ?? []
    ).map((file) => file.logicalPath);
    expect(schemaPaths.length).toBeLessThanOrEqual(16);
    expect(schemaPaths.some((path) => path.includes('schema.prisma'))).toBe(true);

    // Boundedness — no full catalog in model payload.
    for (const result of [api, testGoal, schema]) {
      const serialized = JSON.stringify(result);
      expect(serialized.length).toBeLessThan(80_000);
      expect(serialized.includes('"fileContents"')).toBe(false);
      expect(serialized.includes('API_KEY')).toBe(false);
      expect((result.structured as { files: unknown[] }).files.length).toBeLessThanOrEqual(16);
    }

    const outline = await executor.execute(
      {
        callId: 'c-outline',
        toolId: 'inspect_file_outline',
        args: { logicalPath: 'zzz/api/ordersRoute.ts' },
      },
      baseContext(),
    );
    expect(outline.status).toBe('SUCCEEDED');
    expect(outline.structured).toMatchObject({
      entries: expect.arrayContaining([
        expect.objectContaining({ name: 'ordersRoute', kind: 'EXPORT_FUNCTION' }),
      ]),
    });

    const related = await executor.execute(
      {
        callId: 'c-related',
        toolId: 'find_related_files',
        args: { logicalPath: 'zzz/api/ordersRoute.ts', goal: 'orders api tests' },
      },
      baseContext(),
    );
    expect(related.status).toBe('SUCCEEDED');

    const denied = await executor.execute(
      {
        callId: 'c-deny',
        toolId: 'read_source_file',
        args: { logicalPath: 'secret.env' },
      },
      baseContext(),
    );
    expect(denied.status).toBe('FAILED');
    expect(denied.errorCode).toBe('ACCESS_DENIED');

    // Gate 2 cannot be bypassed via tools — APPLY tools rejected at registration; B2 has none.
    expect(registry.listDefinitions().some((d) => d.requiresGate2)).toBe(false);

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

    // B1 freeze — same three tools still succeed with prior contracts.
    const b1 = createB1ProofToolRegistry({
      authorization,
      search: { listSourcePaths, readSourceFile },
      read: { readSourceFile },
      readiness: {
        project: async () => {
          throw new Error('unused');
        },
      },
    });
    const search = await b1.executor.execute(
      { callId: 'b1-s', toolId: 'search_repository', args: { query: 'ordersRoute' } },
      baseContext(),
    );
    expect(search.status).toBe('SUCCEEDED');
    const read = await b1.executor.execute(
      {
        callId: 'b1-r',
        toolId: 'read_source_file',
        args: { logicalPath: 'zzz/api/ordersRoute.ts' },
      },
      baseContext(),
    );
    expect(read.status).toBe('SUCCEEDED');
    expect(JSON.stringify(read).includes('"fileContents"')).toBe(false);
  }, 60_000);
});
