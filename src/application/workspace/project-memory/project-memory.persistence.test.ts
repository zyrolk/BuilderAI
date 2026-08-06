import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ProjectMemoryPersistence, assertSafeWritePath } from './project-memory.persistence';
import { DEFAULT_PROJECT_MEMORY_CONFIGURATION } from './project-memory-configuration';
import {
  ProjectMemoryPersistenceError,
  ProjectMemoryValidationError,
} from './project-memory.types';
import { assertSafeMemoryRelativePath } from './project-memory-sanitize';

describe('ProjectMemoryPersistence', () => {
  it('reads empty memory when file is missing', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'builderai-memory-read-'));
    try {
      const persistence = new ProjectMemoryPersistence(root);
      const memory = await persistence.read('project-a');
      expect(memory.projectId).toBe('project-a');
      expect(memory.findings).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes and reads memory atomically', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'builderai-memory-write-'));
    try {
      const persistence = new ProjectMemoryPersistence(root);
      await persistence.write({
        schemaVersion: 1,
        projectId: 'project-a',
        updatedAt: '2026-08-05T12:00:00.000Z',
        decisions: [],
        completedWork: [],
        investigations: [],
        findings: [
          {
            id: 'finding-00000001',
            category: 'FINDING',
            createdAt: '2026-08-05T12:00:00.000Z',
            updatedAt: '2026-08-05T12:00:00.000Z',
            summary: 'Persisted finding',
            supportingPaths: ['src/app.ts'],
            source: 'OPERATOR',
          },
        ],
      });
      const loaded = await persistence.read('project-a');
      expect(loaded.findings[0]?.summary).toBe('Persisted finding');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects invalid json and project mismatch on read', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'builderai-memory-invalid-'));
    try {
      const filePath = path.join(root, '.builderai', 'project-memory.json');
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(
        filePath,
        `${JSON.stringify({ schemaVersion: 1, projectId: 'project-a', updatedAt: '2026-08-05T12:00:00.000Z', decisions: [], completedWork: [], investigations: [], findings: [] })}\n`,
        'utf8',
      );
      const persistence = new ProjectMemoryPersistence(root);
      await expect(persistence.read('project-b')).rejects.toBeInstanceOf(
        ProjectMemoryValidationError,
      );
      writeFileSync(filePath, '{not-json', 'utf8');
      await expect(persistence.read('project-a')).rejects.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects unsafe relative memory paths', () => {
    expect(() => assertSafeMemoryRelativePath('../project-memory.json')).toThrow(
      /allowed storage boundary/i,
    );
    expect(() => assertSafeMemoryRelativePath('secrets/project-memory.json')).toThrow(
      /allowed storage boundary/i,
    );
  });

  it('rejects writes outside project root', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'builderai-memory-outside-'));
    try {
      await expect(
        assertSafeWritePath(root, path.resolve(root, '..', 'outside-memory.json')),
      ).rejects.toBeInstanceOf(ProjectMemoryPersistenceError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns empty memory for blank files and rejects oversized payloads', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'builderai-memory-empty-'));
    try {
      const filePath = path.join(root, '.builderai', 'project-memory.json');
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, '   \n', 'utf8');
      const persistence = new ProjectMemoryPersistence(root);
      const empty = await persistence.read('project-a');
      expect(empty.findings).toHaveLength(0);

      const tinyPersistence = new ProjectMemoryPersistence(root, {
        ...DEFAULT_PROJECT_MEMORY_CONFIGURATION,
        maximumSerializedBytes: 32,
      });
      await expect(
        tinyPersistence.write({
          schemaVersion: 1,
          projectId: 'project-a',
          updatedAt: '2026-08-05T12:00:00.000Z',
          decisions: [],
          completedWork: [],
          investigations: [],
          findings: [
            {
              id: 'finding-00000001',
              category: 'FINDING',
              createdAt: '2026-08-05T12:00:00.000Z',
              updatedAt: '2026-08-05T12:00:00.000Z',
              summary: 'This serialized finding exceeds the tiny configured payload limit.',
              supportingPaths: ['src/app.ts'],
              source: 'OPERATOR',
            },
          ],
        }),
      ).rejects.toMatchObject({ code: 'INVALID_PATH' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
