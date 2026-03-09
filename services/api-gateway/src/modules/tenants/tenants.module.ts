import { Module } from '@nestjs/common';
import { TenantsController } from './tenants.controller';
import { TenantProxyService } from './tenant-proxy.service';

@Module({
  controllers: [TenantsController],
  providers: [TenantProxyService],
  exports: [TenantProxyService],
})
export class TenantsModule {}
