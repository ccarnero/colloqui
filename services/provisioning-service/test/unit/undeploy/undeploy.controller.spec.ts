import "../../setup-env";
import { describe, expect, it } from "bun:test";
import { HttpException } from "@nestjs/common";
import { UndeployController } from "../../../src/modules/undeploy/undeploy.controller";
import type { UndeployService } from "../../../src/modules/undeploy/undeploy.service";

function controllerWith(
  undeploy: UndeployService["undeploy"]
): UndeployController {
  return new UndeployController({ undeploy } as unknown as UndeployService);
}

describe("UndeployController", () => {
  it("POST /manifests/:name/undeploy returns the report of a successful run", async () => {
    const controller = controllerWith(async () => ({
      ok: true,
      value: {
        manifestName: "demo",
        resources: [
          {
            kind: "workflow",
            name: "router",
            action: "deleted",
            externalId: "w1",
          },
        ],
        secrets: [],
        deletedCount: 1,
        notFoundCount: 0,
        skippedCount: 0,
        checksumRowsDeleted: 0,
        manifestRecordDeleted: true,
        durationMs: 7,
      },
    }));

    const response = await controller.undeploy("acme", "demo");

    expect(response).toMatchObject({
      manifestName: "demo",
      deletedCount: 1,
      manifestRecordDeleted: true,
    });
  });

  it("returns 200 (not an error) when everything was already gone", async () => {
    const controller = controllerWith(async () => ({
      ok: true,
      value: {
        manifestName: "demo",
        resources: [{ kind: "workflow", name: "router", action: "not_found" }],
        secrets: [],
        deletedCount: 0,
        notFoundCount: 1,
        skippedCount: 0,
        checksumRowsDeleted: 0,
        manifestRecordDeleted: true,
        durationMs: 2,
      },
    }));

    await expect(controller.undeploy("acme", "demo")).resolves.toMatchObject({
      notFoundCount: 1,
    });
  });

  it("throws 404 when the manifest is not stored for this tenant", async () => {
    const controller = controllerWith(async () => ({
      ok: false,
      error: { kind: "manifest_not_found", name: "missing" },
    }));

    try {
      await controller.undeploy("acme", "missing");
      throw new Error("expected undeploy to throw");
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(HttpException);
      expect((thrown as HttpException).getStatus()).toBe(404);
    }
  });

  it("throws 409 with the dependents when the shared-resource guard blocks", async () => {
    const controller = controllerWith(async () => ({
      ok: false,
      error: {
        kind: "undeploy_blocked",
        manifestName: "crm-library",
        dependents: [
          {
            manifestName: "crm-support",
            resourceKind: "connector",
            resourceName: "hubspot",
          },
        ],
        message: "blocked",
      },
    }));

    try {
      await controller.undeploy("acme", "crm-library");
      throw new Error("expected undeploy to throw");
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(HttpException);
      const exception = thrown as HttpException;
      expect(exception.getStatus()).toBe(409);
      expect(exception.getResponse()).toMatchObject({
        error: { kind: "undeploy_blocked" },
      });
    }
  });

  it("throws 409 with the partial report when a delete fails mid-run", async () => {
    const controller = controllerWith(async () => ({
      ok: false,
      error: {
        kind: "undeploy_failed",
        manifestName: "demo",
        resources: [],
        secrets: [],
        pending: [{ kind: "channel", name: "tg-in" }],
        failure: {
          kind: "downstream_error",
          resourceKind: "channel",
          resourceName: "tg-in",
          message: "HTTP 500",
        },
        manifestRecordDeleted: false,
        durationMs: 3,
      },
    }));

    try {
      await controller.undeploy("acme", "demo");
      throw new Error("expected undeploy to throw");
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(HttpException);
      const exception = thrown as HttpException;
      expect(exception.getStatus()).toBe(409);
      expect(exception.getResponse()).toMatchObject({
        error: { kind: "undeploy_failed", manifestRecordDeleted: false },
      });
    }
  });
});
