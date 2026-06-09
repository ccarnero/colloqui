import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { TenantGuard, TenantId } from "@yoizen/database";
import { MemoryQueryDto } from "../dto/memory-query.dto";
import { MemoryStatus } from "../domain/enums";
import { ProposeMemoryDto } from "../dto/propose-memory.dto";
import { UpdateMemoryDto } from "../dto/update-memory.dto";
import { MemoryService } from "../services/memory.service";
import { NatsPublisher } from "../../../providers/nats.provider";

@Controller("admin/memories")
@UseGuards(TenantGuard)
export class AdminMemoriesController {
  constructor(
    private readonly memoryService: MemoryService,
    private readonly natsPublisher: NatsPublisher,
  ) {}

  @Get()
  async list(
    @TenantId() tenantId: string,
    @Query() query: MemoryQueryDto,
  ) {
    return this.memoryService.getMemories(tenantId, query);
  }

  @Get("proposals")
  async proposals(
    @TenantId() tenantId: string,
    @Query() query: MemoryQueryDto,
  ) {
    return this.memoryService.getMemories(tenantId, {
      ...query,
      status: MemoryStatus.PROPOSED,
    });
  }

  @Get(":id")
  async getOne(@TenantId() tenantId: string, @Param("id") id: string) {
    return this.memoryService.getMemory(tenantId, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
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
    }, this.natsPublisher);
  }

  @Patch(":id")
  async update(
    @TenantId() tenantId: string,
    @Param("id") id: string,
    @Body() dto: UpdateMemoryDto,
  ) {
    return this.memoryService.updateMemory(tenantId, id, dto);
  }

  @Patch(":id/approve")
  async approve(@TenantId() tenantId: string, @Param("id") id: string) {
    return this.memoryService.approveMemory(tenantId, id, this.natsPublisher);
  }

  @Patch(":id/reject")
  async reject(@TenantId() tenantId: string, @Param("id") id: string) {
    return this.memoryService.rejectMemory(tenantId, id, this.natsPublisher);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@TenantId() tenantId: string, @Param("id") id: string) {
    await this.memoryService.deleteMemory(tenantId, id);
  }
}
