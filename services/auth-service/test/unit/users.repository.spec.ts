import { describe, it, expect, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { createMockMongoClient } from "@yoizen/testing";
import { UsersMongoRepository } from "../../src/modules/users/users.mongo.repository";
import { MONGO_CLIENT } from "../../src/providers/mongo.provider";

describe("UsersMongoRepository", () => {
  it("insertUser forwards parameters to Mongo", async () => {
    let capturedDoc: unknown;
    const client = createMockMongoClient(
      new Map([
        [
          "platform_users",
          (operation, args) => {
            if (operation === "insertOne") {
              capturedDoc = args[0];
              return { acknowledged: true };
            }
            return null;
          },
        ],
      ]),
      mock,
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersMongoRepository,
        { provide: MONGO_CLIENT, useValue: client },
      ],
    }).compile();

    const repo = moduleRef.get(UsersMongoRepository);
    await repo.insertUser({
      id: "id1",
      email: "a@b.com",
      passwordHash: "hash",
      role: "admin",
    });

    expect(capturedDoc).toMatchObject({
      _id: "id1",
      email: "a@b.com",
      password_hash: "hash",
      role: "admin",
    });
  });
});
