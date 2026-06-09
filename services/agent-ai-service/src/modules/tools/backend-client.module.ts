import { Module } from "@nestjs/common";
import { BackendClientService } from "./backend-client.service";

@Module({
  providers: [BackendClientService],
  exports: [BackendClientService],
})
export class BackendClientModule {}
