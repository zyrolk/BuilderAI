import path from 'node:path';

import {
  rejectForbiddenNpmArguments,
  rejectForbiddenShellInvocation,
} from '../../verification/policy';
import type { RuntimeServerDescriptor } from './runtime-server-descriptor';
import { DEV_SERVER_SCRIPT_CANDIDATES } from './runtime-server-descriptor';

export const MAXIMUM_BROWSER_ROUTES = 5 as const;
export const MAXIMUM_BROWSER_SCREENSHOTS = 5 as const;
export const DEFAULT_RUNTIME_BROWSER_WORKFLOW_DEADLINE_MS = 300_000 as const;
export const DEFAULT_RUNTIME_SERVER_STARTUP_TIMEOUT_MS = 120_000 as const;
export const DEFAULT_RUNTIME_SERVER_SHUTDOWN_TIMEOUT_MS = 15_000 as const;
export const LOCALHOST_BIND_HOST = '127.0.0.1' as const;

export class RuntimeVerificationPolicyViolationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RuntimeVerificationPolicyViolationError';
  }
}

export function assertLocalhostBindHost(host: string): void {
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new RuntimeVerificationPolicyViolationError(
      'PUBLIC_BIND_FORBIDDEN',
      'Dev server must bind to localhost only.',
    );
  }
}

export function assertRoutePathAllowed(routePath: string): void {
  if (!routePath.startsWith('/') || routePath.includes('://') || routePath.includes('..')) {
    throw new RuntimeVerificationPolicyViolationError(
      'FORBIDDEN_ROUTE',
      'Browser route must be a bounded relative application path.',
    );
  }
}

export function assertBrowserUrlAllowed(url: string, allowedHost: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new RuntimeVerificationPolicyViolationError('FORBIDDEN_URL', 'Browser URL is invalid.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new RuntimeVerificationPolicyViolationError(
      'FORBIDDEN_URL_PROTOCOL',
      'Browser navigation must use HTTP(S) to localhost.',
    );
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== allowedHost) {
    throw new RuntimeVerificationPolicyViolationError(
      'EXTERNAL_ORIGIN_FORBIDDEN',
      'Browser navigation is limited to localhost.',
    );
  }
}

export function validateRuntimeServerDescriptor(
  descriptor: RuntimeServerDescriptor,
  projectRoot: string,
): void {
  const root = path.resolve(projectRoot);
  if (containsTraversal(root)) {
    throw new RuntimeVerificationPolicyViolationError(
      'WORKING_DIRECTORY_TRAVERSAL',
      'Project root contains traversal segments.',
    );
  }
  if (descriptor.bindHost !== '127.0.0.1') {
    throw new RuntimeVerificationPolicyViolationError(
      'PUBLIC_BIND_FORBIDDEN',
      'Dev server must bind to 127.0.0.1.',
    );
  }
  if (descriptor.fixedArguments.length !== 2 || descriptor.fixedArguments[0] !== 'run') {
    throw new RuntimeVerificationPolicyViolationError(
      'FORBIDDEN_DEV_SERVER_COMMAND',
      'Dev server must use npm run <script>.',
    );
  }
  const script = descriptor.fixedArguments[1];
  if (typeof script !== 'string' || !DEV_SERVER_SCRIPT_CANDIDATES.includes(script as never)) {
    throw new RuntimeVerificationPolicyViolationError(
      'FORBIDDEN_DEV_SERVER_SCRIPT',
      `Script "${String(script)}" is not allowlisted for dev server startup.`,
    );
  }
  if (script !== descriptor.scriptName) {
    throw new RuntimeVerificationPolicyViolationError(
      'SCRIPT_NAME_MISMATCH',
      'Descriptor script name does not match fixed arguments.',
    );
  }
  rejectForbiddenShellInvocation('npm', descriptor.fixedArguments);
  rejectForbiddenNpmArguments(descriptor.fixedArguments);
}

export function sanitizeUrlForEvidence(url: string): string {
  try {
    const parsed = new URL(url);
    const sensitive = ['token', 'key', 'secret', 'password', 'auth', 'session'];
    for (const name of [...parsed.searchParams.keys()]) {
      if (sensitive.some((part) => name.toLowerCase().includes(part))) {
        parsed.searchParams.set(name, '[REDACTED]');
      }
    }
    return parsed.toString();
  } catch {
    return url.slice(0, 500);
  }
}

function containsTraversal(value: string): boolean {
  return value.split(/[\\/]/).some((segment) => segment === '..');
}
