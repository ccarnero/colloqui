import { IsString, IsNotEmpty, IsOptional, IsBoolean } from "class-validator";

export class AdapterEndpointDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsString()
  @IsNotEmpty()
  label!: string;

  @IsString()
  @IsNotEmpty()
  path!: string;

  @IsString()
  @IsNotEmpty()
  method!: string;
}

export class AdapterSummaryDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  status!: string;

  @IsString()
  @IsOptional()
  baseUrl?: string;

  @IsString()
  @IsOptional()
  authType?: string;

  @IsBoolean()
  @IsOptional()
  hasAuth?: boolean;

  endpoints!: AdapterEndpointDto[];
}

export class AdapterDetailDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  baseUrl!: string;

  @IsString()
  @IsNotEmpty()
  status!: string;

  @IsString()
  @IsNotEmpty()
  authType!: string;

  @IsBoolean()
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
  const authType = (raw.authType as string) ?? "none";
  const authConfig = raw.authConfig as Record<string, unknown> | undefined;
  const hasAuth =
    authType !== "none" &&
    authConfig !== undefined &&
    Object.keys(authConfig).length > 0;

  return {
    id: raw.id as string,
    name: raw.name as string,
    status: raw.status as string,
    baseUrl: raw.baseUrl as string | undefined,
    authType,
    hasAuth,
    endpoints: (raw.endpoints as Array<Record<string, unknown>> ?? []).map(
      (ep) => ({
        id: ep.id as string,
        label: ep.label as string,
        path: ep.path as string,
        method: ep.method as string,
      }),
    ),
  };
}

/**
 * Strips sensitive fields and returns a detail view (always includes baseUrl).
 */
export function sanitizeAdapterDetail(
  raw: Record<string, unknown>,
): AdapterDetailDto {
  const authType = (raw.authType as string) ?? "none";
  const authConfig = raw.authConfig as Record<string, unknown> | undefined;
  const hasAuth =
    authType !== "none" &&
    authConfig !== undefined &&
    Object.keys(authConfig).length > 0;

  return {
    id: raw.id as string,
    name: raw.name as string,
    baseUrl: (raw.baseUrl as string) ?? "",
    status: raw.status as string,
    authType,
    hasAuth,
    endpoints: (raw.endpoints as Array<Record<string, unknown>> ?? []).map(
      (ep) => ({
        id: ep.id as string,
        label: ep.label as string,
        path: ep.path as string,
        method: ep.method as string,
      }),
    ),
  };
}
