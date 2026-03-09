import { Injectable } from '@nestjs/common';
import type { EventResult } from '@yoizen/shared';
import { EventType } from './event-type.decorator';
import type { EventHandler } from './event-handler.interface';

@Injectable()
@EventType('created')
export class CreatedHandler implements EventHandler {
  readonly eventType = 'created';

  async handle(_eventId: string, _payload: unknown): Promise<EventResult> {
    return { processed: true };
  }
}
