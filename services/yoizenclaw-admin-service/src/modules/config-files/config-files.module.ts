import { Module } from "@nestjs/common";
import { createRepositoryProvider } from "@yoizen/database";
import { yoizenclawAdminServiceConfig } from "../../config";
import { ConfigFilesController } from "./config-files.controller";
import { ConfigFilesMongoRepository } from "./config-files.mongo.repository";
import { ConfigFilesPostgresRepository } from "./config-files.postgres.repository";
import {
  CONFIG_FILES_REPOSITORY,
  type IConfigFilesRepository,
} from "./config-files.repository.interface";
import { ConfigFilesService } from "./config-files.service";

@Module({
  controllers: [ConfigFilesController],
  providers: [
    createRepositoryProvider<IConfigFilesRepository>({
      token: CONFIG_FILES_REPOSITORY,
      engine: yoizenclawAdminServiceConfig.dbEngine,
      postgresClass: ConfigFilesPostgresRepository,
      mongoClass: ConfigFilesMongoRepository,
    }),
    ConfigFilesService,
  ],
  exports: [ConfigFilesService],
})
export class ConfigFilesModule {}
