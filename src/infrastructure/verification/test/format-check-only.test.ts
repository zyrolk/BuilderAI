import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createAppliedResult } from '../../../core/verification/test/verification.fixture';
import {
  ALLOWED_NPM_RUN_SCRIPT_NAMES,
  validateCommandDescriptorAgainstPolicy,
  VerificationPolicyViolationError,
} from '../../../core/verification/policy';
import { FORMAT_SCRIPT_CANDIDATES } from '../../../core/verification/policy/verification-script-candidates';
import { discoverPackageScripts } from '../package-script-discovery';
import { createNodeVerificationRunners } from '../node-verification-ports';

describe('format check-only script policy', () => {
  it('limits FORMAT_SCRIPT_CANDIDATES to non-mutating check scripts', () => {
    expect([...FORMAT_SCRIPT_CANDIDATES]).toEqual(['format:check', 'format-check']);
    expect(ALLOWED_NPM_RUN_SCRIPT_NAMES.has('format')).toBe(false);
    expect(ALLOWED_NPM_RUN_SCRIPT_NAMES.has('format:check')).toBe(true);
    expect(ALLOWED_NPM_RUN_SCRIPT_NAMES.has('format-check')).toBe(true);
  });

  it('does not select bare format when only a mutating format script exists', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'builderai-format-only-'));
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ scripts: { format: 'prettier --write .' } }),
    );

    const scripts = discoverPackageScripts(root);
    expect(scripts.formatScript).toBeUndefined();
  });

  it('selects format:check and format-check aliases in discovery order', () => {
    const withColon = mkdtempSync(path.join(tmpdir(), 'builderai-format-colon-'));
    writeFileSync(
      path.join(withColon, 'package.json'),
      JSON.stringify({ scripts: { 'format:check': 'prettier --check .' } }),
    );
    expect(discoverPackageScripts(withColon).formatScript).toBe('format:check');

    const withHyphen = mkdtempSync(path.join(tmpdir(), 'builderai-format-hyphen-'));
    writeFileSync(
      path.join(withHyphen, 'package.json'),
      JSON.stringify({ scripts: { 'format-check': 'prettier --check .' } }),
    );
    expect(discoverPackageScripts(withHyphen).formatScript).toBe('format-check');
  });

  it('skips the format stage when no check-only script is declared', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'builderai-format-skip-'));
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ scripts: { format: 'prettier --write .', build: 'node -e 0' } }),
    );
    const runners = createNodeVerificationRunners({
      projectRoot: root,
      commandTimeoutMs: 5_000,
      maximumOutputBytes: 4_096,
    });
    const result = await runners.formatRunner.runFormat({
      fileApplyResult: createAppliedResult(),
      affectedFiles: { created: [], updated: [], deleted: [] },
      metadata: {},
    });
    expect(result.status).toBe('SKIPPED');
    expect(result.metadata.skipped).toBe(true);
  });

  it('rejects bare format at the verification policy allowlist layer', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'builderai-format-policy-'));
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ scripts: { format: 'prettier --write .' } }),
    );
    expect(() =>
      validateCommandDescriptorAgainstPolicy(
        {
          id: 'npm-run-named-script',
          stage: 'FORMAT_VALIDATION',
          executableKind: 'npm',
          fixedArguments: ['run', 'format'],
          scriptName: 'format',
          workingDirectoryPolicy: 'project-root',
          environmentPolicy: 'allowlisted-minimal',
          timeoutMs: 1_000,
          outputLimitBytes: 1_024,
          networkPolicy: 'disabled-unsupported',
        },
        { projectRoot: root, stageTimeoutMs: 1_000, outputLimitBytes: 1_024 },
      ),
    ).toThrow(VerificationPolicyViolationError);
  });
});
