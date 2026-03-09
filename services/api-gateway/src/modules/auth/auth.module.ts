import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthProxyService } from './auth-proxy.service';
import { JwtService } from './jwt.service';
import { PublicRoutesCacheService } from './public-routes-cache.service';
import { TenantsModule } from '../tenants/tenants.module';

@Module({
  imports: [TenantsModule],
  controllers: [AuthController],
  providers: [AuthProxyService, JwtService, PublicRoutesCacheService],
  exports: [JwtService, PublicRoutesCacheService],
})
export class AuthModule {}
