import type { ExecutionCancellationToken } from '../../execution-engine';
import type { ResponseMetadata } from '../../response-processor';

export const RUNTIME_BROWSER_VERIFICATION_REPORT_SCHEMA_VERSION = 1 as const;

export const RUNTIME_SERVER_STATUSES = [
  'READY',
  'NOT_READY',
  'PROCESS_FAILED',
  'TIMEOUT',
  'CANCELLED',
  'POLICY_BLOCKED',
  'UNAVAILABLE',
] as const;

export const BROWSER_VERIFICATION_STATUSES = [
  'PASSED',
  'FAILED',
  'TIMEOUT',
  'CANCELLED',
  'UNAVAILABLE',
  'POLICY_BLOCKED',
] as const;

export const BROWSER_ROUTE_STATUSES = [
  'PASSED',
  'FAILED',
  'TIMEOUT',
  'NETWORK_ERROR',
  'CONSOLE_ERROR',
  'PAGE_ERROR',
] as const;

export const RUNTIME_BROWSER_OVERALL_STATUSES = [
  'PASSED',
  'FAILED',
  'PARTIAL',
  'TIMEOUT',
  'CANCELLED',
  'UNAVAILABLE',
  'POLICY_BLOCKED',
] as const;

export const SUPPORTED_RUNTIME_FRAMEWORKS = ['next', 'vite', 'generic-npm'] as const;

export type RuntimeServerStatus = (typeof RUNTIME_SERVER_STATUSES)[number];
export type BrowserVerificationStatus = (typeof BROWSER_VERIFICATION_STATUSES)[number];
export type BrowserRouteStatus = (typeof BROWSER_ROUTE_STATUSES)[number];
export type RuntimeBrowserOverallStatus = (typeof RUNTIME_BROWSER_OVERALL_STATUSES)[number];
export type SupportedRuntimeFramework = (typeof SUPPORTED_RUNTIME_FRAMEWORKS)[number];

export interface RuntimeVerificationPlan {
  readonly framework: SupportedRuntimeFramework;
  readonly serverDescriptorId: string;
  readonly devScript: string;
  readonly host: '127.0.0.1';
  readonly preferredPort?: number;
  readonly routes: readonly BrowserRoutePlan[];
  readonly startupTimeoutMs: number;
  readonly shutdownTimeoutMs: number;
  readonly workflowDeadlineMs: number;
  readonly outputLimitBytes: number;
}

export interface BrowserRoutePlan {
  readonly path: string;
  readonly requiredSelector?: string;
}

export interface BrowserVerificationPlan {
  readonly baseUrl: string;
  readonly routes: readonly BrowserRoutePlan[];
  readonly navigationTimeoutMs: number;
  readonly maximumScreenshots: number;
}

export interface RuntimeServerEvidence {
  readonly descriptorId: string;
  readonly status: RuntimeServerStatus;
  readonly url?: string;
  readonly port?: number;
  readonly startupDurationMs: number;
  readonly httpStatus?: number;
  readonly httpDurationMs?: number;
  readonly policyBlockCode?: string;
  readonly diagnostic?: RuntimeServerDiagnostic;
}

export interface RuntimeServerDiagnostic {
  readonly stdoutExcerpt?: string;
  readonly stderrExcerpt?: string;
  readonly truncated: boolean;
}

export interface BrowserConsoleEvidence {
  readonly level: 'error' | 'warning';
  readonly message: string;
}

export interface BrowserNetworkEvidence {
  readonly url: string;
  readonly status?: number;
  readonly resourceType?: string;
  readonly failureText?: string;
}

export interface BrowserRouteResult {
  readonly path: string;
  readonly status: BrowserRouteStatus;
  readonly durationMs: number;
  readonly httpStatus?: number;
  readonly pageTitle?: string;
  readonly finalUrl?: string;
  readonly consoleErrors: readonly BrowserConsoleEvidence[];
  readonly pageExceptions: readonly string[];
  readonly failedRequests: readonly BrowserNetworkEvidence[];
  readonly screenshotArtifactId?: string;
}

export interface BrowserVerificationEvidence {
  readonly status: BrowserVerificationStatus;
  readonly durationMs: number;
  readonly routes: readonly BrowserRouteResult[];
  readonly consoleErrorCount: number;
  readonly pageExceptionCount: number;
  readonly failedRequestCount: number;
  readonly policyBlockCode?: string;
}

export interface RuntimeBrowserVerificationReport {
  readonly schemaVersion: typeof RUNTIME_BROWSER_VERIFICATION_REPORT_SCHEMA_VERSION;
  readonly status: RuntimeBrowserOverallStatus;
  readonly server: RuntimeServerEvidence;
  readonly browser: BrowserVerificationEvidence;
  readonly durationMs: number;
  readonly metadata: ResponseMetadata;
}

export interface RuntimeBrowserVerificationInput {
  readonly projectRoot: string;
  readonly builderAiRoot?: string;
  readonly cancellation?: ExecutionCancellationToken;
  readonly workflowDeadlineMs?: number;
}
