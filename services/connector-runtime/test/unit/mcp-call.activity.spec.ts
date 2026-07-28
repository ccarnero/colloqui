import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import { setActiveRedisInstance } from "../helpers/fake-adapter-redis";
import { setActivePublishSpy } from "../helpers/fake-nats-jetstream";
import {
  setActiveTracedFetch,
  type TracedFetchImpl,
} from "../helpers/fake-traced-fetch";

// ---- fake ioredis instance (breaker.ts's getHttpBreaker()) ----
const mockRedisInstance = {
  get: mock((_key: string) => Promise.resolve(null)),
  setex: mock(() => Promise.resolve("OK")),
  del: mock((..._keys: string[]) => Promise.resolve(0)),
  script: mock(() => Promise.resolve("sha-fake")),
  evalsha: mock(() => Promise.resolve(["allow", "closed", ""])),
  eval: mock(() => Promise.resolve(["allow", "closed", ""])),
  options: {},
  status: "ready",
};
setActiveRedisInstance(mockRedisInstance);

/**
 * Controllable fake for `@ai-sdk/mcp`'s `createMCPClient`. Mocked PRIVATELY
 * here (not one of `test/helpers/`'s shared singleton doubles) because
 * `mcp-call.activity.ts` — via this spec file's dynamic import below — is
 * the ONLY module in this test run that imports `@ai-sdk/mcp`, so there is
 * no cross-file ESM-singleton binding race to guard against (unlike
 * `"nats"` / `"ioredis"` / `"@yoizen/observability"`, each shared by
 * multiple spec files per those helpers' doc comments).
 */
type FakeToolExecute = (
  input: unknown,
  options: unknown
) => Promise<{ content?: unknown; isError?: boolean }>;

let activeToolExecute: FakeToolExecute = () =>
  Promise.resolve({ content: { ok: true } });
let activeCreateMCPClient = mock(() =>
  Promise.resolve({
    tools: () =>
      Promise.resolve({
        "echo-tool": {
          execute: (...args: Parameters<FakeToolExecute>) =>
            activeToolExecute(...args),
        },
      }),
    close: () => Promise.resolve(),
  })
);

mock.module("@ai-sdk/mcp", () => ({
  createMCPClient: (...args: unknown[]) =>
    (activeCreateMCPClient as unknown as (...a: unknown[]) => unknown)(...args),
}));

// `@yoizen/observability` and `"nats"` route through the SHARED doubles
// (`fake-traced-fetch.ts` / `fake-nats-jetstream.ts`) — see those files' doc
// comments: both back process-wide singletons (`getAdapterClient()`'s
// `tracedFetch` binding, `event-publisher.ts`'s `nats` binding) shared with
// `service-call.activity.spec.ts` / `endpoint-call.activity.spec.ts`, so a
// private mock here would race those files for whichever binding wins.
let tracedFetchMock: ReturnType<typeof mock>;
let publishSpy: ReturnType<typeof mock>;

/** Routes `resolveServer`'s `GET /admin/mcp-servers/:id` lookup. */
const defaultServerConfig = {
  id: "srv-1",
  name: "test-mcp-server",
  transport_type: "http" as const,
  url: "https://mcp.example.com/mcp",
  headers: null,
  auth_type: "none" as const,
  auth_config: null,
};

function defaultTracedFetchImpl() {
  return Promise.resolve(
    new Response(JSON.stringify(defaultServerConfig), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );
}

// `reportMcpUsageEvent` (`@yoizen/shared/mcp-usage-client.ts`) posts to
// agent-admin-service via the RAW global `fetch` (not `tracedFetch`) — it is
// the only caller in this activity's call graph that does so. Stubbed here
// (scoped to this file's `beforeEach`/`afterAll`, never left dangling
// across spec files — the exact pitfall `deliver-webhook.spec.ts` documents
// for mutating `globalThis.fetch` directly) so the usage-reporting side
// effect resolves immediately instead of hitting a real network call.
const originalFetch = globalThis.fetch;
let usageFetchMock: ReturnType<typeof mock>;

// Import AFTER all mocks are in place — `mcp-call.activity.ts` is the ONLY
// consumer of `@ai-sdk/mcp` in this test run, so mocking it before this
// import is both necessary and sufficient.
const { executeMcpCall, validateUrl } = await import(
  "../../src/activities/mcp-call.activity"
);

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function decodePublishedMcpEvent(): {
  type: string;
  resource: string;
  correlation_id: string;
  causation_id: string | null;
  transport: { depth: number };
  payload: Record<string, unknown>;
} {
  const rawBytes = publishSpy.mock.calls[0]![1] as Uint8Array;
  const envelope = JSON.parse(new TextDecoder().decode(rawBytes)) as {
    type: string;
    resource: string;
    correlation_id: string;
    causation_id: string | null;
    transport: { depth: number };
    data: { payload: Record<string, unknown> };
  };
  return {
    type: envelope.type,
    resource: envelope.resource,
    correlation_id: envelope.correlation_id,
    causation_id: envelope.causation_id,
    transport: envelope.transport,
    payload: envelope.data.payload,
  };
}

describe("executeMcpCall — connector.mcp_call.completed.v1 emission (T03)", () => {
  beforeEach(() => {
    publishSpy = mock(async () => ({ seq: 1 }));
    setActivePublishSpy(publishSpy);

    tracedFetchMock = mock(() => defaultTracedFetchImpl());
    setActiveTracedFetch(tracedFetchMock as unknown as TracedFetchImpl);

    setActiveRedisInstance(mockRedisInstance);
    mockRedisInstance.evalsha.mockReset();
    mockRedisInstance.evalsha.mockImplementation(() =>
      Promise.resolve(["allow", "closed", ""])
    );

    activeCreateMCPClient = mock(() =>
      Promise.resolve({
        tools: () =>
          Promise.resolve({
            "echo-tool": {
              execute: (...args: Parameters<FakeToolExecute>) =>
                activeToolExecute(...args),
            },
          }),
        close: () => Promise.resolve(),
      })
    );
    activeToolExecute = () => Promise.resolve({ content: { ok: true } });

    usageFetchMock = mock(() =>
      Promise.resolve(new Response("{}", { status: 200 }))
    );
    globalThis.fetch = usageFetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("publishes connector.mcp_call.completed.v1 with resource mcp/<mcpServerId>", async () => {
    await executeMcpCall(
      { serverId: "srv-1", toolName: "echo-tool", params: { q: "hi" } },
      "tenant-abc"
    );
    await flush();

    expect(publishSpy).toHaveBeenCalledTimes(1);
    const evt = decodePublishedMcpEvent();
    expect(evt.type).toBe("connector.mcp_call.completed.v1");
    expect(evt.resource).toBe("mcp/srv-1");
  });

  it("captures tool arguments and result content in the payload", async () => {
    activeToolExecute = () =>
      Promise.resolve({ content: { answer: 42 }, isError: false });

    await executeMcpCall(
      { serverId: "srv-1", toolName: "echo-tool", params: { q: "hi" } },
      "tenant-abc"
    );
    await flush();

    const evt = decodePublishedMcpEvent();
    expect(evt.payload["serverName"]).toBe("test-mcp-server");
    expect(evt.payload["mcpServerId"]).toBe("srv-1");
    expect(evt.payload["toolName"]).toBe("echo-tool");
    expect(evt.payload["success"]).toBe(true);
    expect(evt.payload["arguments"]).toBe(JSON.stringify({ q: "hi" }));
    expect(evt.payload["result"]).toBe(JSON.stringify({ answer: 42 }));
  });

  it("truncates oversized arguments and result to 8192 chars", async () => {
    const bigValue = "x".repeat(9000);
    activeToolExecute = () => Promise.resolve({ content: { big: bigValue } });

    await executeMcpCall(
      { serverId: "srv-1", toolName: "echo-tool", params: { big: bigValue } },
      "tenant-abc"
    );
    await flush();

    const evt = decodePublishedMcpEvent();
    expect((evt.payload["arguments"] as string).length).toBe(8192);
    expect((evt.payload["result"] as string).length).toBe(8192);
  });

  it("emits with success=false and the error message on a tool-level error (isError)", async () => {
    activeToolExecute = () =>
      Promise.resolve({ content: { message: "boom" }, isError: true });

    await executeMcpCall(
      { serverId: "srv-1", toolName: "echo-tool" },
      "tenant-abc"
    );
    await flush();

    const evt = decodePublishedMcpEvent();
    expect(evt.payload["success"]).toBe(false);
  });

  it("emits with success=false and an error message when the tool call throws", async () => {
    activeToolExecute = () =>
      Promise.reject(new Error("MCP server unreachable"));

    let caught: unknown = null;
    try {
      await executeMcpCall(
        { serverId: "srv-1", toolName: "echo-tool" },
        "tenant-abc"
      );
    } catch (err) {
      caught = err;
    }
    await flush();

    // The activity still rethrows for Temporal retry semantics...
    expect(caught).not.toBeNull();
    // ...but the mcp_call event is emitted regardless (failed calls are the
    // interesting ones — T03).
    expect(publishSpy).toHaveBeenCalledTimes(1);
    const evt = decodePublishedMcpEvent();
    expect(evt.payload["success"]).toBe(false);
    expect(evt.payload["error"]).toBe("MCP server unreachable");
    expect("result" in evt.payload).toBe(false);
  });

  it("threads causal context into correlation_id/causation_id/depth", async () => {
    const causal = {
      correlation_id: "run-correlation-id",
      causation_id: "parent-event-id",
      depth: 1,
    };

    await executeMcpCall(
      { serverId: "srv-1", toolName: "echo-tool" },
      "tenant-abc",
      causal
    );
    await flush();

    const evt = decodePublishedMcpEvent();
    expect(evt.correlation_id).toBe("run-correlation-id");
    expect(evt.causation_id).toBe("parent-event-id");
    expect(evt.transport.depth).toBe(2);
  });

  it("publishes a root event when no causal context is passed", async () => {
    await executeMcpCall(
      { serverId: "srv-1", toolName: "echo-tool" },
      "tenant-abc"
    );
    await flush();

    const evt = decodePublishedMcpEvent();
    expect(evt.causation_id).toBeNull();
    expect(evt.transport.depth).toBe(0);
  });

  it("does not throw when the publish sink rejects (fire-and-forget)", async () => {
    publishSpy.mockImplementationOnce(async () => {
      throw new Error("NATS unavailable");
    });

    let caught: unknown = null;
    try {
      await executeMcpCall(
        { serverId: "srv-1", toolName: "echo-tool" },
        "tenant-abc"
      );
    } catch (err) {
      caught = err;
    }
    await flush();

    expect(caught).toBeNull();
  });

  it("keeps reporting usage to agent-admin-service via reportMcpUsageEvent, unchanged", async () => {
    await executeMcpCall(
      { serverId: "srv-1", toolName: "echo-tool" },
      "tenant-abc"
    );
    await flush();

    expect(usageFetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = usageFetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toContain("/admin/mcp-servers/usage-events");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body["serverName"]).toBe("test-mcp-server");
    expect(body["toolName"]).toBe("echo-tool");
    expect(body["success"]).toBe(true);
  });
});

/**
 * Covers the SSRF guard in `mcp-call.activity.ts`'s `validateUrl`, extended
 * with an explicit `scope` parameter (mcp-connections.md SSRF-scope
 * follow-up). `scope: "internal"` is an admin opt-in that relaxes the
 * localhost/RFC1918 checks; cloud-metadata and link-local targets stay
 * blocked regardless of scope.
 */
describe("validateUrl (mcp-call.activity.ts) — SSRF guard scope semantics", () => {
  describe("external scope (default) — unchanged regression behavior", () => {
    it("accepts a public https URL", () => {
      expect(() => validateUrl("https://api.example.com/mcp")).not.toThrow();
    });

    it("rejects localhost", () => {
      expect(() => validateUrl("http://localhost:3000/mcp")).toThrow(
        "must not target localhost"
      );
    });

    it("rejects 127.0.0.1", () => {
      expect(() => validateUrl("http://127.0.0.1:3000/mcp")).toThrow(
        "must not target localhost"
      );
    });

    it("rejects 10.x.x.x (RFC1918 private)", () => {
      expect(() => validateUrl("http://10.0.0.5/mcp")).toThrow(
        "private/RFC1918"
      );
    });

    it("rejects 192.168.x.x (RFC1918 private)", () => {
      expect(() => validateUrl("http://192.168.1.10/mcp")).toThrow(
        "private/RFC1918"
      );
    });

    it("rejects 169.254.169.254 (cloud metadata)", () => {
      expect(() =>
        validateUrl("http://169.254.169.254/latest/meta-data")
      ).toThrow("cloud metadata");
    });

    it("rejects 169.254.x.x (link-local)", () => {
      expect(() => validateUrl("http://169.254.1.1/mcp")).toThrow("link-local");
    });

    it("rejects non-http(s) protocols", () => {
      expect(() => validateUrl("ftp://files.example.com/mcp")).toThrow(
        "http or https protocol"
      );
    });

    it("behaves the same when scope is explicitly 'external'", () => {
      expect(() => validateUrl("http://10.0.0.5/mcp", "external")).toThrow(
        "private/RFC1918"
      );
    });
  });

  describe("internal scope — explicit opt-in relaxation", () => {
    it("allows 10.x.x.x", () => {
      expect(() =>
        validateUrl("http://10.0.0.5/mcp", "internal")
      ).not.toThrow();
    });

    it("allows 192.168.x.x", () => {
      expect(() =>
        validateUrl("http://192.168.1.10/mcp", "internal")
      ).not.toThrow();
    });

    it("allows localhost", () => {
      expect(() =>
        validateUrl("http://localhost:3000/mcp", "internal")
      ).not.toThrow();
    });

    it("still blocks 169.254.169.254 (cloud metadata)", () => {
      expect(() =>
        validateUrl("http://169.254.169.254/latest/meta-data", "internal")
      ).toThrow("cloud metadata");
    });

    it("still blocks 169.254.x.x / fe80: (link-local)", () => {
      expect(() => validateUrl("http://169.254.1.1/mcp", "internal")).toThrow(
        "link-local"
      );
    });

    it("still blocks non-http(s) protocols", () => {
      expect(() =>
        validateUrl("ftp://files.example.com/mcp", "internal")
      ).toThrow("http or https protocol");
    });
  });
});
