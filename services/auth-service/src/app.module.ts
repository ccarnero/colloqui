import { Module } from '@nestjs/common';
import { ProvidersModule } from './providers/providers.module';
import { TokenModule } from './modules/token/token.module';
import { UsersModule } from './modules/users/users.module';
import { ClientsModule } from './modules/clients/clients.module';
import { PublicRoutesModule } from './modules/public-routes/public-routes.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ProvidersModule,
    TokenModule,
    UsersModule,
    ClientsModule,
    PublicRoutesModule,
    HealthModule,
  ],
})
export class AppModule {}
