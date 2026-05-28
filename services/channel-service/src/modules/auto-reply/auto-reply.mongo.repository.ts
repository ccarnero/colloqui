import { Inject, Injectable } from "@nestjs/common";
import type { Db, TenantMongoConnectionManager } from "@yoizen/database";
import { ChannelTenantConnectionManager } from "../../providers/channel-tenant-connection-manager";
import type {
  IAutoReplyRepository,
  IInsertRuleOptions,
  IRuleRow,
} from "./auto-reply.repository.interface";

interface IAutoReplyRuleDoc {
  readonly _id: string;
  readonly account_id: string;
  readonly channel: string;
  readonly trigger_pattern: string;
  readonly reply_text: string;
  readonly is_active: boolean;
  readonly created_at: Date;
}

function docToRow(doc: IAutoReplyRuleDoc): IRuleRow {
  return {
    id: String(doc._id),
    account_id: doc.account_id,
    channel: doc.channel,
    trigger_pattern: doc.trigger_pattern,
    reply_text: doc.reply_text,
    is_active: doc.is_active,
  };
}

@Injectable()
export class AutoReplyMongoRepository implements IAutoReplyRepository {
  constructor(
    @Inject(ChannelTenantConnectionManager)
    private readonly tenantDb: TenantMongoConnectionManager,
  ) {}

  private async dbFor(tenantId: string): Promise<Db> {
    return this.tenantDb.ensureSchema(tenantId);
  }

  async listActiveRulesForTenant(tenantId: string): Promise<IRuleRow[]> {
    const db = await this.dbFor(tenantId);
    const docs = await db
      .collection<IAutoReplyRuleDoc>("auto_reply_rules")
      .find({ is_active: true })
      .toArray();
    return docs.map(docToRow);
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
    const db = await this.dbFor(tenantId);
    await db.collection<IAutoReplyRuleDoc>("auto_reply_rules").insertOne({
      _id: id,
      account_id: accountId,
      channel,
      trigger_pattern: triggerPattern,
      reply_text: replyText,
      is_active: true,
      created_at: new Date(),
    });
  }

  async listRulesForTenant(
    tenantId: string,
    accountId?: string,
  ): Promise<IRuleRow[]> {
    const db = await this.dbFor(tenantId);
    const filter = accountId ? { account_id: accountId } : {};
    const docs = await db
      .collection<IAutoReplyRuleDoc>("auto_reply_rules")
      .find(filter)
      .sort({ created_at: 1 })
      .toArray();
    return docs.map(docToRow);
  }

  async deleteRule(
    tenantId: string,
    ruleId: string,
  ): Promise<{ count: number }> {
    const db = await this.dbFor(tenantId);
    const result = await db
      .collection<IAutoReplyRuleDoc>("auto_reply_rules")
      .deleteOne({ _id: ruleId });
    return { count: result.deletedCount };
  }
}
