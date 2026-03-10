import { TENANT_HEADER } from '@yoizen/shared';
import type { RetryConfig, YoizenClientOptions } from './types';
import { YoizenApiError } from './types';

const TOKEN_REFRESH_BUFFER_MS = 60_000;

export class HttpTransport {
  private readonly baseUrl: string;
  private readonly tenant: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly retry: RetryConfig;
  private readonly _fetch: typeof globalThis.fetch;

  private accessToken: string | null = null;
  private expiresAt = 0;
  private refreshPromise: Promise<void> | null = null;

  constructor(opts: YoizenClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.tenant = opts.tenant;
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.retry = {
      maxRetries: opts.maxRetries ?? 0,
      baseDelayMs: opts.retryBaseDelayMs ?? 500,
    };
    this._fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  // -------------------------------------------------------------------------
  // Public request helpers
  // -------------------------------------------------------------------------

  async get<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    const url = this.buildUrl(path, query);
    return this.request<T>(url, 'GET');
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const url = this.buildUrl(path);
    return this.request<T>(url, 'POST', body);
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    const url = this.buildUrl(path);
    return this.request<T>(url, 'PUT', body);
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    const url = this.buildUrl(path);
    return this.request<T>(url, 'PATCH', body);
  }

  async delete<T>(path: string): Promise<T> {
    const url = this.buildUrl(path);
    return this.request<T>(url, 'DELETE');
  }

  /**
   * Returns a raw fetch Response (used for SSE streaming).
   * Caller is responsible for consuming the body.
   */
  async raw(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<Response> {
    await this.ensureToken();
    const url = this.buildUrl(path, query);
    const headers = this.buildHeaders();
    return this._fetch(url, { method: 'GET', headers });
  }

  // -------------------------------------------------------------------------
  // Auth token lifecycle
  // -------------------------------------------------------------------------

  private async ensureToken(): Promise<void> {
    if (this.accessToken && Date.now() < this.expiresAt - TOKEN_REFRESH_BUFFER_MS) {
      return;
    }
    if (this.refreshPromise) {
      await this.refreshPromise;
      return;
    }
    this.refreshPromise = this.fetchToken();
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async fetchToken(): Promise<void> {
    const url = `${this.baseUrl}/auth/token`;
    const res = await this._fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new YoizenApiError(res.status, body, 'POST /auth/token');
    }

    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.expiresAt = Date.now() + data.expires_in * 1_000;
  }

  // -------------------------------------------------------------------------
  // Core request execution with retry
  // -------------------------------------------------------------------------

  private async request<T>(url: string, method: string, body?: unknown): Promise<T> {
    await this.ensureToken();
    const headers = this.buildHeaders(body !== undefined);

    let lastError: unknown;
    const attempts = 1 + this.retry.maxRetries;

    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) {
        const delay = this.retry.baseDelayMs * (1 << (attempt - 1));
        await new Promise(r => setTimeout(r, delay));
        await this.ensureToken();
      }

      const init: RequestInit = { method, headers: { ...headers } };
      if (body !== undefined) {
        init.body = JSON.stringify(body);
      }

      let res: Response;
      try {
        res = await this._fetch(url, init);
      } catch (err) {
        lastError = err;
        if (attempt < attempts - 1) continue;
        throw err;
      }

      if (res.ok) {
        const text = await res.text();
        if (!text) return undefined as T;
        return JSON.parse(text) as T;
      }

      const errorBody = await res.text().catch(() => '');
      const parsed = safeParse(errorBody);

      if (res.status >= 500 && attempt < attempts - 1) {
        lastError = new YoizenApiError(res.status, parsed, `${method} ${stripBase(this.baseUrl, url)}`);
        continue;
      }

      throw new YoizenApiError(res.status, parsed, `${method} ${stripBase(this.baseUrl, url)}`);
    }

    throw lastError;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(path.startsWith('/') ? path : `/${path}`, this.baseUrl);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  private buildHeaders(hasBody = false): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      [TENANT_HEADER]: this.tenant,
    };
    if (hasBody) {
      h['Content-Type'] = 'application/json';
    }
    return h;
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function stripBase(base: string, url: string): string {
  return url.startsWith(base) ? url.slice(base.length) : url;
}
