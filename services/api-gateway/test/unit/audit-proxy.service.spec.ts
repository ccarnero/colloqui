import { beforeEach, describe, expect, it, mock } from "bun:test";
import { AuditProxyService } from "../../src/modules/audit/audit-proxy.service";

describe("AuditProxyService", () => {
  let fetchMock: ReturnType<typeof mock>;

  beforeEach(() => {
    process.env.AUDIT_SERVICE_URL = "http://audit.test";
    fetchMock = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ items: [] }),
      }),
    );
    (globalThis as { fetch?: typeof fetch }).fetch = fetchMock as typeof fetch;
  });

  it("queryEvents requests audit URL with query params", async () => {
    const svc = new AuditProxyService();
    await svc.queryEvents({ limit: "10", skip: undefined }, "tenant-a");

    expect(fetchMock).toHaveBeenCalled();
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("/audit/events");
    expect(url).toContain("limit=10");
  });

  it("getEventById returns null on 404", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({}),
      }),
    );
    const svc = new AuditProxyService();
    const result = await svc.getEventById("evt-1", "tenant-a");
    expect(result).toBeNull();
  });
});
