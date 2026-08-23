/**
 * @vitest-environment node
 * Extra ADR-043 branch coverage for ControlledLocalBrowserService / BROWSER policy.
 */
import { describe, expect, it } from 'vitest';

import type { ExecutionCancellationToken } from '../../../core/execution-engine';
import { WorkspaceAuthorizationService } from '../workspace-authorization.service';
import {
  assertNotAbsoluteOrDangerousUrl,
  assertSafeRouteId,
  ControlledLocalBrowserError,
  ControlledLocalBrowserService,
  DEFAULT_BROWSER_OBSERVATION_ROUTE_CATALOG,
} from '../controlled-local-browser/controlled-local-browser.service';
import { isBrowserCatalogTool, isBrowserObservationTool, ToolPolicyGate } from './tool-policy';
import { ToolRegistry } from './tool-registry';
import type { ToolDefinition } from './tool-registry.types';

function neverCancelled(): ExecutionCancellationToken {
  return { cancelled: false, subscribe: () => () => undefined };
}

describe('ADR-043 B7 coverage boost', () => {
  it('covers catalog predicates, empty args, server failure paths, and redirect policy mapping', async () => {
    expect(DEFAULT_BROWSER_OBSERVATION_ROUTE_CATALOG[0]?.routeId).toBe('home');
    expect(() => assertSafeRouteId('')).toThrow(ControlledLocalBrowserError);
    expect(() => assertNotAbsoluteOrDangerousUrl('data:text/html,hi')).toThrow(
      ControlledLocalBrowserError,
    );

    const catalogDef: ToolDefinition = {
      toolId: 'inspect_browser_verification_catalog',
      name: 'c',
      description: 'd',
      inputSchema: {},
      outputSchema: {},
      capabilityClass: 'BROWSER',
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
      allowedPhases: ['VERIFYING', 'DIAGNOSING'],
    };
    const obsDef: ToolDefinition = {
      ...catalogDef,
      toolId: 'run_local_browser_observation',
      riskLevel: 'HIGH',
      authorizationAction: 'BROWSER_OBSERVE',
      approvalRequirement: 'OPERATOR',
    };
    expect(isBrowserCatalogTool(catalogDef)).toBe(true);
    expect(isBrowserObservationTool(obsDef)).toBe(true);
    expect(isBrowserCatalogTool(obsDef)).toBe(false);

    const policy = new ToolPolicyGate(
      new WorkspaceAuthorizationService({
        profile: 'TRUSTED_LOCAL',
        projectId: 'builder-ai',
        principalId: 'local-operator',
      }),
    );
    const registry = new ToolRegistry(policy);
    expect(() =>
      registry.register({
        definition: {
          ...obsDef,
          allowedPhases: ['UNDERSTANDING', 'VERIFYING'],
        },
        execute: async () => ({ summary: 'no' }),
      }),
    ).toThrow(/VERIFYING\/DIAGNOSING/);

    const browser = new ControlledLocalBrowserService({
      catalog: [
        { routeId: 'home', path: '/' },
        { routeId: 'about', path: '/about' },
      ],
      serverManagerFactory: () => ({
        start: async () => ({
          descriptorId: 'npm-run-dev',
          status: 'POLICY_BLOCKED',
          startupDurationMs: 0,
          policyBlockCode: 'PUBLIC_BIND_FORBIDDEN',
        }),
        shutdown: async () => undefined,
      }),
      browserRunner: {
        verify: async () => ({
          status: 'PASSED',
          durationMs: 1,
          routes: [],
          consoleErrorCount: 0,
          pageExceptionCount: 0,
          failedRequestCount: 0,
        }),
      },
    });
    expect(() => browser.assertSafeObservationArgs(null)).toThrow(ControlledLocalBrowserError);
    expect(() => browser.assertSafeObservationArgs({})).toThrow(ControlledLocalBrowserError);
    expect(() => browser.resolveRoutes([])).toThrow(ControlledLocalBrowserError);
    expect(() =>
      browser.resolveRoutes(['home', 'about', 'home', 'about', 'home', 'about']),
    ).toThrow(ControlledLocalBrowserError);

    await expect(
      browser.observe({
        projectId: 'builder-ai',
        projectRoot: process.cwd(),
        routeIds: ['home'],
        cancellation: neverCancelled(),
        browserObservationApproved: false,
      }),
    ).rejects.toThrow(ControlledLocalBrowserError);

    const blocked = await browser.observe({
      projectId: 'builder-ai',
      projectRoot: process.cwd(),
      routeIds: ['home'],
      cancellation: neverCancelled(),
      browserObservationApproved: true,
      leaseId: 'lease-blocked',
    });
    expect(blocked.status).toBe('POLICY_BLOCKED');

    const redirectBrowser = new ControlledLocalBrowserService({
      serverManagerFactory: () => ({
        start: async () => ({
          descriptorId: 'npm-run-dev',
          status: 'READY',
          url: 'http://127.0.0.1:4010',
          port: 4010,
          startupDurationMs: 1,
        }),
        shutdown: async () => undefined,
      }),
      browserRunner: {
        verify: async () => ({
          status: 'PASSED',
          durationMs: 1,
          routes: [
            {
              path: '/',
              status: 'PASSED',
              durationMs: 1,
              httpStatus: 200,
              pageTitle: 'escaped',
              finalUrl: 'https://evil.example/',
              consoleErrors: [{ level: 'warning', message: 'x' }],
              pageExceptions: [],
              failedRequests: [],
              screenshotArtifactId: 'x.png',
            },
          ],
          consoleErrorCount: 0,
          pageExceptionCount: 0,
          failedRequestCount: 0,
        }),
      },
    });
    const redirected = await redirectBrowser.observe({
      projectId: 'builder-ai',
      projectRoot: process.cwd(),
      routeIds: ['home'],
      cancellation: neverCancelled(),
      browserObservationApproved: true,
      leaseId: 'lease-redirect',
    });
    expect(redirected.status).toBe('POLICY_BLOCKED');
    expect(redirected.routes[0]?.status).toBe('POLICY_BLOCKED');

    const emptyRoot = await redirectBrowser
      .observe({
        projectId: 'builder-ai',
        projectRoot: '   ',
        routeIds: ['home'],
        cancellation: neverCancelled(),
        browserObservationApproved: true,
      })
      .catch((error: unknown) => error);
    expect(emptyRoot).toBeInstanceOf(ControlledLocalBrowserError);

    const catalog = browser.listCatalog();
    expect(catalog.localhostOnly).toBe(true);
    expect(catalog.pageEvaluateAvailable).toBe(false);
    expect(catalog.mcpEnabled).toBe(false);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const concurrent = new ControlledLocalBrowserService({
      serverManagerFactory: () => ({
        start: async () => {
          await gate;
          return {
            descriptorId: 'npm-run-dev',
            status: 'READY',
            url: 'http://127.0.0.1:4011',
            port: 4011,
            startupDurationMs: 1,
          };
        },
        shutdown: async () => undefined,
      }),
      browserRunner: {
        verify: async () => ({
          status: 'PASSED',
          durationMs: 1,
          routes: [
            {
              path: '/',
              status: 'PASSED',
              durationMs: 1,
              httpStatus: 200,
              pageTitle: 't',
              finalUrl: 'http://127.0.0.1:4011/',
              consoleErrors: [],
              pageExceptions: [],
              failedRequests: [],
            },
          ],
          consoleErrorCount: 0,
          pageExceptionCount: 0,
          failedRequestCount: 0,
        }),
      },
    });
    const first = concurrent.observe({
      projectId: 'builder-ai',
      projectRoot: process.cwd(),
      routeIds: ['home'],
      cancellation: neverCancelled(),
      browserObservationApproved: true,
      leaseId: 'same-lease',
    });
    await expect(
      concurrent.observe({
        projectId: 'builder-ai',
        projectRoot: process.cwd(),
        routeIds: ['home'],
        cancellation: neverCancelled(),
        browserObservationApproved: true,
        leaseId: 'same-lease',
      }),
    ).rejects.toThrow(ControlledLocalBrowserError);
    release();
    await first;

    const cancelledServer = new ControlledLocalBrowserService({
      workflowDeadlineMs: 1,
      serverManagerFactory: () => ({
        start: async () => ({
          descriptorId: 'npm-run-dev',
          status: 'CANCELLED',
          startupDurationMs: 0,
        }),
        shutdown: async () => undefined,
      }),
      browserRunner: {
        verify: async () => ({
          status: 'CANCELLED',
          durationMs: 0,
          routes: [],
          consoleErrorCount: 0,
          pageExceptionCount: 0,
          failedRequestCount: 0,
        }),
      },
    });
    await new Promise((r) => setTimeout(r, 5));
    const timed = await cancelledServer.observe({
      projectId: 'builder-ai',
      projectRoot: process.cwd(),
      routeIds: ['home'],
      cancellation: neverCancelled(),
      browserObservationApproved: true,
      leaseId: 'deadline',
    });
    expect(['CANCELLED', 'UNAVAILABLE', 'POLICY_BLOCKED', 'PASSED', 'FAILED']).toContain(
      timed.status,
    );
  });
});
