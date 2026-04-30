import { describe, expect, it } from "bun:test";
import { isKubernetesConflictError } from "../../src/providers/kubernetes-errors";

describe("isKubernetesConflictError", () => {
  it("detects generated Kubernetes client response status conflicts", () => {
    expect(
      isKubernetesConflictError({ response: { statusCode: 409 } }),
    ).toBe(true);
  });

  it("detects in-cluster Kubernetes errors by status body", () => {
    expect(
      isKubernetesConflictError({
        body: { code: 409, reason: "AlreadyExists" },
      }),
    ).toBe(true);
  });

  it("detects serialized Kubernetes 409 messages", () => {
    expect(
      isKubernetesConflictError(
        new Error(
          'HTTP-Code: 409\nBody: {"reason":"AlreadyExists","code":409}',
        ),
      ),
    ).toBe(true);
  });

  it("does not classify unrelated errors as conflicts", () => {
    expect(isKubernetesConflictError(new Error("HTTP-Code: 500"))).toBe(false);
  });
});
