import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ZYRO_STYLE_FIXTURE_ROOT } from '../../core/target-project/test/external-target.fixture';
import { discoverPackageScripts } from './package-script-discovery';

describe('package script discovery', () => {
  it('discovers build, test, lint, and typecheck on the Zyro-style fixture', () => {
    const scripts = discoverPackageScripts(ZYRO_STYLE_FIXTURE_ROOT);
    expect(scripts.hasBuild).toBe(true);
    expect(scripts.hasTest).toBe(true);
    expect(scripts.lintScript).toBe('lint');
    expect(scripts.typecheckScript).toBe('typecheck');
  });

  it('skips optional lint and typecheck when scripts are absent', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'builderai-verify-'));
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ scripts: { build: 'npm run build', test: 'npm test' } }),
    );
    const scripts = discoverPackageScripts(root);
    expect(scripts.hasBuild).toBe(true);
    expect(scripts.hasTest).toBe(true);
    expect(scripts.lintScript).toBeUndefined();
    expect(scripts.typecheckScript).toBeUndefined();
  });

  it('resolves type-check alias before giving up', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'builderai-verify-'));
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ scripts: { 'type-check': 'tsc --noEmit', test: 'vitest run' } }),
    );
    const scripts = discoverPackageScripts(root);
    expect(scripts.typecheckScript).toBe('type-check');
  });
});
