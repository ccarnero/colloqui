import { describe, it, expect } from 'bun:test';
import { getBaseUrl, httpPost, httpGet, poll } from './helpers';

const GW = getBaseUrl('api-gateway');

interface PublishResponse {
  id: string;
  status: string;
}

interface ProcessedResult {
  eventId: string;
  type: string;
  processed: boolean;
  timestamp: number;
}

async function publishAndWaitForResult(
  type: string,
  payload: object,
): Promise<{ eventId: string; result: ProcessedResult }> {
  const { status, body } = await httpPost<PublishResponse>(`${GW}/events`, {
    type,
    payload,
  });
  expect(status).toBe(202);
  expect(body.status).toBe('accepted');
  const eventId = body.id;

  const result = await poll<ProcessedResult>(async () => {
    const res = await httpGet<ProcessedResult>(`${GW}/results/${eventId}`);
    if (res.status === 200) return res.body;
    return null;
  }, { timeoutMs: 30_000 });

  return { eventId, result };
}

describe('E2E: full event flow', () => {
  it('should process a "created" event end-to-end', async () => {
    const { eventId, result } = await publishAndWaitForResult('created', {
      name: 'e2e-test',
    });

    expect(result.eventId).toBe(eventId);
    expect(result.type).toBe('created');
    expect(result.processed).toBe(true);
    expect(typeof result.timestamp).toBe('number');
  });

  it('should process an "updated" event end-to-end', async () => {
    const { eventId, result } = await publishAndWaitForResult('updated', {
      field: 'status',
    });

    expect(result.eventId).toBe(eventId);
    expect(result.type).toBe('updated');
    expect(result.processed).toBe(true);
  });

  it('should process an "deleted" event end-to-end', async () => {
    const { eventId, result } = await publishAndWaitForResult('deleted', {
      reason: 'cleanup',
    });

    expect(result.eventId).toBe(eventId);
    expect(result.type).toBe('deleted');
    expect(result.processed).toBe(true);
  });

  it('should handle unknown event type with truthy payload', async () => {
    const { result } = await publishAndWaitForResult('custom-action', {
      data: 42,
    });

    expect(result.type).toBe('custom-action');
    expect(result.processed).toBe(true);
  });

  it('should process multiple events concurrently', async () => {
    const count = 5;
    const promises = Array.from({ length: count }, (_, i) =>
      publishAndWaitForResult('created', { index: i }),
    );

    const results = await Promise.all(promises);

    const ids = new Set(results.map((r) => r.eventId));
    expect(ids.size).toBe(count);

    for (const { result } of results) {
      expect(result.processed).toBe(true);
      expect(result.type).toBe('created');
    }
  });

  it('should return 404 for a nonexistent result', async () => {
    const { status } = await httpGet(`${GW}/results/nonexistent-e2e-id`);
    expect(status).toBe(404);
  });
});
