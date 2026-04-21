import { describe, it, expect, mock } from "bun:test";
import type { Mock } from "bun:test";
import { RetentionPolicy } from "nats";
import { ensureStream } from "../../src/nats-provider";

interface StreamInfoStub {
  config: {
    name: string;
    subjects?: readonly string[];
    max_age?: number;
    max_bytes?: number;
  };
}

interface MockJsm {
  streams: {
    info: Mock<(name: string) => Promise<StreamInfoStub>>;
    add: Mock<(cfg: Record<string, unknown>) => Promise<unknown>>;
    update: Mock<
      (name: string, cfg: Record<string, unknown>) => Promise<unknown>
    >;
  };
}

function makeJsmMock(existing: StreamInfoStub | null): MockJsm {
  const info = mock((_name: string): Promise<StreamInfoStub> => {
    if (existing === null) return Promise.reject(new Error("stream not found"));
    return Promise.resolve(existing);
  });
  const add = mock((_cfg: Record<string, unknown>) => Promise.resolve({}));
  const update = mock(
    (_name: string, _cfg: Record<string, unknown>) => Promise.resolve({}),
  );

  return { streams: { info, add, update } };
}

describe("ensureStream", () => {
  it("creates the stream with the requested subjects when missing", async () => {
    const jsm = makeJsmMock(null);

    await ensureStream(jsm as never, {
      name: "DLQ",
      subjects: ["dlq.webhook"],
      maxBytes: 1024,
      retention: RetentionPolicy.Limits,
    });

    expect(jsm.streams.add).toHaveBeenCalledTimes(1);
    expect(jsm.streams.update).not.toHaveBeenCalled();

    const addArgs = jsm.streams.add.mock.calls[0] as [Record<string, unknown>];
    const addCfg = addArgs[0];
    expect(addCfg.name).toBe("DLQ");
    expect(addCfg.subjects).toEqual(["dlq.webhook"]);
    expect(addCfg.max_bytes).toBe(1024);
    expect(addCfg.retention).toBe(RetentionPolicy.Limits);
  });

  it("is a no-op when existing stream matches requested subjects and limits", async () => {
    const jsm = makeJsmMock({
      config: {
        name: "DLQ",
        subjects: ["dlq.webhook"],
        max_age: 1_000,
        max_bytes: 2048,
      },
    });

    await ensureStream(jsm as never, {
      name: "DLQ",
      subjects: ["dlq.webhook"],
      maxAge: 1_000,
      maxBytes: 2048,
    });

    expect(jsm.streams.update).not.toHaveBeenCalled();
    expect(jsm.streams.add).not.toHaveBeenCalled();
  });

  it("reconciles drifted subjects by calling streams.update with the new subject list", async () => {
    const jsm = makeJsmMock({
      config: {
        name: "DLQ",
        subjects: ["dlq.>"],
        max_age: 1_000,
        max_bytes: 2048,
      },
    });

    const warn = mock((_msg: string) => {});
    await ensureStream(jsm as never, {
      name: "DLQ",
      subjects: ["dlq.webhook"],
      maxAge: 1_000,
      maxBytes: 2048,
      logger: { warn },
    });

    expect(jsm.streams.update).toHaveBeenCalledTimes(1);
    const updateArgs = jsm.streams.update.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(updateArgs[0]).toBe("DLQ");
    expect(updateArgs[1].subjects).toEqual(["dlq.webhook"]);
    expect(updateArgs[1].max_age).toBe(1_000);
    expect(updateArgs[1].max_bytes).toBe(2048);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("updates max_age/max_bytes drift while leaving matching subjects untouched", async () => {
    const jsm = makeJsmMock({
      config: {
        name: "DLQ",
        subjects: ["dlq.webhook"],
        max_age: 500,
        max_bytes: 1024,
      },
    });

    await ensureStream(jsm as never, {
      name: "DLQ",
      subjects: ["dlq.webhook"],
      maxAge: 1_000,
      maxBytes: 2048,
    });

    expect(jsm.streams.update).toHaveBeenCalledTimes(1);
    const [, cfg] = jsm.streams.update.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(cfg.max_age).toBe(1_000);
    expect(cfg.max_bytes).toBe(2048);
    expect(cfg.subjects).toEqual(["dlq.webhook"]);
  });

  it("treats subject list order as irrelevant (set-equality)", async () => {
    const jsm = makeJsmMock({
      config: {
        name: "MULTI",
        subjects: ["a.b", "c.d"],
      },
    });

    await ensureStream(jsm as never, {
      name: "MULTI",
      subjects: ["c.d", "a.b"],
    });

    expect(jsm.streams.update).not.toHaveBeenCalled();
  });
});
