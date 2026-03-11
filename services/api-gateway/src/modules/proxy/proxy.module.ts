import { Module } from '@nestjs/common';
import { ProxyController } from './proxy.controller';
import { ProxyProxyService } from './proxy-proxy.service';

@Module({
  controllers: [ProxyController],
  providers: [ProxyProxyService],
})
export class ProxyModule {}
