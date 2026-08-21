import { describe, expect, it } from 'vitest';

import { CORRECTION_LOOP_SCHEMA_VERSION } from './correction-loop.types';
import {
  CorrectionLoopService,
  type CorrectionLoopPersistencePort,
} from './correction-loop.service';
import type { CorrectionLoopSession } from './correction-loop.types';

function session(overrides: Partial<CorrectionLoopSession> = {}): CorrectionLoopSession {
  return {
    schemaVersion: CORRECTION_LOOP_SCHEMA_VERSION,
    workflowId: 'wf-lazy',
    state: 'CORRECTION_WAITING_FOR_APPROVAL',
    attempt: 1,
    maximumAttempts: 3,
    startedAt: '2026-08-20T10:00:00.000Z',
    deadlineAt: '2026-08-20T13:00:00.000Z',
    attemptHistory: [],
    ...overrides,
  };
}

describe('CorrectionLoopService lazy persistence', () => {
  it('hydrates sessions from persistence.list', async () => {
    const persistence: CorrectionLoopPersistencePort = {
      save: async () => undefined,
      load: async () => undefined,
      list: async () => [session()],
    };
    const service = new CorrectionLoopService(
      undefined,
      () => new Date('2026-08-20T12:00:00.000Z'),
      persistence,
    );
    await service.hydratePersistedSessions();
    expect(service.getSession('wf-lazy')?.state).toBe('CORRECTION_WAITING_FOR_APPROVAL');
  });

  it('lazy-loads non-terminal sessions via getSessionAsync', async () => {
    const persistence: CorrectionLoopPersistencePort = {
      save: async () => undefined,
      load: async () => session(),
    };
    const service = new CorrectionLoopService(
      undefined,
      () => new Date('2026-08-20T12:00:00.000Z'),
      persistence,
    );
    const loaded = await service.getSessionAsync('wf-lazy');
    expect(loaded?.workflowId).toBe('wf-lazy');
    expect(service.getSession('wf-lazy')?.attempt).toBe(1);
  });

  it('returns terminal sessions without caching them as active', async () => {
    const persistence: CorrectionLoopPersistencePort = {
      save: async () => undefined,
      load: async () => session({ state: 'CORRECTION_PASSED', attempt: 2 }),
    };
    const service = new CorrectionLoopService(
      undefined,
      () => new Date('2026-08-20T12:00:00.000Z'),
      persistence,
    );
    const loaded = await service.getSessionAsync('wf-lazy');
    expect(loaded?.state).toBe('CORRECTION_PASSED');
    expect(service.getSession('wf-lazy')).toBeUndefined();
  });

  it('marks cancelled and expired sessions during lazy load', async () => {
    const persistence: CorrectionLoopPersistencePort = {
      save: async () => undefined,
      load: async (workflowId) =>
        session({
          workflowId,
          deadlineAt: '2026-08-20T11:00:00.000Z',
        }),
    };
    const service = new CorrectionLoopService(
      undefined,
      () => new Date('2026-08-20T12:00:00.000Z'),
      persistence,
    );
    const expired = await service.getSessionAsync('wf-expired');
    expect(expired?.state).toBe('CORRECTION_FAILED');
    expect(expired?.blockCode).toBe('CORRECTION_DEADLINE_EXCEEDED');

    const cancelledPersistence: CorrectionLoopPersistencePort = {
      save: async () => undefined,
      load: async () => session({ workflowId: 'wf-cancel' }),
    };
    const cancelledService = new CorrectionLoopService(
      undefined,
      () => new Date('2026-08-20T12:00:00.000Z'),
      cancelledPersistence,
    );
    await cancelledService.getSessionAsync('wf-cancel');
    await cancelledService.cancelCorrection('wf-cancel', 'user');
    const cancelled = await cancelledService.getSessionAsync('wf-cancel');
    expect(cancelled?.state).toBe('CORRECTION_CANCELLED');
  });

  it('returns undefined when persistence has no session', async () => {
    const persistence: CorrectionLoopPersistencePort = {
      save: async () => undefined,
      load: async () => undefined,
    };
    const service = new CorrectionLoopService(undefined, () => new Date(), persistence);
    expect(await service.getSessionAsync('missing')).toBeUndefined();
  });
});
