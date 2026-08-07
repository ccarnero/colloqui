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
import { JOB_EXECUTIONS_REPOSITORY } from "../../src/modules/jobs/job-executions.repository.interface";
import { JobsModule } from "../../src/modules/jobs/jobs.module";
import { JOBS_REPOSITORY } from "../../src/modules/jobs/jobs.repository.interface";
import { LAZY_NATS, NatsPublisher } from "../../src/providers/nats.provider";
import { YoizenclawTenantConnectionManager } from "../../src/providers/tenant-connection-manager";
import {
  createIntegrationApp,
  createIntegrationLazyNats,
  createIntegrationTenantConnectionManager,
} from "./harness";
import { createInMemoryJobsBackend } from "./in-memory-repositories";

const createMockNatsPublisher = () => ({
  publishJobTrigger: async () => null,
});

/**
 * `CreateJobDto.agent_id` is `@IsUUID()`, and so are the `agent_id`/`job_id`
 * list filters. The suite used to send `"agent-1"` / `"job-1"`, which only
 * survived because the app was built without the production `ValidationPipe`.
 */
const AGENT_ID = "3f1a6b0e-6a5f-4a3a-9a2d-1c5d0b7e9f11";
const OTHER_JOB_ID = "8c2b7d10-4e6f-4b8c-9d1e-2a3b4c5d6e7f";

describe("Jobs Integration Tests", () => {
  let app: NestFastifyApplication;
  let mockNatsPublisher: ReturnType<typeof createMockNatsPublisher>;
  const TENANT_ID = "test-tenant-123";

  beforeAll(async () => {
    mockNatsPublisher = createMockNatsPublisher();
    const repositories = createInMemoryJobsBackend();

    app = await createIntegrationApp({
      imports: [JobsModule],
      globals: [
        { provide: NatsPublisher, useValue: mockNatsPublisher },
        { provide: LAZY_NATS, useValue: createIntegrationLazyNats() },
        {
          provide: YoizenclawTenantConnectionManager,
          useValue: createIntegrationTenantConnectionManager(),
        },
      ],
      overrides: [
        { token: JOBS_REPOSITORY, value: repositories.jobs },
        { token: JOB_EXECUTIONS_REPOSITORY, value: repositories.executions },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    // Reset mocks before each test
  });

  describe("POST /admin/jobs", () => {
    it("should create a new job", async () => {
      const jobData = {
        name: "Test Job",
        agent_id: AGENT_ID,
        schedule: "0 */6 * * *",
        payload: { key: "value" },
        is_active: true,
      };

      const response = await request(app.getHttpServer())
        .post("/admin/jobs")
        .set(TENANT_HEADER, TENANT_ID)
        .send(jobData)
        .expect(201);

      expect(response.body).toHaveProperty("id");
      expect(response.body.name).toBe(jobData.name);
      expect(response.body.agent_id).toBe(jobData.agent_id);
      expect(response.body.schedule).toBe(jobData.schedule);
      expect(response.body.is_active).toBe(true);
    });

    it("should validate required fields", async () => {
      const invalidData = {
        name: "",
        agent_id: "not-a-uuid",
        schedule: "",
      };

      await request(app.getHttpServer())
        .post("/admin/jobs")
        .set(TENANT_HEADER, TENANT_ID)
        .send(invalidData)
        .expect(400);
    });

    it("should require tenant header", async () => {
      const jobData = {
        name: "Test Job",
        agent_id: AGENT_ID,
        schedule: "0 */6 * * *",
      };

      await request(app.getHttpServer())
        .post("/admin/jobs")
        .send(jobData)
        .expect(400);
    });

    it("should create job with interval schedule", async () => {
      const jobData = {
        name: "Interval Job",
        agent_id: AGENT_ID,
        schedule: "interval:30",
        payload: {},
      };

      const response = await request(app.getHttpServer())
        .post("/admin/jobs")
        .set(TENANT_HEADER, TENANT_ID)
        .send(jobData)
        .expect(201);

      expect(response.body.schedule).toBe("interval:30");
    });
  });

  describe("GET /admin/jobs", () => {
    it("should list jobs with pagination", async () => {
      const response = await request(app.getHttpServer())
        .get("/admin/jobs?limit=10&offset=0")
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(response.body).toHaveProperty("jobs");
      expect(response.body).toHaveProperty("total");
      expect(Array.isArray(response.body.jobs)).toBe(true);
    });

    it("should filter by agent_id", async () => {
      const response = await request(app.getHttpServer())
        .get(`/admin/jobs?agent_id=${AGENT_ID}`)
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(response.body).toHaveProperty("jobs");
    });

    it("should filter by is_active", async () => {
      const response = await request(app.getHttpServer())
        .get("/admin/jobs?is_active=true")
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(response.body).toHaveProperty("jobs");
    });
  });

  describe("GET /admin/jobs/:id", () => {
    it("should get job by id", async () => {
      const createResponse = await request(app.getHttpServer())
        .post("/admin/jobs")
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: "Test Job",
          agent_id: AGENT_ID,
          schedule: "0 */6 * * *",
        })
        .expect(201);

      const jobId = createResponse.body.id;

      const response = await request(app.getHttpServer())
        .get(`/admin/jobs/${jobId}`)
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(response.body.id).toBe(jobId);
      expect(response.body.name).toBe("Test Job");
    });

    it("should return 404 for non-existent job", async () => {
      await request(app.getHttpServer())
        .get("/admin/jobs/non-existent-id")
        .set(TENANT_HEADER, TENANT_ID)
        .expect(404);
    });
  });

  describe("PUT /admin/jobs/:id", () => {
    it("should update job", async () => {
      const createResponse = await request(app.getHttpServer())
        .post("/admin/jobs")
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: "Original Name",
          agent_id: AGENT_ID,
          schedule: "0 */6 * * *",
        })
        .expect(201);

      const jobId = createResponse.body.id;

      const response = await request(app.getHttpServer())
        .put(`/admin/jobs/${jobId}`)
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: "Updated Name",
          schedule: "0 */12 * * *",
        })
        .expect(200);

      expect(response.body.name).toBe("Updated Name");
      expect(response.body.schedule).toBe("0 */12 * * *");
    });

    it("should return 404 for non-existent job", async () => {
      await request(app.getHttpServer())
        .put("/admin/jobs/non-existent-id")
        .set(TENANT_HEADER, TENANT_ID)
        .send({ name: "New Name" })
        .expect(404);
    });
  });

  describe("DELETE /admin/jobs/:id", () => {
    it("should delete job", async () => {
      const createResponse = await request(app.getHttpServer())
        .post("/admin/jobs")
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: "Job to Delete",
          agent_id: AGENT_ID,
          schedule: "0 */6 * * *",
        })
        .expect(201);

      const jobId = createResponse.body.id;

      await request(app.getHttpServer())
        .delete(`/admin/jobs/${jobId}`)
        .set(TENANT_HEADER, TENANT_ID)
        .expect(204);

      await request(app.getHttpServer())
        .get(`/admin/jobs/${jobId}`)
        .set(TENANT_HEADER, TENANT_ID)
        .expect(404);
    });

    it("should return 404 for non-existent job", async () => {
      await request(app.getHttpServer())
        .delete("/admin/jobs/non-existent-id")
        .set(TENANT_HEADER, TENANT_ID)
        .expect(404);
    });
  });

  describe("POST /admin/jobs/:id/enable", () => {
    it("should enable job", async () => {
      const createResponse = await request(app.getHttpServer())
        .post("/admin/jobs")
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: "Job to Enable",
          agent_id: AGENT_ID,
          schedule: "0 */6 * * *",
          is_active: false,
        })
        .expect(201);

      const jobId = createResponse.body.id;

      const response = await request(app.getHttpServer())
        .post(`/admin/jobs/${jobId}/enable`)
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(response.body.is_active).toBe(true);
    });

    it("should return 404 for non-existent job", async () => {
      await request(app.getHttpServer())
        .post("/admin/jobs/non-existent-id/enable")
        .set(TENANT_HEADER, TENANT_ID)
        .expect(404);
    });
  });

  describe("POST /admin/jobs/:id/disable", () => {
    it("should disable job", async () => {
      const createResponse = await request(app.getHttpServer())
        .post("/admin/jobs")
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: "Job to Disable",
          agent_id: AGENT_ID,
          schedule: "0 */6 * * *",
          is_active: true,
        })
        .expect(201);

      const jobId = createResponse.body.id;

      const response = await request(app.getHttpServer())
        .post(`/admin/jobs/${jobId}/disable`)
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(response.body.is_active).toBe(false);
    });

    it("should return 404 for non-existent job", async () => {
      await request(app.getHttpServer())
        .post("/admin/jobs/non-existent-id/disable")
        .set(TENANT_HEADER, TENANT_ID)
        .expect(404);
    });
  });

  describe("POST /admin/jobs/:id/run", () => {
    it("should run job manually and create execution", async () => {
      const createResponse = await request(app.getHttpServer())
        .post("/admin/jobs")
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: "Job to Run",
          agent_id: AGENT_ID,
          schedule: "0 */6 * * *",
          is_active: true,
        })
        .expect(201);

      const jobId = createResponse.body.id;

      const response = await request(app.getHttpServer())
        .post(`/admin/jobs/${jobId}/run`)
        .set(TENANT_HEADER, TENANT_ID)
        .expect(201);

      expect(response.body).toHaveProperty("id");
      expect(response.body.job_id).toBe(jobId);
      expect(response.body.status).toBe("running");
      expect(response.body.triggered_by).toBe("manual");
    });

    it("should return 400 for inactive job", async () => {
      const createResponse = await request(app.getHttpServer())
        .post("/admin/jobs")
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: "Inactive Job",
          agent_id: AGENT_ID,
          schedule: "0 */6 * * *",
          is_active: false,
        })
        .expect(201);

      const jobId = createResponse.body.id;

      await request(app.getHttpServer())
        .post(`/admin/jobs/${jobId}/run`)
        .set(TENANT_HEADER, TENANT_ID)
        .expect(400);
    });

    it("should return 404 for non-existent job", async () => {
      await request(app.getHttpServer())
        .post("/admin/jobs/non-existent-id/run")
        .set(TENANT_HEADER, TENANT_ID)
        .expect(404);
    });
  });

  describe("POST /admin/jobs/:id/trigger", () => {
    it("should trigger job with payload and emit event", async () => {
      const createResponse = await request(app.getHttpServer())
        .post("/admin/jobs")
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: "Job to Trigger",
          agent_id: AGENT_ID,
          schedule: "0 */6 * * *",
          is_active: true,
          payload: { default: "value" },
        })
        .expect(201);

      const jobId = createResponse.body.id;

      const response = await request(app.getHttpServer())
        .post(`/admin/jobs/${jobId}/trigger`)
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          event_payload: { custom: "data" },
        })
        .expect(201);

      expect(response.body).toHaveProperty("id");
      expect(response.body.job_id).toBe(jobId);
      expect(response.body.status).toBe("pending");
      expect(response.body.triggered_by).toBe("event");
    });

    it("should trigger job without payload", async () => {
      const createResponse = await request(app.getHttpServer())
        .post("/admin/jobs")
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: "Job to Trigger",
          agent_id: AGENT_ID,
          schedule: "0 */6 * * *",
          is_active: true,
        })
        .expect(201);

      const jobId = createResponse.body.id;

      const response = await request(app.getHttpServer())
        .post(`/admin/jobs/${jobId}/trigger`)
        .set(TENANT_HEADER, TENANT_ID)
        .send({})
        .expect(201);

      expect(response.body.status).toBe("pending");
    });

    it("should return 400 for inactive job", async () => {
      const createResponse = await request(app.getHttpServer())
        .post("/admin/jobs")
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: "Inactive Job",
          agent_id: AGENT_ID,
          schedule: "0 */6 * * *",
          is_active: false,
        })
        .expect(201);

      const jobId = createResponse.body.id;

      await request(app.getHttpServer())
        .post(`/admin/jobs/${jobId}/trigger`)
        .set(TENANT_HEADER, TENANT_ID)
        .send({})
        .expect(400);
    });
  });

  describe("GET /admin/jobs/executions", () => {
    it("should list job executions", async () => {
      const response = await request(app.getHttpServer())
        .get("/admin/jobs/executions?limit=10&offset=0")
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(response.body).toHaveProperty("executions");
      expect(response.body).toHaveProperty("total");
      expect(Array.isArray(response.body.executions)).toBe(true);
    });

    it("should filter by job_id", async () => {
      const response = await request(app.getHttpServer())
        .get(`/admin/jobs/executions?job_id=${OTHER_JOB_ID}`)
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(response.body).toHaveProperty("executions");
    });

    it("should filter by status", async () => {
      const response = await request(app.getHttpServer())
        .get("/admin/jobs/executions?status=completed")
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(response.body).toHaveProperty("executions");
    });
  });

  describe("Complete workflow", () => {
    it("should handle full job lifecycle", async () => {
      // 1. Create job
      const createResponse = await request(app.getHttpServer())
        .post("/admin/jobs")
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: "Lifecycle Job",
          agent_id: AGENT_ID,
          schedule: "interval:60",
          payload: { key: "value" },
        })
        .expect(201);

      const jobId = createResponse.body.id;
      expect(createResponse.body.is_active).toBe(true);

      // 2. List jobs - should include the new one
      const listResponse = await request(app.getHttpServer())
        .get("/admin/jobs")
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(listResponse.body.jobs.length).toBeGreaterThan(0);

      // 3. Get job by id
      const getResponse = await request(app.getHttpServer())
        .get(`/admin/jobs/${jobId}`)
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(getResponse.body.name).toBe("Lifecycle Job");

      // 4. Update job
      const updateResponse = await request(app.getHttpServer())
        .put(`/admin/jobs/${jobId}`)
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          name: "Updated Lifecycle Job",
          schedule: "0 */12 * * *",
        })
        .expect(200);

      expect(updateResponse.body.name).toBe("Updated Lifecycle Job");
      expect(updateResponse.body.schedule).toBe("0 */12 * * *");

      // 5. Disable job
      const disableResponse = await request(app.getHttpServer())
        .post(`/admin/jobs/${jobId}/disable`)
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(disableResponse.body.is_active).toBe(false);

      // 6. Enable job again
      const enableResponse = await request(app.getHttpServer())
        .post(`/admin/jobs/${jobId}/enable`)
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(enableResponse.body.is_active).toBe(true);

      // 7. Run job manually
      const runResponse = await request(app.getHttpServer())
        .post(`/admin/jobs/${jobId}/run`)
        .set(TENANT_HEADER, TENANT_ID)
        .expect(201);

      const executionId = runResponse.body.id;
      expect(runResponse.body.status).toBe("running");

      // 8. List executions - should include the new one
      const executionsResponse = await request(app.getHttpServer())
        .get("/admin/jobs/executions")
        .set(TENANT_HEADER, TENANT_ID)
        .expect(200);

      expect(executionsResponse.body.executions.length).toBeGreaterThan(0);

      // 9. Trigger job with payload
      const triggerResponse = await request(app.getHttpServer())
        .post(`/admin/jobs/${jobId}/trigger`)
        .set(TENANT_HEADER, TENANT_ID)
        .send({
          event_payload: { custom: "data" },
        })
        .expect(201);

      expect(triggerResponse.body.status).toBe("pending");
      expect(triggerResponse.body.triggered_by).toBe("event");

      // 10. Delete job
      await request(app.getHttpServer())
        .delete(`/admin/jobs/${jobId}`)
        .set(TENANT_HEADER, TENANT_ID)
        .expect(204);

      // 11. Verify deletion
      await request(app.getHttpServer())
        .get(`/admin/jobs/${jobId}`)
        .set(TENANT_HEADER, TENANT_ID)
        .expect(404);
    });
  });
});
