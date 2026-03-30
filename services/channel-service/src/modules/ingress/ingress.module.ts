import { Module } from "@nestjs/common";
import { IngressService } from "./ingress.service";

@Module({
  providers: [IngressService],
  exports: [IngressService],
})
export class IngressModule {}
