import path from 'node:path';

import type { GeminiProviderConfiguration } from '../../providers/gemini';
import type { OpenAIProviderConfiguration } from '../../providers/openai';
import type { WorkspaceRuntimeConfiguration } from '../../application/workspace';

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
    };

export interface LocalWorkspaceRuntimeConfiguration {
  readonly projectRoot: string;
  readonly provider: LocalProviderConfiguration;
  readonly workspace: WorkspaceRuntimeConfiguration;
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
  const providerKind = providerSelection();
  return {
    projectRoot,
    provider: providerConfiguration(providerKind),
    workspace: {
      preparationTtlMs: integer('BUILDERAI_PREPARATION_TTL_MS', 900_000, 60_000, 3_600_000),
      maximumPreparations: integer('BUILDERAI_MAX_PREPARATIONS', 50, 1, 500),
      providerTimeoutMs: integer('BUILDERAI_PROVIDER_TIMEOUT_MS', 120_000, 1_000, 600_000),
    },
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
  if (value === 'openai' || value === 'gemini') return value;
  throw new Error("BUILDERAI_AI_PROVIDER must equal 'openai' or 'gemini'.");
}

function providerConfiguration(
  kind: LocalProviderConfiguration['kind'],
): LocalProviderConfiguration {
  const settings = providerSettings(
    kind === 'openai' ? required('OPENAI_MODEL') : required('GEMINI_MODEL'),
  );
  return kind === 'openai'
    ? { kind, apiKey: required('OPENAI_API_KEY'), settings }
    : { kind, apiKey: required('GEMINI_API_KEY'), settings };
}

function providerSettings(
  model: string,
): OpenAIProviderConfiguration | GeminiProviderConfiguration {
  return {
    model,
    defaultTimeoutMs: integer('BUILDERAI_PROVIDER_TIMEOUT_MS', 120_000, 1_000, 600_000),
    maximumTimeoutMs: integer('BUILDERAI_PROVIDER_MAX_TIMEOUT_MS', 120_000, 1_000, 600_000),
    maximumInputCharacters: integer(
      'BUILDERAI_PROVIDER_MAX_INPUT_CHARACTERS',
      200_000,
      10_000,
      1_000_000,
    ),
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

function integer(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} is outside its supported range.`);
  }
  return value;
}
