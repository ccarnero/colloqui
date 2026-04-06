import { SetMetadata } from "@nestjs/common";

export const EVENT_TYPE_KEY = "EVENT_TYPE";

export const EventType = (type: string): ClassDecorator =>
  SetMetadata(EVENT_TYPE_KEY, type);
