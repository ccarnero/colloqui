import "../setup-env";
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { ConflictException, HttpStatus } from "@nestjs/common";
import { Test } from "@nestjs/testing";

const load = async () => {
  const { SystemVariablesController } = await import(
    "../../src/modules/system-variables/system-variables.controller"
  );
  const { SystemVariablesService, SystemVariableConflictError } = await import(
    "../../src/modules/system-variables/system-variables.service"
  );
  return {
    SystemVariablesController,
    SystemVariablesService,
    SystemVariableConflictError,
  };
};

describe("SystemVariablesController", () => {
  let SystemVariablesController: Awaited<
    ReturnType<typeof load>
  >["SystemVariablesController"];
  let controller: InstanceType<typeof SystemVariablesController>;
  let service: Record<string, ReturnType<typeof mock>>;
  let SystemVariableConflictError: Awaited<
    ReturnType<typeof load>
  >["SystemVariableConflictError"];

  beforeEach(async () => {
    const mod = await load();
    SystemVariablesController = mod.SystemVariablesController;
    SystemVariableConflictError = mod.SystemVariableConflictError;
    service = {
      findAll: mock(() => Promise.resolve({ variables: [], total: 0 })),
      findById: mock(() => Promise.resolve(null)),
      create: mock(() => Promise.resolve({ id: "v1", name: "x" })),
      update: mock(() => Promise.resolve({ id: "v1", name: "x" })),
      delete: mock(() => Promise.resolve(true)),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [SystemVariablesController],
      providers: [
        { provide: mod.SystemVariablesService, useValue: service },
      ],
    }).compile();
    controller = moduleRef.get(SystemVariablesController);
  });

  it("findAll calls service.findAll with tenantId", async () => {
    await controller.findAll("t1");
    expect(service.findAll).toHaveBeenCalledWith("t1");
  });

  it("findById calls service.findById with tenantId and id", async () => {
    await controller.findById("t1", "v1");
    expect(service.findById).toHaveBeenCalledWith("t1", "v1");
  });

  it("create calls service.create with tenantId and body", async () => {
    const body = { name: "test", type: "string", value: "hello" };
    await controller.create("t1", body as never);
    expect(service.create).toHaveBeenCalledWith("t1", body);
  });

  it("create returns the reactivated variable unchanged (same success shape)", async () => {
    const reactivated = {
      id: "pre-existing-id",
      name: "crm-support-company-name",
      type: "string",
      value: "ACME Corp",
    };
    service.create = mock(() => Promise.resolve(reactivated));
    const body = {
      name: "crm-support-company-name",
      type: "string",
      value: "ACME Corp",
    };

    const result = await controller.create("t1", body as never);

    expect(result).toEqual(reactivated);
  });

  it("create maps SystemVariableConflictError to 409 naming the variable", async () => {
    service.create = mock(() =>
      Promise.reject(
        new SystemVariableConflictError("crm-support-company-name")
      )
    );
    const body = {
      name: "crm-support-company-name",
      type: "string",
      value: "ACME Corp",
    };

    try {
      await controller.create("t1", body as never);
      throw new Error("expected ConflictException");
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictException);
      const exception = err as ConflictException;
      expect(exception.getStatus()).toBe(HttpStatus.CONFLICT);
      expect(exception.message).toContain("crm-support-company-name");
    }
  });

  it("create rethrows non-conflict errors untouched", async () => {
    const boom = new Error("connection reset");
    service.create = mock(() => Promise.reject(boom));

    await expect(
      controller.create("t1", { name: "x", type: "string", value: "y" } as never)
    ).rejects.toThrow("connection reset");
  });

  it("update calls service.update with tenantId, id, and body", async () => {
    const body = { name: "updated" };
    await controller.update("t1", "v1", body as never);
    expect(service.update).toHaveBeenCalledWith("t1", "v1", body);
  });

  it("delete calls service.delete with tenantId and id", async () => {
    await controller.delete("t1", "v1");
    expect(service.delete).toHaveBeenCalledWith("t1", "v1");
  });
});
