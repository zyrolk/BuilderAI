import { describe, expect, it, vi } from 'vitest';

import type { WorkspaceBaselinePort } from '../../../core/change-planner/ports';
import {
  ProjectFileSourceAccessDeniedError,
  type ProjectFileSource,
} from '../../../core/context-builder';
import { createWorkspacePathProtectionPolicyFromManifest } from '../../../core/target-project';
import { PrepareConfidentialityBoundary } from './prepare-confidentiality-boundary';

const SAFE_PATH = 'src/services/safe.ts';
const SECRET_PATH = 'server/secrets/api-config.json';
const SECRET_CONTENT = 'BUILDERAI_NEVER_EXPOSE_SECRET_MARKER_9f7a4c2e';

function sourceHarness(): ProjectFileSource & {
  readonly listSourcePaths: ReturnType<typeof vi.fn>;
  readonly readSourceFile: ReturnType<typeof vi.fn>;
} {
  return {
    listSourcePaths: vi.fn(async () => [SAFE_PATH, SECRET_PATH]),
    readSourceFile: vi.fn(async (logicalPath: string) =>
      logicalPath === SECRET_PATH ? SECRET_CONTENT : 'export const safe = true;\n',
    ),
  };
}

function baselineHarness(): WorkspaceBaselinePort & {
  readonly readTextBaseline: ReturnType<typeof vi.fn>;
} {
  return {
    readTextBaseline: vi.fn((logicalPath: string) => ({
      logicalPath,
      content: logicalPath === SECRET_PATH ? SECRET_CONTENT : 'safe',
      checksum: { algorithm: 'SHA-256' as const, value: 'a'.repeat(64) },
      sizeBytes: 4,
    })),
  };
}

describe('PrepareConfidentialityBoundary', () => {
  it('filters protected paths and aliases before source or baseline delegates are called', async () => {
    const source = sourceHarness();
    const baseline = baselineHarness();
    const boundary = new PrepareConfidentialityBoundary(
      'EXTERNAL_TARGET',
      source,
      baseline,
      createWorkspacePathProtectionPolicyFromManifest(['server/secrets/']),
    );

    await expect(boundary.listSourcePaths()).resolves.toEqual([SAFE_PATH]);
    for (const alias of [
      SECRET_PATH,
      './server/secrets/api-config.json',
      'server\\secrets\\api-config.json',
      'SERVER/SECRETS/API-CONFIG.JSON',
      '../server/secrets/api-config.json',
      'server/secrets/../secrets/api-config.json',
      'server/secrets/api-config.json ',
      'server/secrets/NUL.json',
    ]) {
      await expect(boundary.readSourceFile(alias)).rejects.toBeInstanceOf(
        ProjectFileSourceAccessDeniedError,
      );
      expect(boundary.readTextBaseline(alias)).toBeNull();
    }

    expect(source.readSourceFile).not.toHaveBeenCalled();
    expect(baseline.readTextBaseline).not.toHaveBeenCalled();
    await expect(boundary.readSourceFile(SAFE_PATH)).resolves.toContain('safe');
    expect(boundary.readTextBaseline(SAFE_PATH)?.content).toBe('safe');
  });

  it('fails closed before any source access when external policy classification is unavailable', async () => {
    const source = sourceHarness();
    const boundary = new PrepareConfidentialityBoundary(
      'EXTERNAL_TARGET',
      source,
      baselineHarness(),
    );

    await expect(boundary.listSourcePaths()).rejects.toBeInstanceOf(
      ProjectFileSourceAccessDeniedError,
    );
    await expect(boundary.readSourceFile(SAFE_PATH)).rejects.toBeInstanceOf(
      ProjectFileSourceAccessDeniedError,
    );
    expect(source.listSourcePaths).not.toHaveBeenCalled();
    expect(source.readSourceFile).not.toHaveBeenCalled();
  });

  it('drops malformed runtime path hints without touching the source adapter', () => {
    const source = sourceHarness();
    const boundary = new PrepareConfidentialityBoundary(
      'EXTERNAL_TARGET',
      source,
      baselineHarness(),
      createWorkspacePathProtectionPolicyFromManifest(['server/secrets/']),
    );

    expect(boundary.filterPaths([null as never, SECRET_PATH, SAFE_PATH])).toEqual([SAFE_PATH]);
    expect(source.readSourceFile).not.toHaveBeenCalled();
  });

  it('preserves BUILDERAI_SELF source, hint, and baseline behavior unchanged', async () => {
    const source = sourceHarness();
    const baseline = baselineHarness();
    const boundary = new PrepareConfidentialityBoundary('BUILDERAI_SELF', source, baseline);
    const paths = [SECRET_PATH];

    expect(boundary.filterPaths(paths)).toBe(paths);
    await expect(boundary.listSourcePaths()).resolves.toContain(SECRET_PATH);
    await expect(boundary.readSourceFile(SECRET_PATH)).resolves.toBe(SECRET_CONTENT);
    expect(boundary.readTextBaseline(SECRET_PATH)?.content).toBe(SECRET_CONTENT);
  });
});
