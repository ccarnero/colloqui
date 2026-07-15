import "../../setup-env";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { createAgentAdminKbClient } from "../../../src/modules/kb/infrastructure/agent-admin-kb-client";

const BASE_URL = "http://agent-admin-service.local";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Fixtures mirror the ACTUAL agent-admin-service controller/service DTOs
// (services/agent-admin-service/src/modules/knowledge-bases/*), NOT
// assumptions. Regression origin (T06 attempt 3): a live apply hit
// `result.value.find is not a function` because the list endpoint returns
// the ENVELOPED `{ knowledge_bases, total }` shape, while the client (and its
// hand-rolled fake in the reconcile spec) assumed a plain array. These tests
// exercise the REAL `createAgentAdminKbClient` against the enveloped shapes.

describe("createAgentAdminKbClient", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("findKbByName unwraps the enveloped { knowledge_bases, total } list response", async () => {
    globalThis.fetch = mock(async () =>
      json({
        knowledge_bases: [
          { id: "kb-1", name: "other-kb" },
          { id: "kb-2", name: "target-kb" },
        ],
        total: 2,
      })
    ) as unknown as typeof fetch;

    const client = createAgentAdminKbClient(BASE_URL);
    const result = await client.findKbByName("tenant-a", "target-kb");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ id: "kb-2", name: "target-kb" });
    }
  });

  it("findKbByName returns null (not an error) when the enveloped list has no match", async () => {
    globalThis.fetch = mock(async () =>
      json({ knowledge_bases: [{ id: "kb-1", name: "other-kb" }], total: 1 })
    ) as unknown as typeof fetch;

    const client = createAgentAdminKbClient(BASE_URL);
    const result = await client.findKbByName("tenant-a", "missing-kb");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
    }
  });

  it("findKbByName handles an empty enveloped list without throwing", async () => {
    globalThis.fetch = mock(async () =>
      json({ knowledge_bases: [], total: 0 })
    ) as unknown as typeof fetch;

    const client = createAgentAdminKbClient(BASE_URL);
    const result = await client.findKbByName("tenant-a", "any");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
    }
  });

  it("createKb reads the plain KB row response (POST returns the row directly, NOT enveloped)", async () => {
    let capturedBody: unknown;
    globalThis.fetch = mock(async (_url, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      // KnowledgeBasesService.create returns IKnowledgeBaseRow directly.
      return json(
        {
          id: "kb-new",
          name: "kb-support",
          description: null,
          icon: "library_books",
          is_active: true,
        },
        201
      );
    }) as unknown as typeof fetch;

    const client = createAgentAdminKbClient(BASE_URL);
    const result = await client.createKb("tenant-a", "kb-support");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ id: "kb-new", name: "kb-support" });
    }
    expect(capturedBody).toEqual({ name: "kb-support" });
  });

  it("listDocuments unwraps the enveloped { documents, total } response", async () => {
    globalThis.fetch = mock(async () =>
      json({
        documents: [
          { id: "doc-1", original_filename: "faq", chunk_count: 3 },
          { id: "doc-2", original_filename: "manual", chunk_count: 1 },
        ],
        total: 2,
      })
    ) as unknown as typeof fetch;

    const client = createAgentAdminKbClient(BASE_URL);
    const result = await client.listDocuments("tenant-a", "kb-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([
        { id: "doc-1", original_filename: "faq" },
        { id: "doc-2", original_filename: "manual" },
      ]);
    }
  });

  it("uploadTextDocument reads the { documentId, status } upload response", async () => {
    let capturedUrl = "";
    let capturedBody: unknown;
    globalThis.fetch = mock(async (url, init: RequestInit) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(init.body as string);
      // DocumentsController.upload returns { documentId, status }.
      return json({ documentId: "doc-new", status: "pending" }, 202);
    }) as unknown as typeof fetch;

    const client = createAgentAdminKbClient(BASE_URL);
    const result = await client.uploadTextDocument(
      "tenant-a",
      "kb-1",
      "faq",
      "hello world"
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ documentId: "doc-new" });
    }
    expect(capturedUrl).toBe(
      `${BASE_URL}/admin/knowledge-bases/kb-1/documents/upload`
    );
    expect(capturedBody).toMatchObject({
      content_text: "hello world",
      original_filename: "faq",
      content_type: "text",
    });
  });

  it("uploadFileDocument reads the { documentId, status } upload-file response", async () => {
    let capturedUrl = "";
    let capturedBody: unknown;
    globalThis.fetch = mock(async (url, init: RequestInit) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(init.body as string);
      return json({ documentId: "doc-file", status: "pending" }, 202);
    }) as unknown as typeof fetch;

    const client = createAgentAdminKbClient(BASE_URL);
    const result = await client.uploadFileDocument(
      "tenant-a",
      "kb-1",
      "manual",
      "YmFzZTY0"
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ documentId: "doc-file" });
    }
    expect(capturedUrl).toBe(
      `${BASE_URL}/admin/knowledge-bases/kb-1/documents/upload-file`
    );
    expect(capturedBody).toMatchObject({
      filename: "manual",
      file_base64: "YmFzZTY0",
      content_type: "auto",
    });
  });

  it("deleteDocument treats the 200 boolean-body DELETE response as success (no parse)", async () => {
    globalThis.fetch = mock(async () =>
      json(true, 200)
    ) as unknown as typeof fetch;

    const client = createAgentAdminKbClient(BASE_URL);
    const result = await client.deleteDocument("tenant-a", "kb-1", "doc-1");

    expect(result.ok).toBe(true);
  });

  it("surfaces a non-2xx list response as a typed error (never throws)", async () => {
    globalThis.fetch = mock(async () =>
      json({ error: "boom" }, 500)
    ) as unknown as typeof fetch;

    const client = createAgentAdminKbClient(BASE_URL);
    const result = await client.findKbByName("tenant-a", "any");

    expect(result.ok).toBe(false);
  });
});
