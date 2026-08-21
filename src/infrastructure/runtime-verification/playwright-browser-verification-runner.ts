import { mkdirSync } from 'node:fs';
import path from 'node:path';

import type { BrowserVerificationRunnerPort } from '../../core/runtime-verification/ports';
import type {
  BrowserConsoleEvidence,
  BrowserNetworkEvidence,
  BrowserRouteResult,
  BrowserVerificationEvidence,
} from '../../core/runtime-verification';
import {
  assertBrowserUrlAllowed,
  assertRoutePathAllowed,
  MAXIMUM_BROWSER_SCREENSHOTS,
  sanitizeUrlForEvidence,
} from '../../core/runtime-verification/policy';
import type { BrowserVerificationRunnerRequest } from '../../core/runtime-verification/ports';
import { screenshotArtifactId } from './runtime-verification-artifacts';

interface PlaywrightModule {
  readonly chromium: {
    launch: (options: { headless: boolean }) => Promise<{
      newContext: (options?: Record<string, unknown>) => Promise<{
        newPage: () => Promise<unknown>;
        close: () => Promise<void>;
      }>;
      close: () => Promise<void>;
    }>;
  };
}

interface PlaywrightPageLike {
  goto: (
    url: string,
    options: { timeout: number; waitUntil: 'domcontentloaded' | 'load' | 'networkidle' },
  ) => Promise<{ status?: () => number } | null>;
  title: () => Promise<string>;
  url: () => string;
  locator: (selector: string) => { count: () => Promise<number> };
  screenshot: (options: { path: string; fullPage: boolean }) => Promise<void>;
  on: (event: string, listener: (...args: never[]) => void) => void;
  close: () => Promise<void>;
}

export class PlaywrightBrowserVerificationRunner implements BrowserVerificationRunnerPort {
  async verify(request: BrowserVerificationRunnerRequest): Promise<BrowserVerificationEvidence> {
    const startedAt = Date.now();
    if (request.cancellation?.cancelled) {
      return cancelledEvidence(startedAt);
    }
    let playwright: PlaywrightModule;
    try {
      playwright = (await import('playwright')) as PlaywrightModule;
    } catch {
      return unavailableEvidence(startedAt);
    }
    mkdirSync(request.artifactDirectory, { recursive: true });
    const routes: BrowserRouteResult[] = [];
    let consoleErrorCount = 0;
    let pageExceptionCount = 0;
    let failedRequestCount = 0;
    let screenshotCount = 0;
    const browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext({});
    try {
      for (const route of request.plan.routes) {
        if (request.cancellation?.cancelled) break;
        if (request.remainingWorkflowMs !== undefined && request.remainingWorkflowMs <= 0) {
          break;
        }
        const routeStartedAt = Date.now();
        assertRoutePathAllowed(route.path);
        const targetUrl = new URL(route.path, request.plan.baseUrl).toString();
        assertBrowserUrlAllowed(targetUrl, '127.0.0.1');
        const page = (await context.newPage()) as PlaywrightPageLike;
        const consoleErrors: BrowserConsoleEvidence[] = [];
        const pageExceptions: string[] = [];
        const failedRequests: BrowserNetworkEvidence[] = [];
        page.on('console', (message: { type: () => string; text: () => string }) => {
          const level = message.type();
          const text = message.text().slice(0, 500);
          if (level === 'error') {
            consoleErrors.push({ level: 'error', message: text });
            consoleErrorCount += 1;
          } else if (level === 'warning') {
            consoleErrors.push({ level: 'warning', message: text });
          }
        });
        page.on('pageerror', (error: Error) => {
          pageExceptions.push(error.message.slice(0, 500));
          pageExceptionCount += 1;
        });
        page.on(
          'requestfailed',
          (failedRequest: { url: () => string; failure: () => { errorText: string } | null }) => {
            failedRequests.push({
              url: sanitizeUrlForEvidence(failedRequest.url()),
              failureText: failedRequest.failure()?.errorText,
            });
            failedRequestCount += 1;
          },
        );
        page.on(
          'response',
          (response: {
            url: () => string;
            status: () => number;
            request: () => { resourceType: () => string };
          }) => {
            const status = response.status();
            if (status >= 400) {
              failedRequests.push({
                url: sanitizeUrlForEvidence(response.url()),
                status,
                resourceType: response.request().resourceType(),
              });
              failedRequestCount += 1;
            }
          },
        );
        let routeStatus: BrowserRouteResult['status'] = 'PASSED';
        let httpStatus: number | undefined;
        try {
          const response = await page.goto(targetUrl, {
            timeout: request.plan.navigationTimeoutMs,
            waitUntil: 'domcontentloaded',
          });
          httpStatus = response?.status?.();
          if (httpStatus !== undefined && httpStatus >= 500) {
            routeStatus = 'NETWORK_ERROR';
          }
        } catch {
          routeStatus = 'TIMEOUT';
        }
        if (pageExceptions.length > 0) routeStatus = 'PAGE_ERROR';
        else if (consoleErrors.some(({ level }) => level === 'error'))
          routeStatus = 'CONSOLE_ERROR';
        else if (failedRequests.length > 0 && routeStatus === 'PASSED')
          routeStatus = 'NETWORK_ERROR';
        if (route.requiredSelector !== undefined) {
          const selectorCount = await page.locator(route.requiredSelector).count();
          if (selectorCount === 0 && routeStatus === 'PASSED') {
            routeStatus = 'FAILED';
          }
        }
        let screenshotArtifact: string | undefined;
        if (
          screenshotCount < request.plan.maximumScreenshots &&
          screenshotCount < MAXIMUM_BROWSER_SCREENSHOTS &&
          routeStatus !== 'TIMEOUT'
        ) {
          const screenshotPath = path.join(
            request.artifactDirectory,
            `${route.path.replace(/\W+/g, '-') || 'root'}-${Date.now()}.png`,
          );
          await page.screenshot({ path: screenshotPath, fullPage: false });
          screenshotArtifact = screenshotArtifactId(screenshotPath, request.artifactDirectory);
          screenshotCount += 1;
        }
        routes.push({
          path: route.path,
          status: routeStatus,
          durationMs: Date.now() - routeStartedAt,
          ...(httpStatus === undefined ? {} : { httpStatus }),
          pageTitle: await page.title().catch(() => undefined),
          finalUrl: sanitizeUrlForEvidence(page.url()),
          consoleErrors,
          pageExceptions,
          failedRequests,
          ...(screenshotArtifact === undefined ? {} : { screenshotArtifactId: screenshotArtifact }),
        });
        await page.close();
      }
    } finally {
      await context.close();
      await browser.close();
    }
    if (request.cancellation?.cancelled) {
      return cancelledEvidence(
        startedAt,
        routes,
        consoleErrorCount,
        pageExceptionCount,
        failedRequestCount,
      );
    }
    const failed = routes.some(({ status }) => status !== 'PASSED');
    return {
      status: failed ? 'FAILED' : 'PASSED',
      durationMs: Date.now() - startedAt,
      routes,
      consoleErrorCount,
      pageExceptionCount,
      failedRequestCount,
    };
  }
}

function unavailableEvidence(startedAt: number): BrowserVerificationEvidence {
  return {
    status: 'UNAVAILABLE',
    durationMs: Date.now() - startedAt,
    routes: [],
    consoleErrorCount: 0,
    pageExceptionCount: 0,
    failedRequestCount: 0,
  };
}

function cancelledEvidence(
  startedAt: number,
  routes: readonly BrowserRouteResult[] = [],
  consoleErrorCount = 0,
  pageExceptionCount = 0,
  failedRequestCount = 0,
): BrowserVerificationEvidence {
  return {
    status: 'CANCELLED',
    durationMs: Date.now() - startedAt,
    routes,
    consoleErrorCount,
    pageExceptionCount,
    failedRequestCount,
  };
}
