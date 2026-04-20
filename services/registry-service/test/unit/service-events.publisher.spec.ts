import { describe, it, expect, beforeEach, mock, afterEach } from "bun:test";
import { Test } from "@nestjs/testing";
import { ServiceEventsPublisher } from "../../src/modules/services/service-events.publisher";
import { NATS_CONNECTION } from "../../src/providers/nats.provider";
import { registryServiceConfig } from "../../src/config";

interface IFakeNats {
  publish: ReturnType<typeof mock>;
  flush: ReturnType<typeof mock>;
}

function makeFakeNats(): IFakeNats {
  return {
    publish: mock((_subj: string, _data: Uint8Array, _opts?: unknown) =>
      undefined,
    ),
    flush: mock(() => Promise.resolve()),
  };
}

describe("ServiceEventsPublisher", () => {
  let nc: IFakeNats;
  let publisher: ServiceEventsPublisher;
  let originalFlag: boolean;

  beforeEach(async () => {
    originalFlag = registryServiceConfig.emitAdapterSync;
    (registryServiceConfig as { emitAdapterSync: boolean }).emitAdapterSync =
      true;

    nc = makeFakeNats();

    const moduleRef = await Test.createTestingModule({
      providers: [
        ServiceEventsPublisher,
        { provide: NATS_CONNECTION, useValue: nc },
      ],
    }).compile();

    publisher = moduleRef.get(ServiceEventsPublisher);
  });

  afterEach(() => {
    (registryServiceConfig as { emitAdapterSync: boolean }).emitAdapterSync =
      originalFlag;
  });

  it("is no-op when flag is disabled", async () => {
    (registryServiceConfig as { emitAdapterSync: boolean }).emitAdapterSync =
      false;
    await publisher.publishUpserted({
      serviceId: "svc-1",
      tenantId: "t1",
      name: "my-svc",
      knativeName: "my-svc-t1",
      namespace: "t1-dev",
      port: 3000,
      status: "active",
    });
    expect(nc.publish).not.toHaveBeenCalled();
  });

  it("publishes upserted to registry-service platform subject", async () => {
    await publisher.publishUpserted({
      serviceId: "svc-1",
      tenantId: "t1",
      name: "my-svc",
      knativeName: "my-svc-t1",
      namespace: "t1-dev",
      port: 3000,
      status: "active",
    });
    expect(nc.publish).toHaveBeenCalledTimes(1);
    const [subject, data] = nc.publish.mock.calls[0];
    expect(typeof subject).toBe("string");
    expect((subject as string)).toMatch(
      /^evt\.t1\.registry-service\.platform\.service\.system\.upserted\.v1$/,
    );
    const envelope = JSON.parse(Buffer.from(data as Uint8Array).toString());
    expect(envelope.type).toBe("io.yoizen.registry.service.upserted.v1");
    expect(envelope.tenant).toBe("t1");
    expect(envelope.producer).toBe("registry-service");
    expect(envelope.data.payload.serviceId).toBe("svc-1");
  });

  it("publishes deleted with matching subject", async () => {
    await publisher.publishDeleted({
      serviceId: "svc-1",
      tenantId: "t1",
      name: "my-svc",
    });
    expect(nc.publish).toHaveBeenCalledTimes(1);
    const [subject] = nc.publish.mock.calls[0];
    expect((subject as string)).toMatch(
      /^evt\.t1\.registry-service\.platform\.service\.system\.deleted\.v1$/,
    );
  });

  it("sets Nats-Msg-Id to deterministic idempotency key", async () => {
    const payload = {
      serviceId: "svc-1",
      tenantId: "t1",
      name: "my-svc",
      knativeName: "my-svc-t1",
      namespace: "t1-dev",
      port: 3000,
      status: "active" as const,
    };
    await publisher.publishUpserted(payload);
    await publisher.publishUpserted(payload);
    const call1 = nc.publish.mock.calls[0];
    const call2 = nc.publish.mock.calls[1];
    const hdrs1 = (call1[2] as { headers: unknown }).headers as {
      get: (k: string) => string;
    };
    const hdrs2 = (call2[2] as { headers: unknown }).headers as {
      get: (k: string) => string;
    };
    const msgId1 = hdrs1.get("Nats-Msg-Id");
    const msgId2 = hdrs2.get("Nats-Msg-Id");
    expect(msgId1).toBeTruthy();
    expect(msgId1).toBe(msgId2);
  });
});
