import { Inject, Injectable } from "@nestjs/common";
import type { TenantConnectionManager } from "@yoizen/database";
import { ChannelTenantConnectionManager } from "../../providers/channel-tenant-connection-manager";
import type {
  IAutoReplyRepository,
  IInsertRuleOptions,
  IRuleRow,
} from "./auto-reply.repository.interface";

@Injectable()
export class AutoReplyPostgresRepository implements IAutoReplyRepository {
  constructor(
    @Inject(ChannelTenantConnectionManager)
    private readonly tenantSql: TenantConnectionManager,
  ) {}

  private async sqlFor(tenantId: string) {
    return this.tenantSql.ensureSchema(tenantId);
  }

  async listActiveRulesForTenant(tenantId: string): Promise<IRuleRow[]> {
    const sql = await this.sqlFor(tenantId);
    return sql<IRuleRow[]>`
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
    const sql = await this.sqlFor(tenantId);
    await sql`
      INSERT INTO auto_reply_rules (id, account_id, channel, trigger_pattern, reply_text)
      VALUES (${id}, ${accountId}, ${channel}, ${triggerPattern}, ${replyText})
    `;
  }

  async listRulesForTenant(
    tenantId: string,
    accountId?: string,
  ): Promise<IRuleRow[]> {
    const sql = await this.sqlFor(tenantId);
    return accountId
      ? sql<IRuleRow[]>`
          SELECT * FROM auto_reply_rules
          WHERE account_id = ${accountId}
          ORDER BY created_at ASC
        `
      : sql<IRuleRow[]>`
          SELECT * FROM auto_reply_rules
          ORDER BY created_at ASC
        `;
  }

  async deleteRule(
    tenantId: string,
    ruleId: string,
  ): Promise<{ count: number }> {
    const sql = await this.sqlFor(tenantId);
    return sql`
      DELETE FROM auto_reply_rules
      WHERE id = ${ruleId}
    `;
  }
}
