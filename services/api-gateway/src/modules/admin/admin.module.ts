import { Module } from '@nestjs/common';
import { AdminProxyService } from './admin-proxy.service';
import { AdminAgentsController } from './admin-agents.controller';
import { AdminCredentialsController } from './admin-credentials.controller';
import { AdminJobsController } from './admin-jobs.controller';
import { AdminConfigController } from './admin-config.controller';

@Module({
  controllers: [
    AdminAgentsController,
    AdminCredentialsController,
    AdminJobsController,
    AdminConfigController,
  ],
  providers: [AdminProxyService],
})
export class AdminModule {}