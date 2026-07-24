import "reflect-metadata";
import { describe, expect, it } from "bun:test";
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

  // manual-loops/provisioning-manifest-gaps-4.md T04 (Option B — k8s-native
  // valueFrom.secretKeyRef, human ruling 2026-07-24).
  it("maps a { secretKeyRef } entry to the k8s-native valueFrom.secretKeyRef variant", () => {
    expect(
      envRecordToKnativeEnvList({
        YOIZEN_PASSWORD: {
          secretKeyRef: {
            name: "psec-service-priority-scorer",
            key: "scorer-password",
          },
        },
      })
    ).toEqual([
      {
        name: "YOIZEN_PASSWORD",
        valueFrom: {
          secretKeyRef: {
            name: "psec-service-priority-scorer",
            key: "scorer-password",
          },
        },
      },
    ]);
  });

  it("mixes literal and secretKeyRef entries in the same array (same order as declared)", () => {
    expect(
      envRecordToKnativeEnvList({
        MODE: "production",
        YOIZEN_PASSWORD: {
          secretKeyRef: {
            name: "psec-service-priority-scorer",
            key: "scorer-password",
          },
        },
      })
    ).toEqual([
      { name: "MODE", value: "production" },
      {
        name: "YOIZEN_PASSWORD",
        valueFrom: {
          secretKeyRef: {
            name: "psec-service-priority-scorer",
            key: "scorer-password",
          },
        },
      },
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
        template: {
          spec: {
            containers: Array<{ env?: Array<{ name: string; value: string }> }>;
          };
        };
      }
    ).template.spec.containers;
    expect(containers[0]?.image).toBe("img:v1");
    expect(containers[0]?.env).toContainEqual({ name: "FOO", value: "bar" });
  });

  // manual-loops/provisioning-manifest-gaps-4.md T04 (Option B).
  it("emits a mixed env[] (literal + secretKeyRef) in the Knative container spec", () => {
    const body = buildKnativeServiceBody({
      namespace: "ns-a",
      name: "svc-1",
      image: "img:v1",
      port: 8080,
      minScale: 0,
      maxScale: 3,
      concurrencyTarget: 10,
      envVars: {
        MODE: "production",
        YOIZEN_PASSWORD: {
          secretKeyRef: { name: "psec-service-svc-1", key: "svc-password" },
        },
      },
    });
    const containers = (
      body.spec as {
        template: {
          spec: {
            containers: Array<{
              env?: Array<
                | { name: string; value: string }
                | {
                    name: string;
                    valueFrom: {
                      secretKeyRef: { name: string; key: string };
                    };
                  }
              >;
            }>;
          };
        };
      }
    ).template.spec.containers;
    expect(containers[0]?.env).toEqual([
      { name: "MODE", value: "production" },
      {
        name: "YOIZEN_PASSWORD",
        valueFrom: {
          secretKeyRef: { name: "psec-service-svc-1", key: "svc-password" },
        },
      },
    ]);
  });
});
