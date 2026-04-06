import {
  Inject,
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import type { NatsConnection, Subscription } from "nats";
import { PinoLoggerService } from "@yoizen/observability";
import type { ChannelEnvelope, AutoReplyRule, Channel } from "@yoizen/shared";
import { CHANNEL_SUBJECT_PREFIX, CHANNEL_DOMAIN } from "@yoizen/shared";
import { NATS_CONNECTION } from "../../providers/nats.provider";
import { EgressService } from "../egress/egress.service";
import { AutoReplyRepository } from "./auto-reply.repository";
import { matchAutoReplyPattern } from "./auto-reply.pattern";

/** Options for creating an auto-reply rule. */
interface ICreateRuleOptions {
  tenantId: string;
  accountId: string;
  channel: Channel;
  triggerPattern: string;
  replyText: string;
}

@Injectable()
export class AutoReplyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new PinoLoggerService(AutoReplyService.name);
  private subscription: Subscription | null = null;

  private readonly rulesCache = new Map<string, AutoReplyRule[]>();
  private cacheRefreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    private readonly autoReplyRepository: AutoReplyRepository,
    private readonly egress: EgressService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refreshRulesCache();

    this.cacheRefreshInterval = setInterval(
      () =>
        this.refreshRulesCache().catch((err: unknown) => {
          this.logger.warn(
            `Rules cache refresh failed: ${err instanceof Error ? err.message : err}`,
          );
        }),
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
      matchAutoReplyPattern(text, rule.triggerPattern, (msg) =>
        this.logger.warn(msg),
      ),
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

  private async refreshRulesCache(): Promise<void> {
    const rows = await this.autoReplyRepository.loadActiveRules();

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

  async createRule(options: ICreateRuleOptions): Promise<AutoReplyRule> {
    const { tenantId, accountId, channel, triggerPattern, replyText } = options;
    const id = crypto.randomUUID();

    await this.autoReplyRepository.insertRule({
      id,
      tenantId,
      accountId,
      channel,
      triggerPattern,
      replyText,
    });

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
    const rows = await this.autoReplyRepository.listRulesForTenant(
      tenantId,
      accountId,
    );

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
    const result = await this.autoReplyRepository.deleteRule(
      tenantId,
      ruleId,
    );

    if (result.count > 0) {
      await this.refreshRulesCache();
    }

    return result.count > 0;
  }
}
