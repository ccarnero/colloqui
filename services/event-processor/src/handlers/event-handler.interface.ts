import type { EventResult } from '@yoizen/shared';

export interface EventHandler {
  readonly eventType: string;
  handle(eventId: string, payload: unknown): Promise<EventResult>;
}
