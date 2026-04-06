import { describe, it, expect, mock } from "bun:test";
import { TENANT_HEADER } from "@yoizen/shared";
import { resolveAdapterPipelineRequest } from "../../src/pipeline/adapter-pipeline-resolve.util";
import type { AdapterClient } from "@yoizen/shared";

describe("resolveAdapterPipelineRequest", () => {
  it("resolves URL and merges headers", async () => {
    const adapterClient = {
      resolveRequest: mock(() =>
        Promise.resolve({
          url: "http://adapter.test/v1/hook",
          method: "POST",
          headers: { "X-Custom": "a" },
          timeoutMs: 5000,
          maxRetries: 2,
          retryBackoffMs: 100,
        }),
      ),
    } as unknown as AdapterClient;

    const { resolved, headers } = await resolveAdapterPipelineRequest({
      adapterClient,
      tenantId: "tenant-1",
      adapterId: "adp-1",
      endpointId: "ep-1",
      extraHeaders: { Accept: "application/json" },
    });

    expect(resolved.url).toContain("adapter.test");
    expect(headers[TENANT_HEADER]).toBe("tenant-1");
    expect(headers.Accept).toBe("application/json");
  });
});
