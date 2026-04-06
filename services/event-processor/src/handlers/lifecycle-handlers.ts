import { Injectable } from "@nestjs/common";
import type { EventResult } from "@yoizen/shared";
import { EventType } from "./event-type.decorator";
import type { IEventHandler } from "./event-handler.interface";

async function noopProcessed(
  _eventId: string,
  _payload: unknown,
): Promise<EventResult> {
  return { processed: true };
}

@Injectable()
@EventType("created")
export class CreatedHandler implements IEventHandler {
  readonly eventType = "created";
  handle = noopProcessed;
}

@Injectable()
@EventType("updated")
export class UpdatedHandler implements IEventHandler {
  readonly eventType = "updated";
  handle = noopProcessed;
}

@Injectable()
@EventType("deleted")
export class DeletedHandler implements IEventHandler {
  readonly eventType = "deleted";
  handle = noopProcessed;
}
