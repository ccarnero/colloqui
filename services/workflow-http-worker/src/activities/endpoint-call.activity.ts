import axios from 'axios';
import type { EndpointCallArgs } from '@yoizen/shared';
import { TENANT_HEADER } from '@yoizen/shared';

export interface EndpointCallResult {
  status: number;
  data: unknown;
  headers: Record<string, string>;
}

export async function executeEndpointCall(
  args: EndpointCallArgs,
  tenantId: string,
): Promise<EndpointCallResult> {
  const response = await axios({
    method: args.method,
    url: args.url,
    params: args.params,
    data: args.data,
    headers: { [TENANT_HEADER]: tenantId, ...args.headers },
    timeout: 30_000,
    validateStatus: () => true,
  });

  const responseHeaders: Record<string, string> = {};
  const entries = Object.entries(response.headers);
  for (let i = 0; i < entries.length; i++) {
    if (typeof entries[i][1] === 'string') {
      responseHeaders[entries[i][0]] = entries[i][1];
    }
  }

  return {
    status: response.status,
    data: response.data,
    headers: responseHeaders,
  };
}
