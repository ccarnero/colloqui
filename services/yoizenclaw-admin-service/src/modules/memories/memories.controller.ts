import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TenantGuard } from '../../providers/tenant.guard';
import { TenantId } from '../../providers/tenant.decorator';
import {
  MemoryDecisionDto,
  MemoryProposalActionResponseDto,
  MemoryProposalListResponseDto,
  MemoryProposalParamDto,
  ListMemoryProposalsQueryDto,
} from './memories.dto';
import { MemoriesService } from './memories.service';

const YOIZEN_USER_ID_HEADER = 'x-yoizen-user-id';

@Controller('admin/memories')
@UseGuards(TenantGuard)
export class MemoriesController {
  constructor(private readonly service: MemoriesService) {}

  @Get('proposals')
  @HttpCode(HttpStatus.OK)
  async listProposals(
    @TenantId() tenantId: string,
    @Query() query: ListMemoryProposalsQueryDto,
  ): Promise<MemoryProposalListResponseDto> {
    return this.service.listProposals(
      tenantId,
      query.status,
      query.kind,
      query.limit,
    );
  }

  @Post('proposals/:id/approve')
  @HttpCode(HttpStatus.OK)
  async approveProposal(
    @TenantId() tenantId: string,
    @Param() params: MemoryProposalParamDto,
    @Body() body: MemoryDecisionDto,
    @Headers(YOIZEN_USER_ID_HEADER) reviewerId?: string,
  ): Promise<MemoryProposalActionResponseDto> {
    return this.service.approveProposal(
      tenantId,
      params.id,
      reviewerId,
      body.reason,
    );
  }

  @Post('proposals/:id/reject')
  @HttpCode(HttpStatus.OK)
  async rejectProposal(
    @TenantId() tenantId: string,
    @Param() params: MemoryProposalParamDto,
    @Body() body: MemoryDecisionDto,
    @Headers(YOIZEN_USER_ID_HEADER) reviewerId?: string,
  ): Promise<MemoryProposalActionResponseDto> {
    return this.service.rejectProposal(
      tenantId,
      params.id,
      reviewerId,
      body.reason,
    );
  }
}
