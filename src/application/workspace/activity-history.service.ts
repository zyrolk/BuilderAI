import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { WorkspaceActivity, ActivityHistory } from './activity-history.types';

export interface ActivityHistoryServiceOptions {
  projectRoot: string;
  maxEntries?: number;
}

function isForbiddenKey(key: string): boolean {
  const lowerKey = key.toLowerCase();
  const forbiddenSubstrings = ['token', 'secret', 'password', 'apikey', 'stdout', 'stderr'];
  return forbiddenSubstrings.some((sub) => lowerKey.includes(sub));
}

function sanitizePayload<P>(payload: P, projectRoot: string): P {
  if (payload === null || payload === undefined) {
    return payload;
  }

  if (Array.isArray(payload)) {
    return payload.map((item) => sanitizePayload(item, projectRoot)) as P;
  }

  if (typeof payload === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      if (isForbiddenKey(key)) {
        continue;
      }
      sanitized[key] = sanitizePayload(value, projectRoot);
    }
    return sanitized as P;
  }

  if (typeof payload === 'string') {
    const isAbsolute = /^(?:\/|\\\\|[A-Za-z]:)/.test(payload);
    if (isAbsolute) {
      let normalized = payload.replace(/\\/g, '/');
      normalized = normalized.replace(/^[A-Za-z]:/, '');

      let normalizedRoot = projectRoot.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '');
      if (!normalizedRoot.startsWith('/')) {
        normalizedRoot = '/' + normalizedRoot;
      }
      if (!normalized.startsWith('/')) {
        normalized = '/' + normalized;
      }

      if (normalized.startsWith(normalizedRoot)) {
        let relative = normalized.slice(normalizedRoot.length);
        if (relative.startsWith('/')) {
          relative = relative.slice(1);
        }
        return relative as P;
      }
    }
    return payload as P;
  }

  return payload;
}

export class ActivityHistoryService {
  private readonly projectRoot: string;
  private readonly maxEntries: number;
  private readonly historyFilePath: string;

  constructor(options: ActivityHistoryServiceOptions) {
    this.projectRoot = options.projectRoot;
    this.maxEntries = options.maxEntries ?? 50;
    this.historyFilePath = path.join(this.projectRoot, '.builderai', 'activity-history.json');
  }

  public getHistoryFilePath(): string {
    return this.historyFilePath;
  }

  public async readHistory(): Promise<ActivityHistory> {
    try {
      const content = await fs.readFile(this.historyFilePath, 'utf-8');
      if (!content.trim()) {
        return { schemaVersion: 1, activities: [] };
      }
      const parsed = JSON.parse(content) as ActivityHistory;
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.activities)) {
        return { schemaVersion: 1, activities: [] };
      }
      return parsed;
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as Record<string, unknown>).code === 'ENOENT'
      ) {
        return { schemaVersion: 1, activities: [] };
      }
      throw error;
    }
  }

  public async recordActivity<T extends WorkspaceActivity>(activity: T): Promise<ActivityHistory> {
    const sanitizedPayload = sanitizePayload(activity.payload, this.projectRoot);
    const sanitizedActivity: T = {
      ...activity,
      payload: sanitizedPayload,
    };

    const history = await this.readHistory();
    const updatedActivities = [...history.activities, sanitizedActivity];

    if (updatedActivities.length > this.maxEntries) {
      updatedActivities.splice(0, updatedActivities.length - this.maxEntries);
    }

    const updatedHistory: ActivityHistory = {
      schemaVersion: 1,
      activities: updatedActivities,
    };

    const dir = path.dirname(this.historyFilePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.historyFilePath, JSON.stringify(updatedHistory, null, 2), 'utf-8');

    return updatedHistory;
  }
}
