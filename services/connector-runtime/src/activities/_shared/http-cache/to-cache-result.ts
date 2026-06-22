import type { EndpointCacheResult } from "../http-call-with-retry";
import type { HttpResponseCacheResultValue } from "../metrics";
import { HttpResponseCacheResult } from "../metrics";

export function toEndpointCacheResult(
  r: HttpResponseCacheResultValue
): EndpointCacheResult {
  if (r === HttpResponseCacheResult.HIT) {
    return "hit";
  }
  if (r === HttpResponseCacheResult.MISS) {
    return "miss";
  }
  if (r === HttpResponseCacheResult.BYPASS) {
    return "bypass";
  }
  return null;
}
