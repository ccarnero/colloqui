import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Req,
  Sse,
  HttpCode,
  HttpStatus,
  NotFoundException,
  type MessageEvent,
} from "@nestjs/common";
import { Observable, map } from "rxjs";
import { EventsService } from "./events.service";
import { EventDto } from "./event.dto";
import { EventsStreamQueryDto } from "./events-stream-query.dto";
import { REQUEST_TENANT_KEY } from "../../guards/tenant.guard";
import type { ITenantScopedRequest } from "../../types/yoizen-request";

@Controller()
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post("events")
  @HttpCode(HttpStatus.ACCEPTED)
  async publish(
    @Req() req: ITenantScopedRequest,
    @Body() dto: EventDto,
  ): Promise<{ id: string; status: string }> {
    const id = await this.eventsService.publish({
      type: dto.type,
      payload: dto.payload,
      tenantId: req[REQUEST_TENANT_KEY],
      callbackUrl: dto.callbackUrl,
      enrichAdapter: dto.enrichAdapter,
      forwardAdapter: dto.forwardAdapter,
      adapterId: dto.adapterId,
    });
    return { id, status: "accepted" };
  }

  @Get("results/:id")
  async getResult(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
  ): Promise<object> {
    const result = await this.eventsService.getResult(
      id,
      req[REQUEST_TENANT_KEY],
    );
    if (result === null) throw new NotFoundException();
    return result;
  }

  @Sse("events/stream")
  stream(
    @Req() req: ITenantScopedRequest,
    @Query() query: EventsStreamQueryDto,
  ): Observable<MessageEvent> {
    const typeList = query.types
      ? query.types.split(",").filter((t) => t.length > 0)
      : [];

    return this.eventsService
      .streamEvents(typeList, req[REQUEST_TENANT_KEY])
      .pipe(
        map(
          (event) =>
            ({
              data: event.data,
              type: event.type,
              id: undefined,
              retry: undefined,
            }) as MessageEvent,
        ),
      );
  }
}
