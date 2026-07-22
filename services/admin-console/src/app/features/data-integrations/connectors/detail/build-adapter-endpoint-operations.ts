import type { Observable } from "rxjs";
import type { IAdapterEndpointDto } from "../../../../core/services/http-adapter.service";
import type { IHttpAdapter } from "../../../../shared/models/http-adapter.model";

/** Side-effect boundary — the caller injects the actual HTTP calls. */
export interface IAdapterEndpointOps {
  addEndpoint(
    adapterId: string,
    endpoint: {
      label: string;
      method: string;
      path: string;
      cache?: IHttpAdapter["defaultCache"];
    }
  ): Observable<IAdapterEndpointDto>;
  updateEndpoint(
    adapterId: string,
    endpointId: string,
    payload: {
      label?: string;
      method?: string;
      path?: string;
      cache?: IHttpAdapter["defaultCache"] | null;
    }
  ): Observable<IAdapterEndpointDto>;
  removeEndpoint(adapterId: string, endpointId: string): Observable<void>;
}

/**
 * Diffs the current vs. next endpoint lists and returns the add/update/
 * remove calls needed to sync them.
 *
 * Mirrors `connectors.component.ts`'s `buildEndpointOperations()`
 * (duplicated per T03 scope constraints — this folder only). Kept pure
 * aside from the injected `ops` boundary, per repo convention (side
 * effects at the edges, injected as arguments).
 */
export function buildAdapterEndpointOperations(
  adapterId: string,
  current: IHttpAdapter,
  next: IHttpAdapter,
  ops: IAdapterEndpointOps
): Array<Observable<unknown>> {
  const currentById = new Map(
    current.endpoints
      .filter((endpoint) => endpoint.id)
      .map((endpoint) => [endpoint.id!, endpoint])
  );
  const nextById = new Map(
    next.endpoints
      .filter((endpoint) => endpoint.id)
      .map((endpoint) => [endpoint.id!, endpoint])
  );
  const operations: Array<Observable<unknown>> = [];

  for (const endpointId of currentById.keys()) {
    if (!nextById.has(endpointId)) {
      operations.push(ops.removeEndpoint(adapterId, endpointId));
    }
  }

  for (const [endpointId, endpoint] of nextById.entries()) {
    operations.push(
      ops.updateEndpoint(adapterId, endpointId, {
        label: endpoint.label,
        method: endpoint.method,
        path: endpoint.path,
        cache: endpoint.cache ?? null,
      })
    );
  }

  for (const endpoint of next.endpoints) {
    if (!endpoint.id) {
      operations.push(
        ops.addEndpoint(adapterId, {
          label: endpoint.label,
          method: endpoint.method,
          path: endpoint.path,
          cache: endpoint.cache,
        })
      );
    }
  }

  return operations;
}
