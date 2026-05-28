import { Module } from "@nestjs/common";
import { createRepositoryProvider } from "@yoizen/database";
import { authServiceConfig } from "../../config";
import { UsersController } from "./users.controller";
import { UsersMongoRepository } from "./users.mongo.repository";
import { UsersPostgresRepository } from "./users.postgres.repository";
import {
  USERS_REPOSITORY,
  type IUsersRepository,
} from "./users.repository.interface";
import { UsersService } from "./users.service";

@Module({
  controllers: [UsersController],
  providers: [
    createRepositoryProvider<IUsersRepository>({
      token: USERS_REPOSITORY,
      engine: authServiceConfig.dbEngine,
      postgresClass: UsersPostgresRepository,
      mongoClass: UsersMongoRepository,
    }),
    UsersService,
  ],
  exports: [UsersService],
})
export class UsersModule {}
