import "reflect-metadata";
import { describe, it, expect } from "bun:test";
import {
  buildKnativeServiceBody,
  envRecordToKnativeEnvList,
} from "../../src/modules/services/knative-builder";

describe("envRecordToKnativeEnvList", () => {
  it("maps env object to Knative env array", () => {
    expect(envRecordToKnativeEnvList({ FOO: "a", BAR: "b" })).toEqual([
      { name: "FOO", value: "a" },
      { name: "BAR", value: "b" },
    ]);
  });
});

describe("buildKnativeServiceBody", () => {
  it("sets metadata name, namespace, and Knative apiVersion", () => {
    const body = buildKnativeServiceBody({
      namespace: "ns-a",
      name: "svc-1",
      image: "img:v1",
      port: 8080,
      minScale: 0,
      maxScale: 3,
      concurrencyTarget: 10,
      envVars: { FOO: "bar" },
    });
    expect(body.kind).toBe("Service");
    expect((body.metadata as { name: string }).name).toBe("svc-1");
    expect((body.metadata as { namespace: string }).namespace).toBe("ns-a");
    const containers = (
      body.spec as {
        template: { spec: { containers: Array<{ env?: Array<{ name: string; value: string }> }> } };
      }
    ).template.spec.containers;
    expect(containers[0]?.image).toBe("img:v1");
    expect(containers[0]?.env).toContainEqual({ name: "FOO", value: "bar" });
  });
});
