/**
 * Shared query parameters for paginated metrics listing (service + repository).
 */
export interface IMetricsQueryParams {
  source?: string;
  name?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}
