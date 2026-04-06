import { Module } from "@nestjs/common";
import { ObservabilityModule } from "@yoizen/observability";
import { ProvidersModule } from "./providers/providers.module";
import { TokenModule } from "./modules/token/token.module";
import { UsersModule } from "./modules/users/users.module";
import { ClientsModule } from "./modules/clients/clients.module";
import { PublicRoutesModule } from "./modules/public-routes/public-routes.module";
import { TenantRolesModule } from "./modules/tenant-roles/tenant-roles.module";
import { TenantUsersModule } from "./modules/tenant-users/tenant-users.module";
import { HealthModule } from "./modules/health/health.module";

@Module({
  imports: [
    ObservabilityModule.forRoot({ serviceName: "auth-service" }),
    ProvidersModule,
    TokenModule,
    UsersModule,
    ClientsModule,
    PublicRoutesModule,
    TenantRolesModule,
    TenantUsersModule,
    HealthModule,
  ],
})
export class AppModule {}
