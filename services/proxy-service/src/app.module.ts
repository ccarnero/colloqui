import { Module } from '@nestjs/common';
import { ProxyModule } from './modules/proxy/proxy.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [ProxyModule, HealthModule],
})
export class AppModule {}
