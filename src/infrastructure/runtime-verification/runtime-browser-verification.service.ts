import type {
  BrowserVerificationRunnerPort,
  RuntimeServerManagerPort,
} from '../../core/runtime-verification/ports';
import {
  RUNTIME_BROWSER_VERIFICATION_REPORT_SCHEMA_VERSION,
  type RuntimeBrowserOverallStatus,
  type RuntimeBrowserVerificationInput,
  type RuntimeBrowserVerificationReport,
} from '../../core/runtime-verification';
import { allocateLocalhostPort } from './localhost-port-allocation';
import { createRuntimeVerificationArtifactStore } from './runtime-verification-artifacts';
import {
  buildRuntimeVerificationPlan,
  createRuntimeServerDescriptor,
} from './runtime-script-discovery';

export interface RuntimeBrowserVerificationConfiguration {
  readonly workflowDeadlineMs: number;
  readonly outputLimitBytes: number;
}

export class RuntimeBrowserVerificationService {
  constructor(
    private readonly serverManagerFactory: () => RuntimeServerManagerPort,
    private readonly browserRunner: BrowserVerificationRunnerPort,
    private readonly configuration: RuntimeBrowserVerificationConfiguration,
  ) {}

  async verify(input: RuntimeBrowserVerificationInput): Promise<RuntimeBrowserVerificationReport> {
    const startedAt = Date.now();
    const workflowDeadlineMs = input.workflowDeadlineMs ?? this.configuration.workflowDeadlineMs;
    if (input.cancellation?.cancelled) {
      return cancelledReport(startedAt);
    }
    const plan = buildRuntimeVerificationPlan({
      projectRoot: input.projectRoot,
      workflowDeadlineMs,
      outputLimitBytes: this.configuration.outputLimitBytes,
    });
    if (plan === undefined) {
      return unavailableReport(startedAt, 'NO_DEV_SERVER_SCRIPT');
    }
    const remainingMs = () => workflowDeadlineMs - (Date.now() - startedAt);
    if (remainingMs() <= 0) {
      return cancelledReport(startedAt);
    }
    const serverManager = this.serverManagerFactory();
    const descriptor = createRuntimeServerDescriptor(plan);
    const port = await allocateLocalhostPort(plan.preferredPort);
    const artifactStore = createRuntimeVerificationArtifactStore(input.projectRoot);
    try {
      const serverEvidence = await serverManager.start({
        projectRoot: input.projectRoot,
        descriptor,
        port,
        host: plan.host,
        outputLimitBytes: plan.outputLimitBytes,
        startupTimeoutMs: Math.min(plan.startupTimeoutMs, remainingMs()),
        shutdownTimeoutMs: plan.shutdownTimeoutMs,
        cancellation: input.cancellation,
      });
      if (serverEvidence.status !== 'READY' || serverEvidence.url === undefined) {
        return finalizeReport(startedAt, serverEvidence, {
          status: mapServerFailureToBrowser(serverEvidence.status),
          durationMs: Date.now() - startedAt,
          routes: [],
          consoleErrorCount: 0,
          pageExceptionCount: 0,
          failedRequestCount: 0,
        });
      }
      const browserEvidence = await this.browserRunner.verify({
        plan: {
          baseUrl: serverEvidence.url,
          routes: plan.routes,
          navigationTimeoutMs: Math.min(30_000, remainingMs()),
          maximumScreenshots: 5,
        },
        artifactDirectory: artifactStore.rootDirectory,
        cancellation: input.cancellation,
        remainingWorkflowMs: remainingMs(),
      });
      return finalizeReport(startedAt, serverEvidence, browserEvidence);
    } finally {
      await serverManager.shutdown();
    }
  }
}

function mapServerFailureToBrowser(
  status: RuntimeBrowserVerificationReport['server']['status'],
): RuntimeBrowserVerificationReport['browser']['status'] {
  if (status === 'CANCELLED') return 'CANCELLED';
  if (status === 'POLICY_BLOCKED') return 'POLICY_BLOCKED';
  if (status === 'TIMEOUT') return 'TIMEOUT';
  if (status === 'UNAVAILABLE') return 'UNAVAILABLE';
  return 'UNAVAILABLE';
}

function finalizeReport(
  startedAt: number,
  server: RuntimeBrowserVerificationReport['server'],
  browser: RuntimeBrowserVerificationReport['browser'],
): RuntimeBrowserVerificationReport {
  return {
    schemaVersion: RUNTIME_BROWSER_VERIFICATION_REPORT_SCHEMA_VERSION,
    status: deriveOverallStatus(server.status, browser.status, browser.routes),
    server,
    browser,
    durationMs: Date.now() - startedAt,
    metadata: {
      'server-descriptor-id': server.descriptorId,
      ...(server.url === undefined ? {} : { 'server-url': server.url }),
      'browser-route-count': browser.routes.length,
    },
  };
}

function deriveOverallStatus(
  serverStatus: RuntimeBrowserVerificationReport['server']['status'],
  browserStatus: RuntimeBrowserVerificationReport['browser']['status'],
  routes: RuntimeBrowserVerificationReport['browser']['routes'],
): RuntimeBrowserOverallStatus {
  if (serverStatus === 'CANCELLED' || browserStatus === 'CANCELLED') return 'CANCELLED';
  if (serverStatus === 'POLICY_BLOCKED' || browserStatus === 'POLICY_BLOCKED') {
    return 'POLICY_BLOCKED';
  }
  if (serverStatus === 'TIMEOUT' || browserStatus === 'TIMEOUT') return 'TIMEOUT';
  if (serverStatus === 'UNAVAILABLE' || browserStatus === 'UNAVAILABLE') return 'UNAVAILABLE';
  if (serverStatus !== 'READY') return 'FAILED';
  if (browserStatus === 'PASSED') return 'PASSED';
  const passedRoutes = routes.filter(({ status }) => status === 'PASSED').length;
  if (passedRoutes > 0 && passedRoutes < routes.length) return 'PARTIAL';
  return 'FAILED';
}

function unavailableReport(startedAt: number, code: string): RuntimeBrowserVerificationReport {
  return {
    schemaVersion: RUNTIME_BROWSER_VERIFICATION_REPORT_SCHEMA_VERSION,
    status: 'UNAVAILABLE',
    server: {
      descriptorId: 'npm-run-dev',
      status: 'UNAVAILABLE',
      startupDurationMs: 0,
      policyBlockCode: code,
    },
    browser: {
      status: 'UNAVAILABLE',
      durationMs: 0,
      routes: [],
      consoleErrorCount: 0,
      pageExceptionCount: 0,
      failedRequestCount: 0,
    },
    durationMs: Date.now() - startedAt,
    metadata: { code },
  };
}

function cancelledReport(startedAt: number): RuntimeBrowserVerificationReport {
  return {
    schemaVersion: RUNTIME_BROWSER_VERIFICATION_REPORT_SCHEMA_VERSION,
    status: 'CANCELLED',
    server: { descriptorId: 'npm-run-dev', status: 'CANCELLED', startupDurationMs: 0 },
    browser: {
      status: 'CANCELLED',
      durationMs: 0,
      routes: [],
      consoleErrorCount: 0,
      pageExceptionCount: 0,
      failedRequestCount: 0,
    },
    durationMs: Date.now() - startedAt,
    metadata: {},
  };
}
