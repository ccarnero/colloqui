import { Injectable } from "@nestjs/common";
import type { EventResult } from "@yoizen/shared";
import type { IEventHandler } from "./event-handler.interface";

@Injectable()
export class DefaultHandler implements IEventHandler {
  readonly eventType = "__default__";

  async handle(_eventId: string, payload: unknown): Promise<EventResult> {
    const hasContent =
      payload != null &&
      typeof payload === "object" &&
      Object.keys(payload as Record<string, unknown>).length > 0;
    return { processed: hasContent };
  }
}
