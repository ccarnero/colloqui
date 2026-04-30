import { describe, it, expect, afterAll } from 'bun:test';
import { getBaseUrl, httpPost, httpGet, httpPatch, httpDelete, poll } from './helpers';
import { authHeaders } from './auth.setup';

const GW = getBaseUrl('api-gateway');

const createdScheduleIds: string[] = [];

afterAll(async () => {
  const h = await authHeaders();
  await Promise.all(
    createdScheduleIds.map((id) =>
      httpDelete(`${GW}/schedulers/schedules/${id}`, { headers: h }),
    ),
  );
});

/**
 * scheduler-service runs as a Knative svc with `min-scale: 0` in non-prod,
 * so the first request of the suite triggers a cold-start (~10-25s on
 * minikube). The transport layer (`helpers.ts`) already retries on 502/503,
 * but the per-test budget needs explicit headroom over the default.
 */
const COLD_START_IT = { timeout: 90_000 };

describe('E2E: scheduler-service', () => {
  let scheduleId: string;

  it(
    'should create a one-time schedule',
    async () => {
      const h = await authHeaders();
      const { status, body } = await httpPost<{ id: string; name: string; type: string }>(
        `${GW}/schedulers/schedules`,
        {
          name: `e2e-schedule-${Date.now()}`,
          type: 'one-time',
          expression: new Date(Date.now() + 3_600_000).toISOString(),
          exec_mode: 'js-inline',
          config: { script: 'return { ok: true };' },
        },
        { headers: h },
      );

      expect(status).toBe(201);
      expect(body.id).toBeDefined();
      expect(body.type).toBe('one-time');
      scheduleId = body.id;
      createdScheduleIds.push(scheduleId);
    },
    COLD_START_IT.timeout,
  );

  it('should list schedules', async () => {
    const h = await authHeaders();
    const { status, body } = await httpGet<{ data: unknown[] }>(
      `${GW}/schedulers/schedules?limit=10`,
      { headers: h },
    );

    expect(status).toBe(200);
    expect(body).toBeDefined();
  });

  it('should get a specific schedule', async () => {
    if (!scheduleId) return;
    const h = await authHeaders();
    const { status, body } = await httpGet<{ id: string; name: string }>(
      `${GW}/schedulers/schedules/${scheduleId}`,
      { headers: h },
    );

    expect(status).toBe(200);
    expect(body.id).toBe(scheduleId);
  });

  it('should update a schedule', async () => {
    if (!scheduleId) return;
    const h = await authHeaders();
    const { status, body } = await httpPatch<{ id: string; enabled: boolean }>(
      `${GW}/schedulers/schedules/${scheduleId}`,
      { enabled: false },
      { headers: h },
    );

    expect(status).toBe(200);
    expect(body.enabled).toBe(false);
  });

  it('should manually trigger a schedule', async () => {
    if (!scheduleId) return;
    const h = await authHeaders();

    const enableRes = await httpPatch(
      `${GW}/schedulers/schedules/${scheduleId}`,
      { enabled: true },
      { headers: h },
    );
    expect(enableRes.status).toBe(200);

    const { status, body } = await httpPost<{ execution_id: string }>(
      `${GW}/schedulers/schedules/${scheduleId}/trigger`,
      {},
      { headers: h },
    );

    expect(status).toBe(201);
    expect(body).toBeDefined();
  });

  it('should list executions for a schedule', async () => {
    if (!scheduleId) return;
    const h = await authHeaders();

    await Bun.sleep(2_000);

    const { status, body } = await httpGet<{ data: unknown[] }>(
      `${GW}/schedulers/schedules/${scheduleId}/executions?limit=10`,
      { headers: h },
    );

    expect(status).toBe(200);
    expect(body).toBeDefined();
  });

  it('should list all executions', async () => {
    const h = await authHeaders();
    const { status, body } = await httpGet<{ data: unknown[] }>(
      `${GW}/schedulers/executions?limit=10`,
      { headers: h },
    );

    expect(status).toBe(200);
    expect(body).toBeDefined();
  });

  it('should delete a schedule', async () => {
    if (!scheduleId) return;
    const h = await authHeaders();
    const { status } = await httpDelete(`${GW}/schedulers/schedules/${scheduleId}`, {
      headers: h,
    });

    expect(status).toBe(204);
    createdScheduleIds.splice(createdScheduleIds.indexOf(scheduleId), 1);
  });
});
