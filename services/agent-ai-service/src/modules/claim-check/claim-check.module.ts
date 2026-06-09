import { Module } from "@nestjs/common";
import { ClaimCheckService } from "./claim-check.service";

@Module({
  providers: [ClaimCheckService],
  exports: [ClaimCheckService],
})
export class ClaimCheckModule {}
