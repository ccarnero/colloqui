import type { IAdapterDto } from "../../../../core/services/http-adapter.service";
import type {
  IHttpAdapter,
  IHttpAdapterCacheStrategy,
} from "../../../../shared/models/http-adapter.model";

function toCacheStrategy(
  cache?: IAdapterDto["defaultCache"]
): IHttpAdapterCacheStrategy | undefined {
  if (!cache) {
    return undefined;
  }
  return {
    enabled: cache.enabled,
    ttlSeconds: cache.ttlSeconds,
    methods: cache.methods as IHttpAdapterCacheStrategy["methods"],
    keyBody: cache.keyBody,
    keyHeaders: cache.keyHeaders,
    keyQueryParams: cache.keyQueryParams,
  };
}

/**
 * Maps the read API shape (`IAdapterDto`) to the edit-form shape
 * (`IHttpAdapter`) expected by `HttpAdapterDialogComponent`.
 *
 * Mirrors `connectors.component.ts`'s `toRow()` inner adapter mapping.
 * Duplicated here (rather than imported) because T03's scope is limited to
 * `features/data-integrations/connectors/detail/` — see SPEC
 * `console-redesign-connections.md` T03 constraints.
 */
export function adapterDtoToHttpAdapter(dto: IAdapterDto): IHttpAdapter {
  return {
    name: dto.name,
    baseUrl: dto.baseUrl,
    auth: {
      type: dto.authType as IHttpAdapter["auth"]["type"],
      ...(dto.authConfig as Record<string, unknown>),
    },
    headers: dto.headers,
    defaultCache: toCacheStrategy(dto.defaultCache),
    endpoints: dto.endpoints.map((ep) => ({
      id: ep.id,
      label: ep.label,
      method: ep.method as IHttpAdapter["endpoints"][number]["method"],
      path: ep.path,
      cache: toCacheStrategy(ep.cache),
    })),
    timeoutMs: dto.timeoutMs,
    maxRetries: dto.maxRetries,
    retryBackoffMs: dto.retryBackoffMs,
    healthCheckPath: dto.healthCheckPath,
    tags: dto.tags ?? [],
    isEncrypted: dto.isEncrypted ?? false,
    managedBy: dto.managedBy ?? null,
  };
}
