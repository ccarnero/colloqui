import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Transport,
  TransportRequestOptions,
  TransportResponse,
} from "../../../src/core/transport.js";
import { createTenantsClient } from "../../../src/resources/tenants/client.js";

interface Call extends TransportRequestOptions {}

function fakeTransport(
  handler: (
    call: Call
  ) => TransportResponse<unknown> | Promise<TransportResponse<unknown>>
): { transport: Transport; calls: Call[] } {
  const calls: Call[] = [];
  const transport: Transport = {
    async request(options) {
      calls.push(options);
      return (await handler(options)) as TransportResponse<never>;
    },
  };
  return { transport, calls };
}

const acceptedTenant = {
  id: "t-1",
  name: "sdk-e2e-fin",
  tier: "shared" as const,
  provisioningStatus: "pending" as const,
  statusUrl: "/tenants/sdk-e2e-fin",
};

const tenantDetail = {
  id: "t-1",
  name: "sdk-e2e-fin",
  tier: "shared" as const,
  configuration: {},
  namespaces: [],
  provisioningStatus: "active" as const,
  provisioningError: null,
  provisioningStartedAt: null,
  provisioningCompletedAt: null,
  createdAt: "2026-07-04T00:00:00.000Z",
  updatedAt: "2026-07-04T00:00:00.000Z",
};

test("create() POSTs /tenants with the input body and returns the 202 accepted body", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 202,
    body: acceptedTenant,
  }));
  const client = createTenantsClient({ transport });

  const result = await client.create({ name: "sdk-e2e-fin" });
  assert.equal(calls[0]!.path, "/tenants");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(calls[0]!.body, { name: "sdk-e2e-fin" });
  assert.deepEqual(result, acceptedTenant);
});

test("list() GETs /tenants and degrades the bare array to a single page", async () => {
  const items = [
    {
      id: "t-1",
      name: "acme",
      environment: "dev",
      configuration: {},
      provisioningStatus: "active" as const,
      tier: "shared" as const,
    },
  ];
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: items,
  }));
  const client = createTenantsClient({ transport });

  const seen: unknown[] = [];
  for await (const t of client.list()) {
    seen.push(t);
  }
  assert.equal(calls[0]!.path, "/tenants");
  assert.equal(calls[0]!.method, "GET");
  assert.deepEqual(seen, items);
});

test("get() GETs /tenants/:nameOrId", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: tenantDetail,
  }));
  const client = createTenantsClient({ transport });

  const result = await client.get("acme");
  assert.equal(calls[0]!.path, "/tenants/acme");
  assert.equal(calls[0]!.method, "GET");
  assert.deepEqual(result, tenantDetail);
});

test("update() PATCHes /tenants/:name (not :nameOrId)", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: tenantDetail,
  }));
  const client = createTenantsClient({ transport });

  await client.update("sdk-e2e-fin", { configuration: { flag: true } });
  assert.equal(calls[0]!.path, "/tenants/sdk-e2e-fin");
  assert.equal(calls[0]!.method, "PATCH");
  assert.deepEqual(calls[0]!.body, { configuration: { flag: true } });
});

test("remove() DELETEs /tenants/:name and resolves with no value", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 204,
    body: undefined,
  }));
  const client = createTenantsClient({ transport });

  const result = await client.remove("sdk-e2e-fin");
  assert.equal(calls[0]!.path, "/tenants/sdk-e2e-fin");
  assert.equal(calls[0]!.method, "DELETE");
  assert.equal(result, undefined);
});

test("update() URL-encodes the name in the path", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: tenantDetail,
  }));
  const client = createTenantsClient({ transport });
  await client.update("needs encoding", { configuration: {} });
  assert.equal(calls[0]!.path, "/tenants/needs%20encoding");
});
