import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { TENANT_HEADER } from '@yoizen/shared';
import type { WorkflowAction } from '@yoizen/shared';
import { StartWorkflowDto } from './dto/start-workflow.dto';
import { WorkflowsService } from './workflows.service';

@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly workflowsService: WorkflowsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async startWorkflow(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Body() dto: StartWorkflowDto,
  ) {
    if (!tenantId) {
      throw new BadRequestException(
        `Missing required header: ${TENANT_HEADER}`,
      );
    }

    return this.workflowsService.startWorkflow(
      dto.name,
      dto.application,
      tenantId,
      dto.request,
      dto.actions as WorkflowAction[],
    );
  }

  @Get()
  async listWorkflows(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
  ) {
    if (!tenantId) {
      throw new BadRequestException(
        `Missing required header: ${TENANT_HEADER}`,
      );
    }

    return this.workflowsService.listWorkflows(tenantId);
  }

  @Get(':workflowId')
  async getWorkflowStatus(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Param('workflowId') workflowId: string,
  ) {
    if (!tenantId) {
      throw new BadRequestException(
        `Missing required header: ${TENANT_HEADER}`,
      );
    }

    return this.workflowsService.getWorkflowStatus(workflowId, tenantId);
  }
}
