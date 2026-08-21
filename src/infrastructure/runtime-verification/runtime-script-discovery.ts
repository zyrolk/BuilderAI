import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  DEV_SERVER_SCRIPT_CANDIDATES,
  type RuntimeServerDescriptor,
  type RuntimeServerDescriptorId,
  type SupportedRuntimeFramework,
} from '../../core/runtime-verification';
import {
  DEFAULT_RUNTIME_BROWSER_WORKFLOW_DEADLINE_MS,
  DEFAULT_RUNTIME_SERVER_SHUTDOWN_TIMEOUT_MS,
  DEFAULT_RUNTIME_SERVER_STARTUP_TIMEOUT_MS,
  MAXIMUM_BROWSER_ROUTES,
} from '../../core/runtime-verification/policy/runtime-verification-policy';
import type { BrowserRoutePlan, RuntimeVerificationPlan } from '../../core/runtime-verification';

export interface DiscoveredRuntimeScripts {
  readonly devScript: string | undefined;
  readonly framework: SupportedRuntimeFramework;
  readonly preferredPort: number | undefined;
}

export interface RuntimeVerificationProfile {
  readonly routes: readonly BrowserRoutePlan[];
}

export function discoverRuntimeScripts(projectRoot: string): DiscoveredRuntimeScripts {
  const packagePath = path.join(path.resolve(projectRoot), 'package.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(packagePath, 'utf8')) as unknown;
  } catch {
    return { devScript: undefined, framework: 'generic-npm', preferredPort: undefined };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { devScript: undefined, framework: 'generic-npm', preferredPort: undefined };
  }
  const scripts = Reflect.get(parsed, 'scripts');
  const dependencies = Reflect.get(parsed, 'devDependencies');
  const runtimeDependencies = Reflect.get(parsed, 'dependencies');
  const names =
    typeof scripts === 'object' && scripts !== null
      ? new Set(
          Object.keys(scripts).filter((name) => typeof Reflect.get(scripts, name) === 'string'),
        )
      : new Set<string>();
  const devScript = DEV_SERVER_SCRIPT_CANDIDATES.find((candidate) => names.has(candidate));
  const framework = detectFramework(dependencies, runtimeDependencies);
  return {
    devScript,
    framework,
    preferredPort: readPreferredPort(parsed),
  };
}

export function buildRuntimeVerificationPlan(input: {
  readonly projectRoot: string;
  readonly profile?: RuntimeVerificationProfile;
  readonly startupTimeoutMs?: number;
  readonly shutdownTimeoutMs?: number;
  readonly workflowDeadlineMs?: number;
  readonly outputLimitBytes?: number;
}): RuntimeVerificationPlan | undefined {
  const discovered = discoverRuntimeScripts(input.projectRoot);
  if (discovered.devScript === undefined) return undefined;
  const descriptorId = descriptorIdForScript(discovered.devScript);
  const routes = normalizeRoutes(input.profile?.routes ?? [{ path: '/' }]);
  return {
    framework: discovered.framework,
    serverDescriptorId: descriptorId,
    devScript: discovered.devScript,
    host: '127.0.0.1',
    ...(discovered.preferredPort === undefined ? {} : { preferredPort: discovered.preferredPort }),
    routes,
    startupTimeoutMs: input.startupTimeoutMs ?? DEFAULT_RUNTIME_SERVER_STARTUP_TIMEOUT_MS,
    shutdownTimeoutMs: input.shutdownTimeoutMs ?? DEFAULT_RUNTIME_SERVER_SHUTDOWN_TIMEOUT_MS,
    workflowDeadlineMs: input.workflowDeadlineMs ?? DEFAULT_RUNTIME_BROWSER_WORKFLOW_DEADLINE_MS,
    outputLimitBytes: input.outputLimitBytes ?? 1_000_000,
  };
}

export function createRuntimeServerDescriptor(
  plan: RuntimeVerificationPlan,
): RuntimeServerDescriptor {
  return {
    id: plan.serverDescriptorId as RuntimeServerDescriptorId,
    framework: plan.framework,
    executableKind: 'npm',
    fixedArguments: ['run', plan.devScript],
    scriptName: plan.devScript,
    workingDirectoryPolicy: 'project-root',
    environmentPolicy: 'allowlisted-minimal',
    startupTimeoutMs: plan.startupTimeoutMs,
    shutdownTimeoutMs: plan.shutdownTimeoutMs,
    outputLimitBytes: plan.outputLimitBytes,
    bindHost: '127.0.0.1',
  };
}

function descriptorIdForScript(script: string): RuntimeServerDescriptorId {
  if (script === 'dev') return 'npm-run-dev';
  if (script === 'start') return 'npm-run-start';
  return 'npm-run-preview';
}

function detectFramework(
  devDependencies: unknown,
  dependencies: unknown,
): SupportedRuntimeFramework {
  const names = packageDependencyNames(devDependencies).concat(
    packageDependencyNames(dependencies),
  );
  if (names.includes('next')) return 'next';
  if (names.includes('vite')) return 'vite';
  return 'generic-npm';
}

function packageDependencyNames(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return [];
  return Object.keys(value);
}

function readPreferredPort(parsed: object): number | undefined {
  const env = Reflect.get(parsed, 'config');
  if (typeof env === 'object' && env !== null) {
    const port = Reflect.get(env, 'port');
    if (typeof port === 'number' && Number.isInteger(port) && port > 0 && port <= 65535) {
      return port;
    }
  }
  return undefined;
}

function normalizeRoutes(routes: readonly BrowserRoutePlan[]): readonly BrowserRoutePlan[] {
  const unique: BrowserRoutePlan[] = [];
  for (const route of routes.slice(0, MAXIMUM_BROWSER_ROUTES)) {
    if (!unique.some(({ path }) => path === route.path)) unique.push(route);
  }
  return unique.length === 0 ? [{ path: '/' }] : unique;
}
