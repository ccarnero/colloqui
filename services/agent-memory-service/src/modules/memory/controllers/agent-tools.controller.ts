import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { TenantGuard, TenantId } from "@yoizen/database";
import { ProposeMemoryDto } from "../dto/propose-memory.dto";
import { MemoryQueryDto } from "../dto/memory-query.dto";
import { MemoryService } from "../services/memory.service";

@Controller("tools")
@UseGuards(TenantGuard)
export class AgentToolsController {
  constructor(private readonly memoryService: MemoryService) {}

  @Post("propose-memory")
  @HttpCode(HttpStatus.CREATED)
  async proposeMemory(
    @TenantId() tenantId: string,
    @Body() dto: ProposeMemoryDto,
  ) {
    return this.memoryService.proposeMemory(tenantId, {
      scope: dto.scope,
      kind: dto.kind,
      title: dto.title,
      content: dto.content,
      userId: dto.userId,
      sessionId: dto.sessionId,
      metadata: dto.metadata,
      topicKey: dto.topicKey,
      ttl: dto.ttl,
    });
  }

  @Get("memories")
  async getMemories(
    @TenantId() tenantId: string,
    @Query() query: MemoryQueryDto,
  ) {
    return this.memoryService.getMemories(tenantId, query);
  }

  @Get("memories/:id/timeline")
  async getTimeline(
    @TenantId() tenantId: string,
    @Param("id") id: string,
    @Query() query: MemoryQueryDto,
  ) {
    return this.memoryService.getTimeline(tenantId, {
      sessionId: query.sessionId,
      userId: query.userId,
      limit: query.limit,
      offset: query.offset,
    });
  }
}
