import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { createMockMongoClient } from "@yoizen/testing";
import { PublicRoutesMongoRepository } from "../../src/modules/public-routes/public-routes.mongo.repository";
import { MONGO_CLIENT } from "../../src/providers/mongo.provider";

describe("PublicRoutesMongoRepository", () => {
  beforeEach(() => {
    process.env.PLATFORM_ENVIRONMENT = "dev";
  });

  it("insertRoute includes environment", async () => {
    let capturedDoc: unknown;
    const client = createMockMongoClient(
      new Map([
        [
          "public_routes",
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
        PublicRoutesMongoRepository,
        { provide: MONGO_CLIENT, useValue: client },
      ],
    }).compile();

    const repo = moduleRef.get(PublicRoutesMongoRepository);
    await repo.insertRoute("r1", "GET", "/x", "platform");

    expect(capturedDoc).toMatchObject({
      _id: "r1",
      method: "GET",
      path_pattern: "/x",
      scope: "platform",
      environment: "dev",
    });
  });
});
