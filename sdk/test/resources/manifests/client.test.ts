import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Transport,
  TransportRequestOptions,
  TransportResponse,
} from "../../../src/core/transport.js";
import { ConflictError, NotFoundError } from "../../../src/domain/errors.js";
import { createManifestsClient } from "../../../src/resources/manifests/client.js";

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
    async requestStream() {
      throw new Error("not used in this test");
    },
  };
  return { transport, calls };
}

const sampleManifest = {
  apiVersion: "provisioning.yoizen.io/v1",
  kind: "IntegrationManifest",
  metadata: { name: "support-bot" },
  spec: {
    channels: [{ name: "http-in", type: "http" }],
    agents: [{ name: "bot" }],
  },
};

const sampleRevision = {
  id: "rev-1",
  tenantId: "acme",
  name: "support-bot",
  revision: 1,
  manifest: sampleManifest,
  createdAt: "2026-07-15T00:00:00.000Z",
};

test("validate() POSTs /provisioning/manifests/validate with the manifest object as the body", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { valid: true, errors: [] },
  }));
  const client = createManifestsClient({ transport });

  const result = await client.validate(sampleManifest);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.path, "/provisioning/manifests/validate");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(calls[0]!.body, sampleManifest);
  assert.deepEqual(result, { valid: true, errors: [] });
});

test("validate() never throws for a structurally invalid manifest — returns valid:false with typed errors", async () => {
  const errors = [
    {
      path: "spec.channels",
      message: "at least one inbound channel is required",
    },
  ];
  const { transport } = fakeTransport(() => ({
    status: 200,
    body: { valid: false, errors },
  }));
  const client = createManifestsClient({ transport });

  const result = await client.validate({ kind: "IntegrationManifest" });
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, errors);
});

test("validate() accepts a per-call retry override", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { valid: true, errors: [] },
  }));
  const client = createManifestsClient({ transport });

  await client.validate(sampleManifest, { retry: false });
  assert.equal(calls[0]!.retry, false);
});

test("put() PUTs /provisioning/manifests/:name with the manifest body and returns the stored revision", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: sampleRevision,
  }));
  const client = createManifestsClient({ transport });

  const result = await client.put("support-bot", sampleManifest);
  assert.equal(calls[0]!.path, "/provisioning/manifests/support-bot");
  assert.equal(calls[0]!.method, "PUT");
  assert.deepEqual(calls[0]!.body, sampleManifest);
  assert.deepEqual(result, sampleRevision);
});

test("put() URL-encodes the manifest name in the path", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: sampleRevision,
  }));
  const client = createManifestsClient({ transport });

  await client.put("needs encoding/x", sampleManifest);
  assert.equal(calls[0]!.path, "/provisioning/manifests/needs%20encoding%2Fx");
});

test("get() GETs /provisioning/manifests/:name and returns the stored revision", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: sampleRevision,
  }));
  const client = createManifestsClient({ transport });

  const result = await client.get("support-bot");
  assert.equal(calls[0]!.path, "/provisioning/manifests/support-bot");
  assert.equal(calls[0]!.method, "GET");
  assert.deepEqual(result, sampleRevision);
});

test("get() propagates NotFoundError for an unknown manifest name (404)", async () => {
  const { transport } = fakeTransport(() => {
    throw new NotFoundError("request failed: not found");
  });
  const client = createManifestsClient({ transport });

  await assert.rejects(() => client.get("missing"), NotFoundError);
});

test("plan() POSTs /provisioning/manifests/:name/plan with no body and returns the plan", async () => {
  const plan = {
    manifestName: "support-bot",
    resources: [
      {
        kind: "channel",
        name: "http-in",
        external: false,
        verdict: "create",
        diff: [],
      },
    ],
    preconditions: [],
  };
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: plan,
  }));
  const client = createManifestsClient({ transport });

  const result = await client.plan("support-bot");
  assert.equal(calls[0]!.path, "/provisioning/manifests/support-bot/plan");
  assert.equal(calls[0]!.method, "POST");
  assert.equal(calls[0]!.body, undefined);
  assert.deepEqual(result, plan);
});

test("plan() propagates ConflictError for a dependency cycle (409)", async () => {
  const { transport } = fakeTransport(() => {
    throw new ConflictError("request failed: conflict");
  });
  const client = createManifestsClient({ transport });

  await assert.rejects(() => client.plan("support-bot"), ConflictError);
});

test("apply() POSTs /provisioning/manifests/:name/apply with an empty body when no bundle is passed", async () => {
  const applyResult = {
    manifestName: "support-bot",
    resources: [],
    appliedCount: 0,
    noopCount: 0,
    durationMs: 12,
  };
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: applyResult,
  }));
  const client = createManifestsClient({ transport });

  const result = await client.apply("support-bot");
  assert.equal(calls[0]!.path, "/provisioning/manifests/support-bot/apply");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(calls[0]!.body, {});
  assert.deepEqual(result, applyResult);
});

test("apply() base64-encodes the bundle bytes into { bundle: { contentBase64 } }", async () => {
  const applyResult = {
    manifestName: "support-bot",
    resources: [],
    appliedCount: 1,
    noopCount: 0,
    durationMs: 20,
  };
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: applyResult,
  }));
  const client = createManifestsClient({ transport });

  const tarBytes = new TextEncoder().encode("fake-tar-bytes");
  await client.apply("support-bot", { bundle: tarBytes });

  assert.equal(calls[0]!.path, "/provisioning/manifests/support-bot/apply");
  const expectedBase64 = Buffer.from(tarBytes).toString("base64");
  assert.deepEqual(calls[0]!.body, {
    bundle: { contentBase64: expectedBase64 },
  });
});

test("apply() propagates NotFoundError for an unknown manifest name (404)", async () => {
  const { transport } = fakeTransport(() => {
    throw new NotFoundError("request failed: not found");
  });
  const client = createManifestsClient({ transport });

  await assert.rejects(() => client.apply("missing"), NotFoundError);
});

test("apply() propagates ConflictError for a cycle or partial-failure apply result (409)", async () => {
  const { transport } = fakeTransport(() => {
    throw new ConflictError("request failed: conflict");
  });
  const client = createManifestsClient({ transport });

  await assert.rejects(() => client.apply("support-bot"), ConflictError);
});

test("undeploy() POSTs /provisioning/manifests/:name/undeploy with no body and returns the report", async () => {
  const report = {
    manifestName: "support-bot",
    resources: [
      {
        kind: "channel",
        name: "http-in",
        action: "deleted",
        externalId: "acc-1",
      },
    ],
    secrets: [
      {
        name: "telegram-bot-token",
        scope: { kind: "channel", owner: "http-in" },
        action: "deleted",
      },
    ],
    deletedCount: 1,
    notFoundCount: 0,
    skippedCount: 0,
    checksumRowsDeleted: 0,
    manifestRecordDeleted: true,
    durationMs: 12,
  };
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: report,
  }));
  const client = createManifestsClient({ transport });

  const result = await client.undeploy("support-bot");
  assert.equal(calls[0]!.path, "/provisioning/manifests/support-bot/undeploy");
  assert.equal(calls[0]!.method, "POST");
  assert.equal(calls[0]!.body, undefined);
  assert.deepEqual(result, report);
});

test("undeploy() URL-encodes the manifest name in the path", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: {
      manifestName: "needs encoding/x",
      resources: [],
      secrets: [],
      deletedCount: 0,
      notFoundCount: 0,
      skippedCount: 0,
      checksumRowsDeleted: 0,
      manifestRecordDeleted: true,
      durationMs: 1,
    },
  }));
  const client = createManifestsClient({ transport });

  await client.undeploy("needs encoding/x");
  assert.equal(
    calls[0]!.path,
    "/provisioning/manifests/needs%20encoding%2Fx/undeploy"
  );
});

test("undeploy() propagates NotFoundError (404) — the already-undeployed case the CLI renders as such", async () => {
  const { transport } = fakeTransport(() => {
    throw new NotFoundError("request failed: not found");
  });
  const client = createManifestsClient({ transport });

  await assert.rejects(() => client.undeploy("missing"), NotFoundError);
});

test("undeploy() propagates ConflictError (409 undeploy_blocked / partial run)", async () => {
  const { transport } = fakeTransport(() => {
    throw new ConflictError("request failed: conflict");
  });
  const client = createManifestsClient({ transport });

  await assert.rejects(() => client.undeploy("support-bot"), ConflictError);
});

test("undeploy() forwards a per-call retry override", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: {
      manifestName: "support-bot",
      resources: [],
      secrets: [],
      deletedCount: 0,
      notFoundCount: 0,
      skippedCount: 0,
      checksumRowsDeleted: 0,
      manifestRecordDeleted: true,
      durationMs: 1,
    },
  }));
  const client = createManifestsClient({ transport });

  await client.undeploy("support-bot", { retry: false });
  assert.equal(calls[0]!.retry, false);
});

test("apply() forwards a per-call retry override alongside the bundle", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: {
      manifestName: "support-bot",
      resources: [],
      appliedCount: 0,
      noopCount: 0,
      durationMs: 1,
    },
  }));
  const client = createManifestsClient({ transport });

  await client.apply("support-bot", { retry: false });
  assert.equal(calls[0]!.retry, false);
});
