import { Connection, Client } from '@temporalio/client';
import type { FactoryProvider } from '@nestjs/common';
import { Logger } from '@nestjs/common';

export const TEMPORAL_CLIENT = 'TEMPORAL_CLIENT';

const logger = new Logger('TemporalProvider');

async function ensureSearchAttributes(connection: Connection): Promise<void> {
  try {
    const ns = process.env.TEMPORAL_NAMESPACE ?? 'default';
    const response = await connection.operatorService.listSearchAttributes({
      namespace: ns,
    });
    const existing = response.customAttributes ?? {};
    if (existing['TenantId'] !== undefined) return;

    await connection.operatorService.addSearchAttributes({
      namespace: ns,
      searchAttributes: {
        TenantId: 1, // 1 = INDEXED_VALUE_TYPE_KEYWORD
      },
    });
    logger.log('Registered TenantId search attribute');
  } catch (err) {
    logger.warn(`Could not register search attributes: ${err}`);
  }
}

export const temporalClientProvider: FactoryProvider = {
  provide: TEMPORAL_CLIENT,
  useFactory: async (): Promise<Client> => {
    const connection = await Connection.connect({
      address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
    });
    await ensureSearchAttributes(connection);
    return new Client({ connection });
  },
};
