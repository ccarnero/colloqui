import { Injectable } from '@nestjs/common';
import { AgentsRuntimeService } from '../agents/agents-runtime.service';
import type {
  MemoryProposalActionResponseDto,
  MemoryProposalListResponseDto,
} from './memories.dto';

@Injectable()
export class MemoriesService {
  constructor(private readonly runtimeService: AgentsRuntimeService) {}

  async listProposals(
    tenantId: string,
    status?: string,
    kind?: string,
    limit?: number,
  ): Promise<MemoryProposalListResponseDto> {
    return this.runtimeService.listMemoryProposals(tenantId, {
      status,
      kind,
      limit,
    });
  }

  async approveProposal(
    tenantId: string,
    proposalId: string,
    reviewerId?: string,
    reason?: string,
  ): Promise<MemoryProposalActionResponseDto> {
    return this.runtimeService.reviewMemoryProposal(
      tenantId,
      proposalId,
      'memory_proposals_approve',
      reviewerId,
      reason,
    );
  }

  async rejectProposal(
    tenantId: string,
    proposalId: string,
    reviewerId?: string,
    reason?: string,
  ): Promise<MemoryProposalActionResponseDto> {
    return this.runtimeService.reviewMemoryProposal(
      tenantId,
      proposalId,
      'memory_proposals_reject',
      reviewerId,
      reason,
    );
  }
}
