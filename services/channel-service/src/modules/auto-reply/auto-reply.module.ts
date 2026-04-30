import { Module, forwardRef } from "@nestjs/common";
import { AutoReplyController } from "./auto-reply.controller";
import { AutoReplyRepository } from "./auto-reply.repository";
import { AutoReplyService } from "./auto-reply.service";
import { EgressModule } from "../egress/egress.module";

@Module({
  imports: [forwardRef(() => EgressModule)],
  controllers: [AutoReplyController],
  providers: [AutoReplyRepository, AutoReplyService],
  exports: [AutoReplyService],
})
export class AutoReplyModule {}
