import "../../setup-env";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { ManifestSystemVariable } from "@yoizen/shared";
import { createSystemVariablesWriter } from "../../../src/modules/apply/infrastructure/system-variables-writer";

const BASE_URL = "http://agent-admin-service.local";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createSystemVariablesWriter", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("create: POSTs name/type/value (+ label/description when present) to /admin/system-variables", async () => {
    let capturedUrl: string | undefined;
    let capturedBody: unknown;
    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init.body as string);
      return json({ id: "sysvar-1" }, 201);
    }) as unknown as typeof fetch;

    const writer = createSystemVariablesWriter(BASE_URL);
    const systemVariable: ManifestSystemVariable = {
      name: "escalation-threshold",
      type: "number",
      value: 5,
      label: "Escalation threshold",
      description: "Number of retries before escalation",
    };

    const result = await writer.create("tenant-a", systemVariable);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.externalId).toBe("sysvar-1");
    }
    expect(capturedUrl).toBe(`${BASE_URL}/admin/system-variables`);
    expect(capturedBody).toMatchObject({
      name: "escalation-threshold",
      type: "number",
      value: 5,
      label: "Escalation threshold",
      description: "Number of retries before escalation",
    });
  });

  it("create: omits label/description when absent from the manifest entry", async () => {
    let capturedBody: unknown;
    globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return json({ id: "sysvar-2" }, 201);
    }) as unknown as typeof fetch;

    const writer = createSystemVariablesWriter(BASE_URL);
    const systemVariable: ManifestSystemVariable = {
      name: "feature-flag",
      type: "boolean",
      value: true,
    };

    const result = await writer.create("tenant-a", systemVariable);
    expect(result.ok).toBe(true);
    expect(capturedBody).toEqual({
      name: "feature-flag",
      type: "boolean",
      value: true,
    });
  });

  it("create: a network failure fails loud with a typed downstream_error, never fabricating an externalId", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;

    const writer = createSystemVariablesWriter(BASE_URL);
    const systemVariable: ManifestSystemVariable = {
      name: "escalation-threshold",
      type: "number",
      value: 5,
    };

    const result = await writer.create("tenant-a", systemVariable);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("downstream_error");
      expect(result.error.resourceKind).toBe("systemVariable");
      expect(result.error.resourceName).toBe("escalation-threshold");
    }
  });

  it("create: a non-2xx HTTP response fails loud with a typed downstream_error", async () => {
    globalThis.fetch = mock(async () =>
      json({ message: "conflict" }, 409)
    ) as unknown as typeof fetch;

    const writer = createSystemVariablesWriter(BASE_URL);
    const systemVariable: ManifestSystemVariable = {
      name: "escalation-threshold",
      type: "number",
      value: 5,
    };

    const result = await writer.create("tenant-a", systemVariable);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("downstream_error");
    }
  });

  it("update: a diff with zero mappable fields is a safe no-op (no HTTP call)", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("must never call the network for a no-op diff");
    }) as unknown as typeof fetch;

    const writer = createSystemVariablesWriter(BASE_URL);
    const systemVariable: ManifestSystemVariable = {
      name: "escalation-threshold",
      type: "number",
      value: 5,
    };

    const result = await writer.update(
      "tenant-a",
      "sysvar-1",
      systemVariable,
      []
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.externalId).toBe("sysvar-1");
    }
  });

  it("update: a mappable 'value' diff issues a PATCH with only the changed fields", async () => {
    let capturedUrl: string | undefined;
    let capturedBody: unknown;
    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init.body as string);
      return json({ id: "sysvar-1" });
    }) as unknown as typeof fetch;

    const writer = createSystemVariablesWriter(BASE_URL);
    const systemVariable: ManifestSystemVariable = {
      name: "escalation-threshold",
      type: "number",
      value: 10,
    };

    const result = await writer.update("tenant-a", "sysvar-1", systemVariable, [
      { field: "value", current: 5, desired: 10 },
    ]);
    expect(result.ok).toBe(true);
    expect(capturedUrl).toBe(`${BASE_URL}/admin/system-variables/sysvar-1`);
    expect(capturedBody).toEqual({ value: 10 });
  });

  it("update: a network failure fails loud with a typed downstream_error", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;

    const writer = createSystemVariablesWriter(BASE_URL);
    const systemVariable: ManifestSystemVariable = {
      name: "escalation-threshold",
      type: "number",
      value: 10,
    };

    const result = await writer.update("tenant-a", "sysvar-1", systemVariable, [
      { field: "value", current: 5, desired: 10 },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("downstream_error");
    }
  });
});
