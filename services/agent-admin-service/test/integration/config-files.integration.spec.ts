import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { TENANT_HEADER } from "@yoizen/shared";
import request from "supertest";
import { ConfigFilesModule } from "../../src/modules/config-files/config-files.module";
import { CONFIG_FILES_REPOSITORY } from "../../src/modules/config-files/config-files.repository.interface";
import { LAZY_NATS, NatsPublisher } from "../../src/providers/nats.provider";
import { YoizenclawTenantConnectionManager } from "../../src/providers/tenant-connection-manager";
import {
  createIntegrationApp,
  createIntegrationLazyNats,
  createIntegrationTenantConnectionManager,
} from "./harness";
import { createInMemoryConfigFilesRepository } from "./in-memory-repositories";

const createMockNatsPublisher = () => ({
  publishRuntimeConfigSync: async () => null,
});

describe("ConfigFiles Integration Tests", () => {
  let app: NestFastifyApplication;
  let mockNatsPublisher: ReturnType<typeof createMockNatsPublisher>;
  const TENANT_ID = "test-tenant-123";

  beforeAll(async () => {
    mockNatsPublisher = createMockNatsPublisher();

    app = await createIntegrationApp({
      imports: [ConfigFilesModule],
      globals: [
        { provide: NatsPublisher, useValue: mockNatsPublisher },
        { provide: LAZY_NATS, useValue: createIntegrationLazyNats() },
        {
          provide: YoizenclawTenantConnectionManager,
          useValue: createIntegrationTenantConnectionManager(),
        },
      ],
      overrides: [
        {
          token: CONFIG_FILES_REPOSITORY,
          value: createInMemoryConfigFilesRepository(),
        },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    // Reset mocks before each test
  });

  describe("GET /admin/config-files", () => {
    it("should list config files with pagination", async () => {
      const response = await request(app.getHttpServer())
        .get("/admin/config-files?limit=10&offset=0")
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(response.body).toHaveProperty("files");
      expect(response.body).toHaveProperty("total");
      expect(Array.isArray(response.body.files)).toBe(true);
    });

    it("should require tenant header", async () => {
      await request(app.getHttpServer()).get("/admin/config-files").expect(400);
    });
  });

  describe("GET /admin/config-files/file", () => {
    it("should get config file by path", async () => {
      // First create a config file
      const createResponse = await request(app.getHttpServer())
        .put("/admin/config-files")
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: "Test Config",
          path: "/config/test.yaml",
          content: "key: value",
          format: "yaml",
        })
        .expect(200);

      // Then get it by path
      const response = await request(app.getHttpServer())
        .get("/admin/config-files/file?path=/config/test.yaml")
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(response.body.path).toBe("/config/test.yaml");
      expect(response.body.content).toBe("key: value");
    });

    it("should return 404 for non-existent path", async () => {
      await request(app.getHttpServer())
        .get("/admin/config-files/file?path=/config/nonexistent.yaml")
        .set(TENANT_HEADER, TENANT_ID)
        .expect(404);
    });

    it("should require path parameter", async () => {
      await request(app.getHttpServer())
        .get("/admin/config-files/file")
        .set(TENANT_HEADER, TENANT_ID)
        .expect(400);
    });
  });

  describe("PUT /admin/config-files", () => {
    it("should create new config file", async () => {
      const response = await request(app.getHttpServer())
        .put("/admin/config-files")
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: "New Config",
          path: "/config/new.yaml",
          content: "key: value",
          format: "yaml",
        })
        .expect(200);

      expect(response.body).toHaveProperty("id");
      expect(response.body.path).toBe("/config/new.yaml");
      expect(response.body.version).toBe(1);
      expect(response.body.format).toBe("yaml");
    });

    it("should update existing config file and increment version", async () => {
      // First create
      const createResponse = await request(app.getHttpServer())
        .put("/admin/config-files")
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: "Version Test",
          path: "/config/version-test.yaml",
          content: "version: 1",
          format: "yaml",
        })
        .expect(200);

      expect(createResponse.body.version).toBe(1);

      // Then update
      const updateResponse = await request(app.getHttpServer())
        .put("/admin/config-files")
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: "Version Test Updated",
          path: "/config/version-test.yaml",
          content: "version: 2",
          format: "yaml",
        })
        .expect(200);

      expect(updateResponse.body.version).toBe(2);
      expect(updateResponse.body.content).toBe("version: 2");
    });

    it("should validate required fields", async () => {
      const invalidData = {
        name: "",
        path: "",
        content: "",
        format: "invalid",
      };

      await request(app.getHttpServer())
        .put("/admin/config-files")
        .set(TENANT_HEADER, TENANT_ID)
        .send(invalidData)
        .expect(400);
    });

    it("should validate format enum", async () => {
      const invalidData = {
        name: "Test",
        path: "/config/test.yaml",
        content: "key: value",
        format: "xml",
      };

      await request(app.getHttpServer())
        .put("/admin/config-files")
        .set(TENANT_HEADER, TENANT_ID)
        .send(invalidData)
        .expect(400);
    });

    it("should require tenant header", async () => {
      const configData = {
        name: "Test Config",
        path: "/config/test.yaml",
        content: "key: value",
        format: "yaml",
      };

      await request(app.getHttpServer())
        .put("/admin/config-files")
        .send(configData)
        .expect(400);
    });
  });

  describe("POST /admin/config-files/deploy", () => {
    it("should deploy and emit runtime config sync event", async () => {
      // Create some config files first
      await request(app.getHttpServer())
        .put("/admin/config-files")
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: "App Config",
          path: "/config/app.yaml",
          content: "app: config",
          format: "yaml",
        })
        .expect(200);

      await request(app.getHttpServer())
        .put("/admin/config-files")
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: "Routes Config",
          path: "/config/routes.json",
          content: '{"routes": []}',
          format: "json",
        })
        .expect(200);

      // Deploy
      const response = await request(app.getHttpServer())
        .post("/admin/config-files/deploy")
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(response.body).toHaveProperty("files");
      expect(response.body).toHaveProperty("eventEmitted");
      expect(response.body.eventEmitted).toBe(true);
      expect(response.body.files.length).toBeGreaterThanOrEqual(2);
    });

    it("should support deletePaths parameter", async () => {
      const response = await request(app.getHttpServer())
        .post("/admin/config-files/deploy")
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          deletePaths: ["/config/old.yaml", "/config/deprecated.json"],
        })
        .expect(200);

      expect(response.body.eventEmitted).toBe(true);
    });

    it("should require tenant header", async () => {
      await request(app.getHttpServer())
        .post("/admin/config-files/deploy")
        .expect(400);
    });
  });

  describe("Complete workflow", () => {
    it("should handle full config file lifecycle", async () => {
      // 1. Create config file
      const createResponse = await request(app.getHttpServer())
        .put("/admin/config-files")
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: "Lifecycle Config",
          path: "/config/lifecycle.yaml",
          content: "initial: value",
          format: "yaml",
        })
        .expect(200);

      const configPath = createResponse.body.path;
      expect(createResponse.body.version).toBe(1);

      // 2. List config files - should include the new one
      const listResponse = await request(app.getHttpServer())
        .get("/admin/config-files")
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(listResponse.body.files.length).toBeGreaterThan(0);

      // 3. Get config file by path
      const getResponse = await request(app.getHttpServer())
        .get(`/admin/config-files/file?path=${configPath}`)
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(getResponse.body.name).toBe("Lifecycle Config");

      // 4. Update config file (version should increment)
      const updateResponse = await request(app.getHttpServer())
        .put("/admin/config-files")
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: "Updated Lifecycle Config",
          path: configPath,
          content: "updated: value",
          format: "yaml",
        })
        .expect(200);

      expect(updateResponse.body.name).toBe("Updated Lifecycle Config");
      expect(updateResponse.body.version).toBe(2);

      // 5. Deploy config files
      const deployResponse = await request(app.getHttpServer())
        .post("/admin/config-files/deploy")
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(deployResponse.body.eventEmitted).toBe(true);
      expect(deployResponse.body.files.length).toBeGreaterThan(0);
    });
  });
});
