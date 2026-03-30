import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import type { NatsConnection, Subscription } from "nats";
import type { Sql } from "postgres";
import type {
  ChannelEnvelope,
  AutoReplyRule,
  Channel,
} from "@yoizen/shared";
import {
  CHANNEL_SUBJECT_PREFIX,
  CHANNEL_DOMAIN,
} from "@yoizen/shared";
import { NATS_CONNECTION } from "../../providers/nats.provider";
import { POSTGRES_SQL } from "../../providers/postgres.provider";
import { EgressService } from "../egress/egress.service";

interface RuleRow {
  id: string;
  tenant_id: string;
  account_id: string;
  channel: string;
  trigger_pattern: string;
  reply_text: string;
  is_active: boolean;
}

@Injectable()
export class AutoReplyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutoReplyService.name);
  private subscription: Subscription | null = null;

  private readonly rulesCache = new Map<string, AutoReplyRule[]>();
  private cacheRefreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    @Inject(POSTGRES_SQL) private readonly sql: Sql,
    private readonly egress: EgressService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refreshRulesCache();

    this.cacheRefreshInterval = setInterval(
      () => this.refreshRulesCache().catch(() => {}),
      30_000,
    );

    const subject = `${CHANNEL_SUBJECT_PREFIX}.*.${CHANNEL_DOMAIN}.*.*.received.v1`;
    this.subscription = this.nc.subscribe(subject, {
      callback: (_err, msg) => {
        this.handleMessage(msg).catch((err) => {
          this.logger.warn(
            `Auto-reply handler error: ${err instanceof Error ? err.message : err}`,
          );
        });
      },
    });

    this.logger.log(`Auto-reply subscribed to: ${subject}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.cacheRefreshInterval) {
      clearInterval(this.cacheRefreshInterval);
    }
    if (this.subscription) {
      this.subscription.unsubscribe();
    }
  }

  private async handleMessage(msg: { data: Uint8Array }): Promise<void> {
    const decoder = new TextDecoder();
    const envelope = JSON.parse(decoder.decode(msg.data)) as ChannelEnvelope;

    const text = envelope.data.text as string | undefined;
    if (!text) return;

    const cacheKey = `${envelope.tenantId}:${envelope.data.accountId}`;
    const rules = this.rulesCache.get(cacheKey);
    if (!rules || rules.length === 0) return;

    const matchedRule = rules.find((rule) =>
      this.matchPattern(text, rule.triggerPattern),
    );

    if (!matchedRule) return;

    const from = envelope.data.from as string;
    const accountId = envelope.data.accountId as string;

    this.logger.log(
      `Auto-reply triggered: rule=${matchedRule.id} from=${from} tenant=${envelope.tenantId}`,
    );

    await this.egress.send(envelope.tenantId, accountId, {
      to: from,
      type: "text",
      text: matchedRule.replyText,
    });
  }

  private matchPattern(text: string, pattern: string): boolean {
    if (pattern === "*") return true;

    const lowerText = text.toLowerCase();
    const lowerPattern = pattern.toLowerCase();

    if (lowerPattern.startsWith("regex:")) {
      try {
        const regex = new RegExp(lowerPattern.slice(6), "i");
        return regex.test(text);
      } catch {
        return false;
      }
    }

    return lowerText.includes(lowerPattern);
  }

  private async refreshRulesCache(): Promise<void> {
    const rows = await this.sql<RuleRow[]>`
      SELECT * FROM auto_reply_rules WHERE is_active = true
    `;

    this.rulesCache.clear();

    for (const row of rows) {
      const key = `${row.tenant_id}:${row.account_id}`;
      const rule: AutoReplyRule = {
        id: row.id,
        tenantId: row.tenant_id,
        accountId: row.account_id,
        channel: row.channel as Channel,
        triggerPattern: row.trigger_pattern,
        replyText: row.reply_text,
        isActive: row.is_active,
      };

      const existing = this.rulesCache.get(key);
      if (existing) {
        existing.push(rule);
      } else {
        this.rulesCache.set(key, [rule]);
      }
    }

    this.logger.log(`Auto-reply rules cache refreshed: ${rows.length} rules`);
  }

  async createRule(
    tenantId: string,
    accountId: string,
    channel: Channel,
    triggerPattern: string,
    replyText: string,
  ): Promise<AutoReplyRule> {
    const id = crypto.randomUUID();

    await this.sql`
      INSERT INTO auto_reply_rules (id, tenant_id, account_id, channel, trigger_pattern, reply_text)
      VALUES (${id}, ${tenantId}, ${accountId}, ${channel}, ${triggerPattern}, ${replyText})
    `;

    const rule: AutoReplyRule = {
      id,
      tenantId,
      accountId,
      channel,
      triggerPattern,
      replyText,
      isActive: true,
    };

    const key = `${tenantId}:${accountId}`;
    const existing = this.rulesCache.get(key);
    if (existing) {
      existing.push(rule);
    } else {
      this.rulesCache.set(key, [rule]);
    }

    return rule;
  }

  async listRules(
    tenantId: string,
    accountId?: string,
  ): Promise<AutoReplyRule[]> {
    const rows = accountId
      ? await this.sql<RuleRow[]>`
          SELECT * FROM auto_reply_rules
          WHERE tenant_id = ${tenantId} AND account_id = ${accountId}
          ORDER BY created_at ASC
        `
      : await this.sql<RuleRow[]>`
          SELECT * FROM auto_reply_rules
          WHERE tenant_id = ${tenantId}
          ORDER BY created_at ASC
        `;

    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      accountId: row.account_id,
      channel: row.channel as Channel,
      triggerPattern: row.trigger_pattern,
      replyText: row.reply_text,
      isActive: row.is_active,
    }));
  }

  async deleteRule(tenantId: string, ruleId: string): Promise<boolean> {
    const result = await this.sql`
      DELETE FROM auto_reply_rules
      WHERE id = ${ruleId} AND tenant_id = ${tenantId}
    `;

    if (result.count > 0) {
      await this.refreshRulesCache();
    }

    return result.count > 0;
  }
}
