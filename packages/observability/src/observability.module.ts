import { Module, Global, type DynamicModule } from '@nestjs/common';
import { PinoLoggerService } from './logger';

export const OBSERVABILITY_LOGGER = 'OBSERVABILITY_LOGGER';

export interface ObservabilityModuleOptions {
  serviceName: string;
}

@Global()
@Module({})
export class ObservabilityModule {
  static forRoot(options: ObservabilityModuleOptions): DynamicModule {
    const loggerProvider = {
      provide: OBSERVABILITY_LOGGER,
      useFactory: () => new PinoLoggerService(options.serviceName),
    };

    return {
      module: ObservabilityModule,
      providers: [loggerProvider],
      exports: [loggerProvider],
    };
  }
}
