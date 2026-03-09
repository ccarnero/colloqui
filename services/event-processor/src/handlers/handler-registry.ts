import { Injectable, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';
import { EVENT_TYPE_KEY } from './event-type.decorator';
import type { EventHandler } from './event-handler.interface';

@Injectable()
export class HandlerRegistry implements OnModuleInit {
  private readonly handlers = new Map<string, EventHandler>();

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

      this.handlers.set(eventType, instance as EventHandler);
    }
  }

  get(type: string): EventHandler | undefined {
    return this.handlers.get(type);
  }

  has(type: string): boolean {
    return this.handlers.has(type);
  }

  registeredTypes(): string[] {
    return [...this.handlers.keys()];
  }
}
