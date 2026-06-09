import { describe, it, expect, beforeEach, vi } from "bun:test";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigFilesMongoRepository } from "../../src/modules/config-files/config-files.mongo.repository";
import { YoizenclawTenantConnectionManager } from "../../src/providers/tenant-connection-manager";
import { createMockDb, createMockTenantManager } from "../mongo-mock";

describe("ConfigFilesMongoRepository", () => {
  let repository: ConfigFilesMongoRepository;
  const TENANT_ID = "tenant-123";

  beforeEach(async () => {
    const db = createMockDb({
      config_files: {
        countDocuments: vi.fn(async () => 1),
        find: vi.fn(() => ({
          sort: vi.fn(() => ({
            skip: vi.fn(() => ({
              limit: vi.fn(() => ({
                toArray: vi.fn(async () => [
                  {
                    _id: "cfg-1",
                    name: "app.yaml",
                    path: "/app.yaml",
                    content: "key: value",
                    format: "yaml",
                    version: 1,
                    is_active: true,
                    created_at: new Date(),
                    updated_at: new Date(),
                  },
                ]),
              })),
            })),
          })),
        })),
        findOne: vi.fn(async () => null),
        insertOne: vi.fn(async () => ({ acknowledged: true })),
        findOneAndUpdate: vi.fn(async () => null),
      },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfigFilesMongoRepository,
        {
          provide: YoizenclawTenantConnectionManager,
          useValue: createMockTenantManager(db),
        },
      ],
    }).compile();

    repository = module.get<ConfigFilesMongoRepository>(
      ConfigFilesMongoRepository,
    );
  });

  it("findAll returns files with total", async () => {
    const result = await repository.findAll(TENANT_ID);
    expect(result.total).toBe(1);
    expect(result.files).toHaveLength(1);
  });
});
