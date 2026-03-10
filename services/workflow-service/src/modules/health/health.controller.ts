import { Controller, Get, Inject } from '@nestjs/common';
import type { Client } from '@temporalio/client';

@Controller('health')
export class HealthController {
  constructor(
    @Inject('TEMPORAL_CLIENT') private readonly temporal: Client,
  ) {}

  @Get()
  async check(): Promise<{ status: string; temporal: boolean }> {
    let temporalOk = false;
    try {
      await this.temporal.workflowService.getSystemInfo({});
      temporalOk = true;
    } catch {
      temporalOk = false;
    }
    const status = temporalOk ? 'ok' : 'degraded';
    return { status, temporal: temporalOk };
  }
}
