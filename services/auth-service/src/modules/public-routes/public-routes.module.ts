import { Module } from '@nestjs/common';
import { PublicRoutesController } from './public-routes.controller';
import { PublicRoutesService } from './public-routes.service';

@Module({
  controllers: [PublicRoutesController],
  providers: [PublicRoutesService],
  exports: [PublicRoutesService],
})
export class PublicRoutesModule {}
