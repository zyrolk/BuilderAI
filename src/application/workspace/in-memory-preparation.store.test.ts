import { CHANGE_PLAN, APPLY_RESULT } from '../../ui/workspace/test/workspace.fixture';
import { EMPTY_GATE2_REVIEW } from './gate2-review/gate2-review.fixture';
import { InMemoryPreparationStore, MAXIMUM_APPLY_ATTEMPTS } from './in-memory-preparation.store';

describe('InMemoryPreparationStore', () => {
  it('never evicts or double-claims an in-flight preparation', () => {
    let now = new Date('2026-07-31T13:00:00.000Z');
    const store = new InMemoryPreparationStore({ now: () => new Date(now) }, 1);
    store.save(
      'preparation-one',
      CHANGE_PLAN,
      EMPTY_GATE2_REVIEW,
      new Date('2026-07-31T13:15:00.000Z'),
    );
    expect(store.claim('preparation-one').kind).toBe('CLAIMED');

    expect(() => store.claim('preparation-one')).toThrow('already being applied');
    expect(() =>
      store.save(
        'preparation-two',
        CHANGE_PLAN,
        EMPTY_GATE2_REVIEW,
        new Date('2026-07-31T13:15:00.000Z'),
      ),
    ).toThrow('capacity');

    store.complete('preparation-one', { applyResult: APPLY_RESULT });
    store.save(
      'preparation-two',
      CHANGE_PLAN,
      EMPTY_GATE2_REVIEW,
      new Date('2026-07-31T13:15:00.000Z'),
    );
    expect(() => store.claim('preparation-one')).toThrow('not found');

    now = new Date('2026-07-31T13:16:00.000Z');
    expect(() => store.claim('preparation-two')).toThrow('expired');
  });

  it('reports the current attempt number and allows a released record to be reclaimed (P1-6)', () => {
    const store = new InMemoryPreparationStore(
      { now: () => new Date('2026-07-31T13:00:00.000Z') },
      10,
    );
    store.save(
      'preparation-one',
      CHANGE_PLAN,
      EMPTY_GATE2_REVIEW,
      new Date('2026-07-31T13:15:00.000Z'),
    );

    const first = store.claim('preparation-one');
    expect(first).toMatchObject({ kind: 'CLAIMED', attempt: 1 });

    store.releaseForRetry('preparation-one');
    expect(() => store.claim('preparation-one')).not.toThrow();
  });

  it('increments the attempt count across a release-and-reclaim cycle up to the configured maximum', () => {
    const store = new InMemoryPreparationStore(
      { now: () => new Date('2026-07-31T13:00:00.000Z') },
      10,
    );
    store.save(
      'preparation-one',
      CHANGE_PLAN,
      EMPTY_GATE2_REVIEW,
      new Date('2026-07-31T13:15:00.000Z'),
    );

    const first = store.claim('preparation-one');
    expect(first).toMatchObject({ kind: 'CLAIMED', attempt: 1 });
    store.releaseForRetry('preparation-one');

    const second = store.claim('preparation-one');
    expect(second).toMatchObject({ kind: 'CLAIMED', attempt: MAXIMUM_APPLY_ATTEMPTS });

    store.complete('preparation-one', { applyResult: APPLY_RESULT });
    expect(store.claim('preparation-one')).toEqual({
      kind: 'COMPLETED',
      completion: { applyResult: APPLY_RESULT },
    });
  });

  it('does not reset or extend the original expiry when a record is released for retry', () => {
    let now = new Date('2026-07-31T13:00:00.000Z');
    const store = new InMemoryPreparationStore({ now: () => new Date(now) }, 10);
    store.save(
      'preparation-one',
      CHANGE_PLAN,
      EMPTY_GATE2_REVIEW,
      new Date('2026-07-31T13:15:00.000Z'),
    );

    store.claim('preparation-one');
    now = new Date('2026-07-31T13:14:00.000Z');
    store.releaseForRetry('preparation-one');

    now = new Date('2026-07-31T13:16:00.000Z');
    expect(() => store.claim('preparation-one')).toThrow('expired');
  });

  it('rejects releaseForRetry when the record is not currently being applied', () => {
    const store = new InMemoryPreparationStore(
      { now: () => new Date('2026-07-31T13:00:00.000Z') },
      10,
    );
    store.save(
      'preparation-one',
      CHANGE_PLAN,
      EMPTY_GATE2_REVIEW,
      new Date('2026-07-31T13:15:00.000Z'),
    );
    expect(() => store.releaseForRetry('preparation-one')).toThrow('inconsistent');
  });
});
