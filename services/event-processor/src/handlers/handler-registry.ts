import { Injectable, OnModuleInit } from "@nestjs/common";
import { DiscoveryService, Reflector } from "@nestjs/core";
import { EVENT_TYPE_KEY } from "./event-type.decorator";
import type { IEventHandler } from "./event-handler.interface";

@Injectable()
export class HandlerRegistry implements OnModuleInit {
  private readonly handlers = new Map<string, IEventHandler>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly reflector: Reflector,
  ) {}

  onModuleInit(): void {
    const wrappers = this.discovery.getProviders();
    for (const wrapper of wrappers) {
      const { instance } = wrapper;
      if (!instance || !wrapper.metatype) continue;

      const eventType = this.reflector.get<string | undefined>(
        EVENT_TYPE_KEY,
        wrapper.metatype,
      );
      if (eventType === undefined) continue;

      this.handlers.set(eventType, instance as IEventHandler);
    }
  }

  get(type: string): IEventHandler | undefined {
    return this.handlers.get(type);
  }
}
