import { createHash } from 'node:crypto';

/**
 * Controlled Local Browser Observation (ADR-043).
 * Localhost-only; catalog route IDs; distinct from Gate2/Git approval.
 */

import type { ExecutionCancellationToken } from '../../../core/execution-engine';
import type {
  BrowserVerificationRunnerPort,
  RuntimeServerManagerPort,
} from '../../../core/runtime-verification/ports';
import {
  MAXIMUM_BROWSER_ROUTES,
  MAXIMUM_BROWSER_SCREENSHOTS,
  DEFAULT_RUNTIME_BROWSER_WORKFLOW_DEADLINE_MS,
  assertBrowserUrlAllowed,
  assertRoutePathAllowed,
} from '../../../core/runtime-verification/policy/runtime-verification-policy';
import type {
  BrowserRoutePlan,
  BrowserRouteResult,
  BrowserVerificationEvidence,
  RuntimeBrowserOverallStatus,
} from '../../../core/runtime-verification';
import { allocateLocalhostPort } from '../../../infrastructure/runtime-verification/localhost-port-allocation';
import { createRuntimeVerificationArtifactStore } from '../../../infrastructure/runtime-verification/runtime-verification-artifacts';
import {
  buildRuntimeVerificationPlan,
  createRuntimeServerDescriptor,
} from '../../../infrastructure/runtime-verification/runtime-script-discovery';

export const DEFAULT_BROWSER_OBSERVATION_ROUTE_CATALOG: readonly BrowserCatalogRoute[] = [
  { routeId: 'home', path: '/' },
] as const;

export interface BrowserCatalogRoute {
  readonly routeId: string;
  readonly path: string;
}

export interface BrowserObservationCatalog {
  readonly routes: readonly BrowserCatalogRoute[];
  readonly maximumRoutesPerObservation: number;
  readonly maximumScreenshots: number;
  readonly workflowDeadlineMs: number;
  readonly localhostOnly: true;
  readonly acceptsAbsoluteUrls: false;
  readonly acceptsModelCredentials: false;
  readonly pageEvaluateAvailable: false;
  readonly downloadsAllowed: false;
  readonly mcpEnabled: false;
  readonly openWebEnabled: false;
}

export type ControlledBrowserObservationStatus = RuntimeBrowserOverallStatus | 'REJECTED_BY_POLICY';

export interface ControlledBrowserRouteObservation {
  readonly routeId: string;
  readonly path: string;
  readonly status: BrowserRouteResult['status'] | 'POLICY_BLOCKED';
  readonly httpStatus?: number;
  readonly titleDigest?: string;
  readonly titleSummary?: string;
  readonly consoleErrorCount: number;
  readonly consoleWarningCount: number;
  readonly networkFailureCount: number;
  readonly screenshotArtifactRef?: string;
  readonly screenshotDigest?: string;
  readonly finalUrlRedacted?: string;
}

export interface ControlledBrowserObservationResult {
  readonly status: ControlledBrowserObservationStatus;
  readonly routeIds: readonly string[];
  readonly routes: readonly ControlledBrowserRouteObservation[];
  readonly durationMs: number;
  readonly policyBlockCode?: string;
  readonly diagnosticSummary: string;
}

export class ControlledLocalBrowserError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ControlledLocalBrowserError';
  }
}

export interface ControlledLocalBrowserServiceDeps {
  readonly serverManagerFactory: () => RuntimeServerManagerPort;
  readonly browserRunner: BrowserVerificationRunnerPort;
  readonly catalog?: readonly BrowserCatalogRoute[];
  readonly workflowDeadlineMs?: number;
  readonly outputLimitBytes?: number;
  readonly digest?: (value: string) => string;
}

/**
 * Server-owned localhost browser observation (ADR-043).
 * Never accepts model absolute URLs, credentials, storageState, or action automation.
 */
export class ControlledLocalBrowserService {
  private readonly catalog: readonly BrowserCatalogRoute[];
  private readonly workflowDeadlineMs: number;
  private readonly outputLimitBytes: number;
  private readonly digest: (value: string) => string;
  private readonly activeLeases = new Set<string>();

  constructor(private readonly deps: ControlledLocalBrowserServiceDeps) {
    this.catalog = normalizeCatalog(deps.catalog ?? DEFAULT_BROWSER_OBSERVATION_ROUTE_CATALOG);
    this.workflowDeadlineMs =
      deps.workflowDeadlineMs ?? DEFAULT_RUNTIME_BROWSER_WORKFLOW_DEADLINE_MS;
    this.outputLimitBytes = deps.outputLimitBytes ?? 1_000_000;
    this.digest =
      deps.digest ??
      ((value: string) => createHash('sha256').update(value).digest('hex').slice(0, 24));
  }

  listCatalog(): BrowserObservationCatalog {
    return {
      routes: this.catalog.map((entry) => ({ routeId: entry.routeId, path: entry.path })),
      maximumRoutesPerObservation: Math.min(MAXIMUM_BROWSER_ROUTES, this.catalog.length),
      maximumScreenshots: MAXIMUM_BROWSER_SCREENSHOTS,
      workflowDeadlineMs: this.workflowDeadlineMs,
      localhostOnly: true,
      acceptsAbsoluteUrls: false,
      acceptsModelCredentials: false,
      pageEvaluateAvailable: false,
      downloadsAllowed: false,
      mcpEnabled: false,
      openWebEnabled: false,
    };
  }

  resolveRoutes(routeIds: readonly string[]): readonly BrowserCatalogRoute[] {
    if (routeIds.length === 0) {
      throw new ControlledLocalBrowserError('EMPTY_ROUTE_IDS', 'At least one routeId is required.');
    }
    if (routeIds.length > MAXIMUM_BROWSER_ROUTES) {
      throw new ControlledLocalBrowserError(
        'ROUTE_BUDGET_EXCEEDED',
        `At most ${MAXIMUM_BROWSER_ROUTES} routes may be observed.`,
      );
    }
    const byId = new Map(this.catalog.map((entry) => [entry.routeId, entry]));
    const resolved: BrowserCatalogRoute[] = [];
    for (const routeId of routeIds) {
      assertSafeRouteId(routeId);
      const entry = byId.get(routeId);
      if (entry === undefined) {
        throw new ControlledLocalBrowserError(
          'ROUTE_NOT_IN_CATALOG',
          `Route id "${routeId}" is not in the server catalog.`,
        );
      }
      assertRoutePathAllowed(entry.path);
      resolved.push(entry);
    }
    return resolved;
  }

  /**
   * Rejects authority / navigation / credential fields that must never be accepted from tools.
   */
  assertSafeObservationArgs(args: unknown): void {
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
      throw new ControlledLocalBrowserError('INVALID_ARGS', 'Observation args must be an object.');
    }
    const record = args as Record<string, unknown>;
    const forbidden = [
      'url',
      'urls',
      'baseUrl',
      'href',
      'origin',
      'absoluteUrl',
      'storageState',
      'cookies',
      'cookie',
      'credentials',
      'authorization',
      'authHeaders',
      'headers',
      'bearerToken',
      'accessToken',
      'password',
      'oauth',
      'download',
      'downloads',
      'evaluate',
      'pageEvaluate',
      'script',
      'javascript',
      'click',
      'type',
      'submit',
      'form',
      'mcp',
      'cwd',
      'env',
      'argv',
      'shell',
      'repositoryRoot',
      'applyAuthorizationToken',
      'changePlan',
      'approved',
      'operatorApproved',
    ];
    for (const key of Object.keys(record)) {
      if (forbidden.includes(key)) {
        throw new ControlledLocalBrowserError(
          'FORBIDDEN_ARGUMENT',
          `Argument "${key}" is not allowed for browser observation.`,
        );
      }
    }
    if ('routeIds' in record === false) {
      throw new ControlledLocalBrowserError('INVALID_ARGS', 'routeIds is required.');
    }
    if (!Array.isArray(record.routeIds) || record.routeIds.some((id) => typeof id !== 'string')) {
      throw new ControlledLocalBrowserError(
        'INVALID_ARGS',
        'routeIds must be an array of strings.',
      );
    }
  }

  async observe(input: {
    readonly projectId: string;
    readonly projectRoot: string;
    readonly routeIds: readonly string[];
    readonly cancellation: ExecutionCancellationToken;
    readonly browserObservationApproved: boolean;
    readonly leaseId?: string;
  }): Promise<ControlledBrowserObservationResult> {
    if (!input.browserObservationApproved) {
      throw new ControlledLocalBrowserError(
        'BROWSER_OPERATOR_APPROVAL_REQUIRED',
        'Browser observation requires distinct OPERATOR approval.',
      );
    }
    if (input.projectRoot.trim().length === 0) {
      throw new ControlledLocalBrowserError('INVALID_CONTEXT', 'projectRoot is required.');
    }

    const routes = this.resolveRoutes(input.routeIds);
    const leaseId = input.leaseId ?? `${input.projectId}:${Date.now()}`;
    if (this.activeLeases.has(leaseId)) {
      throw new ControlledLocalBrowserError(
        'CONCURRENT_OBSERVATION_REJECTED',
        'Serial browser observation required.',
      );
    }
    this.activeLeases.add(leaseId);
    const startedAt = Date.now();
    const serverManager = this.deps.serverManagerFactory();
    try {
      if (input.cancellation.cancelled) {
        return cancelledObservation(startedAt, input.routeIds);
      }
      const plan = buildRuntimeVerificationPlan({
        projectRoot: input.projectRoot,
        profile: { routes: routes.map((entry) => ({ path: entry.path })) },
        workflowDeadlineMs: this.workflowDeadlineMs,
        outputLimitBytes: this.outputLimitBytes,
      });
      if (plan === undefined) {
        return {
          status: 'UNAVAILABLE',
          routeIds: input.routeIds,
          routes: [],
          durationMs: Date.now() - startedAt,
          policyBlockCode: 'NO_DEV_SERVER_SCRIPT',
          diagnosticSummary: 'No allowlisted local dev server script is available.',
        };
      }
      const remainingMs = () => this.workflowDeadlineMs - (Date.now() - startedAt);
      if (remainingMs() <= 0) {
        return cancelledObservation(startedAt, input.routeIds);
      }
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
          return {
            status:
              serverEvidence.status === 'CANCELLED'
                ? 'CANCELLED'
                : serverEvidence.status === 'POLICY_BLOCKED'
                  ? 'POLICY_BLOCKED'
                  : 'UNAVAILABLE',
            routeIds: input.routeIds,
            routes: [],
            durationMs: Date.now() - startedAt,
            ...(serverEvidence.policyBlockCode !== undefined
              ? { policyBlockCode: serverEvidence.policyBlockCode }
              : {}),
            diagnosticSummary: `Local server did not become ready (${serverEvidence.status}).`,
          };
        }
        assertBrowserUrlAllowed(serverEvidence.url, '127.0.0.1');
        const browserEvidence = await this.deps.browserRunner.verify({
          plan: {
            baseUrl: serverEvidence.url,
            routes: routes.map((entry) => ({ path: entry.path }) satisfies BrowserRoutePlan),
            navigationTimeoutMs: Math.min(30_000, remainingMs()),
            maximumScreenshots: MAXIMUM_BROWSER_SCREENSHOTS,
          },
          artifactDirectory: artifactStore.rootDirectory,
          cancellation: input.cancellation,
          remainingWorkflowMs: remainingMs(),
        });
        return mapBrowserEvidence(browserEvidence, routes, input.routeIds, startedAt, this.digest);
      } finally {
        await serverManager.shutdown();
      }
    } finally {
      this.activeLeases.delete(leaseId);
    }
  }

  /** Restart-safe: never auto-relaunches; exposes whether a lease is active. */
  hasActiveLease(leaseId: string): boolean {
    return this.activeLeases.has(leaseId);
  }
}

function normalizeCatalog(catalog: readonly BrowserCatalogRoute[]): readonly BrowserCatalogRoute[] {
  const seen = new Set<string>();
  const normalized: BrowserCatalogRoute[] = [];
  for (const entry of catalog) {
    assertSafeRouteId(entry.routeId);
    assertRoutePathAllowed(entry.path);
    if (seen.has(entry.routeId)) continue;
    seen.add(entry.routeId);
    normalized.push({ routeId: entry.routeId, path: entry.path });
    if (normalized.length >= MAXIMUM_BROWSER_ROUTES) break;
  }
  if (normalized.length === 0) {
    throw new ControlledLocalBrowserError('EMPTY_CATALOG', 'Browser route catalog is empty.');
  }
  return normalized;
}

export function assertSafeRouteId(routeId: string): void {
  if (!/^[a-z][a-z0-9_-]{0,63}$/i.test(routeId)) {
    throw new ControlledLocalBrowserError(
      'INVALID_ROUTE_ID',
      'routeId must be a short alphanumeric token.',
    );
  }
  if (
    routeId.includes('://') ||
    routeId.includes('/') ||
    routeId.includes('\\') ||
    routeId.includes('..')
  ) {
    throw new ControlledLocalBrowserError(
      'INVALID_ROUTE_ID',
      'routeId must not contain URLs or path traversal.',
    );
  }
}

export function assertNotAbsoluteOrDangerousUrl(value: string): void {
  const trimmed = value.trim().toLowerCase();
  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('file:') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('javascript:') ||
    trimmed.includes('://')
  ) {
    throw new ControlledLocalBrowserError(
      'ABSOLUTE_URL_FORBIDDEN',
      'Absolute or dangerous URLs are not accepted; use catalog routeIds only.',
    );
  }
  if (trimmed.includes('..')) {
    throw new ControlledLocalBrowserError('TRAVERSAL_FORBIDDEN', 'Path traversal is forbidden.');
  }
}

function cancelledObservation(
  startedAt: number,
  routeIds: readonly string[],
): ControlledBrowserObservationResult {
  return {
    status: 'CANCELLED',
    routeIds,
    routes: [],
    durationMs: Date.now() - startedAt,
    diagnosticSummary: 'Browser observation cancelled.',
  };
}

function mapBrowserEvidence(
  evidence: BrowserVerificationEvidence & { readonly policyBlockCode?: string },
  catalogRoutes: readonly BrowserCatalogRoute[],
  routeIds: readonly string[],
  startedAt: number,
  digest: (value: string) => string,
): ControlledBrowserObservationResult {
  const byPath = new Map(catalogRoutes.map((entry) => [entry.path, entry.routeId]));
  const routes: ControlledBrowserRouteObservation[] = evidence.routes.map((route) => {
    let status: ControlledBrowserRouteObservation['status'] = route.status;
    if (route.finalUrl !== undefined) {
      try {
        assertBrowserUrlAllowed(route.finalUrl, '127.0.0.1');
      } catch {
        status = 'POLICY_BLOCKED';
      }
    }
    const title = route.pageTitle?.slice(0, 120);
    const routeId = byPath.get(route.path) ?? 'unknown';
    return {
      routeId,
      path: route.path,
      status,
      ...(route.httpStatus !== undefined ? { httpStatus: route.httpStatus } : {}),
      ...(title !== undefined ? { titleSummary: title, titleDigest: digest(title) } : {}),
      consoleErrorCount: route.consoleErrors.filter((entry) => entry.level === 'error').length,
      consoleWarningCount: route.consoleErrors.filter((entry) => entry.level === 'warning').length,
      networkFailureCount: route.failedRequests.length,
      ...(route.screenshotArtifactId !== undefined
        ? {
            screenshotArtifactRef: route.screenshotArtifactId,
            screenshotDigest: digest(route.screenshotArtifactId),
          }
        : {}),
      ...(route.finalUrl !== undefined ? { finalUrlRedacted: route.finalUrl } : {}),
    };
  });
  const policyBlocked = routes.some((route) => route.status === 'POLICY_BLOCKED');
  const status: ControlledBrowserObservationStatus = policyBlocked
    ? 'POLICY_BLOCKED'
    : (evidence.status as RuntimeBrowserOverallStatus);
  return {
    status,
    routeIds,
    routes,
    durationMs: Date.now() - startedAt,
    ...(policyBlocked || evidence.policyBlockCode !== undefined
      ? { policyBlockCode: evidence.policyBlockCode ?? 'CROSS_ORIGIN_OR_EXTERNAL_NAVIGATION' }
      : {}),
    diagnosticSummary: policyBlocked
      ? 'Observation blocked: final navigation left localhost policy.'
      : `Observed ${routes.length} route(s); status=${status}.`,
  };
}
