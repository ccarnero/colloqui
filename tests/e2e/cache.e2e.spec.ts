import { describe, it, expect, afterAll } from 'bun:test';
import { getBaseUrl, httpGet, httpPost, httpPut, httpDelete } from './helpers';

const CS = getBaseUrl('cache-service');

const skip = !process.env.CACHE_SERVICE_URL;

const createdKeys: string[] = [];

function e2eKey(suffix: string): string {
  const key = `e2e:${suffix}`;
  createdKeys.push(key);
  return key;
}

afterAll(async () => {
  if (skip) return;
  await Promise.all(createdKeys.map((k) => httpDelete(`${CS}/cache/${k}`)));
});

describe('E2E: cache-service CRUD', () => {
  it('should perform a full PUT -> GET -> DELETE -> GET cycle', async () => {
    if (skip) return;
    const key = e2eKey('crud');
    const value = { message: 'hello', num: 42 };

    const putRes = await httpPut(`${CS}/cache/${key}`, { value, ttl: 120 });
    expect(putRes.status).toBe(200);
    expect(putRes.body).toEqual({ ok: true });

    const getRes = await httpGet(`${CS}/cache/${key}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body).toEqual(value);

    const delRes = await httpDelete(`${CS}/cache/${key}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body).toEqual({ ok: true });

    const getAfter = await httpGet(`${CS}/cache/${key}`);
    expect(getAfter.status).toBe(200);
    expect(getAfter.body).toBeNull();
  });

  it('should batch get multiple keys', async () => {
    if (skip) return;
    const keys = ['batch-a', 'batch-b', 'batch-c'].map((s) => e2eKey(s));
    const values = ['alpha', 'bravo', 'charlie'];

    await Promise.all(
      keys.map((k, i) => httpPut(`${CS}/cache/${k}`, { value: values[i] })),
    );

    const batchRes = await httpPost<Record<string, unknown>>(
      `${CS}/cache/batch`,
      { keys },
    );
    expect(batchRes.status).toBe(200);

    for (let i = 0; i < keys.length; i++) {
      expect(batchRes.body[keys[i]]).toBe(values[i]);
    }
  });

  it('should overwrite an existing key', async () => {
    if (skip) return;
    const key = e2eKey('overwrite');

    await httpPut(`${CS}/cache/${key}`, { value: 'first' });
    await httpPut(`${CS}/cache/${key}`, { value: 'second' });

    const res = await httpGet(`${CS}/cache/${key}`);
    expect(res.status).toBe(200);
    expect(res.body).toBe('second');
  });

  it('should expire a key after TTL', async () => {
    if (skip) return;
    const key = e2eKey('ttl-expire');

    await httpPut(`${CS}/cache/${key}`, { value: 'ephemeral', ttl: 1 });

    const immediate = await httpGet(`${CS}/cache/${key}`);
    expect(immediate.status).toBe(200);
    expect(immediate.body).toBe('ephemeral');

    await Bun.sleep(1500);

    const afterExpiry = await httpGet(`${CS}/cache/${key}`);
    expect(afterExpiry.status).toBe(200);
    expect(afterExpiry.body).toBeNull();
  });

  it('should scan keys matching a pattern', async () => {
    if (skip) return;
    const k1 = e2eKey('scan-x');
    const k2 = e2eKey('scan-y');

    await Promise.all([
      httpPut(`${CS}/cache/${k1}`, { value: 1 }),
      httpPut(`${CS}/cache/${k2}`, { value: 2 }),
    ]);

    const res = await httpGet<string[]>(`${CS}/cache?pattern=e2e:scan-*`);
    expect(res.status).toBe(200);
    expect(res.body).toContain(k1);
    expect(res.body).toContain(k2);
  });
});
