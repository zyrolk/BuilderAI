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

  it('posts toolTurn only to the B8 tool-turn route and strips authority fields', async () => {
    const client = new HttpAgentWorkflow();
    await client.toolTurn('run-1', {
      intent: { toolId: 'search_repository', intentId: 'i1', arguments: { query: 'a' } },
      browserObservationApproved: true,
      approved: true,
      applyAuthorizationToken: 'tok',
      operatorApproved: true,
      phase: 'EXECUTING',
      projectId: 'evil',
    } as {
      readonly intent: unknown;
      readonly browserObservationApproved?: boolean;
    });

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspace/agent/run/run-1/tool-turn',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify({
          intent: { toolId: 'search_repository', intentId: 'i1', arguments: { query: 'a' } },
          browserObservationApproved: true,
        }),
      }),
    );
  });

  it('does not invent browserObservationApproved when false/absent', async () => {
    const client = new HttpAgentWorkflow();
    await client.toolTurn('run-2', {
      intent: { toolId: 'inspect_readiness', intentId: 'i2', arguments: {} },
      browserObservationApproved: false,
    });
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const call = fetchMock.mock.calls.find((entry) => String(entry[0]).includes('/tool-turn'));
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({
          intent: { toolId: 'inspect_readiness', intentId: 'i2', arguments: {} },
        }),
      }),
    );
  });

  it('posts providerToolTurn only to provider-tool-turn without client intents', async () => {
    const client = new HttpAgentWorkflow();
    await client.providerToolTurn('run-3', { browserObservationApproved: true });
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspace/agent/run/run-3/provider-tool-turn',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify({ browserObservationApproved: true }),
      }),
    );
  });
});
