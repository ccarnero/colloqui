import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Transport,
  TransportRequestOptions,
  TransportResponse,
} from "../../../src/core/transport.js";
import { createConfigFilesClient } from "../../../src/resources/config-files/client.js";

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

const sampleFile = {
  id: "cf-1",
  name: "rules",
  path: "/config/rules.yaml",
  content: "key: value",
  format: "yaml" as const,
  version: 1,
  is_active: true,
  created_at: "2026-07-04T00:00:00.000Z",
  updated_at: "2026-07-04T00:00:00.000Z",
};

test("list() GETs /admin/config-files with real limit/offset pagination ({files,total})", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { files: [sampleFile], total: 1 },
  }));
  const client = createConfigFilesClient({ transport });

  const seen: unknown[] = [];
  for await (const f of client.list()) {
    seen.push(f);
  }
  assert.equal(calls[0]!.path, "/admin/config-files?limit=50&offset=0");
  assert.deepEqual(seen, [sampleFile]);
});

test("getByPath() GETs /admin/config-files/file with the path query param", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: sampleFile,
  }));
  const client = createConfigFilesClient({ transport });

  const result = await client.getByPath("/config/rules.yaml");
  assert.equal(
    calls[0]!.path,
    "/admin/config-files/file?path=%2Fconfig%2Frules.yaml"
  );
  assert.equal(calls[0]!.method, "GET");
  assert.deepEqual(result, sampleFile);
});

test("upsert() PUTs /admin/config-files with the fixed {name,path,content,format} shape", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: sampleFile,
  }));
  const client = createConfigFilesClient({ transport });

  const result = await client.upsert({
    name: "rules",
    path: "/config/rules.yaml",
    content: "key: value",
    format: "yaml",
  });
  assert.equal(calls[0]!.path, "/admin/config-files");
  assert.equal(calls[0]!.method, "PUT");
  assert.deepEqual(calls[0]!.body, {
    name: "rules",
    path: "/config/rules.yaml",
    content: "key: value",
    format: "yaml",
  });
  assert.deepEqual(result, sampleFile);
});

test("deploy() POSTs /admin/config-files/deploy with deletePaths", async () => {
  const deployResult = { files: [sampleFile], eventEmitted: true };
  const { transport, calls } = fakeTransport(() => ({
    status: 201,
    body: deployResult,
  }));
  const client = createConfigFilesClient({ transport });

  const result = await client.deploy({ deletePaths: ["/config/old.yaml"] });
  assert.equal(calls[0]!.path, "/admin/config-files/deploy");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(calls[0]!.body, { deletePaths: ["/config/old.yaml"] });
  assert.deepEqual(result, deployResult);
});

test("runtimeStatus() GETs /admin/runtime/status", async () => {
  const status = {
    configured: true,
    connected_runtimes: ["runtime-1"],
  };
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: status,
  }));
  const client = createConfigFilesClient({ transport });

  const result = await client.runtimeStatus();
  assert.equal(calls[0]!.path, "/admin/runtime/status");
  assert.equal(calls[0]!.method, "GET");
  assert.deepEqual(result, status);
});

test("templates() GETs /admin/templates and unwraps the {templates} envelope", async () => {
  const templates = [
    {
      id: "tpl-1",
      label: "Support Agent",
      name: "support-agent",
      description: "desc",
      system_prompt: "prompt",
      rules: "rules",
      soul: "soul",
      subagents: [],
    },
  ];
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { templates },
  }));
  const client = createConfigFilesClient({ transport });

  const result = await client.templates();
  assert.equal(calls[0]!.path, "/admin/templates");
  assert.equal(calls[0]!.method, "GET");
  assert.deepEqual(result, templates);
});
