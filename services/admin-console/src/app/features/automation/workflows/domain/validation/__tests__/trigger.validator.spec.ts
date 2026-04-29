import { validateTrigger } from "../trigger.validator";

function ok(trigger: unknown): boolean {
  return validateTrigger(trigger).length === 0;
}

function codes(trigger: unknown): string[] {
  return validateTrigger(trigger).map((e) => e.code);
}

describe("validateTrigger", () => {
  it("passes with the minimal valid trigger including one accountId", () => {
    expect(
      ok({
        type: "message_received",
        mode: "shared",
        config: { accountIds: ["acc-1"] },
      }),
    ).toBe(true);
  });

  it("requires at least one accountId for message_received", () => {
    const errors = validateTrigger({
      type: "message_received",
      mode: "shared",
      config: { accountIds: [] },
    });
    expect(
      errors.some(
        (e) =>
          e.code === "REQUIRED" &&
          e.field === "trigger.config.accountIds",
      ),
    ).toBe(true);
  });

  it("requires accountIds when config is missing entirely", () => {
    const errors = validateTrigger({
      type: "message_received",
      mode: "shared",
    });
    expect(
      errors.some(
        (e) =>
          e.code === "REQUIRED" &&
          e.field === "trigger.config.accountIds",
      ),
    ).toBe(true);
  });

  it("rejects unknown trigger type", () => {
    expect(
      codes({ type: "scheduled", mode: "shared", config: {} }),
    ).toContain("INVALID_ENUM");
  });

  it("rejects unknown mode", () => {
    expect(
      codes({
        type: "message_received",
        mode: "broadcast",
        config: { accountIds: ["acc-1"] },
      }),
    ).toContain("INVALID_ENUM");
  });

  it("rejects invalid channel values", () => {
    const errors = validateTrigger({
      type: "message_received",
      mode: "shared",
      config: { accountIds: ["acc-1"], channels: ["sms"] },
    });
    expect(errors.some((e) => e.code === "INVALID_ENUM")).toBe(true);
    expect(
      errors.some((e) => e.field === "trigger.config.channels[0]"),
    ).toBe(true);
  });

  it("rejects invalid provider values", () => {
    const errors = validateTrigger({
      type: "message_received",
      mode: "shared",
      config: { accountIds: ["acc-1"], providers: ["twilio"] },
    });
    expect(
      errors.some((e) => e.field === "trigger.config.providers[0]"),
    ).toBe(true);
  });

  it("accepts known channels and providers", () => {
    expect(
      ok({
        type: "message_received",
        mode: "exclusive",
        config: {
          channels: ["whatsapp", "telegram"],
          providers: ["meta"],
          accountIds: ["acc-1"],
          patterns: ["hello"],
        },
      }),
    ).toBe(true);
  });

  it("rejects non-string accountIds", () => {
    const errors = validateTrigger({
      type: "message_received",
      mode: "shared",
      config: { accountIds: [123] },
    });
    expect(errors.some((e) => e.code === "INVALID_VALUE")).toBe(true);
  });

  it("rejects non-object trigger payload", () => {
    expect(codes(null)).toContain("INVALID_VALUE");
  });
});
