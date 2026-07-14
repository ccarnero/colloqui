// Route matcher for `POST /invoke/:connectorId/:endpointId` (the sync HTTP
// invoke facade, `manual-loops/connector-invoke-api.md` T02). Pure — no
// `Bun.serve`/`Request` types here so it's unit-testable without sockets;
// `src/http-main.ts` is the only I/O caller.

export interface InvokeRoute {
  readonly connectorId: string;
  readonly endpointId: string;
}

const INVOKE_ROUTE_PATTERN = /^\/invoke\/([^/]+)\/([^/]+)\/?$/;

/**
 * Matches `pathname` against `/invoke/:connectorId/:endpointId`, returning
 * the decoded path segments or `null` when the path doesn't match.
 */
export function matchInvokeRoute(pathname: string): InvokeRoute | null {
  const match = INVOKE_ROUTE_PATTERN.exec(pathname);
  if (!match) {
    return null;
  }
  const [, connectorId, endpointId] = match;
  return {
    connectorId: decodeURIComponent(connectorId!),
    endpointId: decodeURIComponent(endpointId!),
  };
}
