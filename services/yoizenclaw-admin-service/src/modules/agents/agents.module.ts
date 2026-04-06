import { Module } from '@nestjs/common';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { AgentsRepository } from './agents.repository';
import { AgentsRuntimeService } from './agents-runtime.service';

@Module({
  controllers: [AgentsController],
  providers: [AgentsService, AgentsRepository, AgentsRuntimeService],
  exports: [AgentsService, AgentsRuntimeService],
})
export class AgentsModule {}
