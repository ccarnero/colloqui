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
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { EventsService } from './events.service';
import { EventDto } from './event.dto';
import { REQUEST_TENANT_KEY } from '../../guards/tenant.guard';
import type { TenantScopedRequest } from '../../types/yoizen-request';

@Controller()
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post('events')
  @HttpCode(HttpStatus.ACCEPTED)
  async publish(
    @Req() req: TenantScopedRequest,
    @Body() dto: EventDto,
  ): Promise<{ id: string; status: string }> {
    const id = await this.eventsService.publish(
      dto.type,
      dto.payload,
      req[REQUEST_TENANT_KEY],
      dto.callbackUrl,
      dto.enrichAdapter,
      dto.forwardAdapter,
      dto.adapterId,
    );
    return { id, status: 'accepted' };
  }

  @Get('results/:id')
  async getResult(@Req() req: TenantScopedRequest, @Param('id') id: string): Promise<object> {
    const result = await this.eventsService.getResult(id, req[REQUEST_TENANT_KEY]);
    if (result === null) throw new NotFoundException();
    return result;
  }

  @Sse('events/stream')
  stream(@Req() req: TenantScopedRequest, @Query('types') types?: string): Observable<MessageEvent> {
    const typeList = types
      ? types.split(',').filter((t) => t.length > 0)
      : [];

    return this.eventsService.streamEvents(typeList, req[REQUEST_TENANT_KEY]).pipe(
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
