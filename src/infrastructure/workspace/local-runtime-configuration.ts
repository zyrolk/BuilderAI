import path from 'node:path';

import type { GeminiProviderConfiguration } from '../../providers/gemini';
import type { OpenAIProviderConfiguration } from '../../providers/openai';
import {
  OPENROUTER_DEFAULT_BASE_URL,
  type OpenRouterProviderConfiguration,
} from '../../providers/openrouter';
import type { WorkspaceRuntimeConfiguration } from '../../application/workspace';
import type { WorkspaceSecurityConfiguration } from '../../application/workspace/workspace-authorization.types';
import {
  parseWorkspaceProjectProfile,
  readWorkspaceProjectId,
  type WorkspaceProjectProfile,
} from '../../core/target-project';
import { parseExtraSourceScanRoots } from '../project/project-source-index-policy';
import { assertBudgetOrdering } from './budget-invariant';

export type LocalProviderConfiguration =
  | {
      readonly kind: 'openai';
      readonly apiKey: string;
      readonly settings: OpenAIProviderConfiguration;
    }
  | {
      readonly kind: 'gemini';
      readonly apiKey: string;
      readonly settings: GeminiProviderConfiguration;
    }
  | {
      readonly kind: 'openrouter';
      readonly apiKey: string;
      readonly baseUrl: string;
      readonly httpReferer?: string;
      readonly appTitle?: string;
      readonly settings: OpenRouterProviderConfiguration;
    };

export interface LocalWorkspaceRuntimeConfiguration {
  readonly projectRoot: string;
  readonly projectProfile: WorkspaceProjectProfile;
  readonly extraSourceScanRoots: readonly string[];
  readonly provider: LocalProviderConfiguration;
  readonly workspace: WorkspaceRuntimeConfiguration;
  readonly security: WorkspaceSecurityConfiguration;
  readonly verificationCommandTimeoutMs: number;
  readonly verificationMaximumOutputBytes: number;
}

export function isLocalWorkspaceRuntimeConfigured(): boolean {
  if (process.env.BUILDERAI_LIVE_WORKFLOW_ENABLED !== 'true') return false;
  try {
    loadLocalWorkspaceRuntimeConfiguration();
    return true;
  } catch {
    return false;
  }
}

export function loadLocalWorkspaceRuntimeConfiguration(): LocalWorkspaceRuntimeConfiguration {
  if (process.env.BUILDERAI_LIVE_WORKFLOW_ENABLED !== 'true') {
    throw new Error('The local workspace runtime is disabled.');
  }
  const projectRoot = path.resolve(required('BUILDERAI_PROJECT_ROOT'));
  const projectProfile = parseWorkspaceProjectProfile(
    process.env.BUILDERAI_WORKSPACE_PROJECT_PROFILE,
  );
  const providerKind = providerSelection();
  const projectId = readWorkspaceProjectId(projectRoot, projectProfile);
  return {
    projectRoot,
    projectProfile,
    extraSourceScanRoots: parseExtraSourceScanRoots(process.env.BUILDERAI_EXTRA_SOURCE_SCAN_ROOTS),
    provider: providerConfiguration(providerKind),
    workspace: {
      preparationTtlMs: integer('BUILDERAI_PREPARATION_TTL_MS', 3_600_000, 60_000, 3_600_000),
      maximumPreparations: integer('BUILDERAI_MAX_PREPARATIONS', 50, 1, 500),
      providerTimeoutMs: integer('BUILDERAI_PROVIDER_TIMEOUT_MS', 120_000, 1_000, 600_000),
    },
    security: loadWorkspaceSecurityConfiguration(projectId),
    verificationCommandTimeoutMs: integer(
      'BUILDERAI_VERIFICATION_TIMEOUT_MS',
      600_000,
      10_000,
      1_800_000,
    ),
    verificationMaximumOutputBytes: integer(
      'BUILDERAI_VERIFICATION_MAX_OUTPUT_BYTES',
      1_000_000,
      1_024,
      10_000_000,
    ),
  };
}

function providerSelection(): LocalProviderConfiguration['kind'] {
  const value = required('BUILDERAI_AI_PROVIDER');
  if (value === 'openai' || value === 'gemini' || value === 'openrouter') return value;
  throw new Error("BUILDERAI_AI_PROVIDER must equal 'openai', 'gemini', or 'openrouter'.");
}

function providerConfiguration(
  kind: LocalProviderConfiguration['kind'],
): LocalProviderConfiguration {
  const model =
    kind === 'openai'
      ? required('OPENAI_MODEL')
      : kind === 'gemini'
        ? required('GEMINI_MODEL')
        : required('OPENROUTER_MODEL');
  const settings = providerSettings(model);
  if (kind === 'openai') {
    return { kind, apiKey: required('OPENAI_API_KEY'), settings };
  }
  if (kind === 'gemini') {
    return { kind, apiKey: required('GEMINI_API_KEY'), settings };
  }
  const baseUrl = optional('OPENROUTER_BASE_URL') ?? OPENROUTER_DEFAULT_BASE_URL;
  const httpReferer = optional('OPENROUTER_HTTP_REFERER');
  const appTitle = optional('OPENROUTER_APP_TITLE');
  return {
    kind,
    apiKey: required('OPENROUTER_API_KEY'),
    baseUrl,
    ...(httpReferer === undefined ? {} : { httpReferer }),
    ...(appTitle === undefined ? {} : { appTitle }),
    settings,
  };
}

function providerSettings(
  model: string,
): OpenAIProviderConfiguration | GeminiProviderConfiguration | OpenRouterProviderConfiguration {
  const maximumInputCharacters = integer(
    'BUILDERAI_PROVIDER_MAX_INPUT_CHARACTERS',
    200_000,
    10_000,
    1_000_000,
  );
  assertBudgetOrdering(maximumInputCharacters);
  return {
    model,
    defaultTimeoutMs: integer('BUILDERAI_PROVIDER_TIMEOUT_MS', 120_000, 1_000, 600_000),
    maximumTimeoutMs: integer('BUILDERAI_PROVIDER_MAX_TIMEOUT_MS', 120_000, 1_000, 600_000),
    maximumInputCharacters,
    maximumOutputCharacters: integer(
      'BUILDERAI_PROVIDER_MAX_OUTPUT_CHARACTERS',
      100_000,
      1_000,
      1_000_000,
    ),
    maximumOutputTokens: integer('BUILDERAI_PROVIDER_MAX_OUTPUT_TOKENS', 16_000, 256, 100_000),
  };
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) throw new Error(`${name} is required.`);
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function integer(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} is outside its supported range.`);
  }
  return value;
}

export function loadWorkspaceSecurityConfiguration(
  projectId: string,
): WorkspaceSecurityConfiguration {
  const profileRaw = process.env.BUILDERAI_WORKSPACE_SECURITY_PROFILE?.trim().toLowerCase();
  const profile = profileRaw === 'protected' ? 'PROTECTED' : 'TRUSTED_LOCAL';
  if (profile === 'TRUSTED_LOCAL') {
    return {
      profile: 'TRUSTED_LOCAL',
      projectId,
      principalId: 'local-operator',
    };
  }
  return {
    profile: 'PROTECTED',
    projectId,
    accessToken: required('BUILDERAI_WORKSPACE_ACCESS_TOKEN'),
    csrfToken: required('BUILDERAI_WORKSPACE_CSRF_TOKEN'),
    principalId: optional('BUILDERAI_WORKSPACE_PRINCIPAL_ID') ?? 'workspace-operator',
  };
}
