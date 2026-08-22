import { describe, expect, it } from 'vitest';

import { WorkspaceAuthorizationService } from '../workspace-authorization.service';
import { createB1ProofToolRegistry } from './create-b1-proof-registry';
import { ToolPolicyGate } from './tool-policy';
import { ToolRegistry } from './tool-registry';
import type { ToolDefinition, ToolHandler } from './tool-registry.types';
import { TOOL_RESULT_FORBIDDEN_KEYS, sanitizeToolStructured } from './tool-result-sanitizer';

function authService(projectId = 'builder-ai'): WorkspaceAuthorizationService {
  return new WorkspaceAuthorizationService({
    profile: 'TRUSTED_LOCAL',
    projectId,
    principalId: 'local-operator',
  });
}

function baseDefinition(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    toolId: 'search_repository',
    name: 'Search',
    description: 'test',
    inputSchema: {},
    outputSchema: {},
    capabilityClass: 'SEARCH',
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
    allowedPhases: ['UNDERSTANDING'],
    ...overrides,
  };
}

describe('ToolRegistry registration policy', () => {
  it('registers B1 read-only tools and lists definitions', () => {
    const policy = new ToolPolicyGate(authService());
    const registry = new ToolRegistry(policy);
    const handler: ToolHandler = {
      definition: baseDefinition({ toolId: 'search_repository' }),
      execute: async () => ({ summary: 'ok' }),
    };
    registry.register(handler);
    expect(registry.listDefinitions().map((item) => item.toolId)).toEqual(['search_repository']);
    expect(registry.dependencySurface()).toEqual(['ToolPolicyGate', 'ToolHandler']);
  });

  it('rejects MUTATE / APPLY / non-readOnly / Gate2 definitions', () => {
    const policy = new ToolPolicyGate(authService());
    const registry = new ToolRegistry(policy);

    expect(() =>
      registry.register({
        definition: baseDefinition({
          toolId: 'mutate_files',
          capabilityClass: 'MUTATE',
          readOnly: false,
          authorizationAction: 'APPLY',
        }),
        execute: async () => ({ summary: 'no' }),
      }),
    ).toThrow(/readOnly|APPLY|unavailable/i);

    expect(() =>
      registry.register({
        definition: baseDefinition({
          toolId: 'needs_gate',
          requiresGate2: true,
        }),
        execute: async () => ({ summary: 'no' }),
      }),
    ).toThrow(/Gate 2/i);

    expect(() =>
      registry.register({
        definition: baseDefinition({
          toolId: 'apply_tool',
          authorizationAction: 'APPLY',
        }),
        execute: async () => ({ summary: 'no' }),
      }),
    ).toThrow(/APPLY/);

    expect(() =>
      registry.register({
        definition: baseDefinition({
          toolId: 'loose_verify',
          capabilityClass: 'VERIFY',
          riskLevel: 'LOW',
          authorizationAction: 'PREPARE',
        }),
        execute: async () => ({ summary: 'no' }),
      }),
    ).toThrow(/catalog-only|HIGH|unavailable/i);

    expect(() =>
      registry.register({
        definition: baseDefinition({
          toolId: 'verify_gate',
          capabilityClass: 'VERIFY',
          riskLevel: 'HIGH',
          authorizationAction: 'PREPARE',
          requiresGate2: true,
        }),
        execute: async () => ({ summary: 'no' }),
      }),
    ).toThrow(/Gate 2|catalog-only/i);

    expect(() =>
      registry.register({
        definition: baseDefinition({
          toolId: 'verify_ok',
          capabilityClass: 'VERIFY',
          riskLevel: 'HIGH',
          authorizationAction: 'PREPARE',
        }),
        execute: async () => ({ summary: 'ok' }),
      }),
    ).not.toThrow();

    expect(() =>
      registry.register({
        definition: baseDefinition({
          toolId: 'no_phases',
          allowedPhases: [],
        }),
        execute: async () => ({ summary: 'no' }),
      }),
    ).toThrow(/allowedPhases/i);

    expect(() =>
      registry.register({
        definition: baseDefinition({
          toolId: 'not_scoped',
          workspaceScoped: false,
        }),
        execute: async () => ({ summary: 'no' }),
      }),
    ).toThrow(/workspaceScoped/i);
  });

  it('rejects duplicate tool ids', () => {
    const policy = new ToolPolicyGate(authService());
    const registry = new ToolRegistry(policy);
    registry.register({
      definition: baseDefinition(),
      execute: async () => ({ summary: 'ok' }),
    });
    expect(() =>
      registry.register({
        definition: baseDefinition(),
        execute: async () => ({ summary: 'ok' }),
      }),
    ).toThrow(/already registered/);
  });
});

describe('tool result sanitizer', () => {
  it('strips forbidden keys', () => {
    const sanitized = sanitizeToolStructured({
      preview: 'safe',
      fileContents: 'SECRET',
      stdout: 'noise',
      nested: { applyAuthorizationToken: 'tok', ok: true },
    });
    expect(sanitized).toEqual({
      preview: 'safe',
      nested: { ok: true },
    });
    const serialized = JSON.stringify(sanitized);
    for (const key of ['fileContents', 'stdout', 'applyAuthorizationToken'] as const) {
      expect(serialized.includes(`"${key}"`)).toBe(false);
    }
    expect(TOOL_RESULT_FORBIDDEN_KEYS.length).toBeGreaterThan(5);
  });
});

describe('createB1ProofToolRegistry', () => {
  it('registers exactly the three proof tools', () => {
    const { registry } = createB1ProofToolRegistry({
      authorization: authService(),
      search: {
        listSourcePaths: async () => [],
        readSourceFile: async () => '',
      },
      read: {
        readSourceFile: async () => '',
      },
      readiness: {
        project: async () => {
          throw new Error('unused');
        },
      },
    });
    expect(
      registry
        .listDefinitions()
        .map((item) => item.toolId)
        .sort(),
    ).toEqual(['inspect_readiness', 'read_source_file', 'search_repository']);
  });
});
