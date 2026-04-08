import { Injectable, inject } from "@angular/core";
import { HttpClient, HttpParams } from "@angular/common/http";
import { Observable } from "rxjs";
import { environment } from "../../../environments/environment";

export type ChannelType = "whatsapp" | "instagram" | "telegram";

export interface IChannelAccount {
  id: string;
  tenantId: string;
  channel: ChannelType;
  provider: string;
  name: string;
  externalId: string;
  phoneNumberId?: string;
  wabaId?: string;
  igUserId?: string;
  telegramBotToken?: string;
  accessToken?: string;
  appId?: string;
  appSecret?: string;
  verifyToken?: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ICreateAccountDto {
  channel: ChannelType;
  provider?: "meta" | "telegram";
  name: string;
  externalId: string;
  phoneNumberId?: string;
  wabaId?: string;
  igUserId?: string;
  telegramBotToken?: string;
  accessToken: string;
  appId?: string;
  appSecret?: string;
  verifyToken?: string;
}

export interface IUpdateAccountDto {
  name?: string;
  accessToken?: string;
  appId?: string;
  appSecret?: string;
  verifyToken?: string;
  isActive?: boolean;
}

export interface ISendMessageDto {
  to: string;
  type: "text" | "template" | "image" | "document";
  text?: string;
  templateName?: string;
  templateLanguage?: string;
  templateComponents?: unknown[];
  mediaUrl?: string;
  caption?: string;
}

export interface IAutoReplyRule {
  id: string;
  tenantId: string;
  accountId: string;
  channel: string;
  triggerPattern: string;
  replyText: string;
  isActive: boolean;
}

export interface ICreateAutoReplyDto {
  accountId: string;
  channel: ChannelType;
  triggerPattern: string;
  replyText: string;
}

export interface IRefreshTokenResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
}

@Injectable({ providedIn: "root" })
export class ChannelService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/channels`;

  listAccounts(channel?: string): Observable<IChannelAccount[]> {
    let params = new HttpParams();
    if (channel) {
      params = params.set("channel", channel);
    }
    return this.http.get<IChannelAccount[]>(`${this.base}/accounts`, {
      params,
    });
  }

  getAccount(id: string): Observable<IChannelAccount> {
    return this.http.get<IChannelAccount>(
      `${this.base}/accounts/${encodeURIComponent(id)}`,
    );
  }

  createAccount(body: ICreateAccountDto): Observable<IChannelAccount> {
    return this.http.post<IChannelAccount>(`${this.base}/accounts`, body);
  }

  updateAccount(
    id: string,
    body: IUpdateAccountDto,
  ): Observable<IChannelAccount> {
    return this.http.patch<IChannelAccount>(
      `${this.base}/accounts/${encodeURIComponent(id)}`,
      body,
    );
  }

  deleteAccount(id: string): Observable<void> {
    return this.http.delete<void>(
      `${this.base}/accounts/${encodeURIComponent(id)}`,
    );
  }

  /**
   * Exchanges the current Meta token for a long-lived one (~60 days).
   *
   * @param id Account ID.
   * @returns Masked token, type, and expiry in seconds.
   */
  refreshMetaToken(id: string): Observable<IRefreshTokenResponse> {
    return this.http.post<IRefreshTokenResponse>(
      `${this.base}/accounts/${encodeURIComponent(id)}/refresh-token`,
      {},
    );
  }

  sendMessage(accountId: string, body: ISendMessageDto): Observable<object> {
    return this.http.post(
      `${this.base}/${encodeURIComponent(accountId)}/messages`,
      body,
    );
  }

  listAutoReplyRules(accountId?: string): Observable<IAutoReplyRule[]> {
    let params = new HttpParams();
    if (accountId) {
      params = params.set("accountId", accountId);
    }
    return this.http.get<IAutoReplyRule[]>(`${this.base}/auto-reply`, {
      params,
    });
  }

  createAutoReplyRule(body: ICreateAutoReplyDto): Observable<IAutoReplyRule> {
    return this.http.post<IAutoReplyRule>(`${this.base}/auto-reply`, body);
  }

  deleteAutoReplyRule(id: string): Observable<void> {
    return this.http.delete<void>(
      `${this.base}/auto-reply/${encodeURIComponent(id)}`,
    );
  }
}
