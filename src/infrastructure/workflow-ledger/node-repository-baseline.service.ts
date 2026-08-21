import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  REPOSITORY_BASELINE_SCHEMA_VERSION,
  type RepositoryBaseline,
  type RepositoryBaselineFileEntry,
  type RepositoryBaselinePort,
  digestStructured,
} from '../../core/workflow-ledger';

const execFileAsync = promisify(execFile);

const MAX_BASELINE_FILES = 200 as const;
const MAX_FILE_BYTES = 256_000 as const;

export class NodeRepositoryBaselineService implements RepositoryBaselinePort {
  async capture(repositoryRoot: string): Promise<RepositoryBaseline> {
    const root = path.resolve(repositoryRoot);
    const gitAvailable = await this.isGitAvailable(root);
    const branch = gitAvailable ? await this.readGitBranch(root) : undefined;
    const headCommit = gitAvailable ? await this.readGitHead(root) : undefined;
    const workingTreeState = gitAvailable ? await this.readWorkingTreeState(root) : undefined;
    const untrackedFileCount = gitAvailable
      ? await this.countUntrackedFiles(root)
      : await this.countTopLevelFiles(root);
    const fileEntries = gitAvailable
      ? await this.readTrackedAndModifiedFiles(root)
      : await this.readFilesystemSample(root);

    const capturedAt = new Date().toISOString();
    const baselineDigest = digestStructured({
      repositoryRoot: root,
      gitAvailable,
      branch,
      headCommit,
      workingTreeState,
      untrackedFileCount,
      fileEntries,
    });

    return {
      schemaVersion: REPOSITORY_BASELINE_SCHEMA_VERSION,
      repositoryRoot: root,
      gitAvailable,
      ...(branch === undefined ? {} : { branch }),
      ...(headCommit === undefined ? {} : { headCommit }),
      ...(workingTreeState === undefined ? {} : { workingTreeState }),
      untrackedFileCount,
      fileEntries,
      capturedAt,
      baselineDigest,
    };
  }

  private async isGitAvailable(root: string): Promise<boolean> {
    try {
      const gitDir = path.join(root, '.git');
      const entry = await stat(gitDir);
      return entry.isDirectory();
    } catch {
      return false;
    }
  }

  private async readGitBranch(root: string): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync('git', ['-C', root, 'branch', '--show-current'], {
        timeout: 5_000,
      });
      const branch = stdout.trim();
      return branch.length > 0 ? branch : undefined;
    } catch {
      return undefined;
    }
  }

  private async readGitHead(root: string): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync('git', ['-C', root, 'rev-parse', 'HEAD'], {
        timeout: 5_000,
      });
      const commit = stdout.trim();
      return commit.length > 0 ? commit : undefined;
    } catch {
      return undefined;
    }
  }

  private async readWorkingTreeState(root: string): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync('git', ['-C', root, 'status', '--porcelain'], {
        timeout: 10_000,
      });
      return stdout.trim().length > 0 ? 'DIRTY' : 'CLEAN';
    } catch {
      return undefined;
    }
  }

  private async countUntrackedFiles(root: string): Promise<number> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['-C', root, 'ls-files', '--others', '--exclude-standard'],
        { timeout: 10_000 },
      );
      return stdout.split('\n').filter((line) => line.trim().length > 0).length;
    } catch {
      return 0;
    }
  }

  private async countTopLevelFiles(root: string): Promise<number> {
    try {
      const entries = await readdir(root);
      return entries.length;
    } catch {
      return 0;
    }
  }

  private async readTrackedAndModifiedFiles(
    root: string,
  ): Promise<readonly RepositoryBaselineFileEntry[]> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['-C', root, 'ls-files', '-m', '-o', '--exclude-standard'],
        {
          timeout: 10_000,
        },
      );
      const paths = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .slice(0, MAX_BASELINE_FILES);
      const entries: RepositoryBaselineFileEntry[] = [];
      for (const logicalPath of paths) {
        const checksum = await this.checksumFile(path.join(root, logicalPath));
        if (checksum === undefined) continue;
        entries.push({
          logicalPath: logicalPath.replaceAll('\\', '/'),
          checksum: checksum.digest,
          sizeBytes: checksum.sizeBytes,
        });
      }
      return entries;
    } catch {
      return [];
    }
  }

  private async readFilesystemSample(
    root: string,
  ): Promise<readonly RepositoryBaselineFileEntry[]> {
    const entries: RepositoryBaselineFileEntry[] = [];
    const queue = ['.'];
    while (queue.length > 0 && entries.length < MAX_BASELINE_FILES) {
      const relativeDirectory = queue.shift()!;
      const absoluteDirectory = path.join(root, relativeDirectory);
      let children: string[];
      try {
        children = await readdir(absoluteDirectory);
      } catch {
        continue;
      }
      for (const child of children) {
        if (child === 'node_modules' || child === '.git' || child.startsWith('.')) continue;
        const relativePath = relativeDirectory === '.' ? child : `${relativeDirectory}/${child}`;
        const absolutePath = path.join(root, relativePath);
        let entryStat;
        try {
          entryStat = await stat(absolutePath);
        } catch {
          continue;
        }
        if (entryStat.isDirectory()) {
          queue.push(relativePath);
          continue;
        }
        if (!entryStat.isFile() || entryStat.size > MAX_FILE_BYTES) continue;
        const checksum = await this.checksumFile(absolutePath);
        if (checksum === undefined) continue;
        entries.push({
          logicalPath: relativePath.replaceAll('\\', '/'),
          checksum: checksum.digest,
          sizeBytes: checksum.sizeBytes,
        });
      }
    }
    return entries;
  }

  private async checksumFile(
    absolutePath: string,
  ): Promise<{ readonly digest: string; readonly sizeBytes: number } | undefined> {
    try {
      const content = await readFile(absolutePath);
      return {
        digest: createHash('sha256').update(content).digest('hex'),
        sizeBytes: content.byteLength,
      };
    } catch {
      return undefined;
    }
  }
}
