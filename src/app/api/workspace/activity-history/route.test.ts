import { PREPARATION_COMPLETED } from '../../../../ui/workspace/test/activity-history.fixture';

const readHistory = vi.fn();

vi.mock('../../../../infrastructure/workspace/local-feature-workflow-runtime', () => ({
  getLocalActivityHistory: () => ({ readHistory }),
}));

async function callGet(origin = 'http://localhost:3000'): Promise<Response> {
  const { GET } = await import('./route');
  return GET(
    new Request('http://localhost:3000/api/workspace/activity-history', {
      method: 'GET',
      headers: { origin },
    }),
  );
}

describe('GET /api/workspace/activity-history', () => {
  beforeEach(() => {
    readHistory.mockReset();
  });

  it('returns validated canonical history with HTTP 200', async () => {
    readHistory.mockResolvedValueOnce({
      schemaVersion: 1,
      activities: [PREPARATION_COMPLETED],
    });

    const response = await callGet();
    const payload = (await response.json()) as {
      schemaVersion: number;
      activities: (typeof PREPARATION_COMPLETED)[];
    };

    expect(response.status).toBe(200);
    expect(payload.schemaVersion).toBe(1);
    expect(payload.activities).toHaveLength(1);
    expect(payload.activities[0]?.activityId).toBe(PREPARATION_COMPLETED.activityId);
    expect(JSON.stringify(payload)).not.toContain('projectRoot');
  });

  it('returns canonical empty ActivityHistory when persisted history is empty', async () => {
    readHistory.mockResolvedValueOnce({ schemaVersion: 1, activities: [] });

    const response = await callGet();
    const payload = (await response.json()) as { schemaVersion: number; activities: unknown[] };

    expect(response.status).toBe(200);
    expect(payload).toEqual({ schemaVersion: 1, activities: [] });
  });

  it('omits malformed persisted activities instead of leaking arbitrary fields', async () => {
    readHistory.mockResolvedValueOnce({
      schemaVersion: 1,
      activities: [
        PREPARATION_COMPLETED,
        {
          activityId: 'bad-entry',
          correlationId: 'corr-bad',
          featurePlanId: 'plan-bad',
          taskId: 'task-bad',
          timestamp: '2026-08-03T12:00:00.000Z',
          type: 'TASK_PREPARATION_STARTED',
          payload: {
            stdout: 'secret output',
            promptText: 'do not leak',
            absolutePath: 'D:\\projects2\\buiderAI\\secret.ts',
          },
        },
        {
          activityId: 'not-an-activity',
          unexpectedField: 'leak-me',
        },
      ],
    });

    const response = await callGet();
    const payload = (await response.json()) as { activities: Record<string, unknown>[] };

    expect(response.status).toBe(200);
    expect(payload.activities).toHaveLength(1);
    expect(payload.activities[0]?.activityId).toBe(PREPARATION_COMPLETED.activityId);
    expect(JSON.stringify(payload)).not.toContain('stdout');
    expect(JSON.stringify(payload)).not.toContain('leak-me');
    expect(JSON.stringify(payload)).not.toContain('D:\\\\projects2');
  });

  it('rejects untrusted non-loopback requests with HTTP 403', async () => {
    const response = await callGet('https://evil.example');
    const payload = (await response.json()) as { code: string; message: string };

    expect(response.status).toBe(403);
    expect(payload.code).toBe('LOCAL_REQUEST_REJECTED');
    expect(readHistory).not.toHaveBeenCalled();
  });

  it('does not accept caller-controlled filesystem paths', async () => {
    readHistory.mockResolvedValueOnce({ schemaVersion: 1, activities: [] });

    const { GET } = await import('./route');
    const response = await GET(
      new Request(
        'http://localhost:3000/api/workspace/activity-history?historyPath=..%2F..%2Fetc%2Fpasswd',
        {
          method: 'GET',
          headers: { origin: 'http://localhost:3000' },
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(readHistory).toHaveBeenCalledTimes(1);
    const payload = (await response.json()) as { schemaVersion: number; activities: unknown[] };
    expect(payload).toEqual({ schemaVersion: 1, activities: [] });
  });

  it('returns a generic safe error envelope when the service fails unexpectedly', async () => {
    readHistory.mockRejectedValueOnce(new Error('ENOENT: unexpected disk failure at C:\\secrets'));

    const response = await callGet();
    const payload = (await response.json()) as { code: string; message: string };

    expect(response.status).toBe(500);
    expect(payload.code).toBe('INTERNAL_WORKFLOW_ERROR');
    expect(payload.message).not.toContain('C:\\');
    expect(payload.message).not.toContain('ENOENT');
  });

  it('sets Cache-Control: no-store on successful responses', async () => {
    readHistory.mockResolvedValueOnce({ schemaVersion: 1, activities: [] });

    const response = await callGet();

    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('does not expose projectRoot or raw parse details in successful responses', async () => {
    readHistory.mockResolvedValueOnce({
      schemaVersion: 1,
      activities: [PREPARATION_COMPLETED],
    });

    const response = await callGet();
    const body = await response.text();

    expect(body).not.toContain('projectRoot');
    expect(body).not.toContain('parse');
    expect(body).not.toContain('stack');
  });
});
