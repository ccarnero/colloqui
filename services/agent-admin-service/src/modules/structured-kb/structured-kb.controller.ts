import {
  BadRequestException,
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { TenantGuard } from "../../guards/tenant.guard";
import { TenantId } from "../../providers/tenant.decorator";
import { SKBContainersService } from "./containers.service";
import { QuerySKBDto } from "./dto/query-skb.dto";
import { SKBQueryService } from "./skb-query.service";
import { SKBRateLimitGuard } from "./skb-rate-limit.guard";

@Controller("admin/structured-kb")
@UseGuards(TenantGuard)
export class StructuredKBController {
  constructor(
    private readonly containersService: SKBContainersService,
    private readonly queryService: SKBQueryService
  ) {}

  @Post("containers/:id/query")
  @UseGuards(SKBRateLimitGuard)
  async query(
    @TenantId() tenantId: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: QuerySKBDto
  ) {
    // Validate query is not empty
    if (!body.query || body.query.trim().length === 0) {
      throw new BadRequestException("Query must not be empty");
    }

    // Validate limit range
    const limit = body.limit ?? 10;
    if (limit < 1 || limit > 1000) {
      throw new BadRequestException("Limit must be between 1 and 1000");
    }

    // Validate offset
    if (body.offset != null && body.offset < 0) {
      throw new BadRequestException("Offset must be non-negative");
    }

    return this.queryService.query(tenantId, id, body.query, {
      limit,
      offset: body.offset ?? 0,
      categories: body.categories,
    });
  }
}
