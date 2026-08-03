import { mkdir, readFile, rename, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';

import { normalizeFeaturePlan } from './feature-plan.service';
import type { FeaturePlan } from './feature-plan.types';
import { WorkspaceRuntimeError } from './workspace-runtime.types';

const PLAN_ID_PATTERN = /^[A-Za-z0-9-]{8,128}$/u;
const FEATURE_PLANS_DIR = '.builderai/feature-plans';

export class FeaturePlanPersistence {
  constructor(private readonly projectRoot: string) {}

  async save(plan: FeaturePlan): Promise<FeaturePlan> {
    const normalized = normalizeFeaturePlan(plan);
    const filePath = this.planPath(normalized.featurePlanId);
    await this.ensureDirectory();
    await assertSafeWritePath(this.projectRoot, filePath);
    const payload = `${JSON.stringify(normalized, null, 2)}\n`;
    const tempPath = `${filePath}.tmp`;
    await writeFile(tempPath, payload, 'utf8');
    await rename(tempPath, filePath);
    return normalized;
  }

  async load(featurePlanId: string): Promise<FeaturePlan> {
    if (!PLAN_ID_PATTERN.test(featurePlanId)) {
      throw new WorkspaceRuntimeError(
        'INVALID_FEATURE_PLAN',
        'Feature plan identifier is invalid.',
      );
    }
    const filePath = this.planPath(featurePlanId);
    await assertSafeWritePath(this.projectRoot, filePath);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch {
      throw new WorkspaceRuntimeError('FEATURE_PLAN_NOT_FOUND', 'Feature plan was not found.');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new WorkspaceRuntimeError(
        'INVALID_FEATURE_PLAN',
        'Persisted feature plan is not valid JSON.',
      );
    }
    return normalizeFeaturePlan(parsed);
  }

  async loadActive(): Promise<FeaturePlan | undefined> {
    const directory = path.join(this.projectRoot, FEATURE_PLANS_DIR);
    await this.ensureDirectory();
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(directory);
    const candidates = entries.filter(
      (entry) => entry.endsWith('.json') && !entry.endsWith('.tmp'),
    );
    let latest: FeaturePlan | undefined;
    for (const entry of candidates) {
      const featurePlanId = entry.replace(/\.json$/u, '');
      try {
        const plan = await this.load(featurePlanId);
        if (
          plan.status === 'DRAFT' ||
          plan.status === 'APPROVED' ||
          plan.status === 'IN_PROGRESS'
        ) {
          if (latest === undefined || plan.updatedAt > latest.updatedAt) latest = plan;
        }
      } catch {
        continue;
      }
    }
    return latest;
  }

  private planPath(featurePlanId: string): string {
    return path.join(this.projectRoot, FEATURE_PLANS_DIR, `${featurePlanId}.json`);
  }

  private async ensureDirectory(): Promise<void> {
    await mkdir(path.join(this.projectRoot, FEATURE_PLANS_DIR), { recursive: true });
  }
}

export async function assertSafeWritePath(
  projectRoot: string,
  absoluteTarget: string,
): Promise<void> {
  const root = path.resolve(projectRoot);
  const resolved = path.resolve(absoluteTarget);
  const relative = normalizeRelativePath(path.relative(root, resolved));
  if (
    relative.startsWith('..') ||
    path.isAbsolute(relative) ||
    !relative.startsWith(FEATURE_PLANS_DIR)
  ) {
    throw new WorkspaceRuntimeError(
      'INVALID_FEATURE_PLAN',
      'Feature plan path is outside project root.',
    );
  }
  const directory = path.dirname(resolved);
  await assertDirectorySafe(root, directory);
}

async function assertDirectorySafe(projectRoot: string, directory: string): Promise<void> {
  const relative = normalizeRelativePath(path.relative(projectRoot, directory));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new WorkspaceRuntimeError(
      'INVALID_FEATURE_PLAN',
      'Feature plan directory escapes project root.',
    );
  }
  let current = directory;
  while (current.startsWith(projectRoot)) {
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) {
        throw new WorkspaceRuntimeError(
          'INVALID_FEATURE_PLAN',
          'Feature plan path crosses a symbolic link.',
        );
      }
    } catch (error: unknown) {
      if (error instanceof WorkspaceRuntimeError) throw error;
      break;
    }
    if (current === projectRoot) break;
    current = path.dirname(current);
  }
}

function normalizeRelativePath(relative: string): string {
  return relative.replaceAll('\\', '/');
}
