import { Module } from "@nestjs/common";
import { TrackingController } from "./tracking.controller";
import { TrackingProxyService } from "./tracking-proxy.service";

@Module({
  controllers: [TrackingController],
  providers: [TrackingProxyService],
})
export class TrackingModule {}
