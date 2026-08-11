import { validateAction } from "../action-validators";

function ok(action: unknown): boolean {
  return validateAction(action).length === 0;
}

function codes(action: unknown): string[] {
  return validateAction(action).map((e) => e.code);
}

function fields(action: unknown): Array<string | undefined> {
  return validateAction(action).map((e) => e.field);
}

describe("validateAction — jsFunction", () => {
  it("accepts a non-empty code string", () => {
    expect(
      ok({ activity: "jsFunction", name: "fn", args: { code: "return 1;" } }),
    ).toBe(true);
  });

  it("rejects missing code", () => {
    const errors = validateAction({
      activity: "jsFunction",
      name: "fn",
      args: {},
    });
    expect(errors.length).toBe(1);
    expect(errors[0].code).toBe("REQUIRED");
    expect(errors[0].field).toBe("args.code");
  });

  it("rejects empty action name", () => {
    expect(
      codes({ activity: "jsFunction", name: "", args: { code: "x" } }),
    ).toContain("REQUIRED");
  });
});

describe("validateAction — endpointCall", () => {
  it("URL ad-hoc mode requires method and url", () => {
    const errors = validateAction({
      activity: "endpointCall",
      name: "call",
      args: {},
    });
    const fs = errors.map((e) => e.field);
    expect(fs).toContain("args.method");
    expect(fs).toContain("args.url");
  });

  it("URL ad-hoc mode passes when method and url present", () => {
    expect(
      ok({
        activity: "endpointCall",
        name: "call",
        args: { method: "GET", url: "https://x.com" },
      }),
    ).toBe(true);
  });

  it("URL ad-hoc mode rejects invalid HTTP method", () => {
    expect(
      codes({
        activity: "endpointCall",
        name: "call",
        args: { method: "FOO", url: "https://x.com" },
      }),
    ).toContain("INVALID_ENUM");
  });

  it("adapter mode requires endpointId, not method/url", () => {
    const errors = validateAction({
      activity: "endpointCall",
      name: "call",
      args: { adapterId: "ad-1" },
    });
    expect(errors.length).toBe(1);
    expect(errors[0].field).toBe("args.endpointId");
    expect(errors[0].code).toBe("REQUIRED");
  });

  it("adapter mode passes with endpointId, even without method/url", () => {
    expect(
      ok({
        activity: "endpointCall",
        name: "call",
        args: { adapterId: "ad-1", endpointId: "ep-1" },
      }),
    ).toBe(true);
  });
});

describe("validateAction — serviceCall", () => {
  it("requires serviceId, method and path", () => {
    expect(
      fields({ activity: "serviceCall", name: "s", args: {} }).sort(),
    ).toEqual(["args.method", "args.path", "args.serviceId"]);
  });

  it("passes with all required fields", () => {
    expect(
      ok({
        activity: "serviceCall",
        name: "s",
        args: { serviceId: "svc-1", method: "GET", path: "/x" },
      }),
    ).toBe(true);
  });
});

describe("validateAction — serviceBusCall", () => {
  it("requires subject", () => {
    expect(
      codes({ activity: "serviceBusCall", name: "bus", args: {} }),
    ).toContain("REQUIRED");
  });

  it("passes with subject", () => {
    expect(
      ok({
        activity: "serviceBusCall",
        name: "bus",
        args: { subject: "events.x" },
      }),
    ).toBe(true);
  });
});

describe("validateAction — channelSend", () => {
  const baseFields = {
    accountId: "acc-1",
    channel: "telegram",
    provider: "telegram",
    to: "+123",
  };

  it("passes for type=text with non-empty text", () => {
    expect(
      ok({
        activity: "channelSend",
        name: "send",
        args: { ...baseFields, type: "text", text: "hello" },
      }),
    ).toBe(true);
  });

  it("flags every missing base field when args is empty", () => {
    const errors = validateAction({
      activity: "channelSend",
      name: "send",
      args: {},
    });
    const fs = errors.map((e) => e.field).sort();
    // type is missing too, so no conditional rule kicks in.
    expect(fs).toEqual([
      "args.accountId",
      "args.channel",
      "args.provider",
      "args.to",
      "args.type",
    ]);
  });

  it("type=text requires a non-empty text", () => {
    const errors = validateAction({
      activity: "channelSend",
      name: "send",
      args: { ...baseFields, type: "text" },
    });
    expect(
      errors.some(
        (e) => e.field === "args.text" && e.code === "REQUIRED",
      ),
    ).toBe(true);
  });

  it("type=text rejects an empty text string", () => {
    const errors = validateAction({
      activity: "channelSend",
      name: "send",
      args: { ...baseFields, type: "text", text: "" },
    });
    expect(
      errors.some(
        (e) => e.field === "args.text" && e.code === "REQUIRED",
      ),
    ).toBe(true);
  });

  it("type=template requires templateName and templateLanguage", () => {
    const errors = validateAction({
      activity: "channelSend",
      name: "send",
      args: { ...baseFields, type: "template" },
    });
    const fs = errors
      .map((e) => e.field)
      .filter((f) => f?.startsWith("args.template"))
      .sort();
    expect(fs).toEqual(["args.templateLanguage", "args.templateName"]);
  });

  it("type=template passes when both template fields are present", () => {
    expect(
      ok({
        activity: "channelSend",
        name: "send",
        args: {
          ...baseFields,
          type: "template",
          templateName: "welcome",
          templateLanguage: "en_US",
        },
      }),
    ).toBe(true);
  });

  it("type=image requires mediaUrl", () => {
    const errors = validateAction({
      activity: "channelSend",
      name: "send",
      args: { ...baseFields, type: "image" },
    });
    expect(
      errors.some(
        (e) => e.field === "args.mediaUrl" && e.code === "REQUIRED",
      ),
    ).toBe(true);
  });

  it("type=document requires mediaUrl", () => {
    const errors = validateAction({
      activity: "channelSend",
      name: "send",
      args: { ...baseFields, type: "document" },
    });
    expect(
      errors.some(
        (e) => e.field === "args.mediaUrl" && e.code === "REQUIRED",
      ),
    ).toBe(true);
  });
});

describe("validateAction — agentCall", () => {
  it("requires agentId and message", () => {
    const fs = fields({ activity: "agentCall", name: "ag", args: {} }).sort();
    expect(fs).toEqual(["args.agentId", "args.message"]);
  });

  it("passes with agentId and message", () => {
    expect(
      ok({
        activity: "agentCall",
        name: "ag",
        args: { agentId: "ag-1", message: "hi" },
      }),
    ).toBe(true);
  });

  it("rejects invalid context sender", () => {
    expect(
      codes({
        activity: "agentCall",
        name: "ag",
        args: {
          agentId: "ag-1",
          message: "hi",
          context: [{ sender: "bot", content: "x" }],
        },
      }),
    ).toContain("INVALID_ENUM");
  });
});

describe("validateAction — branch", () => {
  it("requires at least one non-empty path", () => {
    expect(
      codes({ activity: "branch", name: "br" }),
    ).toContain("BRANCH_EMPTY");
  });

  it("rejects branch where all paths are empty arrays", () => {
    expect(
      codes({ activity: "branch", name: "br", path1: [], path2: [] }),
    ).toContain("BRANCH_EMPTY");
  });

  it("validates nested actions inside branch paths", () => {
    const errors = validateAction({
      activity: "branch",
      name: "br",
      path1: [{ activity: "jsFunction", name: "fn", args: {} }],
    });
    expect(errors.some((e) => e.code === "REQUIRED")).toBe(true);
    expect(errors.some((e) => e.field?.startsWith("path1[0]"))).toBe(true);
  });

  it("passes when at least one path has a valid action", () => {
    expect(
      ok({
        activity: "branch",
        name: "br",
        yes: [{ activity: "jsFunction", name: "fn", args: { code: "1" } }],
      }),
    ).toBe(true);
  });

  it("respects MAX_BRANCH_DEPTH on deeply nested branches", () => {
    let nested: Record<string, unknown> = {
      activity: "jsFunction",
      name: "leaf",
      args: { code: "x" },
    };
    for (let i = 0; i < 20; i++) {
      nested = {
        activity: "branch",
        name: `br${i}`,
        path: [nested],
      };
    }
    expect(codes(nested)).toContain("MAX_DEPTH_EXCEEDED");
  });
});

describe("validateAction — unknown activity", () => {
  it("rejects unknown activity types", () => {
    expect(codes({ activity: "wat", name: "x" })).toContain("INVALID_ENUM");
  });

  it("rejects non-object input", () => {
    expect(codes(null)).toContain("INVALID_VALUE");
    expect(codes("string")).toContain("INVALID_VALUE");
  });
});
