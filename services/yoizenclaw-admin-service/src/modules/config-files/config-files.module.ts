import { Module } from "@nestjs/common";
import { ConfigFilesController } from "./config-files.controller";
import { ConfigFilesService } from "./config-files.service";
import { ConfigFilesRepository } from "./config-files.repository";

@Module({
  controllers: [ConfigFilesController],
  providers: [ConfigFilesService, ConfigFilesRepository],
  exports: [ConfigFilesService],
})
export class ConfigFilesModule {}
