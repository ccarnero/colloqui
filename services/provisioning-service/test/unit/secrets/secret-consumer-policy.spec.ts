import "../../setup-env";
import { describe, expect, it } from "bun:test";
import {
  APPLY_ENGINE_CONSUMER_SERVICE,
  isConsumerAuthorized,
} from "../../../src/modules/secrets/lib/secret-consumer-policy";

describe("isConsumerAuthorized", () => {
  it("the apply engine may act for EVERY resource kind", () => {
    for (const kind of [
      "channel",
      "connector",
      "agent",
      "service",
      "workflow",
    ] as const) {
      expect(isConsumerAuthorized(APPLY_ENGINE_CONSUMER_SERVICE, kind)).toBe(
        true
      );
    }
  });

  it("kind-scoped runtime consumers may resolve ONLY their own kind", () => {
    expect(isConsumerAuthorized("channel-service", "channel")).toBe(true);
    expect(isConsumerAuthorized("channel-service", "connector")).toBe(false);

    expect(isConsumerAuthorized("connector-runtime", "connector")).toBe(true);
    expect(isConsumerAuthorized("connector-runtime", "channel")).toBe(false);

    expect(isConsumerAuthorized("agent-ai-service", "agent")).toBe(true);
    expect(isConsumerAuthorized("agent-ai-service", "connector")).toBe(false);

    expect(isConsumerAuthorized("workflow-service", "workflow")).toBe(true);
    expect(isConsumerAuthorized("workflow-service", "agent")).toBe(false);
  });

  it("an unknown or empty consumer identity is never authorized", () => {
    expect(isConsumerAuthorized("some-random-service", "channel")).toBe(false);
    expect(isConsumerAuthorized("", "channel")).toBe(false);
  });

  it("service (hosted-service) secrets are broker-resolvable only by the apply engine in T05", () => {
    expect(isConsumerAuthorized(APPLY_ENGINE_CONSUMER_SERVICE, "service")).toBe(
      true
    );
    expect(isConsumerAuthorized("channel-service", "service")).toBe(false);
    expect(isConsumerAuthorized("connector-runtime", "service")).toBe(false);
  });
});
