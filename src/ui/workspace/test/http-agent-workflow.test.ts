import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { HttpAgentWorkflow } from '../http-agent-workflow';

describe('HttpAgentWorkflow', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ run: { runId: 'r1' } }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts start/plan/approve/cancel and gets status/explain without local mutation logic', async () => {
    const client = new HttpAgentWorkflow();
    await client.start('goal');
    await client.getStatus('r1');
    await client.getExplain('r1');
    await client.plan('r1');
    await client.approve('r1', { approved: true, applyAuthorizationToken: 'tok' });
    await client.cancel('r1', 'stop');

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspace/agent/run',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspace/agent/run/r1',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspace/agent/run/r1/explain',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspace/agent/run/r1/plan',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspace/agent/run/r1/approve',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ approved: true, applyAuthorizationToken: 'tok' }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspace/agent/run/r1/cancel',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reason: 'stop' }),
      }),
    );
  });

  it('does not expose a direct apply or mutation method', () => {
    const client = new HttpAgentWorkflow();
    expect('apply' in client).toBe(false);
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(client))).not.toContain('apply');
  });
});
