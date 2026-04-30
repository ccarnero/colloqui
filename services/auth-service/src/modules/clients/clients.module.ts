import { Module } from "@nestjs/common";
import { ClientsController } from "./clients.controller";
import { ClientsRepository } from "./clients.repository";
import { ClientsService } from "./clients.service";

@Module({
  controllers: [ClientsController],
  providers: [ClientsRepository, ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
