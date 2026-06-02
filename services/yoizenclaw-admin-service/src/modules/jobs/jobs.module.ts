import { Module } from "@nestjs/common";
import { createRepositoryProvider } from "@yoizen/database";
import { yoizenclawAdminServiceConfig } from "../../config";
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
    createRepositoryProvider<IJobsRepository>({
      token: JOBS_REPOSITORY,
      engine: yoizenclawAdminServiceConfig.dbEngine,
      postgresClass: JobsPostgresRepository,
      mongoClass: JobsMongoRepository,
    }),
    createRepositoryProvider<IJobExecutionsRepository>({
      token: JOB_EXECUTIONS_REPOSITORY,
      engine: yoizenclawAdminServiceConfig.dbEngine,
      postgresClass: JobExecutionsPostgresRepository,
      mongoClass: JobExecutionsMongoRepository,
    }),
    JobsService,
  ],
  exports: [JobsService],
})
export class JobsModule {}
