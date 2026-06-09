import { Module } from "@nestjs/common";
import { createRepositoryProvider } from "@yoizen/database";
import { agentAdminServiceConfig } from "../../config";
import { JobExecutionStatusConsumer } from "./job-execution-status.consumer";
import { JobExecutionsMongoRepository } from "./job-executions.mongo.repository";
import { JobExecutionsPostgresRepository } from "./job-executions.postgres.repository";
import {
  JOB_EXECUTIONS_REPOSITORY,
  type IJobExecutionsRepository,
} from "./job-executions.repository.interface";
import { JobsController } from "./jobs.controller";
import { JobsMongoRepository } from "./jobs.mongo.repository";
import { JobsPostgresRepository } from "./jobs.postgres.repository";
import {
  JOBS_REPOSITORY,
  type IJobsRepository,
} from "./jobs.repository.interface";
import { JobsService } from "./jobs.service";

@Module({
  controllers: [JobsController],
  providers: [
    JobExecutionStatusConsumer,
    createRepositoryProvider<IJobsRepository>({
      token: JOBS_REPOSITORY,
      engine: agentAdminServiceConfig.dbEngine,
      postgresClass: JobsPostgresRepository,
      mongoClass: JobsMongoRepository,
    }),
    createRepositoryProvider<IJobExecutionsRepository>({
      token: JOB_EXECUTIONS_REPOSITORY,
      engine: agentAdminServiceConfig.dbEngine,
      postgresClass: JobExecutionsPostgresRepository,
      mongoClass: JobExecutionsMongoRepository,
    }),
    JobsService,
  ],
  exports: [JobsService],
})
export class JobsModule {}
