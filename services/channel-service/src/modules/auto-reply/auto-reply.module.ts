import { Module, forwardRef } from "@nestjs/common";
import { AutoReplyController } from "./auto-reply.controller";
import { AutoReplyService } from "./auto-reply.service";
import { EgressModule } from "../egress/egress.module";

@Module({
  imports: [forwardRef(() => EgressModule)],
  controllers: [AutoReplyController],
  providers: [AutoReplyService],
  exports: [AutoReplyService],
})
export class AutoReplyModule {}
