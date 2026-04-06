import "../setup-env";
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Test } from "@nestjs/testing";
import { CredentialsController } from "../../src/modules/credentials/credentials.controller";
import { CredentialsService } from "../../src/modules/credentials/credentials.service";

describe("CredentialsController", () => {
  let controller: CredentialsController;
  const findAll = mock(() =>
    Promise.resolve({ credentials: [], total: 0 }),
  );
  const findById = mock(() => Promise.resolve(null));
  const create = mock(() => Promise.resolve({ id: "c1" }));
  const update = mock(() => Promise.resolve({ id: "c1" }));
  const deleteFn = mock(() => Promise.resolve());
  const rotate = mock(() => Promise.resolve({ id: "c1" }));

  beforeEach(async () => {
    const mockService = {
      findAll,
      findById,
      create,
      update,
      delete: deleteFn,
      rotate,
    };
    const module = await Test.createTestingModule({
      controllers: [CredentialsController],
      providers: [{ provide: CredentialsService, useValue: mockService }],
    }).compile();

    controller = module.get(CredentialsController);
  });

  it("findAll delegates to service with tenant from guard context", async () => {
    const result = await controller.findAll("tenant-a", {
      limit: 20,
      offset: 0,
    } as never);
    expect(result.total).toBe(0);
    expect(findAll).toHaveBeenCalledWith("tenant-a", {
      type: undefined,
      is_active: undefined,
      limit: 20,
      offset: 0,
    });
  });

  it("create, update, delete, rotate delegate", async () => {
    await controller.create("t1", {
      name: "n",
      type: "api_key",
      value: "v",
    } as never);
    expect(create).toHaveBeenCalledWith("t1", {
      name: "n",
      type: "api_key",
      value: "v",
      metadata: undefined,
      expires_at: undefined,
      is_active: undefined,
    });

    await controller.update("t1", "id1", { name: "n2" } as never);
    expect(update).toHaveBeenCalledWith("t1", "id1", {
      name: "n2",
      type: undefined,
      value: undefined,
      metadata: undefined,
      expires_at: undefined,
      is_active: undefined,
    });

    await controller.delete("t1", "id1");
    expect(deleteFn).toHaveBeenCalledWith("t1", "id1");

    await controller.rotate("t1", "id1", { new_value: "x" } as never);
    expect(rotate).toHaveBeenCalledWith("t1", "id1", "x", undefined);
  });
});
