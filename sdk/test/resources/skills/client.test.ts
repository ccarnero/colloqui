import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Transport,
  TransportRequestOptions,
  TransportResponse,
} from "../../../src/core/transport.js";
import { NotFoundError } from "../../../src/domain/errors.js";
import { createSkillsClient } from "../../../src/resources/skills/client.js";

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

const sampleSkill = {
  id: "skill-1",
  name: "SDK test skill",
  description: "",
  system_prompt: "You are a helpful assistant.",
  icon: "smart_toy",
  color: "#42a5f5",
  trigger_commands: [],
  when_to_use: "",
  priority: 0,
  allowed_tools: [],
  mode: "llm_driven",
  files: [],
  metadata: {},
  is_active: true,
  created_at: "2026-07-04T00:00:00.000Z",
  updated_at: "2026-07-04T00:00:00.000Z",
};

test("create() POSTs /admin/skills with the input body", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 201,
    body: sampleSkill,
  }));
  const client = createSkillsClient({ transport });

  const result = await client.create({
    name: "SDK test skill",
    system_prompt: "You are a helpful assistant.",
  });

  assert.equal(calls[0]!.path, "/admin/skills");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(result, sampleSkill);
});

test("list() GETs /admin/skills with limit/offset and adapts { skills, total } via toOffsetPage", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { skills: [sampleSkill], total: 1 },
  }));
  const client = createSkillsClient({ transport });

  const seen: unknown[] = [];
  for await (const skill of client.list()) {
    seen.push(skill);
  }

  assert.equal(calls[0]!.path, "/admin/skills?limit=50&offset=0");
  assert.deepEqual(seen, [sampleSkill]);
});

test("list() forwards a custom pageSize/startOffset", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { skills: [], total: 0 },
  }));
  const client = createSkillsClient({ transport });

  await client.list({ pageSize: 10, startOffset: 20 }).page();
  assert.equal(calls[0]!.path, "/admin/skills?limit=10&offset=20");
});

test("get() GETs /admin/skills/:id and returns null when the downstream returns null", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: null,
  }));
  const client = createSkillsClient({ transport });

  const result = await client.get("missing");
  assert.equal(calls[0]!.path, "/admin/skills/missing");
  assert.equal(calls[0]!.method, "GET");
  assert.equal(result, null);
});

test("get() propagates transport errors unchanged (error-mapping passthrough)", async () => {
  const { transport } = fakeTransport(() => {
    throw new NotFoundError("request failed: not found");
  });
  const client = createSkillsClient({ transport });

  await assert.rejects(() => client.get("skill-1"), NotFoundError);
});

test("update() PATCHes /admin/skills/:id with the input body", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { ...sampleSkill, name: "renamed" },
  }));
  const client = createSkillsClient({ transport });

  const result = await client.update("skill-1", { name: "renamed" });
  assert.equal(calls[0]!.path, "/admin/skills/skill-1");
  assert.equal(calls[0]!.method, "PATCH");
  assert.deepEqual(calls[0]!.body, { name: "renamed" });
  assert.equal(result!.name, "renamed");
});

test("remove() DELETEs /admin/skills/:id and returns the bare boolean body", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: true,
  }));
  const client = createSkillsClient({ transport });

  const result = await client.remove("skill-1");
  assert.equal(calls[0]!.path, "/admin/skills/skill-1");
  assert.equal(calls[0]!.method, "DELETE");
  assert.equal(result, true);
});
