import type { EventResult } from "@yoizen/shared";

export interface IEventHandler {
  readonly eventType: string;
  handle(eventId: string, payload: unknown): Promise<EventResult>;
}
