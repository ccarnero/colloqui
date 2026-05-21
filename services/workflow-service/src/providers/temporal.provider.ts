import { Connection, Client } from "@temporalio/client";
import type { FactoryProvider } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import { workflowServiceConfig } from "../config";

export const TEMPORAL_CLIENT = "TEMPORAL_CLIENT";

const logger = new PinoLoggerService("TemporalProvider");

async function ensureSearchAttributes(connection: Connection): Promise<void> {
  try {
    const ns = workflowServiceConfig.temporalNamespace;
    const response = await connection.operatorService.listSearchAttributes({
      namespace: ns,
    });
    const existing = response.customAttributes ?? {};
    if (existing["TenantId"] !== undefined) return;

    await connection.operatorService.addSearchAttributes({
      namespace: ns,
      searchAttributes: {
        TenantId: 1, // 1 = INDEXED_VALUE_TYPE_KEYWORD
      },
    });
    logger.log("Registered TenantId search attribute");
  } catch (err) {
    logger.warn(`Could not register search attributes: ${err}`);
  }
}

export const temporalClientProvider: FactoryProvider = {
  provide: TEMPORAL_CLIENT,
  useFactory: async (): Promise<Client> => {
    const connection = await Connection.connect({
      address: workflowServiceConfig.temporalAddress,
    });
    await ensureSearchAttributes(connection);
    // Pass namespace explicitly. The Worker already does this via
    // `worker.ts`, but the Client did not — workflows started here
    // landed on Temporal's default namespace by accident. Defensive
    // alignment: client and worker must agree or
    // `workflow.start` succeeds against one namespace while
    // `workflow.getHandle().describe()` queries a different one,
    // producing phantom NotFound errors under HA.
    return new Client({
      connection,
      namespace: workflowServiceConfig.temporalNamespace,
    });
  },
};
