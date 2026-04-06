/**
 * Shared query parameters for paginated audit event listing (service + repository).
 */
export interface IAuditQueryParams {
  type?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}
