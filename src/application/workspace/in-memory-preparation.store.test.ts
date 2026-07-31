import { CHANGE_PLAN, APPLY_RESULT } from '../../ui/workspace/test/workspace.fixture';
import { InMemoryPreparationStore } from './in-memory-preparation.store';

describe('InMemoryPreparationStore', () => {
  it('never evicts or double-claims an in-flight preparation', () => {
    let now = new Date('2026-07-31T13:00:00.000Z');
    const store = new InMemoryPreparationStore({ now: () => new Date(now) }, 1);
    store.save('preparation-one', CHANGE_PLAN, new Date('2026-07-31T13:15:00.000Z'));
    expect(store.claim('preparation-one').kind).toBe('CLAIMED');

    expect(() => store.claim('preparation-one')).toThrow('already being applied');
    expect(() =>
      store.save('preparation-two', CHANGE_PLAN, new Date('2026-07-31T13:15:00.000Z')),
    ).toThrow('capacity');

    store.complete('preparation-one', { applyResult: APPLY_RESULT });
    store.save('preparation-two', CHANGE_PLAN, new Date('2026-07-31T13:15:00.000Z'));
    expect(() => store.claim('preparation-one')).toThrow('not found');

    now = new Date('2026-07-31T13:16:00.000Z');
    expect(() => store.claim('preparation-two')).toThrow('expired');
  });
});
