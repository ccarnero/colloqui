import "../../setup-env";
import { describe, expect, it } from "bun:test";
import {
  SECRET_LABEL_KEYS,
  secretResourceLabelSelector,
  secretResourceLabels,
} from "../../../src/modules/secrets/lib/secret-labels";

describe("secretResourceLabels", () => {
  it("builds the {tenant, kind, owner} label set", () => {
    const labels = secretResourceLabels("acme", "connector", "hubspot");
    expect(labels[SECRET_LABEL_KEYS.tenant]).toBe("acme");
    expect(labels[SECRET_LABEL_KEYS.kind]).toBe("connector");
    expect(labels[SECRET_LABEL_KEYS.owner]).toBe("hubspot");
  });

  it("never includes a value-shaped key", () => {
    const labels = secretResourceLabels("acme", "channel", "http-in");
    expect(Object.keys(labels)).toEqual([
      SECRET_LABEL_KEYS.tenant,
      SECRET_LABEL_KEYS.kind,
      SECRET_LABEL_KEYS.owner,
    ]);
  });
});

describe("secretResourceLabelSelector", () => {
  it("builds a tenant-scoped label selector for k8s list calls", () => {
    expect(secretResourceLabelSelector("acme")).toBe(
      `${SECRET_LABEL_KEYS.tenant}=acme`
    );
  });
});
