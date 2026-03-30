import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { JobsRepository } from './jobs.repository';
import { JobExecutionsRepository } from './job-executions.repository';

@Module({
  controllers: [JobsController],
  providers: [JobsService, JobsRepository, JobExecutionsRepository],
  exports: [JobsService],
})
export class JobsModule {}
