import { Module } from '@nestjs/common';
import { CredentialsController } from './credentials.controller';
import { CredentialsService } from './credentials.service';
import { CredentialsRepository } from './credentials.repository';

@Module({
  controllers: [CredentialsController],
  providers: [CredentialsService, CredentialsRepository],
  exports: [CredentialsService],
})
export class CredentialsModule {}
