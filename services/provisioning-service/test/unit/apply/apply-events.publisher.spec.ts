import "../../setup-env";
import { describe, expect, it, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { ApplyEventsPublisher } from "../../../src/modules/apply/infrastructure/apply-events.publisher";
import {
  JETSTREAM,
  JETSTREAM_MANAGER,
} from "../../../src/providers/nats.provider";

interface IFakeJsm {
  streams: {
    add: ReturnType<typeof mock>;
    info: ReturnType<typeof mock>;
  };
}

interface IFakeJs {
  publish: ReturnType<typeof mock>;
}

function makeFakeJsm(): IFakeJsm {
  return {
    streams: {
      add: mock(() => Promise.resolve({ config: {} })),
      info: mock(() => Promise.reject(new Error("stream not found"))),
    },
  };
}

function makeFakeJs(): IFakeJs {
  return {
    publish: mock(() =>
      Promise.resolve({ stream: "INGRESS-T", seq: 1, duplicate: false })
    ),
  };
}

async function buildPublisher(): Promise<{
  publisher: ApplyEventsPublisher;
  js: IFakeJs;
  jsm: IFakeJsm;
}> {
  const js = makeFakeJs();
  const jsm = makeFakeJsm();
  const moduleRef = await Test.createTestingModule({
    providers: [
      ApplyEventsPublisher,
      { provide: JETSTREAM, useValue: js },
      { provide: JETSTREAM_MANAGER, useValue: jsm },
    ],
  }).compile();
  return { publisher: moduleRef.get(ApplyEventsPublisher), js, jsm };
}

let counter = 0;
function tenant(): string {
  counter++;
  return `t-${process.pid}-${counter}`;
}

describe("ApplyEventsPublisher", () => {
  function decodeEnvelope(body: Uint8Array): {
    id: string;
    correlation_id: string;
    causation_id: string | null;
    transport: { depth: number; method: string };
    data: { payload: Record<string, unknown> };
  } {
    return JSON.parse(new TextDecoder().decode(body));
  }

  it("applyStarted is the run ROOT: correlation_id = own id, causation null, depth 0, and RETURNS its causal context", async () => {
    const { publisher, js } = await buildPublisher();
    const tenantId = tenant();

    const runAudit = await publisher.applyStarted({
      tenantId,
      manifestName: "e2e-manifest-apply",
      revision: 1,
      resourceCount: 2,
    });

    expect(js.publish).toHaveBeenCalledTimes(1);
    const [subject, body, opts] = js.publish.mock.calls[0] as [
      string,
      Uint8Array,
      { headers: { get: (k: string) => string }; msgID: string },
    ];
    expect(subject).toBe(
      `evt.${tenantId}.provisioning-service.provisioning.platform.internal.apply_started.v1`
    );
    expect(opts.msgID).toBeTruthy();
    expect(opts.headers.get("Nats-Msg-Id")).toBe(opts.msgID);

    const env = decodeEnvelope(body);
    // Root semantics matching golden seq1322: correlation = own id, causation
    // null, depth 0.
    expect(env.correlation_id).toBe(env.id);
    expect(env.causation_id).toBeNull();
    expect(env.transport.depth).toBe(0);
    expect(env.transport.method).toBe("stream");
    // The returned context is exactly what siblings must cite.
    expect(runAudit.causationId).toBe(env.id);
    expect(runAudit.correlationId).toBe(env.correlation_id);
    // Correlation header mirrors the envelope; no causation header for a root.
    expect(opts.headers.get("X-Correlation-Id")).toBe(env.correlation_id);

    expect(env.data.payload).toEqual({
      manifestName: "e2e-manifest-apply",
      revision: 1,
      resourceCount: 2,
    });
  });

  it("resourceApplied is a SIBLING: cites the run's causation, inherits correlation, depth 1; never a manifest field value", async () => {
    const { publisher, js } = await buildPublisher();
    const tenantId = tenant();

    await publisher.resourceApplied({
      tenantId,
      manifestName: "e2e-manifest-apply",
      kind: "channel",
      name: "http-in",
      verdict: "create",
      externalId: "chan-1",
      correlationId: "run-root-id",
      causationId: "run-root-id",
    });

    const [subject, body, opts] = js.publish.mock.calls[0] as [
      string,
      Uint8Array,
      { headers: { get: (k: string) => string }; msgID: string },
    ];
    expect(subject).toBe(
      `evt.${tenantId}.provisioning-service.provisioning.platform.internal.resource_applied.v1`
    );
    const env = decodeEnvelope(body);
    expect(env.correlation_id).toBe("run-root-id");
    expect(env.causation_id).toBe("run-root-id");
    expect(env.transport.depth).toBe(1);
    expect(opts.headers.get("X-Correlation-Id")).toBe("run-root-id");
    expect(opts.headers.get("X-Causation-Id")).toBe("run-root-id");
    expect(env.data.payload).toEqual({
      manifestName: "e2e-manifest-apply",
      kind: "channel",
      name: "http-in",
      verdict: "create",
      externalId: "chan-1",
    });
  });

  it("applyCompleted is a SIBLING: inherits the run correlation, cites its causation, depth 1", async () => {
    const { publisher, js } = await buildPublisher();
    const tenantId = tenant();

    await publisher.applyCompleted({
      tenantId,
      manifestName: "e2e-manifest-apply",
      appliedCount: 2,
      noopCount: 0,
      durationMs: 123,
      correlationId: "run-root-id",
      causationId: "run-root-id",
    });

    const [subject, body] = js.publish.mock.calls[0] as [string, Uint8Array];
    expect(subject).toBe(
      `evt.${tenantId}.provisioning-service.provisioning.platform.internal.apply_completed.v1`
    );
    const env = decodeEnvelope(body);
    expect(env.correlation_id).toBe("run-root-id");
    expect(env.causation_id).toBe("run-root-id");
    expect(env.transport.depth).toBe(1);
  });

  it("applyFailed is a SIBLING: chains off the run root, never a secret value", async () => {
    const { publisher, js } = await buildPublisher();
    const tenantId = tenant();

    await publisher.applyFailed({
      tenantId,
      manifestName: "broken-manifest",
      failure: {
        kind: "secret_not_resolvable",
        resourceKind: "connector",
        resourceName: "broken-connector",
        message: "secrets broker lands in T05",
      },
      appliedSoFar: [{ kind: "channel", name: "http-in" }],
      correlationId: "run-root-id",
      causationId: "run-root-id",
    });

    const [subject, body] = js.publish.mock.calls[0] as [string, Uint8Array];
    expect(subject).toBe(
      `evt.${tenantId}.provisioning-service.provisioning.platform.internal.apply_failed.v1`
    );
    const env = decodeEnvelope(body);
    expect(env.correlation_id).toBe("run-root-id");
    expect(env.causation_id).toBe("run-root-id");
    expect(env.transport.depth).toBe(1);
    expect(env.data.payload).toEqual({
      manifestName: "broken-manifest",
      kind: "connector",
      name: "broken-connector",
      message: "secrets broker lands in T05",
      appliedSoFar: [{ kind: "channel", name: "http-in" }],
    });
  });

  it("a full run forms ONE correlation chain: siblings share the root's correlation and cite its id (matches golden seq1322-1324)", async () => {
    const { publisher, js } = await buildPublisher();
    const tenantId = tenant();

    const runAudit = await publisher.applyStarted({
      tenantId,
      manifestName: "e2e-manifest-apply",
      revision: 1,
      resourceCount: 1,
    });
    await publisher.resourceApplied({
      tenantId,
      manifestName: "e2e-manifest-apply",
      kind: "channel",
      name: "http-in",
      verdict: "create",
      externalId: "chan-1",
      correlationId: runAudit.correlationId,
      causationId: runAudit.causationId,
    });
    await publisher.applyCompleted({
      tenantId,
      manifestName: "e2e-manifest-apply",
      appliedCount: 1,
      noopCount: 0,
      durationMs: 10,
      correlationId: runAudit.correlationId,
      causationId: runAudit.causationId,
    });

    const root = decodeEnvelope(js.publish.mock.calls[0]?.[1] as Uint8Array);
    const applied = decodeEnvelope(js.publish.mock.calls[1]?.[1] as Uint8Array);
    const completed = decodeEnvelope(
      js.publish.mock.calls[2]?.[1] as Uint8Array
    );

    // Root: correlation = own id, causation null, depth 0.
    expect(root.causation_id).toBeNull();
    expect(root.correlation_id).toBe(root.id);
    expect(root.transport.depth).toBe(0);

    // Siblings: causation = the root's id, correlation inherited, depth 1 —
    // exactly the shape golden rows seq1323/seq1324 hand-encode.
    for (const sibling of [applied, completed]) {
      expect(sibling.causation_id).toBe(root.id);
      expect(sibling.correlation_id).toBe(root.correlation_id);
      expect(sibling.transport.depth).toBe(1);
      expect(sibling.id).not.toBe(root.id);
    }
  });

  it("never throws on a broker outage (best-effort)", async () => {
    const { publisher, js } = await buildPublisher();
    js.publish = mock(() => Promise.reject(new Error("ECONNREFUSED")));

    let thrown: unknown;
    try {
      await publisher.applyStarted({
        tenantId: tenant(),
        manifestName: "demo",
        revision: 1,
        resourceCount: 1,
      });
    } catch (cause) {
      thrown = cause;
    }
    expect(thrown).toBeUndefined();
  });

  it("missing tenantId short-circuits without contacting the broker", async () => {
    const { publisher, js, jsm } = await buildPublisher();

    await publisher.applyStarted({
      tenantId: "",
      manifestName: "demo",
      revision: 1,
      resourceCount: 1,
    });

    expect(js.publish).not.toHaveBeenCalled();
    expect(jsm.streams.add).not.toHaveBeenCalled();
  });
});
