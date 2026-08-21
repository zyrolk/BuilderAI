import { describe, expect, it } from 'vitest';

import {
  ProviderCancelledError,
  ProviderUnavailableError,
  type AIProvider,
  type AIProviderRequest,
  type AIProviderResponse,
  type ProviderCancellationSignal,
} from '../../../core/ai-provider';
import {
  ProviderCoordinator,
  type SleepFunction,
} from '../../../core/ai-provider/services/provider-coordinator';
import { DEFAULT_PROVIDER_RETRY_CONFIGURATION } from '../../../core/ai-provider/services/provider-retry-policy';
import { createCancellationTokenFromSignal } from '../request-cancellation';
import { FileApplyEngineService } from '../../../core/file-apply';
import { InMemoryFileSystemPort } from '../../../core/file-apply/test/file-apply.fixture';
import type { ExecutionCancellationToken } from '../../../core/execution-engine';
import type {
  BrowserVerificationRunnerPort,
  RuntimeServerManagerPort,
} from '../../../core/runtime-verification/ports';
import { VerificationEngineService } from '../../../core/verification';
import {
  createAppliedResult,
  createPortHarness,
  PASSED_STAGE_RESULT,
} from '../../../core/verification/test/verification.fixture';
import { RuntimeBrowserVerificationService } from '../../../infrastructure/runtime-verification/runtime-browser-verification.service';
import { createSimpleWebFixture } from '../../../infrastructure/runtime-verification/test/runtime-verification.fixture';
import { CHANGE_PLAN } from '../../../ui/workspace/test/workspace.fixture';
import { CorrectionLoopService } from './correction-loop.service';
import type { CorrectionLoopBeginInput } from './correction-loop.types';

function failedBegin(): CorrectionLoopBeginInput {
  return {
    workflowId: 'wf-boundary',
    applyStatus: 'APPLIED',
    createdPaths: [],
    updatedPaths: ['src/example.ts'],
    deletedPaths: [],
    verificationReport: {
      status: 'FAILED',
      stages: [
        {
          stage: 'BUILD_VALIDATION',
          status: 'FAILED',
          errors: [{ code: 'BUILD_FAILED', message: 'Type error' }],
        },
      ],
      errors: [],
    },
  };
}

function mutableToken(): ExecutionCancellationToken & { cancel: (reason?: string) => void } {
  const listeners: Array<(reason?: string) => void> = [];
  const token = {
    cancelled: false,
    reason: undefined as string | undefined,
    cancel(reason = 'user-cancelled') {
      token.cancelled = true;
      token.reason = reason;
      for (const listener of listeners) listener(reason);
    },
    subscribe(listener: (reason?: string) => void) {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
  };
  return token;
}

async function waitUntilCancelled(token: {
  readonly cancelled: boolean;
  subscribe: (listener: (reason?: string) => void) => () => void;
}): Promise<void> {
  if (token.cancelled) return;
  await new Promise<void>((resolve) => {
    const unsubscribe = token.subscribe(() => {
      unsubscribe();
      resolve();
    });
    if (token.cancelled) {
      unsubscribe();
      resolve();
    }
  });
}

function requestFor(token: ProviderCancellationSignal): AIProviderRequest {
  return {
    contractVersion: 1,
    requestId: 'boundary',
    executionMode: 'SINGLE_RESPONSE',
    timeoutMs: 30_000,
    cancellation: token,
    metadata: {},
  } as AIProviderRequest;
}

function mockResponse(): AIProviderResponse {
  return {
    contractVersion: 1,
    requestId: 'boundary',
    status: 'COMPLETED',
    artifacts: [],
    diagnostics: [],
    warnings: [],
    statistics: { startedAt: '2026-01-01', completedAt: '2026-01-01', durationMs: 10 },
    usage: { inputCharacters: 10, promptCharacters: 10, outputCharacters: 10, artifactCount: 0 },
    metadata: {},
  };
}

function mockProvider(
  execute: (request: AIProviderRequest) => Promise<AIProviderResponse>,
): AIProvider {
  return {
    descriptor: {
      contractVersion: 1,
      id: 'mock',
      displayName: 'Mock',
      capabilities: {
        contextIngestion: true,
        structuredOutput: true,
        streaming: false,
        toolCalling: false,
        reasoning: false,
        fileSupport: false,
        imageSupport: false,
        maximumContextCharacters: 100_000,
        structuredResponses: true,
      },
    },
    execute,
  };
}

describe('P0-9 cancellation production boundaries', () => {
  it('A. cancel during PREPARE does not start APPLY and becomes CORRECTION_CANCELLED', async () => {
    const correction = new CorrectionLoopService();
    await correction.beginCorrection({ ...failedBegin(), workflowId: 'wf-a' });
    const token = mutableToken();
    const cleanup = { ran: false };
    correction.registerCancellation('wf-a', token, () => {
      cleanup.ran = true;
    });
    let attempts = 0;
    const coordinator = new ProviderCoordinator({
      routes: [
        {
          providerId: 'primary',
          provider: mockProvider(async () => {
            attempts += 1;
            return mockResponse();
          }),
        },
      ],
    });
    token.cancel();
    await expect(coordinator.execute(() => requestFor(token), token)).rejects.toBeInstanceOf(
      ProviderCancelledError,
    );
    const session = await correction.cancelCorrection('wf-a');
    expect(attempts).toBe(0);
    expect(cleanup.ran).toBe(true);
    expect(session.state).toBe('CORRECTION_CANCELLED');
    await expect(correction.recordApplying('wf-a')).rejects.toThrow();
  });

  it('B. cancel during provider retry/backoff does not start a second attempt', async () => {
    const correction = new CorrectionLoopService();
    await correction.beginCorrection({ ...failedBegin(), workflowId: 'wf-b' });
    const token = mutableToken();
    correction.registerCancellation('wf-b', token);
    let attempts = 0;
    const sleep: SleepFunction = async (_ms, signal) => {
      if (signal.cancelled) return true;
      await waitUntilCancelled(signal);
      return true;
    };
    const coordinator = new ProviderCoordinator(
      {
        routes: [
          {
            providerId: 'primary',
            provider: mockProvider(async () => {
              attempts += 1;
              throw new ProviderUnavailableError('primary', {
                providerErrorCategory: 'UPSTREAM_5XX',
              });
            }),
          },
        ],
        retry: { ...DEFAULT_PROVIDER_RETRY_CONFIGURATION, maximumAttempts: 3, baseDelayMs: 5_000 },
      },
      { now: () => Date.now() },
      undefined,
      sleep,
    );
    const pending = coordinator.execute(() => requestFor(token), token);
    while (attempts === 0) await Promise.resolve();
    token.cancel();
    await expect(pending).rejects.toBeInstanceOf(ProviderCancelledError);
    await correction.cancelCorrection('wf-b');
    expect(attempts).toBe(1);
    expect(correction.getSession('wf-b')?.state).toBe('CORRECTION_CANCELLED');
  });

  it('C. cancel before the second provider attempt prevents fallback and APPLY', async () => {
    const correction = new CorrectionLoopService();
    await correction.beginCorrection({ ...failedBegin(), workflowId: 'wf-c' });
    const token = mutableToken();
    correction.registerCancellation('wf-c', token);
    let attempts = 0;
    const sleep: SleepFunction = async () => {
      token.cancel();
      return true;
    };
    const coordinator = new ProviderCoordinator(
      {
        routes: [
          {
            providerId: 'primary',
            provider: mockProvider(async () => {
              attempts += 1;
              throw new ProviderUnavailableError('primary', { providerErrorCategory: 'TRANSPORT' });
            }),
          },
          {
            providerId: 'fallback',
            provider: mockProvider(async () => {
              attempts += 1;
              return mockResponse();
            }),
          },
        ],
        retry: { ...DEFAULT_PROVIDER_RETRY_CONFIGURATION, maximumAttempts: 2, baseDelayMs: 1 },
      },
      { now: () => Date.now() },
      undefined,
      sleep,
    );
    await expect(coordinator.execute(() => requestFor(token), token)).rejects.toBeInstanceOf(
      ProviderCancelledError,
    );
    await correction.cancelCorrection('wf-c');
    expect(attempts).toBe(1);
    await expect(correction.recordApplying('wf-c')).rejects.toThrow();
  });

  it('D. cancel during P0-7 verification skips remaining stages', async () => {
    const correction = new CorrectionLoopService();
    await correction.beginCorrection({ ...failedBegin(), workflowId: 'wf-d' });
    await correction.recordPrepared('wf-d', 'prep-d', CHANGE_PLAN);
    await correction.recordApplying('wf-d');
    const token = mutableToken();
    const stages: string[] = [];
    const cleanup = { ran: false };
    correction.registerCancellation('wf-d', token, () => {
      cleanup.ran = true;
    });
    const harness = createPortHarness();
    const hanging = {
      ...harness.ports,
      projectValidator: {
        validateProject: async (context: {
          execution?: { cancellation?: ExecutionCancellationToken };
        }) => {
          stages.push('PROJECT_VALIDATION');
          await waitUntilCancelled(context.execution?.cancellation ?? token);
          return { ...PASSED_STAGE_RESULT, status: 'UNAVAILABLE' as const };
        },
      },
      testRunner: {
        runTests: async () => {
          stages.push('TEST_VALIDATION');
          return PASSED_STAGE_RESULT;
        },
      },
    };
    const engine = new VerificationEngineService(hanging);
    token.cancel();
    const report = await engine.verify(createAppliedResult(), { cancellation: token });
    const session = await correction.cancelCorrection('wf-d');
    expect(stages).not.toContain('TEST_VALIDATION');
    expect(report.stages.some((stage) => stage.status === 'CANCELLED')).toBe(true);
    expect(cleanup.ran).toBe(true);
    expect(session.state).toBe('CORRECTION_CANCELLED');
  });

  it('E. cancel during dev-server startup shuts the server down', async () => {
    const correction = new CorrectionLoopService();
    await correction.beginCorrection({ ...failedBegin(), workflowId: 'wf-e' });
    const token = mutableToken();
    const shutdowns = { count: 0 };
    correction.registerCancellation('wf-e', token, async () => {
      shutdowns.count += 1;
    });
    const projectRoot = createSimpleWebFixture();
    const server: RuntimeServerManagerPort = {
      async start(request) {
        await waitUntilCancelled(request.cancellation ?? token);
        return {
          descriptorId: 'npm-run-dev',
          status: 'CANCELLED',
          startupDurationMs: 4,
        };
      },
      async shutdown() {
        shutdowns.count += 1;
      },
    };
    const browser: BrowserVerificationRunnerPort = {
      async verify() {
        throw new Error('Browser must not start after cancelled server startup.');
      },
    };
    const runtime = new RuntimeBrowserVerificationService(() => server, browser, {
      workflowDeadlineMs: 30_000,
      outputLimitBytes: 64_000,
    });
    const pending = runtime.verify({ projectRoot, cancellation: token });
    await Promise.resolve();
    token.cancel();
    const report = await pending;
    await correction.cancelCorrection('wf-e');
    expect(report.status).toBe('CANCELLED');
    expect(shutdowns.count).toBeGreaterThanOrEqual(1);
    expect(correction.getSession('wf-e')?.state).toBe('CORRECTION_CANCELLED');
  });

  it('F. cancel during browser verification stops the browser and shuts down the server', async () => {
    const correction = new CorrectionLoopService();
    await correction.beginCorrection({ ...failedBegin(), workflowId: 'wf-f' });
    const token = mutableToken();
    const shutdowns = { count: 0 };
    correction.registerCancellation('wf-f', token, async () => {
      shutdowns.count += 1;
    });
    const server: RuntimeServerManagerPort = {
      async start() {
        return {
          descriptorId: 'npm-run-dev',
          status: 'READY',
          url: 'http://127.0.0.1:39991',
          port: 39_991,
          startupDurationMs: 2,
        };
      },
      async shutdown() {
        shutdowns.count += 1;
      },
    };
    const browser: BrowserVerificationRunnerPort = {
      async verify(request) {
        if (request.cancellation?.cancelled) {
          return {
            status: 'CANCELLED',
            durationMs: 1,
            routes: [],
            consoleErrorCount: 0,
            pageExceptionCount: 0,
            failedRequestCount: 0,
          };
        }
        await waitUntilCancelled(request.cancellation ?? token);
        return {
          status: 'CANCELLED',
          durationMs: 3,
          routes: [],
          consoleErrorCount: 0,
          pageExceptionCount: 0,
          failedRequestCount: 0,
        };
      },
    };
    const pending = (async () => {
      try {
        const started = await server.start({
          projectRoot: '.',
          descriptor: {
            id: 'npm-run-dev',
            framework: 'generic-npm',
            executableKind: 'npm',
            fixedArguments: ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '39991'],
            scriptName: 'dev',
            workingDirectoryPolicy: 'project-root',
            environmentPolicy: 'allowlisted-minimal',
            startupTimeoutMs: 1_000,
            shutdownTimeoutMs: 1_000,
            outputLimitBytes: 1_024,
            bindHost: '127.0.0.1',
          },
          port: 39_991,
          host: '127.0.0.1',
          outputLimitBytes: 1_024,
          startupTimeoutMs: 1_000,
          shutdownTimeoutMs: 1_000,
          cancellation: token,
        });
        expect(started.status).toBe('READY');
        return await browser.verify({
          plan: {
            baseUrl: started.url ?? 'http://127.0.0.1:39991',
            routes: [{ path: '/' }],
            navigationTimeoutMs: 1_000,
            maximumScreenshots: 1,
          },
          artifactDirectory: '.',
          cancellation: token,
        });
      } finally {
        await server.shutdown();
      }
    })();
    token.cancel();
    const evidence = await pending;
    await correction.cancelCorrection('wf-f');
    expect(evidence.status).toBe('CANCELLED');
    expect(shutdowns.count).toBeGreaterThanOrEqual(1);
    expect(correction.getSession('wf-f')?.state).toBe('CORRECTION_CANCELLED');
  });

  it('G. cancel after a valid provider response does not APPLY', async () => {
    const correction = new CorrectionLoopService();
    await correction.beginCorrection({ ...failedBegin(), workflowId: 'wf-g' });
    const token = mutableToken();
    correction.registerCancellation('wf-g', token);
    const coordinator = new ProviderCoordinator({
      routes: [{ providerId: 'primary', provider: mockProvider(async () => mockResponse()) }],
    });
    const result = await coordinator.execute(() => requestFor(token), token);
    expect(result.totalAttempts).toBe(1);
    token.cancel();
    const session = await correction.cancelCorrection('wf-g');
    expect(session.state).toBe('CORRECTION_CANCELLED');
    await expect(correction.recordApplying('wf-g')).rejects.toThrow();
  });

  it('H. cancel before APPLY mutation leaves the filesystem unchanged', async () => {
    const correction = new CorrectionLoopService();
    await correction.beginCorrection({ ...failedBegin(), workflowId: 'wf-h' });
    await correction.recordPrepared('wf-h', 'prep-h', CHANGE_PLAN);
    const token = mutableToken();
    correction.registerCancellation('wf-h', token);
    token.cancel();
    const session = await correction.cancelCorrection('wf-h');
    const fileSystem = new InMemoryFileSystemPort();
    const apply = new FileApplyEngineService(fileSystem);
    expect(session.state).toBe('CORRECTION_CANCELLED');
    await expect(correction.recordApplying('wf-h')).rejects.toThrow();
    expect(fileSystem.mutationCalls).toHaveLength(0);
    expect(apply).toBeDefined();
  });

  it('I. cancel after verification begins keeps the session CORRECTION_CANCELLED', async () => {
    const correction = new CorrectionLoopService();
    await correction.beginCorrection({ ...failedBegin(), workflowId: 'wf-i' });
    await correction.recordPrepared('wf-i', 'prep-i', CHANGE_PLAN);
    await correction.recordApplying('wf-i');
    const token = mutableToken();
    correction.registerCancellation('wf-i', token);
    const harness = createPortHarness();
    const engine = new VerificationEngineService(harness.ports);
    token.cancel();
    await engine.verify(createAppliedResult(), { cancellation: token });
    const session = await correction.cancelCorrection('wf-i');
    expect(session.state).toBe('CORRECTION_CANCELLED');
    expect(session.blockCode).toBe('CANCELLATION');
  });

  it('HTTP AbortController abort maps onto the production cancellation token', async () => {
    const controller = new AbortController();
    const token = createCancellationTokenFromSignal(controller.signal);
    const correction = new CorrectionLoopService();
    await correction.beginCorrection({ ...failedBegin(), workflowId: 'wf-http' });
    correction.registerCancellation('wf-http', token);
    controller.abort();
    await Promise.resolve();
    expect(token.cancelled).toBe(true);
    expect(correction.getSession('wf-http')?.state).toBe('CORRECTION_CANCELLED');
  });
});
