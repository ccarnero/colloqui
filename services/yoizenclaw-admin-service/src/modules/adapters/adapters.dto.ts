/** Response shape for adapter list/detail (built in code, not validated by ValidationPipe). */
export class AdapterEndpointDto {
  id!: string;
  label!: string;
  path!: string;
  method!: string;
}

export class AdapterSummaryDto {
  id!: string;
  name!: string;
  status!: string;
  baseUrl?: string;
  authType?: string;
  hasAuth?: boolean;
  endpoints!: AdapterEndpointDto[];
}

function mapAdapterAuthFields(raw: Record<string, unknown>): {
  authType: string;
  hasAuth: boolean;
} {
  const authType = (raw.authType as string) ?? "none";
  const authConfig = raw.authConfig as Record<string, unknown> | undefined;
  const hasAuth =
    authType !== "none" &&
    authConfig !== undefined &&
    Object.keys(authConfig).length > 0;
  return { authType, hasAuth };
}

function mapAdapterEndpoints(
  raw: Record<string, unknown>,
): Array<{
  id: string;
  label: string;
  path: string;
  method: string;
}> {
  return ((raw.endpoints as Array<Record<string, unknown>>) ?? []).map(
    (ep) => ({
      id: ep.id as string,
      label: ep.label as string,
      path: ep.path as string,
      method: ep.method as string,
    }),
  );
}

export class AdapterDetailDto {
  id!: string;
  name!: string;
  baseUrl!: string;
  status!: string;
  authType!: string;
  hasAuth!: boolean;
  endpoints!: AdapterEndpointDto[];
}

/**
 * Strips sensitive fields (authConfig) from raw adapter data
 * received from the adapter-service. Returns a safe summary
 * suitable for the admin UI.
 */
export function sanitizeAdapter(
  raw: Record<string, unknown>,
): AdapterSummaryDto {
  const { authType, hasAuth } = mapAdapterAuthFields(raw);

  return {
    id: raw.id as string,
    name: raw.name as string,
    status: raw.status as string,
    baseUrl: raw.baseUrl as string | undefined,
    authType,
    hasAuth,
    endpoints: mapAdapterEndpoints(raw),
  };
}

/**
 * Strips sensitive fields and returns a detail view (always includes baseUrl).
 */
export function sanitizeAdapterDetail(
  raw: Record<string, unknown>,
): AdapterDetailDto {
  const { authType, hasAuth } = mapAdapterAuthFields(raw);

  return {
    id: raw.id as string,
    name: raw.name as string,
    baseUrl: (raw.baseUrl as string) ?? "",
    status: raw.status as string,
    authType,
    hasAuth,
    endpoints: mapAdapterEndpoints(raw),
  };
}
