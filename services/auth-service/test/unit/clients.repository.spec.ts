import { describe, it, expect, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { createMockMongoClient } from "@yoizen/testing";
import { ClientsMongoRepository } from "../../src/modules/clients/clients.mongo.repository";
import { MONGO_CLIENT } from "../../src/providers/mongo.provider";

describe("ClientsMongoRepository", () => {
  it("insertClient uses options object", async () => {
    let capturedDoc: unknown;
    const client = createMockMongoClient(
      new Map([
        [
          "api_clients",
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
        ClientsMongoRepository,
        { provide: MONGO_CLIENT, useValue: client },
      ],
    }).compile();

    const repo = moduleRef.get(ClientsMongoRepository);
    await repo.insertClient({
      id: "i1",
      clientId: "client_x",
      secretHash: "h",
      name: "n",
      scope: "platform",
    });

    expect(capturedDoc).toMatchObject({
      _id: "i1",
      client_id: "client_x",
      name: "n",
      scope: "platform",
    });
  });
});
