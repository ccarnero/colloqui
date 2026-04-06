import { Module } from '@nestjs/common';
import { CredentialsController } from './credentials.controller';
import { CredentialsService } from './credentials.service';
import { CredentialsRepository } from './credentials.repository';
import { CredentialSyncService } from './credential-sync.service';

@Module({
  controllers: [CredentialsController],
  providers: [CredentialsService, CredentialsRepository, CredentialSyncService],
  exports: [CredentialsService, CredentialSyncService],
})
export class CredentialsModule {}
