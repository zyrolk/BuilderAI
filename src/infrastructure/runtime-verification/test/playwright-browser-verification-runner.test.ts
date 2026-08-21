import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BrowserVerificationPlan } from '../../../core/runtime-verification';

type ConsoleListener = (message: { type: () => string; text: () => string }) => void;
type PageErrorListener = (error: Error) => void;
type RequestFailedListener = (failed: {
  url: () => string;
  failure: () => { errorText: string } | null;
}) => void;
type ResponseListener = (response: {
  url: () => string;
  status: () => number;
  request: () => { resourceType: () => string };
}) => void;

interface PageListeners {
  console: ConsoleListener[];
  pageerror: PageErrorListener[];
  requestfailed: RequestFailedListener[];
  response: ResponseListener[];
}

interface PageMock {
  goto: ReturnType<typeof vi.fn>;
  title: ReturnType<typeof vi.fn>;
  url: ReturnType<typeof vi.fn>;
  locator: ReturnType<typeof vi.fn>;
  screenshot: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  on: (event: keyof PageListeners, listener: PageListeners[keyof PageListeners][number]) => void;
  listeners: PageListeners;
}

function createPage(
  onGoto?: (page: PageMock) => Promise<{ status?: () => number } | null>,
): PageMock {
  const listeners: PageListeners = {
    console: [],
    pageerror: [],
    requestfailed: [],
    response: [],
  };
  const page: PageMock = {
    listeners,
    goto: vi.fn(async () => {
      if (onGoto !== undefined) return onGoto(page);
      return { status: () => 200 };
    }),
    title: vi.fn(async () => 'Title'),
    url: vi.fn(() => 'http://127.0.0.1:3456/'),
    locator: vi.fn(() => ({ count: async () => 1 })),
    screenshot: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    on(event, listener) {
      listeners[event].push(listener as never);
    },
  };
  return page;
}

async function loadRunnerWithPlaywright(pages: PageMock[]): Promise<{
  runner: {
    verify: (request: {
      plan: BrowserVerificationPlan;
      artifactDirectory: string;
      cancellation?: { cancelled: boolean; subscribe: () => () => void };
      remainingWorkflowMs?: number;
    }) => Promise<{
      status: string;
      routes: readonly {
        status: string;
        httpStatus?: number;
        pageTitle?: string;
        consoleErrors: readonly { level: string; message: string }[];
        failedRequests: readonly { url: string }[];
      }[];
      consoleErrorCount: number;
      pageExceptionCount: number;
      failedRequestCount: number;
    }>;
  };
  browserClose: ReturnType<typeof vi.fn>;
  contextClose: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();
  const browserClose = vi.fn(async () => undefined);
  const contextClose = vi.fn(async () => undefined);
  let pageIndex = 0;
  vi.doMock('playwright', () => ({
    chromium: {
      launch: vi.fn(async () => ({
        newContext: vi.fn(async () => ({
          newPage: vi.fn(async () => pages[Math.min(pageIndex++, pages.length - 1)]!),
          close: contextClose,
        })),
        close: browserClose,
      })),
    },
  }));
  const mod = await import('../playwright-browser-verification-runner');
  return {
    runner: new mod.PlaywrightBrowserVerificationRunner(),
    browserClose,
    contextClose,
  };
}

function basePlan(overrides?: Partial<BrowserVerificationPlan>): BrowserVerificationPlan {
  return {
    baseUrl: 'http://127.0.0.1:3456/',
    routes: [{ path: '/' }],
    navigationTimeoutMs: 1_000,
    maximumScreenshots: 5,
    ...overrides,
  };
}

describe('PlaywrightBrowserVerificationRunner', () => {
  const artifactDirectory = mkdtempSync(path.join(tmpdir(), 'builderai-pw-runner-'));

  afterEach(() => {
    vi.doUnmock('playwright');
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('returns CANCELLED when cancellation is already set', async () => {
    const { runner } = await loadRunnerWithPlaywright([createPage()]);
    const evidence = await runner.verify({
      plan: basePlan(),
      artifactDirectory,
      cancellation: { cancelled: true, subscribe: () => () => undefined },
    });
    expect(evidence.status).toBe('CANCELLED');
    expect(evidence.routes).toEqual([]);
  });

  it('returns UNAVAILABLE when playwright cannot be imported', async () => {
    vi.resetModules();
    vi.doMock('playwright', () => {
      throw new Error('playwright missing');
    });
    const mod = await import('../playwright-browser-verification-runner');
    const runner = new mod.PlaywrightBrowserVerificationRunner();
    const evidence = await runner.verify({
      plan: basePlan(),
      artifactDirectory,
    });
    expect(evidence.status).toBe('UNAVAILABLE');
  });

  it('returns PASSED for a successful navigation and captures warning console lines', async () => {
    const page = createPage(async (current) => {
      for (const listener of current.listeners.console) {
        listener({ type: () => 'warning', text: () => 'warn-only' });
      }
      return { status: () => 200 };
    });
    const { runner, browserClose, contextClose } = await loadRunnerWithPlaywright([page]);
    const evidence = await runner.verify({
      plan: basePlan(),
      artifactDirectory,
    });
    expect(evidence.status).toBe('PASSED');
    expect(evidence.routes[0]?.consoleErrors.some(({ level }) => level === 'warning')).toBe(true);
    expect(page.screenshot).toHaveBeenCalled();
    expect(contextClose).toHaveBeenCalled();
    expect(browserClose).toHaveBeenCalled();
  });

  it('maps goto failures to TIMEOUT and skips screenshots', async () => {
    const page = createPage(async () => {
      throw new Error('navigation timeout');
    });
    const { runner } = await loadRunnerWithPlaywright([page]);
    const evidence = await runner.verify({
      plan: basePlan(),
      artifactDirectory,
    });
    expect(evidence.status).toBe('FAILED');
    expect(evidence.routes[0]?.status).toBe('TIMEOUT');
    expect(page.screenshot).not.toHaveBeenCalled();
  });

  it('maps HTTP 5xx to NETWORK_ERROR', async () => {
    const page = createPage(async () => ({ status: () => 503 }));
    const { runner } = await loadRunnerWithPlaywright([page]);
    const evidence = await runner.verify({
      plan: basePlan(),
      artifactDirectory,
    });
    expect(evidence.routes[0]?.status).toBe('NETWORK_ERROR');
    expect(evidence.routes[0]?.httpStatus).toBe(503);
  });

  it('maps page errors and console errors to PAGE_ERROR / CONSOLE_ERROR', async () => {
    const pageErrorPage = createPage(async (current) => {
      for (const listener of current.listeners.pageerror) {
        listener(new Error('boom'));
      }
      return { status: () => 200 };
    });
    const consoleErrorPage = createPage(async (current) => {
      for (const listener of current.listeners.console) {
        listener({ type: () => 'error', text: () => 'bad' });
      }
      return { status: () => 200 };
    });
    const { runner } = await loadRunnerWithPlaywright([pageErrorPage, consoleErrorPage]);
    const evidence = await runner.verify({
      plan: basePlan({
        routes: [{ path: '/a' }, { path: '/b' }],
      }),
      artifactDirectory,
    });
    expect(evidence.routes[0]?.status).toBe('PAGE_ERROR');
    expect(evidence.routes[1]?.status).toBe('CONSOLE_ERROR');
    expect(evidence.pageExceptionCount).toBe(1);
    expect(evidence.consoleErrorCount).toBe(1);
  });

  it('maps failed requests and 4xx responses to NETWORK_ERROR', async () => {
    const failedRequestPage = createPage(async (current) => {
      for (const listener of current.listeners.requestfailed) {
        listener({
          url: () => 'http://127.0.0.1:3456/asset.js?token=secret',
          failure: () => ({ errorText: 'net::ERR_FAILED' }),
        });
      }
      return { status: () => 200 };
    });
    const badStatusPage = createPage(async (current) => {
      for (const listener of current.listeners.response) {
        listener({
          url: () => 'http://127.0.0.1:3456/api',
          status: () => 404,
          request: () => ({ resourceType: () => 'xhr' }),
        });
      }
      return { status: () => 200 };
    });
    const { runner } = await loadRunnerWithPlaywright([failedRequestPage, badStatusPage]);
    const evidence = await runner.verify({
      plan: basePlan({
        routes: [{ path: '/fail' }, { path: '/status' }],
      }),
      artifactDirectory,
    });
    expect(evidence.routes[0]?.status).toBe('NETWORK_ERROR');
    expect(decodeURIComponent(evidence.routes[0]?.failedRequests[0]?.url ?? '')).toContain(
      '[REDACTED]',
    );
    expect(evidence.routes[1]?.status).toBe('NETWORK_ERROR');
    expect(evidence.failedRequestCount).toBe(2);
  });

  it('fails when a required selector is missing', async () => {
    const page = createPage();
    page.locator = vi.fn(() => ({ count: async () => 0 }));
    const { runner } = await loadRunnerWithPlaywright([page]);
    const evidence = await runner.verify({
      plan: basePlan({
        routes: [{ path: '/', requiredSelector: '#missing' }],
      }),
      artifactDirectory,
    });
    expect(evidence.routes[0]?.status).toBe('FAILED');
  });

  it('stops remaining routes when workflow budget is exhausted', async () => {
    const page = createPage();
    const { runner } = await loadRunnerWithPlaywright([page]);
    const evidence = await runner.verify({
      plan: basePlan({
        routes: [{ path: '/one' }, { path: '/two' }],
      }),
      artifactDirectory,
      remainingWorkflowMs: 0,
    });
    expect(evidence.routes).toHaveLength(0);
    expect(evidence.status).toBe('PASSED');
  });

  it('returns CANCELLED after partial routes when cancellation flips mid-run', async () => {
    const cancellation = { cancelled: false, subscribe: () => () => undefined };
    const first = createPage(async () => {
      cancellation.cancelled = true;
      return { status: () => 200 };
    });
    const second = createPage();
    const { runner } = await loadRunnerWithPlaywright([first, second]);
    const evidence = await runner.verify({
      plan: basePlan({
        routes: [{ path: '/one' }, { path: '/two' }],
      }),
      artifactDirectory,
      cancellation,
    });
    expect(evidence.status).toBe('CANCELLED');
    expect(evidence.routes.length).toBe(1);
  });

  it('tolerates title() rejection and null goto response', async () => {
    const page = createPage(async () => null);
    page.title = vi.fn(async () => {
      throw new Error('no title');
    });
    const { runner } = await loadRunnerWithPlaywright([page]);
    const evidence = await runner.verify({
      plan: basePlan(),
      artifactDirectory,
    });
    expect(evidence.status).toBe('PASSED');
    expect(evidence.routes[0]?.pageTitle).toBeUndefined();
    expect(evidence.routes[0]?.httpStatus).toBeUndefined();
  });
});
