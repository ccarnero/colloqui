import { IsOptional, IsString, MaxLength } from "class-validator";

/** Query params for `GET /events/stream` (SSE). */
export class EventsStreamQueryDto {
  /** Comma-separated event type filters (e.g. `created,updated`). */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  types?: string;
}
