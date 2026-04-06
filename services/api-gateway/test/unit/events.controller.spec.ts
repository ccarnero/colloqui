import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { EventsController } from "../../src/modules/events/events.controller";
import { EventsService } from "../../src/modules/events/events.service";
import { EventDto } from "../../src/modules/events/event.dto";
import { JETSTREAM, NATS_CONNECTION } from "../../src/providers/nats.provider";
import { REDIS_CLIENT } from "../../src/providers/redis.provider";
import { REQUEST_TENANT_KEY } from "../../src/guards/tenant.guard";
import type { ITenantScopedRequest } from "../../src/types/yoizen-request";

const TENANT_ID = "test-tenant";

function fakeReq(): ITenantScopedRequest {
  return { [REQUEST_TENANT_KEY]: TENANT_ID } as ITenantScopedRequest;
}

describe("EventsController", () => {
  let controller: EventsController;
  let service: EventsService;

  beforeEach(async () => {
    const mockPipeline = {
      setex: mock(function (this: unknown) {
        return this;
      }),
      exec: mock(() => Promise.resolve([])),
    };

    const module = await Test.createTestingModule({
      controllers: [EventsController],
      providers: [
        EventsService,
        {
          provide: JETSTREAM,
          useValue: { publish: mock(() => Promise.resolve({ seq: 1 })) },
        },
        {
          provide: NATS_CONNECTION,
          useValue: {
            subscribe: mock(() => ({
              [Symbol.asyncIterator]: () => ({
                next: () => Promise.resolve({ done: true, value: undefined }),
              }),
              unsubscribe: mock(),
            })),
            isClosed: mock(() => false),
          },
        },
        {
          provide: REDIS_CLIENT,
          useValue: {
            get: mock(() => Promise.resolve(null)),
            pipeline: mock(() => mockPipeline),
          },
        },
      ],
    }).compile();

    controller = module.get(EventsController);
    service = module.get(EventsService);
  });

  describe("POST /events", () => {
    it("should return id and accepted status", async () => {
      const dto = new EventDto();
      dto.type = "created";
      dto.payload = { name: "test" };
      const result = await controller.publish(fakeReq(), dto);

      expect(result).toHaveProperty("id");
      expect(result.status).toBe("accepted");
      expect(typeof result.id).toBe("string");
    });
  });

  describe("GET /results/:id", () => {
    it("should return result when found", async () => {
      const data = { eventId: "abc", processed: true };
      service.getResult = mock(() =>
        Promise.resolve(data),
      ) as EventsService["getResult"];

      const result = await controller.getResult(fakeReq(), "abc");
      expect(result).toEqual(data);
    });

    it("should throw NotFoundException when result is null", async () => {
      service.getResult = mock(() =>
        Promise.resolve(null),
      ) as EventsService["getResult"];

      try {
        await controller.getResult(fakeReq(), "nonexistent");
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(NotFoundException);
      }
    });
  });
});
