import { Injectable, inject } from "@angular/core";
import { HttpClient, HttpParams } from "@angular/common/http";
import type { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { environment } from "../../../environments/environment";
import { ResourceMutationsService } from "./metrics/resource-mutations.service";
import type {
  IChannelAccount,
  IChannelAccountOption,
} from "../models/channel-account.model";
import type {
  IStreamMessage,
  IStreamMessagesQueryParams,
  IStreamSummary,
  IUsageBucketRow,
  IUsageQueryParams,
  IUsageTotalsQueryParams,
  IUsageTotalsRow,
} from "../models/channel-streams.model";

const BASE = `${environment.apiUrl}/channels`;

export interface IAutoReplyRuleDto {
  id: string;
  accountId: string;
  channel: string;
  triggerPattern: string;
  replyText: string;
  isActive: boolean;
}

@Injectable({ providedIn: "root" })
export class ChannelAdminService {
  private readonly http = inject(HttpClient);
  private readonly mutations = inject(ResourceMutationsService);

  listAccounts(): Observable<IChannelAccount[]> {
    return this.http.get<IChannelAccount[]>(`${BASE}/accounts`);
  }

  deleteAccount(id: string): Observable<void> {
    return this.http
      .delete<void>(`${BASE}/accounts/${id}`)
      .pipe(tap(() => this.mutations.notify("channels")));
  }

  createAccount(body: Record<string, unknown>): Observable<unknown> {
    return this.http
      .post(`${BASE}/accounts`, body)
      .pipe(tap(() => this.mutations.notify("channels")));
  }

  patchAccount(
    id: string,
    body: Record<string, unknown>,
  ): Observable<unknown> {
    return this.http.patch(`${BASE}/accounts/${id}`, body);
  }

  listAccountOptions(): Observable<IChannelAccountOption[]> {
    return this.http.get<IChannelAccountOption[]>(`${BASE}/accounts`);
  }

  listAutoReplyRules(): Observable<IAutoReplyRuleDto[]> {
    return this.http.get<IAutoReplyRuleDto[]>(`${BASE}/auto-reply`);
  }

  deleteAutoReplyRule(id: string): Observable<void> {
    return this.http.delete<void>(`${BASE}/auto-reply/${id}`);
  }

  createAutoReplyRule(body: {
    accountId: string;
    channel: string;
    triggerPattern: string;
    replyText: string;
  }): Observable<unknown> {
    return this.http.post(`${BASE}/auto-reply`, body);
  }

  getUsage(
    params: IUsageQueryParams,
  ): Observable<{ items: IUsageBucketRow[] }> {
    return this.http.get<{ items: IUsageBucketRow[] }>(`${BASE}/usage`, {
      params: buildParams(params as unknown as Record<string, string | undefined>),
    });
  }

  getUsageTotals(
    params: IUsageTotalsQueryParams,
  ): Observable<{ items: IUsageTotalsRow[] }> {
    return this.http.get<{ items: IUsageTotalsRow[] }>(
      `${BASE}/usage/totals`,
      {
        params: buildParams(
          params as unknown as Record<string, string | undefined>,
        ),
      },
    );
  }

  getStreams(): Observable<{ items: IStreamSummary[] }> {
    return this.http.get<{ items: IStreamSummary[] }>(`${BASE}/streams`);
  }

  getStreamMessages(
    key: "ingress" | "dlq",
    params: IStreamMessagesQueryParams = {},
  ): Observable<{ items: IStreamMessage[] }> {
    const rawParams: Record<string, string | undefined> = {};
    if (params.subject !== undefined) rawParams["subject"] = params.subject;
    if (params.accountId !== undefined)
      rawParams["accountId"] = params.accountId;
    if (params.limit !== undefined) rawParams["limit"] = String(params.limit);
    if (params.mode !== undefined) rawParams["mode"] = params.mode;
    return this.http.get<{ items: IStreamMessage[] }>(
      `${BASE}/streams/${encodeURIComponent(key)}/messages`,
      { params: buildParams(rawParams) },
    );
  }
}

function buildParams(
  source: Record<string, string | undefined>,
): HttpParams {
  let p = new HttpParams();
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== "") {
      p = p.set(key, value);
    }
  }
  return p;
}
