import "reflect-metadata";
import { describe, it, expect, mock } from "bun:test";
import type { DiscoveryService } from "@nestjs/core";
import type { Reflector } from "@nestjs/core";
import { HandlerRegistry } from "../../src/handlers/handler-registry";
import { EVENT_TYPE_KEY } from "../../src/handlers/event-type.decorator";
import { CreatedHandler } from "../../src/handlers/lifecycle-handlers";
import type { IEventHandler } from "../../src/handlers/event-handler.interface";

describe("HandlerRegistry", () => {
  it("registers providers with @EventType metadata", () => {
    const handlerInstance: IEventHandler = {
      eventType: "created",
      handle: mock(() => Promise.resolve({ processed: true })),
    };

    const reflector = {
      get: mock((key: string, metatype: unknown) => {
        if (key === EVENT_TYPE_KEY && metatype === CreatedHandler) {
          return "created";
        }
        return undefined;
      }),
    } as unknown as Reflector;

    const discovery = {
      getProviders: mock(() => [
        { instance: handlerInstance, metatype: CreatedHandler },
      ]),
    } as unknown as DiscoveryService;

    const registry = new HandlerRegistry(discovery, reflector);
    registry.onModuleInit();

    expect(registry.get("created")).toBe(handlerInstance);
    expect(registry.get("unknown")).toBeUndefined();
  });
});
