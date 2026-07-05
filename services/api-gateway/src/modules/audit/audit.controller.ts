import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  NotFoundException,
} from "@nestjs/common";
import { AuditProxyService } from "./audit-proxy.service";
import { REQUEST_TENANT_KEY } from "../../guards/tenant.guard";
import type { ITenantScopedRequest } from "../../types/yoizen-request";
import { QueryAuditEventsProxyDto } from "./audit-proxy-query.dto";
import { auditEventsToParams } from "./audit-query-params.util";
import { ApiTags } from "@nestjs/swagger";

@ApiTags("audit")
@Controller("audit/events")
export class AuditController {
  constructor(private readonly auditProxy: AuditProxyService) {}

  @Get()
  async queryEvents(
    @Req() req: ITenantScopedRequest,
    @Query() query: QueryAuditEventsProxyDto,
  ): Promise<object> {
    return this.auditProxy.queryEvents(
      auditEventsToParams(query),
      req[REQUEST_TENANT_KEY],
    );
  }

  @Get(":id")
  async getEvent(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
  ): Promise<object> {
    const event = await this.auditProxy.getEventById(
      id,
      req[REQUEST_TENANT_KEY],
    );
    if (!event) throw new NotFoundException(`Event ${id} not found`);
    return event;
  }
}
