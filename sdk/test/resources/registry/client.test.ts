import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Transport,
  TransportRequestOptions,
  TransportResponse,
} from "../../../src/core/transport.js";
import { NotFoundError } from "../../../src/domain/errors.js";
import { createRegistryClient } from "../../../src/resources/registry/client.js";

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

const sampleService = {
  id: "svc-1",
  tenantId: "acme",
  name: "sdk-e2e-cr-svc",
  image: "gcr.io/example/hello:latest",
  port: 8080,
  minScale: 0,
  maxScale: 3,
  concurrencyTarget: 50,
  envVars: {},
  status: "active",
  knativeName: "sdk-e2e-cr-svc-acme",
  namespace: "acme-dev",
  createdAt: "2026-07-04T00:00:00.000Z",
  updatedAt: "2026-07-04T00:00:00.000Z",
};

test("services.create() POSTs /registry/services with the input body", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 201,
    body: sampleService,
  }));
  const client = createRegistryClient({ transport });

  const result = await client.services.create({
    name: "sdk-e2e-cr-svc",
    image: "gcr.io/example/hello:latest",
  });

  assert.equal(calls[0]!.path, "/registry/services");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(result, sampleService);
});

test("services.list() GETs /registry/services and degrades to a single page", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: [sampleService],
  }));
  const client = createRegistryClient({ transport });

  const seen: unknown[] = [];
  for await (const svc of client.services.list()) {
    seen.push(svc);
  }

  assert.equal(calls[0]!.path, "/registry/services");
  assert.deepEqual(seen, [sampleService]);
});

test("services.get() GETs /registry/services/:id", async () => {
  const detail = { ...sampleService, knativeStatus: { url: "http://x" } };
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: detail,
  }));
  const client = createRegistryClient({ transport });

  const result = await client.services.get("svc-1");
  assert.equal(calls[0]!.path, "/registry/services/svc-1");
  assert.deepEqual(result, detail);
});

test("services.get() propagates transport errors unchanged (error-mapping passthrough)", async () => {
  const { transport } = fakeTransport(() => {
    throw new NotFoundError("request failed: not found");
  });
  const client = createRegistryClient({ transport });

  await assert.rejects(() => client.services.get("missing"), NotFoundError);
});

test("services.update() PATCHes /registry/services/:id with the input body", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { ...sampleService, image: "gcr.io/example/hello:v2" },
  }));
  const client = createRegistryClient({ transport });

  await client.services.update("svc-1", { image: "gcr.io/example/hello:v2" });
  assert.equal(calls[0]!.path, "/registry/services/svc-1");
  assert.equal(calls[0]!.method, "PATCH");
  assert.deepEqual(calls[0]!.body, { image: "gcr.io/example/hello:v2" });
});

test("services.remove() DELETEs /registry/services/:id and resolves with no value", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 204,
    body: undefined,
  }));
  const client = createRegistryClient({ transport });

  const result = await client.services.remove("svc-1");
  assert.equal(calls[0]!.path, "/registry/services/svc-1");
  assert.equal(calls[0]!.method, "DELETE");
  assert.equal(result, undefined);
});

test("services.remove() URL-encodes the service id in the path", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 204,
    body: undefined,
  }));
  const client = createRegistryClient({ transport });
  await client.services.remove("svc/needs encoding");
  assert.equal(calls[0]!.path, "/registry/services/svc%2Fneeds%20encoding");
});

test("services.listRevisions() GETs /registry/services/:id/revisions and degrades to a single page", async () => {
  const revision = {
    name: "sdk-e2e-cr-svc-acme-00001",
    ready: true,
    createdAt: "2026-07-04T00:00:00.000Z",
    image: "gcr.io/example/hello:latest",
  };
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: [revision],
  }));
  const client = createRegistryClient({ transport });

  const seen: unknown[] = [];
  for await (const rev of client.services.listRevisions("svc-1")) {
    seen.push(rev);
  }

  assert.equal(calls[0]!.path, "/registry/services/svc-1/revisions");
  assert.deepEqual(seen, [revision]);
});

const sampleCanary = {
  id: "canary-1",
  serviceId: "svc-1",
  stableRevision: "svc-acme-00001",
  canaryRevision: "svc-acme-00002",
  canaryPercent: 20,
  status: "progressing",
  createdAt: "2026-07-04T00:00:00.000Z",
  updatedAt: "2026-07-04T00:00:00.000Z",
};

test("canary.start() POSTs /registry/services/:serviceId/canary with the input body", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 201,
    body: sampleCanary,
  }));
  const client = createRegistryClient({ transport });

  const result = await client.canary.start("svc-1", {
    image: "gcr.io/example/hello:v2",
    percent: 20,
  });

  assert.equal(calls[0]!.path, "/registry/services/svc-1/canary");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(result, sampleCanary);
});

test("canary.update() PATCHes /registry/services/:serviceId/canary with the input body", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { ...sampleCanary, canaryPercent: 50 },
  }));
  const client = createRegistryClient({ transport });

  await client.canary.update("svc-1", { percent: 50 });
  assert.equal(calls[0]!.path, "/registry/services/svc-1/canary");
  assert.equal(calls[0]!.method, "PATCH");
  assert.deepEqual(calls[0]!.body, { percent: 50 });
});

test("canary.promote() POSTs /registry/services/:serviceId/canary/promote", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { ...sampleCanary, status: "promoted", canaryPercent: 100 },
  }));
  const client = createRegistryClient({ transport });

  await client.canary.promote("svc-1");
  assert.equal(calls[0]!.path, "/registry/services/svc-1/canary/promote");
  assert.equal(calls[0]!.method, "POST");
});

test("canary.rollback() POSTs /registry/services/:serviceId/canary/rollback", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { ...sampleCanary, status: "rolled_back", canaryPercent: 0 },
  }));
  const client = createRegistryClient({ transport });

  await client.canary.rollback("svc-1");
  assert.equal(calls[0]!.path, "/registry/services/svc-1/canary/rollback");
  assert.equal(calls[0]!.method, "POST");
});

test("canary.getStatus() GETs /registry/services/:serviceId/canary and returns null when absent", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: null,
  }));
  const client = createRegistryClient({ transport });

  const result = await client.canary.getStatus("svc-1");
  assert.equal(calls[0]!.path, "/registry/services/svc-1/canary");
  assert.equal(calls[0]!.method, "GET");
  assert.equal(result, null);
});

const sampleRoute = {
  id: "route-1",
  serviceId: "svc-1",
  pathPrefix: "/sdk-e2e-cr/fake-route",
  methods: ["GET"],
  isPublic: false,
  stripPrefix: true,
  createdAt: "2026-07-04T00:00:00.000Z",
};

test("routes.create() POSTs /registry/services/:serviceId/routes with the input body", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 201,
    body: sampleRoute,
  }));
  const client = createRegistryClient({ transport });

  const result = await client.routes.create("svc-1", {
    pathPrefix: "/sdk-e2e-cr/fake-route",
    methods: ["GET"],
  });

  assert.equal(calls[0]!.path, "/registry/services/svc-1/routes");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(result, sampleRoute);
});

test("routes.list() GETs /registry/services/:serviceId/routes and degrades to a single page", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: [sampleRoute],
  }));
  const client = createRegistryClient({ transport });

  const seen: unknown[] = [];
  for await (const route of client.routes.list("svc-1")) {
    seen.push(route);
  }

  assert.equal(calls[0]!.path, "/registry/services/svc-1/routes");
  assert.deepEqual(seen, [sampleRoute]);
});

test("routes.remove() DELETEs /registry/services/:serviceId/routes/:routeId", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 204,
    body: undefined,
  }));
  const client = createRegistryClient({ transport });

  const result = await client.routes.remove("svc-1", "route-1");
  assert.equal(calls[0]!.path, "/registry/services/svc-1/routes/route-1");
  assert.equal(calls[0]!.method, "DELETE");
  assert.equal(result, undefined);
});

test("discoverRoutes() GETs /registry/routes and degrades the bare array to a single page", async () => {
  const discovered = {
    id: "route-1",
    tenantId: "acme",
    serviceName: "sdk-e2e-cr-svc",
    knativeName: "sdk-e2e-cr-svc-acme",
    namespace: "acme-dev",
    port: 80,
    pathPrefix: "/sdk-e2e-cr/fake-route",
    methods: ["GET"],
    isPublic: false,
    stripPrefix: true,
  };
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: [discovered],
  }));
  const client = createRegistryClient({ transport });

  const seen: unknown[] = [];
  for await (const route of client.discoverRoutes()) {
    seen.push(route);
  }

  assert.equal(calls[0]!.path, "/registry/routes");
  assert.deepEqual(seen, [discovered]);
});
