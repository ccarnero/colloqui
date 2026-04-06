import { describe, it, expect } from "bun:test";
import { TENANT_HEADER } from "@yoizen/shared";
import { mergeAdapterPipelineHeaders } from "../../src/pipeline/adapter-request-headers.util";
import { SOURCE_HEADER, SOURCE_VALUE } from "../../src/pipeline/constants";

describe("mergeAdapterPipelineHeaders", () => {
  it("merges tenant and source markers onto resolved headers", () => {
    const h = mergeAdapterPipelineHeaders("t1", { Authorization: "Bearer x" });
    expect(h[TENANT_HEADER]).toBe("t1");
    expect(h[SOURCE_HEADER]).toBe(SOURCE_VALUE);
    expect(h.Authorization).toBe("Bearer x");
  });
});
