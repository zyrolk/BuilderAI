import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NodeRepositoryBaselineService } from '../node-repository-baseline.service';

const execFileAsync = promisify(execFile);

describe.sequential('NodeRepositoryBaselineService git paths', () => {
  let tempRoot: string;
  let projectRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'baseline-git-'));
    projectRoot = path.join(tempRoot, 'repo');
    await mkdir(projectRoot, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(tempRoot, { recursive: true, force: true });
    } catch {
      // Windows may still hold git locks briefly after process exit.
    }
  });

  it('captures git baseline when repository is available', async () => {
    await execFileAsync('git', ['init'], { cwd: projectRoot });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: projectRoot,
    });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: projectRoot });
    await writeFile(path.join(projectRoot, 'tracked.txt'), 'tracked\n', 'utf8');
    await execFileAsync('git', ['add', 'tracked.txt'], { cwd: projectRoot });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: projectRoot });
    await writeFile(path.join(projectRoot, 'tracked.txt'), 'dirty\n', 'utf8');
    await writeFile(path.join(projectRoot, 'untracked.txt'), 'new\n', 'utf8');

    const baseline = await new NodeRepositoryBaselineService().capture(projectRoot);
    expect(baseline.gitAvailable).toBe(true);
    expect(baseline.workingTreeState).toBe('DIRTY');
    expect(baseline.untrackedFileCount).toBeGreaterThan(0);
    expect(baseline.headCommit?.length).toBeGreaterThan(0);
    expect(baseline.baselineDigest.length).toBeGreaterThan(10);
  }, 30_000);

  it('reports CLEAN working tree for committed-only repos', async () => {
    await execFileAsync('git', ['init'], { cwd: projectRoot });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: projectRoot,
    });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: projectRoot });
    await writeFile(path.join(projectRoot, 'only.txt'), 'only\n', 'utf8');
    await execFileAsync('git', ['add', 'only.txt'], { cwd: projectRoot });
    await execFileAsync('git', ['commit', '-m', 'clean'], { cwd: projectRoot });

    const baseline = await new NodeRepositoryBaselineService().capture(projectRoot);
    expect(baseline.gitAvailable).toBe(true);
    expect(baseline.workingTreeState).toBe('CLEAN');
    expect(baseline.untrackedFileCount).toBe(0);
  }, 30_000);
});
