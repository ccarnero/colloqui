import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Transport,
  TransportRequestOptions,
  TransportResponse,
} from "../../../src/core/transport.js";
import { NotFoundError } from "../../../src/domain/errors.js";
import { createKnowledgeBasesClient } from "../../../src/resources/knowledge-bases/client.js";

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

const sampleKb = {
  id: "kb-1",
  name: "SDK test KB",
  description: null,
  project: null,
  category: null,
  icon: "library_books",
  ingestion_config: null,
  is_active: true,
  created_at: "2026-07-04T00:00:00.000Z",
  updated_at: "2026-07-04T00:00:00.000Z",
};

test("create() POSTs /admin/knowledge-bases with the input body", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 201,
    body: sampleKb,
  }));
  const client = createKnowledgeBasesClient({ transport });

  const result = await client.create({ name: "SDK test KB" });

  assert.equal(calls[0]!.path, "/admin/knowledge-bases");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(calls[0]!.body, { name: "SDK test KB" });
  assert.deepEqual(result, sampleKb);
});

test("list() GETs /admin/knowledge-bases with limit/offset and adapts { knowledge_bases, total } via toOffsetPage", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { knowledge_bases: [sampleKb], total: 1 },
  }));
  const client = createKnowledgeBasesClient({ transport });

  const seen: unknown[] = [];
  for await (const kb of client.list()) {
    seen.push(kb);
  }

  assert.equal(calls[0]!.path, "/admin/knowledge-bases?limit=50&offset=0");
  assert.deepEqual(seen, [sampleKb]);
});

test("get() GETs /admin/knowledge-bases/:id and returns null when the downstream returns null", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: null,
  }));
  const client = createKnowledgeBasesClient({ transport });

  const result = await client.get("missing");
  assert.equal(calls[0]!.path, "/admin/knowledge-bases/missing");
  assert.equal(calls[0]!.method, "GET");
  assert.equal(result, null);
});

test("get() propagates transport errors unchanged (error-mapping passthrough)", async () => {
  const { transport } = fakeTransport(() => {
    throw new NotFoundError("request failed: not found");
  });
  const client = createKnowledgeBasesClient({ transport });

  await assert.rejects(() => client.get("kb-1"), NotFoundError);
});

test("update() PATCHes /admin/knowledge-bases/:id with the input body", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { ...sampleKb, name: "renamed" },
  }));
  const client = createKnowledgeBasesClient({ transport });

  const result = await client.update("kb-1", { name: "renamed" });
  assert.equal(calls[0]!.path, "/admin/knowledge-bases/kb-1");
  assert.equal(calls[0]!.method, "PATCH");
  assert.deepEqual(calls[0]!.body, { name: "renamed" });
  assert.equal(result!.name, "renamed");
});

test("remove() DELETEs /admin/knowledge-bases/:id and returns the bare boolean body", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: true,
  }));
  const client = createKnowledgeBasesClient({ transport });

  const result = await client.remove("kb-1");
  assert.equal(calls[0]!.path, "/admin/knowledge-bases/kb-1");
  assert.equal(calls[0]!.method, "DELETE");
  assert.equal(result, true);
});

const sampleDoc = {
  id: "doc-1",
  tenant_id: "acme",
  knowledge_base_id: "kb-1",
  original_filename: "notes.txt",
  mime_type: "text/plain",
  content_type: "text",
  content_text: "hello world",
  file_size: 11,
  chunk_count: 0,
  status: "pending",
  error_message: null,
  is_active: true,
  created_at: "2026-07-04T00:00:00.000Z",
  updated_at: "2026-07-04T00:00:00.000Z",
};

test("documents.list() GETs /admin/knowledge-bases/:kbId/documents and unwraps { documents } as a single page", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { documents: [sampleDoc], total: 1 },
  }));
  const client = createKnowledgeBasesClient({ transport });

  const seen: unknown[] = [];
  for await (const doc of client.documents.list("kb-1")) {
    seen.push(doc);
  }

  assert.equal(calls[0]!.path, "/admin/knowledge-bases/kb-1/documents");
  assert.equal(calls[0]!.method, "GET");
  assert.deepEqual(seen, [sampleDoc]);
});

test("documents.get() GETs /admin/knowledge-bases/:kbId/documents/:id and returns null when not found", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: null,
  }));
  const client = createKnowledgeBasesClient({ transport });

  const result = await client.documents.get("kb-1", "missing");
  assert.equal(calls[0]!.path, "/admin/knowledge-bases/kb-1/documents/missing");
  assert.equal(result, null);
});

test("documents.listChunks() adapts limit/offset to page/limit and reads the real { chunks, total } envelope", async () => {
  const chunk = {
    id: "chunk-1",
    chunk_index: 0,
    content: "hello",
    char_count: 5,
    is_edited: false,
    edited_at: null,
  };
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { chunks: [chunk], total: 1, page: 1, limit: 50, total_pages: 1 },
  }));
  const client = createKnowledgeBasesClient({ transport });

  const page = await client.documents.listChunks("kb-1", "doc-1").page();
  assert.equal(
    calls[0]!.path,
    "/admin/knowledge-bases/kb-1/documents/doc-1/chunks?page=1&limit=50"
  );
  assert.deepEqual(page.items, [chunk]);
  assert.equal(page.total, 1);
  assert.equal(page.hasMore, false);
});

test("documents.listChunks() computes page from a non-zero offset", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { chunks: [], total: 120, page: 3, limit: 50, total_pages: 3 },
  }));
  const client = createKnowledgeBasesClient({ transport });

  await client.documents.listChunks("kb-1", "doc-1").page({
    limit: 50,
    offset: 100,
  });
  assert.equal(
    calls[0]!.path,
    "/admin/knowledge-bases/kb-1/documents/doc-1/chunks?page=3&limit=50"
  );
});

test("documents.updateChunk() PUTs /admin/knowledge-bases/:kbId/documents/:docId/chunks/:chunkId", async () => {
  const updated = {
    id: "chunk-1",
    chunk_index: 0,
    content: "edited",
    char_count: 6,
    is_edited: true,
    edited_at: "2026-07-04T00:00:00.000Z",
  };
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: updated,
  }));
  const client = createKnowledgeBasesClient({ transport });

  const result = await client.documents.updateChunk(
    "kb-1",
    "doc-1",
    "chunk-1",
    {
      content: "edited",
    }
  );

  assert.equal(
    calls[0]!.path,
    "/admin/knowledge-bases/kb-1/documents/doc-1/chunks/chunk-1"
  );
  assert.equal(calls[0]!.method, "PUT");
  assert.deepEqual(calls[0]!.body, { content: "edited" });
  assert.deepEqual(result, updated);
});

test("documents.upload() POSTs /admin/knowledge-bases/:kbId/documents/upload with the input body", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 202,
    body: { documentId: "doc-1", status: "pending" },
  }));
  const client = createKnowledgeBasesClient({ transport });

  const result = await client.documents.upload("kb-1", {
    content_text: "hello world",
    original_filename: "notes.txt",
    mime_type: "text/plain",
    content_type: "text",
  });

  assert.equal(calls[0]!.path, "/admin/knowledge-bases/kb-1/documents/upload");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(result, { documentId: "doc-1", status: "pending" });
});

test("documents.uploadFile() POSTs /admin/knowledge-bases/:kbId/documents/upload-file with a base64 JSON body", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 202,
    body: { documentId: "doc-2", status: "pending" },
  }));
  const client = createKnowledgeBasesClient({ transport });

  const base64 = Buffer.from("hello world", "utf-8").toString("base64");
  const result = await client.documents.uploadFile("kb-1", {
    filename: "notes.txt",
    file_base64: base64,
    content_type: "text",
  });

  assert.equal(
    calls[0]!.path,
    "/admin/knowledge-bases/kb-1/documents/upload-file"
  );
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(calls[0]!.body, {
    filename: "notes.txt",
    file_base64: base64,
    content_type: "text",
  });
  assert.deepEqual(result, { documentId: "doc-2", status: "pending" });
});

test("documents.reingest() POSTs /admin/knowledge-bases/:kbId/documents/:id/reingest", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 202,
    body: { documentId: "doc-1", status: "pending" },
  }));
  const client = createKnowledgeBasesClient({ transport });

  const result = await client.documents.reingest("kb-1", "doc-1");
  assert.equal(
    calls[0]!.path,
    "/admin/knowledge-bases/kb-1/documents/doc-1/reingest"
  );
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(result, { documentId: "doc-1", status: "pending" });
});

test("documents.remove() DELETEs /admin/knowledge-bases/:kbId/documents/:id and returns the bare boolean body", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: true,
  }));
  const client = createKnowledgeBasesClient({ transport });

  const result = await client.documents.remove("kb-1", "doc-1");
  assert.equal(calls[0]!.path, "/admin/knowledge-bases/kb-1/documents/doc-1");
  assert.equal(calls[0]!.method, "DELETE");
  assert.equal(result, true);
});
