import { describe, expect, it, mock } from "bun:test";
import { computeSha256 } from "../../../src/modules/kb/lib/compute-sha256";
import {
  fetchKbUrlSource,
  KB_URL_SOURCE_MAX_BYTES,
} from "../../../src/modules/kb/lib/fetch-kb-url-source";

describe("fetchKbUrlSource", () => {
  it("rejects a private/RFC1918 URL before ever calling fetch (SSRF guard)", async () => {
    const fetchImpl = mock(async () => new Response("should never run"));
    const result = await fetchKbUrlSource("http://10.0.0.5/doc.txt", fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("url_rejected");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects localhost before ever calling fetch (SSRF guard)", async () => {
    const fetchImpl = mock(async () => new Response("should never run"));
    const result = await fetchKbUrlSource(
      "http://localhost/doc.txt",
      fetchImpl
    );
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects the cloud metadata endpoint before ever calling fetch (SSRF guard)", async () => {
    const fetchImpl = mock(async () => new Response("should never run"));
    const result = await fetchKbUrlSource(
      "http://169.254.169.254/latest/meta-data",
      fetchImpl
    );
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fetches and hashes the content for an allowed public URL", async () => {
    const fetchImpl = mock(async () => new Response("remote content"));
    const result = await fetchKbUrlSource(
      "https://docs.example.com/a.md",
      fetchImpl
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sha256).toBe(computeSha256("remote content"));
      expect(result.value.uploadMode).toBe("text");
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("surfaces a non-2xx response as a typed fetch-failed error", async () => {
    const fetchImpl = mock(
      async () => new Response("not found", { status: 404 })
    );
    const result = await fetchKbUrlSource(
      "https://docs.example.com/missing",
      fetchImpl
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("url_fetch_failed");
    }
  });

  it("surfaces a fetch exception as a typed fetch-failed error", async () => {
    const fetchImpl = mock(async () => {
      throw new Error("network down");
    });
    const result = await fetchKbUrlSource(
      "https://docs.example.com/a.md",
      fetchImpl
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("url_fetch_failed");
    }
  });

  it("rejects content over the size cap", async () => {
    const oversized = "x".repeat(KB_URL_SOURCE_MAX_BYTES + 1);
    const fetchImpl = mock(async () => new Response(oversized));
    const result = await fetchKbUrlSource(
      "https://docs.example.com/huge",
      fetchImpl
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("url_too_large");
    }
  });
});
