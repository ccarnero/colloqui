import { Inject, Injectable } from "@nestjs/common";
import type { Sql } from "postgres";
import type { Channel } from "@yoizen/shared";
import { POSTGRES_SQL } from "../../providers/postgres.provider";

export interface IRuleRow {
  id: string;
  tenant_id: string;
  account_id: string;
  channel: string;
  trigger_pattern: string;
  reply_text: string;
  is_active: boolean;
}

/** Options for inserting an auto-reply rule. */
export interface IInsertRuleOptions {
  id: string;
  tenantId: string;
  accountId: string;
  channel: Channel;
  triggerPattern: string;
  replyText: string;
}

@Injectable()
export class AutoReplyRepository {
  constructor(@Inject(POSTGRES_SQL) private readonly sql: Sql) {}

  async loadActiveRules(): Promise<IRuleRow[]> {
    return this.sql<IRuleRow[]>`
      SELECT * FROM auto_reply_rules WHERE is_active = true
    `;
  }

  async insertRule(options: IInsertRuleOptions): Promise<void> {
    const {
      id,
      tenantId,
      accountId,
      channel,
      triggerPattern,
      replyText,
    } = options;
    await this.sql`
      INSERT INTO auto_reply_rules (id, tenant_id, account_id, channel, trigger_pattern, reply_text)
      VALUES (${id}, ${tenantId}, ${accountId}, ${channel}, ${triggerPattern}, ${replyText})
    `;
  }

  async listRulesForTenant(
    tenantId: string,
    accountId?: string,
  ): Promise<IRuleRow[]> {
    return accountId
      ? this.sql<IRuleRow[]>`
          SELECT * FROM auto_reply_rules
          WHERE tenant_id = ${tenantId} AND account_id = ${accountId}
          ORDER BY created_at ASC
        `
      : this.sql<IRuleRow[]>`
          SELECT * FROM auto_reply_rules
          WHERE tenant_id = ${tenantId}
          ORDER BY created_at ASC
        `;
  }

  async deleteRule(tenantId: string, ruleId: string): Promise<{ count: number }> {
    return this.sql`
      DELETE FROM auto_reply_rules
      WHERE id = ${ruleId} AND tenant_id = ${tenantId}
    `;
  }
}
