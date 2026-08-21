import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BrowserVerificationEvidence } from '../../../core/runtime-verification';
import type {
  BrowserVerificationRunnerPort,
  RuntimeServerManagerPort,
} from '../../../core/runtime-verification/ports';
import type { RuntimeServerEvidence } from '../../../core/runtime-verification';
import {
  assertBrowserUrlAllowed,
  assertLocalhostBindHost,
  assertRoutePathAllowed,
  MAXIMUM_BROWSER_ROUTES,
  RuntimeVerificationPolicyViolationError,
  sanitizeUrlForEvidence,
  validateRuntimeServerDescriptor,
} from '../../../core/runtime-verification/policy';
import {
  buildAllowlistedVerificationEnvironment,
  containsForbiddenVerificationEnvironmentKey,
  rejectForbiddenNpmArguments,
} from '../../../core/verification/policy';
import {
  allocateLocalhostPort,
  buildLocalhostUrl,
  isPortAvailable,
} from '../localhost-port-allocation';
import { NodeDevServerManager } from '../node-dev-server-manager';
import { RuntimeBrowserVerificationService } from '../runtime-browser-verification.service';
import {
  buildRuntimeVerificationPlan,
  createRuntimeServerDescriptor,
  discoverRuntimeScripts,
} from '../runtime-script-discovery';
import { createRuntimeVerificationArtifactStore } from '../runtime-verification-artifacts';
import {
  createNoDevScriptFixture,
  createServerFailureFixture,
  createSimpleWebFixture,
  createStartupTimeoutFixture,
} from './runtime-verification.fixture';

class RecordingServerManager implements RuntimeServerManagerPort {
  shutdownCalls = 0;
  started = false;

  constructor(
    private readonly evidence: RuntimeServerEvidence,
    private readonly onStart?: () => void,
  ) {}

  async start(): Promise<RuntimeServerEvidence> {
    this.started = true;
    this.onStart?.();
    return this.evidence;
  }

  async shutdown(): Promise<void> {
    this.shutdownCalls += 1;
  }
}

class MockBrowserRunner implements BrowserVerificationRunnerPort {
  verifyCalls = 0;
  constructor(private readonly evidence: BrowserVerificationEvidence) {}

  async verify(): Promise<BrowserVerificationEvidence> {
    this.verifyCalls += 1;
    return this.evidence;
  }
}

function readyEvidence(url = 'http://127.0.0.1:3456/'): RuntimeServerEvidence {
  return {
    descriptorId: 'npm-run-dev',
    status: 'READY',
    url,
    port: 3456,
    startupDurationMs: 100,
    httpStatus: 200,
    httpDurationMs: 20,
  };
}

function passedBrowserEvidence(): BrowserVerificationEvidence {
  return {
    status: 'PASSED',
    durationMs: 50,
    routes: [
      {
        path: '/',
        status: 'PASSED',
        durationMs: 40,
        httpStatus: 200,
        pageTitle: 'Fixture App',
        finalUrl: 'http://127.0.0.1:3456/',
        consoleErrors: [],
        pageExceptions: [],
        failedRequests: [],
        screenshotArtifactId: 'root.png',
      },
    ],
    consoleErrorCount: 0,
    pageExceptionCount: 0,
    failedRequestCount: 0,
  };
}

describe.sequential('P0-8 runtime browser verification', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds a safe dev-server descriptor from discovered scripts', () => {
    const root = createSimpleWebFixture();
    const plan = buildRuntimeVerificationPlan({ projectRoot: root });
    expect(plan?.devScript).toBe('dev');
    const descriptor = createRuntimeServerDescriptor(plan!);
    expect(descriptor.fixedArguments).toEqual(['run', 'dev']);
    expect(descriptor.bindHost).toBe('127.0.0.1');
    expect(() => validateRuntimeServerDescriptor(descriptor, root)).not.toThrow();
  });

  it('rejects arbitrary server commands and executables at policy layer', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'builderai-p08-policy-'));
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ scripts: { dev: 'node -e 0' } }),
    );
    const plan = buildRuntimeVerificationPlan({ projectRoot: root })!;
    const descriptor = {
      ...createRuntimeServerDescriptor(plan),
      fixedArguments: ['run', 'deploy'],
      scriptName: 'deploy',
    };
    expect(() => validateRuntimeServerDescriptor(descriptor, root)).toThrow(
      RuntimeVerificationPolicyViolationError,
    );
    expect(() => rejectForbiddenNpmArguments(['exec', 'vite'])).toThrow();
  });

  it('rejects public bind and accepts localhost bind', () => {
    expect(() => assertLocalhostBindHost('0.0.0.0')).toThrow(
      RuntimeVerificationPolicyViolationError,
    );
    expect(() => assertLocalhostBindHost('127.0.0.1')).not.toThrow();
  });

  it('allocates dynamic localhost ports and handles preferred port collision', async () => {
    const port = await allocateLocalhostPort();
    expect(await isPortAvailable(port)).toBe(true);
    expect(buildLocalhostUrl(port, '/')).toBe(`http://127.0.0.1:${port}/`);
    const ephemeral = await allocateLocalhostPort(80);
    expect(ephemeral).toBeGreaterThan(0);
  });

  it('returns UNAVAILABLE when no dev script exists', async () => {
    const root = createNoDevScriptFixture();
    const service = new RuntimeBrowserVerificationService(
      () => new NodeDevServerManager(),
      new MockBrowserRunner(passedBrowserEvidence()),
      { workflowDeadlineMs: 60_000, outputLimitBytes: 4_096 },
    );
    const report = await service.verify({ projectRoot: root });
    expect(report.status).toBe('UNAVAILABLE');
    expect(report.server.policyBlockCode).toBe('NO_DEV_SERVER_SCRIPT');
  });

  it('returns PROCESS_FAILED when server exits before ready', async () => {
    const root = createServerFailureFixture();
    const service = new RuntimeBrowserVerificationService(
      () => new NodeDevServerManager(),
      new MockBrowserRunner(passedBrowserEvidence()),
      { workflowDeadlineMs: 60_000, outputLimitBytes: 4_096 },
    );
    const report = await service.verify({
      projectRoot: root,
      workflowDeadlineMs: 30_000,
    });
    expect(report.server.status).toBe('PROCESS_FAILED');
    expect(report.browser.status).toBe('UNAVAILABLE');
  }, 30_000);

  it('returns TIMEOUT when server never becomes ready', async () => {
    const root = createStartupTimeoutFixture();
    const service = new RuntimeBrowserVerificationService(
      () => new NodeDevServerManager(),
      new MockBrowserRunner(passedBrowserEvidence()),
      { workflowDeadlineMs: 60_000, outputLimitBytes: 4_096 },
    );
    const report = await service.verify({
      projectRoot: root,
      workflowDeadlineMs: 8_000,
    });
    expect(report.server.status).toBe('TIMEOUT');
  }, 20_000);

  it('starts real dev server, probes readiness, and shuts down', async () => {
    const root = createSimpleWebFixture();
    const manager = new NodeDevServerManager();
    const plan = buildRuntimeVerificationPlan({ projectRoot: root })!;
    const descriptor = createRuntimeServerDescriptor(plan);
    const port = await allocateLocalhostPort();
    const evidence = await manager.start({
      projectRoot: root,
      descriptor,
      port,
      host: '127.0.0.1',
      outputLimitBytes: 4_096,
      startupTimeoutMs: 15_000,
      shutdownTimeoutMs: 5_000,
    });
    expect(evidence.status).toBe('READY');
    expect(evidence.httpStatus).toBe(200);
    await manager.shutdown();
  }, 20_000);

  it('does not start browser until server is READY', async () => {
    const browser = new MockBrowserRunner(passedBrowserEvidence());
    const server = new RecordingServerManager({
      descriptorId: 'npm-run-dev',
      status: 'PROCESS_FAILED',
      startupDurationMs: 10,
    });
    const service = new RuntimeBrowserVerificationService(() => server, browser, {
      workflowDeadlineMs: 60_000,
      outputLimitBytes: 4_096,
    });
    await service.verify({ projectRoot: createSimpleWebFixture() });
    expect(server.started).toBe(true);
    expect(browser.verifyCalls).toBe(0);
    expect(server.shutdownCalls).toBe(1);
  });

  it('always shuts down server after success and browser failure', async () => {
    for (const scenario of ['success', 'browser-fail'] as const) {
      const server = new RecordingServerManager(readyEvidence());
      const browser = new MockBrowserRunner({
        ...passedBrowserEvidence(),
        status: scenario === 'browser-fail' ? 'FAILED' : 'PASSED',
      });
      const service = new RuntimeBrowserVerificationService(() => server, browser, {
        workflowDeadlineMs: 60_000,
        outputLimitBytes: 4_096,
      });
      await service.verify({
        projectRoot: createSimpleWebFixture(),
        cancellation: { cancelled: false, subscribe: () => () => undefined },
      });
      expect(server.shutdownCalls).toBe(1);
    }
  });

  it('returns CANCELLED before server startup without invoking shutdown', async () => {
    const server = new RecordingServerManager(readyEvidence());
    const service = new RuntimeBrowserVerificationService(
      () => server,
      new MockBrowserRunner(passedBrowserEvidence()),
      { workflowDeadlineMs: 60_000, outputLimitBytes: 4_096 },
    );
    const report = await service.verify({
      projectRoot: createSimpleWebFixture(),
      cancellation: { cancelled: true, subscribe: () => () => undefined },
    });
    expect(report.status).toBe('CANCELLED');
    expect(server.started).toBe(false);
    expect(server.shutdownCalls).toBe(0);
  });

  it('bounds route count and rejects forbidden routes and external URLs', () => {
    expect(() => assertRoutePathAllowed('https://evil.example/')).toThrow();
    expect(() => assertBrowserUrlAllowed('https://example.com', '127.0.0.1')).toThrow();
    expect(() => assertBrowserUrlAllowed('http://127.0.0.1:3000/', '127.0.0.1')).not.toThrow();
    const routes = Array.from({ length: 20 }, (_, index) => ({ path: `/${index}` }));
    const plan = buildRuntimeVerificationPlan({
      projectRoot: createSimpleWebFixture(),
      profile: { routes },
    });
    expect(plan?.routes.length).toBeLessThanOrEqual(MAXIMUM_BROWSER_ROUTES);
  });

  it('sanitizes query-string secrets and excludes forbidden environment keys', () => {
    const sanitized = sanitizeUrlForEvidence('http://127.0.0.1/?token=abc&page=1');
    expect(decodeURIComponent(sanitized)).toContain('[REDACTED]');
    expect(sanitized).toContain('page=1');
    const env = {
      ...buildAllowlistedVerificationEnvironment(),
      OPENAI_API_KEY: 'secret',
    };
    expect(containsForbiddenVerificationEnvironmentKey(env)).toBe('OPENAI_API_KEY');
  });

  it('stores screenshots in controlled artifact locations', () => {
    const root = createSimpleWebFixture();
    const store = createRuntimeVerificationArtifactStore(root);
    expect(store.rootDirectory.includes('.builderai')).toBe(true);
    const screenshotPath = store.createScreenshotPath('/');
    expect(screenshotPath.startsWith(store.rootDirectory)).toBe(true);
    expect(path.basename(screenshotPath)).toMatch(/\.png$/);
  });

  it('detects next and vite frameworks from package.json', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'builderai-p08-fw-'));
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        scripts: { dev: 'next dev' },
        dependencies: { next: '16.0.0' },
      }),
    );
    expect(discoverRuntimeScripts(root).framework).toBe('next');

    const viteRoot = mkdtempSync(path.join(tmpdir(), 'builderai-p08-vite-'));
    writeFileSync(
      path.join(viteRoot, 'package.json'),
      JSON.stringify({
        scripts: { start: 'vite preview' },
        devDependencies: { vite: '6.0.0' },
        config: { port: 4173 },
      }),
    );
    const viteDiscovered = discoverRuntimeScripts(viteRoot);
    expect(viteDiscovered.framework).toBe('vite');
    expect(viteDiscovered.devScript).toBe('start');
    expect(viteDiscovered.preferredPort).toBe(4173);
    const vitePlan = buildRuntimeVerificationPlan({ projectRoot: viteRoot });
    expect(vitePlan?.serverDescriptorId).toBe('npm-run-start');
    expect(createRuntimeServerDescriptor(vitePlan!).id).toBe('npm-run-start');

    const previewRoot = mkdtempSync(path.join(tmpdir(), 'builderai-p08-preview-'));
    writeFileSync(
      path.join(previewRoot, 'package.json'),
      JSON.stringify({ scripts: { preview: 'vite preview' } }),
    );
    expect(buildRuntimeVerificationPlan({ projectRoot: previewRoot })?.serverDescriptorId).toBe(
      'npm-run-preview',
    );

    const invalidRoot = mkdtempSync(path.join(tmpdir(), 'builderai-p08-invalid-'));
    writeFileSync(path.join(invalidRoot, 'package.json'), '{');
    expect(discoverRuntimeScripts(invalidRoot).devScript).toBeUndefined();

    const nonObjectRoot = mkdtempSync(path.join(tmpdir(), 'builderai-p08-nonobj-'));
    writeFileSync(path.join(nonObjectRoot, 'package.json'), '[]');
    expect(discoverRuntimeScripts(nonObjectRoot).framework).toBe('generic-npm');

    const dedupeRoot = createSimpleWebFixture();
    const deduped = buildRuntimeVerificationPlan({
      projectRoot: dedupeRoot,
      profile: { routes: [{ path: '/' }, { path: '/' }, { path: '/about' }] },
      startupTimeoutMs: 1_000,
      shutdownTimeoutMs: 500,
      workflowDeadlineMs: 2_000,
      outputLimitBytes: 2_048,
    });
    expect(deduped?.routes).toEqual([{ path: '/' }, { path: '/about' }]);
    expect(deduped?.startupTimeoutMs).toBe(1_000);
  });

  it('runs end-to-end orchestration with mock browser on simple web fixture', async () => {
    const root = createSimpleWebFixture();
    const service = new RuntimeBrowserVerificationService(
      () => new NodeDevServerManager(),
      new MockBrowserRunner(passedBrowserEvidence()),
      { workflowDeadlineMs: 60_000, outputLimitBytes: 4_096 },
    );
    const report = await service.verify({ projectRoot: root, workflowDeadlineMs: 30_000 });
    expect(report.server.status).toBe('READY');
    expect(report.status).toBe('PASSED');
  }, 25_000);
});
