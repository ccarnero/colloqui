import { Module } from "@nestjs/common";
import { createRepositoryProvider } from "@yoizen/database";
import { authServiceConfig } from "../../config";
import { TokenController } from "./token.controller";
import { TokenMongoRepository } from "./token.mongo.repository";
import { TokenPostgresRepository } from "./token.postgres.repository";
import {
  TOKEN_REPOSITORY,
  type ITokenRepository,
} from "./token.repository.interface";
import { TokenService } from "./token.service";

@Module({
  controllers: [TokenController],
  providers: [
    createRepositoryProvider<ITokenRepository>({
      token: TOKEN_REPOSITORY,
      engine: authServiceConfig.dbEngine,
      postgresClass: TokenPostgresRepository,
      mongoClass: TokenMongoRepository,
    }),
    TokenService,
  ],
  exports: [TokenService],
})
export class TokenModule {}
