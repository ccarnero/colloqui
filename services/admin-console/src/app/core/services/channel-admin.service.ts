import { Injectable, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import type { Observable } from "rxjs";
import { environment } from "../../../environments/environment";
import type {
  IChannelAccount,
  IChannelAccountOption,
} from "../models/channel-account.model";

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

  listAccounts(): Observable<IChannelAccount[]> {
    return this.http.get<IChannelAccount[]>(`${BASE}/accounts`);
  }

  deleteAccount(id: string): Observable<void> {
    return this.http.delete<void>(`${BASE}/accounts/${id}`);
  }

  createAccount(body: Record<string, unknown>): Observable<unknown> {
    return this.http.post(`${BASE}/accounts`, body);
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
}
