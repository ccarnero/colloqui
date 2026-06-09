import { Module } from "@nestjs/common";
import { MEMORY_REPOSITORY } from "./domain/memory.repository.interface";
import type { IMemoryRepository } from "./domain/memory.repository.interface";
import { MemoryPostgresRepository } from "./infrastructure/memory.postgres.repository";
import { MemoryService } from "./services/memory.service";
import { AdminMemoriesController } from "./controllers/admin-memories.controller";

@Module({
  providers: [
    MemoryService,
    {
      provide: MEMORY_REPOSITORY,
      useClass: MemoryPostgresRepository,
    },
  ],
  controllers: [AdminMemoriesController],
  exports: [MEMORY_REPOSITORY, MemoryService],
})
export class MemoryModule {}
