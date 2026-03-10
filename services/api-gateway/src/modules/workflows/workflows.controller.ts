import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { WorkflowProxyService } from './workflow-proxy.service';
import { REQUEST_TENANT_KEY } from '../../guards/tenant.guard';

@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly proxy: WorkflowProxyService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async startWorkflow(@Req() req: any, @Body() body: unknown) {
    return this.proxy.proxy(
      'POST',
      '/workflows',
      req[REQUEST_TENANT_KEY],
      body,
    );
  }

  @Get()
  async listWorkflows(@Req() req: any) {
    return this.proxy.proxy('GET', '/workflows', req[REQUEST_TENANT_KEY]);
  }

  @Get(':workflowId')
  async getWorkflowStatus(
    @Req() req: any,
    @Param('workflowId') workflowId: string,
  ) {
    return this.proxy.proxy(
      'GET',
      `/workflows/${encodeURIComponent(workflowId)}`,
      req[REQUEST_TENANT_KEY],
    );
  }
}
