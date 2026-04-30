import { Module } from "@nestjs/common";
import { PublicRoutesController } from "./public-routes.controller";
import { PublicRoutesRepository } from "./public-routes.repository";
import { PublicRoutesService } from "./public-routes.service";

@Module({
  controllers: [PublicRoutesController],
  providers: [PublicRoutesRepository, PublicRoutesService],
  exports: [PublicRoutesService],
})
export class PublicRoutesModule {}
