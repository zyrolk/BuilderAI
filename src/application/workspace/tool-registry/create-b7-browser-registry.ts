import type { B5GitToolRegistryDeps } from './create-b5-git-registry';
import { createB5GitRegistry } from './create-b5-git-registry';
import type { ToolExecutor } from './tool-executor';
import type { ToolPolicyGate } from './tool-policy';
import type { ToolRegistry } from './tool-registry';
import { createInspectBrowserVerificationCatalogTool } from './tools/inspect-browser-verification-catalog.tool';
import { createRunLocalBrowserObservationTool } from './tools/run-local-browser-observation.tool';
import type { ControlledLocalBrowserService } from '../controlled-local-browser/controlled-local-browser.service';
import {
  ControlledLocalBrowserService as ControlledLocalBrowserServiceImpl,
  DEFAULT_BROWSER_OBSERVATION_ROUTE_CATALOG,
} from '../controlled-local-browser/controlled-local-browser.service';
import type {
  BrowserVerificationRunnerPort,
  RuntimeServerManagerPort,
} from '../../../core/runtime-verification/ports';
import { NodeDevServerManager } from '../../../infrastructure/runtime-verification/node-dev-server-manager';
import { PlaywrightBrowserVerificationRunner } from '../../../infrastructure/runtime-verification/playwright-browser-verification-runner';

export interface B7BrowserToolRegistryDeps extends B5GitToolRegistryDeps {
  readonly controlledBrowser: ControlledLocalBrowserService;
}

/**
 * Additive B7 registry: B5 tools + controlled local browser observation (ADR-043).
 * Must not register WEB, MCP, FileApply, shell, push, or open-web tools.
 */
export function createB7BrowserRegistry(deps: B7BrowserToolRegistryDeps): {
  readonly registry: ToolRegistry;
  readonly policy: ToolPolicyGate;
  readonly executor: ToolExecutor;
} {
  const { registry, policy, executor } = createB5GitRegistry(deps);
  registry.register(
    createInspectBrowserVerificationCatalogTool({ controlledBrowser: deps.controlledBrowser }),
  );
  registry.register(
    createRunLocalBrowserObservationTool({ controlledBrowser: deps.controlledBrowser }),
  );
  return { registry, policy, executor };
}

export interface CreateControlledLocalBrowserServiceOptions {
  readonly serverManagerFactory?: () => RuntimeServerManagerPort;
  readonly browserRunner?: BrowserVerificationRunnerPort;
  readonly workflowDeadlineMs?: number;
  readonly outputLimitBytes?: number;
}

export function createControlledLocalBrowserService(
  options: CreateControlledLocalBrowserServiceOptions = {},
): ControlledLocalBrowserService {
  return new ControlledLocalBrowserServiceImpl({
    serverManagerFactory: options.serverManagerFactory ?? (() => new NodeDevServerManager()),
    browserRunner: options.browserRunner ?? new PlaywrightBrowserVerificationRunner(),
    catalog: DEFAULT_BROWSER_OBSERVATION_ROUTE_CATALOG,
    workflowDeadlineMs: options.workflowDeadlineMs,
    outputLimitBytes: options.outputLimitBytes,
  });
}
