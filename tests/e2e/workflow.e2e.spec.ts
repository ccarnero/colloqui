import { describe, it, expect } from 'bun:test';
import { getBaseUrl, httpPost, httpGet, poll } from './helpers';
import { authHeaders } from './auth.setup';

const GW = getBaseUrl('api-gateway');

describe('E2E: workflow-service', () => {
  let workflowId: string;

  it('should start a workflow', async () => {
    const h = await authHeaders();
    const { status, body } = await httpPost<{ workflowId: string }>(
      `${GW}/workflows`,
      {
        name: `e2e-workflow-${Date.now()}`,
        application: 'e2e-tests',
        request: { input: 'hello' },
        actions: [
          {
            activity: 'jsFunction',
            name: 'greet',
            args: { code: '(ctx) => ({ greeting: "hello from e2e" })' },
          },
        ],
      },
      { headers: h },
    );

    expect(status).toBe(202);
    expect(body.workflowId).toBeDefined();
    workflowId = body.workflowId;
  });

  it('should list workflows', async () => {
    const h = await authHeaders();
    const { status, body } = await httpGet<unknown[]>(`${GW}/workflows`, { headers: h });

    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('should get workflow status and poll until completion', async () => {
    if (!workflowId) return;
    const h = await authHeaders();

    const result = await poll(
      async () => {
        const { status, body } = await httpGet<{ workflowId: string; status: string }>(
          `${GW}/workflows/${workflowId}`,
          { headers: h },
        );
        if (status !== 200) return null;
        if (body.status === 'COMPLETED' || body.status === 'FAILED') return body;
        return null;
      },
      { timeoutMs: 60_000, initialDelayMs: 500, maxDelayMs: 3_000 },
    );

    expect(result.workflowId).toBe(workflowId);
    expect(result.status).toBe('COMPLETED');
  });

  it('should return 404 for a nonexistent workflow', async () => {
    const h = await authHeaders();
    const { status } = await httpGet(`${GW}/workflows/nonexistent-e2e-wf`, { headers: h });

    expect(status).toBe(404);
  });
});
