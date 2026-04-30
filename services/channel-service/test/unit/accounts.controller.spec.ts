import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { AccountsController } from "../../src/modules/accounts/accounts.controller";
import { AccountsService } from "../../src/modules/accounts/accounts.service";

describe("AccountsController", () => {
  let controller: AccountsController;

  beforeEach(async () => {
    const accountsService = {
      create: mock(() => Promise.resolve({})),
      list: mock(() => Promise.resolve([])),
      findById: mock(() => Promise.resolve(null)),
      update: mock(() => Promise.resolve(null)),
      remove: mock(() => Promise.resolve(false)),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AccountsController],
      providers: [{ provide: AccountsService, useValue: accountsService }],
    }).compile();

    controller = moduleRef.get(AccountsController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });
});
