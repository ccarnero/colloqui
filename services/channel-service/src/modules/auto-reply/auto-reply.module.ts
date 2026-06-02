import { Module, forwardRef } from "@nestjs/common";
import { createRepositoryProvider } from "@yoizen/database";
import { channelServiceConfig } from "../../config";
import { EgressModule } from "../egress/egress.module";
import { AutoReplyController } from "./auto-reply.controller";
import { AutoReplyMongoRepository } from "./auto-reply.mongo.repository";
import { AutoReplyPostgresRepository } from "./auto-reply.postgres.repository";
import {
  AUTO_REPLY_REPOSITORY,
  type IAutoReplyRepository,
} from "./auto-reply.repository.interface";
import { AutoReplyService } from "./auto-reply.service";

@Module({
  imports: [forwardRef(() => EgressModule)],
  controllers: [AutoReplyController],
  providers: [
    createRepositoryProvider<IAutoReplyRepository>({
      token: AUTO_REPLY_REPOSITORY,
      engine: channelServiceConfig.dbEngine,
      postgresClass: AutoReplyPostgresRepository,
      mongoClass: AutoReplyMongoRepository,
    }),
    AutoReplyService,
  ],
  exports: [AutoReplyService],
})
export class AutoReplyModule {}
