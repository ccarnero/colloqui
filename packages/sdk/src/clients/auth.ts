import type { TokenResponse } from '@yoizen/shared';
import type { HttpTransport } from '../transport';

export class AuthClient {
  constructor(private readonly transport: HttpTransport) {}

  /**
   * Exchange client credentials for an access token.
   * Typically not needed directly -- HttpTransport manages tokens automatically.
   * Exposed for advanced use cases (e.g. token inspection).
   */
  async token(clientId: string, clientSecret: string): Promise<TokenResponse> {
    return this.transport.post<TokenResponse>('/auth/token', {
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    });
  }
}
