import { Module } from '@nestjs/common';
import { CanaryController } from './canary.controller';
import { CanaryService } from './canary.service';

@Module({
  controllers: [CanaryController],
  providers: [CanaryService],
})
export class CanaryModule {}
