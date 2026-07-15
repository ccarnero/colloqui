import "../../setup-env";
import { describe, expect, it, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { SecretAuditPublisher } from "../../../src/modules/secrets/infrastructure/secret-audit.publisher";
import {
  JETSTREAM,
  JETSTREAM_MANAGER,
} from "../../../src/providers/nats.provider";

interface IFakeJsm {
  streams: { add: ReturnType<typeof mock>; info: ReturnType<typeof mock> };
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
  publisher: SecretAuditPublisher;
  js: IFakeJs;
}> {
  const js = makeFakeJs();
  const jsm = makeFakeJsm();
  const moduleRef = await Test.createTestingModule({
    providers: [
      SecretAuditPublisher,
      { provide: JETSTREAM, useValue: js },
      { provide: JETSTREAM_MANAGER, useValue: jsm },
    ],
  }).compile();
  return { publisher: moduleRef.get(SecretAuditPublisher), js };
}

let counter = 0;
function tenant(): string {
  counter++;
  return `t-${process.pid}-${counter}`;
}

const SECRET_TOKEN = "sk-audit-VALUE-marker-1a2b3c";

describe("SecretAuditPublisher (TAXONOMY.md rule 23)", () => {
  function decodeEnvelope(body: Uint8Array): {
    id: string;
    correlation_id: string;
    causation_id: string | null;
    transport: { depth: number };
    data: { payload: Record<string, unknown> };
  } {
    return JSON.parse(new TextDecoder().decode(body));
  }

  it("secretWritten is its OWN root: correlation_id = own id, causation null, depth 0", async () => {
    const { publisher, js } = await buildPublisher();
    const tenantId = tenant();

    await publisher.secretWritten({
      tenantId,
      secretName: "hubspot-api-key",
      kind: "connector",
      owner: "hubspot",
    });

    const [subject, body] = js.publish.mock.calls[0] as [string, Uint8Array];
    expect(subject).toBe(
      `evt.${tenantId}.provisioning-service.provisioning.platform.internal.secret_written.v1`
    );
    const env = decodeEnvelope(body);
    expect(env.correlation_id).toBe(env.id);
    expect(env.causation_id).toBeNull();
    expect(env.transport.depth).toBe(0);
    expect(env.data.payload).toEqual({
      secretName: "hubspot-api-key",
      kind: "connector",
      owner: "hubspot",
    });
  });

  it("secretResolved is a SIBLING of the caller's correlationId: causation = that correlationId, depth 1", async () => {
    const { publisher, js } = await buildPublisher();
    const tenantId = tenant();

    await publisher.secretResolved({
      tenantId,
      secretName: "hubspot-api-key",
      kind: "connector",
      owner: "hubspot",
      consumerService: "provisioning-service-apply-engine",
      correlationId: "caller-run-id",
    });

    const [subject, body] = js.publish.mock.calls[0] as [string, Uint8Array];
    expect(subject).toBe(
      `evt.${tenantId}.provisioning-service.provisioning.platform.internal.secret_resolved.v1`
    );
    const env = decodeEnvelope(body);
    expect(env.correlation_id).toBe("caller-run-id");
    expect(env.causation_id).toBe("caller-run-id");
    expect(env.transport.depth).toBe(1);
    expect(env.data.payload).toEqual({
      secretName: "hubspot-api-key",
      kind: "connector",
      owner: "hubspot",
      consumerService: "provisioning-service-apply-engine",
    });
  });

  it("secretAccessDenied carries a `reason` field but NEVER a secret value", async () => {
    const { publisher, js } = await buildPublisher();
    const tenantId = tenant();

    await publisher.secretAccessDenied({
      tenantId,
      secretName: "hubspot-api-key",
      kind: "connector",
      owner: "hubspot",
      consumerService: "provisioning-service-apply-engine",
      correlationId: "caller-run-id",
      reason:
        `binding mismatch (attempted value ${SECRET_TOKEN} — should never appear)`.replace(
          SECRET_TOKEN,
          "n/a"
        ),
    });

    const [subject, body] = js.publish.mock.calls[0] as [string, Uint8Array];
    expect(subject).toBe(
      `evt.${tenantId}.provisioning-service.provisioning.platform.internal.secret_access_denied.v1`
    );
    const env = decodeEnvelope(body);
    expect(env.correlation_id).toBe("caller-run-id");
    expect(env.causation_id).toBe("caller-run-id");
    expect(env.transport.depth).toBe(1);
    expect(JSON.stringify(env.data.payload)).not.toContain(SECRET_TOKEN);
  });

  it("never throws on a broker outage (best-effort)", async () => {
    const { publisher, js } = await buildPublisher();
    js.publish = mock(() => Promise.reject(new Error("ECONNREFUSED")));

    let thrown: unknown;
    try {
      await publisher.secretWritten({
        tenantId: tenant(),
        secretName: "x",
        kind: "connector",
        owner: "hubspot",
      });
    } catch (cause) {
      thrown = cause;
    }
    expect(thrown).toBeUndefined();
  });
});
