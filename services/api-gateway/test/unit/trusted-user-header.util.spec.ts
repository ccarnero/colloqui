import { describe, expect, it } from "bun:test";
import {
  buildForwardHeaders,
  YOIZEN_USER_ID_HEADER,
} from "../../src/utils/trusted-user-header.util";

describe("trusted-user-header util", () => {
  it("filters hop-by-hop headers and strips spoofed user headers", () => {
    const headers = buildForwardHeaders({
      authorization: "Bearer token",
      host: "api.local",
      connection: "keep-alive",
      "transfer-encoding": "chunked",
      [YOIZEN_USER_ID_HEADER]: "spoofed-user",
      "x-yoizen-tenant": "acme",
    });

    expect(headers).toEqual({
      authorization: "Bearer token",
      "x-yoizen-tenant": "acme",
    });
  });

  it("adds the trusted user header when the backend subject exists", () => {
    const headers = buildForwardHeaders(
      {
        authorization: "Bearer token",
      },
      " user-123 ",
    );

    expect(headers[YOIZEN_USER_ID_HEADER]).toBe("user-123");
  });

  it("does not add the trusted user header when the subject is blank", () => {
    const headers = buildForwardHeaders(
      {
        authorization: "Bearer token",
      },
      "   ",
    );

    expect(headers[YOIZEN_USER_ID_HEADER]).toBeUndefined();
  });
});
