import { Module } from '@nestjs/common';
import { SchedulersController } from './schedulers.controller';
import { SchedulerProxyService } from './schedulers.service';

@Module({
  controllers: [SchedulersController],
  providers: [SchedulerProxyService],
})
export class SchedulersModule {}
