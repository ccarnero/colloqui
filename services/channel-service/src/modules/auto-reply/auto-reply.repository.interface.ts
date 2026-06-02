import type { Channel } from "@yoizen/shared";

export const AUTO_REPLY_REPOSITORY = Symbol("AUTO_REPLY_REPOSITORY");

export interface IRuleRow {
  id: string;
  account_id: string;
  channel: string;
  trigger_pattern: string;
  reply_text: string;
  is_active: boolean;
}

/** Options for inserting an auto-reply rule. */
export interface IInsertRuleOptions {
  id: string;
  /** Resolves tenant pool only; not stored. */
  tenantId: string;
  accountId: string;
  channel: Channel;
  triggerPattern: string;
  replyText: string;
}

export interface IAutoReplyRepository {
  listActiveRulesForTenant(tenantId: string): Promise<IRuleRow[]>;
  insertRule(options: IInsertRuleOptions): Promise<void>;
  listRulesForTenant(tenantId: string, accountId?: string): Promise<IRuleRow[]>;
  deleteRule(tenantId: string, ruleId: string): Promise<{ count: number }>;
}
