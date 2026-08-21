import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentRunPersistence } from './agent-run.persistence';
import { AgentRunService } from './agent-run.service';
import { AgentRunError, type AgentRun, type AgentRunPhase } from './agent-run.types';
import { canTransitionAgentRunPhase, statusForAgentRunPhase } from './agent-run-transitions';

describe('P1-A Step 1 AgentRun model', () => {
  let stateRoot: string;
  let persistence: AgentRunPersistence;
  let service: AgentRunService;
  let nowMs: number;

  beforeEach(async () => {
    stateRoot = await mkdtemp(path.join(os.tmpdir(), 'builderai-agent-run-'));
    persistence = new AgentRunPersistence(stateRoot, 'project-a');
    nowMs = Date.parse('2026-08-21T10:00:00.000Z');
    service = new AgentRunService(persistence, () => new Date(nowMs));
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it('creates an AgentRun in UNDERSTANDING / RUNNING', async () => {
    const run = await service.create({
      runId: 'run-1',
      projectId: 'project-a',
      goal: 'Add readiness banner',
      createdAt: '2026-08-21T10:00:00.000Z',
    });
    expect(run.phase).toBe('UNDERSTANDING');
    expect(run.status).toBe('RUNNING');
    expect(run.schemaVersion).toBe(1);
    expect(run.references).toEqual({});
  });

  it('allows valid lifecycle transitions including Gate2 wait', async () => {
    await service.create({
      runId: 'run-2',
      projectId: 'project-a',
      goal: 'Fix login',
      createdAt: '2026-08-21T10:00:00.000Z',
    });
    const sequence: AgentRunPhase[] = [
      'PLANNING',
      'AWAITING_GATE2',
      'EXECUTING',
      'VERIFYING',
      'EXPLAINING',
      'COMPLETED',
    ];
    let current = await service.require('run-2');
    for (const phase of sequence) {
      nowMs += 1_000;
      current = await service.transition('run-2', phase);
      expect(current.phase).toBe(phase);
      expect(current.status).toBe(statusForAgentRunPhase(phase));
    }
    expect(current.status).toBe('COMPLETED');
  });

  it('rejects invalid transitions fail-closed', async () => {
    await service.create({
      runId: 'run-3',
      projectId: 'project-a',
      goal: 'Invalid jump',
      createdAt: '2026-08-21T10:00:00.000Z',
    });
    await expect(service.transition('run-3', 'EXECUTING')).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
    expect(canTransitionAgentRunPhase('UNDERSTANDING', 'EXECUTING')).toBe(false);
  });

  it('protects terminal states', async () => {
    await service.create({
      runId: 'run-4',
      projectId: 'project-a',
      goal: 'Terminal',
      createdAt: '2026-08-21T10:00:00.000Z',
    });
    await service.transition('run-4', 'FAILED');
    await expect(service.transition('run-4', 'PLANNING')).rejects.toMatchObject({
      code: 'TERMINAL_STATE',
    });
    await expect(service.cancel('run-4')).rejects.toMatchObject({ code: 'TERMINAL_STATE' });
    await expect(
      service.updateReferences('run-4', { preparationId: 'prep-1' }),
    ).rejects.toMatchObject({ code: 'TERMINAL_STATE' });
  });

  it('models AWAITING_GATE2 as a real interruption status', async () => {
    await service.create({
      runId: 'run-5',
      projectId: 'project-a',
      goal: 'Gate 2 stop',
      createdAt: '2026-08-21T10:00:00.000Z',
    });
    await service.transition('run-5', 'PLANNING');
    const waiting = await service.transition('run-5', 'AWAITING_GATE2');
    expect(waiting.phase).toBe('AWAITING_GATE2');
    expect(waiting.status).toBe('AWAITING_GATE2');
    expect(Object.keys(service).some((key) => /approve|apply/i.test(key))).toBe(false);
  });

  it('stores references to existing workflow identities only', async () => {
    await service.create({
      runId: 'run-6',
      projectId: 'project-a',
      goal: 'Wire references',
      createdAt: '2026-08-21T10:00:00.000Z',
      references: { investigationId: 'inv-1' },
    });
    const updated = await service.updateReferences('run-6', {
      featurePlanId: 'plan-1',
      preparationId: 'prep-1',
      workflowId: 'wf-1',
      correctionWorkflowId: 'corr-1',
    });
    expect(updated.references).toEqual({
      investigationId: 'inv-1',
      featurePlanId: 'plan-1',
      preparationId: 'prep-1',
      workflowId: 'wf-1',
      correctionWorkflowId: 'corr-1',
    });
    await expect(
      service.updateReferences('run-6', { preparationId: '../escape' }),
    ).rejects.toMatchObject({ code: 'INVALID_REFERENCE' });
  });

  it('persists and reloads AgentRun metadata', async () => {
    await service.create({
      runId: 'run-7',
      projectId: 'project-a',
      goal: 'Persist me',
      createdAt: '2026-08-21T10:00:00.000Z',
    });
    await service.transition('run-7', 'PLANNING');
    await service.transition('run-7', 'AWAITING_GATE2');
    await service.updateReferences('run-7', { preparationId: 'prep-7', workflowId: 'wf-7' });

    const restarted = new AgentRunService(new AgentRunPersistence(stateRoot, 'project-a'));
    await restarted.whenReady();
    const loaded = await restarted.require('run-7');
    expect(loaded.phase).toBe('AWAITING_GATE2');
    expect(loaded.status).toBe('AWAITING_GATE2');
    expect(loaded.references.preparationId).toBe('prep-7');
    expect(loaded.references.workflowId).toBe('wf-7');
  });

  it('does not update memory when atomic persistence fails', async () => {
    const failing = {
      projectId: 'project-a',
      stateRoot,
      save: vi.fn(async () => {
        throw new AgentRunError('PERSISTENCE_FAILED', 'disk full');
      }),
      load: persistence.load.bind(persistence),
      list: persistence.list.bind(persistence),
      runPath: persistence.runPath.bind(persistence),
    } as unknown as AgentRunPersistence;
    const failingService = new AgentRunService(failing, () => new Date(nowMs));
    await expect(
      failingService.create({
        runId: 'run-fail',
        projectId: 'project-a',
        goal: 'Should not stick',
        createdAt: '2026-08-21T10:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'PERSISTENCE_FAILED' });
    expect(failingService.listCached()).toHaveLength(0);
  });

  it('persisted representation is secret-free and plan-free', async () => {
    await service.create({
      runId: 'run-8',
      projectId: 'project-a',
      goal: 'No secrets here',
      createdAt: '2026-08-21T10:00:00.000Z',
      references: { preparationId: 'prep-8' },
    });
    const raw = await readFile(persistence.runPath('run-8'), 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('changePlan');
    expect(parsed).not.toHaveProperty('approved');
    expect(parsed).not.toHaveProperty('approval');
    expect(parsed).not.toHaveProperty('applyAuthorizationToken');
    expect(parsed).not.toHaveProperty('providerResponse');
    expect(parsed).not.toHaveProperty('prompt');
    expect(parsed).not.toHaveProperty('fileContents');
    expect(raw.toLowerCase()).not.toMatch(/api[_-]?key|bearer |password/);
  });

  it('restart of AWAITING_GATE2 does not auto-approve or auto-apply', async () => {
    await service.create({
      runId: 'run-9',
      projectId: 'project-a',
      goal: 'Wait at gate',
      createdAt: '2026-08-21T10:00:00.000Z',
    });
    await service.transition('run-9', 'PLANNING');
    await service.transition('run-9', 'AWAITING_GATE2');

    const restarted = new AgentRunService(new AgentRunPersistence(stateRoot, 'project-a'));
    await restarted.whenReady();
    const loaded = await restarted.require('run-9');
    expect(loaded.phase).toBe('AWAITING_GATE2');
    expect(loaded.status).toBe('AWAITING_GATE2');
    // No transition performed by hydration; EXECUTING still requires explicit call.
    expect(canTransitionAgentRunPhase(loaded.phase, 'EXECUTING')).toBe(true);
    expect(loaded.phase).not.toBe('EXECUTING');
  });

  it('supports cancellation from non-terminal phases', async () => {
    await service.create({
      runId: 'run-10',
      projectId: 'project-a',
      goal: 'Cancel me',
      createdAt: '2026-08-21T10:00:00.000Z',
    });
    await service.transition('run-10', 'PLANNING');
    const cancelled = await service.cancel('run-10');
    expect(cancelled.phase).toBe('CANCELLED');
    expect(cancelled.status).toBe('CANCELLED');
  });

  it('confines persistence to the workflow state root', async () => {
    await expect(
      service.create({
        runId: '../escape',
        projectId: 'project-a',
        goal: 'Bad id',
        createdAt: '2026-08-21T10:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REFERENCE' });

    await service.create({
      runId: 'run-11',
      projectId: 'project-a',
      goal: 'Contained',
      createdAt: '2026-08-21T10:00:00.000Z',
    });
    const filePath = persistence.runPath('run-11');
    expect(path.resolve(filePath).startsWith(path.resolve(stateRoot))).toBe(true);
  });

  it('rejects corrupt persisted documents', async () => {
    const filePath = persistence.runPath('run-corrupt');
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: 1,
        runId: 'run-corrupt',
        projectId: 'project-a',
        goal: 'Corrupt',
        phase: 'AWAITING_GATE2',
        status: 'RUNNING',
        references: {},
        createdAt: '2026-08-21T10:00:00.000Z',
        updatedAt: '2026-08-21T10:00:00.000Z',
        changePlan: { evil: true },
      }),
      'utf8',
    );
    await expect(persistence.load('run-corrupt')).rejects.toMatchObject({
      code: 'CORRUPT_STATE',
    });
  });

  it('rejects secret-like goals', async () => {
    await expect(
      service.create({
        runId: 'run-secret',
        projectId: 'project-a',
        goal: 'configure api_key=sk-test-123 for provider',
        createdAt: '2026-08-21T10:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_GOAL' });
  });

  it('supports correction path returning to AWAITING_GATE2', async () => {
    await service.create({
      runId: 'run-12',
      projectId: 'project-a',
      goal: 'Correct after verify fail',
      createdAt: '2026-08-21T10:00:00.000Z',
    });
    for (const phase of [
      'PLANNING',
      'AWAITING_GATE2',
      'EXECUTING',
      'VERIFYING',
      'DIAGNOSING',
      'CORRECTING',
      'AWAITING_GATE2',
    ] as const) {
      nowMs += 1_000;
      await service.transition('run-12', phase);
    }
    const waiting = await service.require('run-12');
    expect(waiting.phase).toBe('AWAITING_GATE2');
    expect(waiting.status).toBe('AWAITING_GATE2');
  });
});

describe('AgentRun type surface', () => {
  it('AgentRun shape cannot carry mutation authority fields at type level via sample', () => {
    const run: AgentRun = {
      schemaVersion: 1,
      runId: 'r',
      projectId: 'p',
      goal: 'g',
      phase: 'UNDERSTANDING',
      status: 'RUNNING',
      references: {},
      createdAt: 't',
      updatedAt: 't',
    };
    expect('changePlan' in run).toBe(false);
    expect('approved' in run).toBe(false);
  });
});
