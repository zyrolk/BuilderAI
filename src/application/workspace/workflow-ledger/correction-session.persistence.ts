import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  CORRECTION_LOOP_SCHEMA_VERSION,
  type CorrectionLoopSession,
} from '../correction-loop/correction-loop.types';

const CORRECTION_SESSION_FILE = 'correction-session.json';

export class CorrectionSessionPersistence {
  constructor(
    private readonly stateRoot: string,
    private readonly projectId: string,
  ) {}

  async save(session: CorrectionLoopSession): Promise<void> {
    const filePath = this.sessionPath(session.workflowId);
    await mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const payload = `${JSON.stringify(session, null, 2)}\n`;
    await writeFile(tempPath, payload, 'utf8');
    await rename(tempPath, filePath);
  }

  async load(workflowId: string): Promise<CorrectionLoopSession | undefined> {
    const filePath = this.sessionPath(workflowId);
    try {
      const raw = await readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as CorrectionLoopSession;
      if (parsed.schemaVersion !== CORRECTION_LOOP_SCHEMA_VERSION) return undefined;
      return parsed;
    } catch {
      return undefined;
    }
  }

  async list(): Promise<readonly CorrectionLoopSession[]> {
    const directory = path.join(this.stateRoot, 'workflows', this.projectId);
    let workflowIds: string[];
    try {
      const { readdir } = await import('node:fs/promises');
      workflowIds = await readdir(directory);
    } catch {
      return [];
    }
    const sessions: CorrectionLoopSession[] = [];
    for (const workflowId of workflowIds) {
      const session = await this.load(workflowId);
      if (session !== undefined) sessions.push(session);
    }
    return sessions;
  }

  private sessionPath(workflowId: string): string {
    return path.join(
      this.stateRoot,
      'workflows',
      this.projectId,
      workflowId,
      CORRECTION_SESSION_FILE,
    );
  }
}
