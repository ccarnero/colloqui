/**
 * `@yoizen/platform-sdk/connectors` — the `connectors` resource client. See
 * sdk/README.md "Resource clients" for the pattern this follows (from the
 * `workflows` reference implementation).
 */

export type {
  ConnectorCallOptions,
  ConnectorsClient,
  ConnectorsClientDeps,
} from "./client.js";
export { createConnectorsClient } from "./client.js";
export type {
  Connector,
  ConnectorAuthType,
  ConnectorCacheMethod,
  ConnectorCacheStrategy,
  ConnectorContext,
  ConnectorEndpoint,
  ConnectorHeaderEntry,
  ConnectorStatus,
  ConnectorUsageParams,
  ConnectorUsageResult,
  ConnectorUsageRow,
  CreateConnectorEndpointInput,
  CreateConnectorInput,
  ListConnectorsParams,
  UpdateConnectorEndpointInput,
  UpdateConnectorInput,
} from "./types.js";
