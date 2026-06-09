import { Module } from "@nestjs/common";
import { MemoryClientService } from "./memory-client.service";
import { MemoryContextBuilderService } from "./memory-context-builder.service";

@Module({
  providers: [MemoryClientService, MemoryContextBuilderService],
  exports: [MemoryClientService, MemoryContextBuilderService],
})
export class MemoryModule {}
