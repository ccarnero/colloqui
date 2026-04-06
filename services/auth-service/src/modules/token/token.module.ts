import { Module } from "@nestjs/common";
import { TokenController } from "./token.controller";
import { TokenRepository } from "./token.repository";
import { TokenService } from "./token.service";

@Module({
  controllers: [TokenController],
  providers: [TokenRepository, TokenService],
  exports: [TokenService],
})
export class TokenModule {}
