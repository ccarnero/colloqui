import { Global, Module } from "@nestjs/common";
import { DynamicRouteCacheService } from "./dynamic-route-cache.service";

@Global()
@Module({
  providers: [DynamicRouteCacheService],
  exports: [DynamicRouteCacheService],
})
export class DynamicRoutesModule {}
