import {
  Inject,
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Optional,
} from "@nestjs/common";
import type {
  JetStreamClient,
  JetStreamManager,
  JsMsg,
  MsgHdrs,
} from "nats";
import { headers as natsHeaders } from "nats";
import { context as otelContext } from "@opentelemetry/api";
import {
  PinoLoggerService,
  logWithEnvelope,
  startNatsConsumerSpan,
  createNatsConsumerMetrics,
  isWorkerMode,
  resolveServiceName,
} from "@yoizen/observability";
import type { ChannelEnvelope, AutoReplyRule, Channel } from "@yoizen/shared";
import {
  CHANNEL_SUBJECT_PREFIX,
  CHANNEL_PRODUCER,
  CHANNEL_DOMAIN,
} from "@yoizen/shared";
import {
  JETSTREAM_MANAGER,
  JETSTREAM_PUBLISHER,
} from "../../providers/nats.provider";
import type { MongoClient, Sql } from "@yoizen/database";
import {
  MultiTenantConsumerManager,
  type IMultiTenantConsumerConfig,
} from "@yoizen/database";
import { channelServiceConfig } from "../../config";
import { MONGO_CLIENT } from "../../providers/mongo.provider";
import { POSTGRES_SQL } from "../../providers/postgres.provider";
import { platformDb } from "../../providers/platform-db";
import { EgressService } from "../egress/egress.service";
import {
  AUTO_REPLY_REPOSITORY,
  type IAutoReplyRepository,
} from "./auto-reply.repository.interface";
import { matchAutoReplyPattern } from "./auto-reply.pattern";

const DURABLE_NAME = "auto-reply";
const TENANT_STREAM_PATTERN = /^INGRESS-/;

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
  private manager: MultiTenantConsumerManager | null = null;

  private readonly rulesCache = new Map<string, AutoReplyRule[]>();
  private cacheRefreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(JETSTREAM_MANAGER) private readonly jsm: JetStreamManager,
    @Inject(JETSTREAM_PUBLISHER) private readonly js: JetStreamClient,
    @Inject(AUTO_REPLY_REPOSITORY)
    private readonly autoReplyRepository: IAutoReplyRepository,
    private readonly egress: EgressService,
    @Optional() @Inject(MONGO_CLIENT) private readonly platformMongo?: MongoClient,
    @Optional() @Inject(POSTGRES_SQL) private readonly platformSql?: Sql,
  ) {}

  async onModuleInit(): Promise<void> {
    const ensureOnly = !isWorkerMode();

    // Rules cache is only useful for worker mode (where messages get
    // processed). API pods just pre-create the consumer for KEDA.
    if (!ensureOnly) {
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
    }

    const subject = `${CHANNEL_SUBJECT_PREFIX}.*.${CHANNEL_PRODUCER}.${CHANNEL_DOMAIN}.*.*.received.v1`;

    const config: IMultiTenantConsumerConfig = {
      streamPattern: TENANT_STREAM_PATTERN,
      durableName: DURABLE_NAME,
      filterSubject: subject,
      description: "Auto-reply rule dispatcher",
      metrics: createNatsConsumerMetrics(resolveServiceName("channel-service")),
      runnerOptions: { concurrency: 16 },
      ensureOnly,
    };
    this.manager = new MultiTenantConsumerManager(
      this.jsm,
      this.js,
      config,
      (msg: JsMsg) => this.handleJsMessage(msg),
      this.logger,
    );
    await this.manager.start();
    this.logger.log(
      ensureOnly
        ? `Pre-created '${DURABLE_NAME}' durable consumer (api mode, ensure-only)`
        : `Auto-reply durable consumer ('${DURABLE_NAME}') started (filter=${subject})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.cacheRefreshInterval) {
      clearInterval(this.cacheRefreshInterval);
    }
    if (this.manager) {
      await this.manager.stop();
      this.manager = null;
    }
  }

  /** JetStream-path handler — throws on failure so runner NAKs. */
  private async handleJsMessage(msg: JsMsg): Promise<void> {
    await this.handleMessage({
      data: msg.data,
      headers: msg.headers,
      subject: msg.subject,
    });
  }

  private async handleMessage(msg: {
    data: Uint8Array;
    headers?: MsgHdrs;
    subject: string;
  }): Promise<void> {
    const decoder = new TextDecoder();
    const envelope = JSON.parse(decoder.decode(msg.data)) as ChannelEnvelope;

    const payload: Record<string, unknown> =
      (envelope.data?.payload as Record<string, unknown> | null | undefined) ??
      (envelope.data as unknown as Record<string, unknown>);
    const text = payload.text as string | undefined;
    if (!text) return;

    const tenantId = envelope.tenant;
    const accountId =
      (payload.accountId as string | undefined) ??
      (envelope.accountid as string | undefined);
    if (!tenantId || !accountId) return;

    const cacheKey = `${tenantId}:${accountId}`;
    const rules = this.rulesCache.get(cacheKey);
    if (!rules || rules.length === 0) return;

    const matchedRule = rules.find((rule) =>
      matchAutoReplyPattern(text, rule.triggerPattern, (msg) =>
        this.logger.warn(msg),
      ),
    );

    if (!matchedRule) return;

    const from = payload.from as string;

    logWithEnvelope(
      this.logger,
      envelope,
      "auto_reply.triggered",
      `Auto-reply triggered rule=${matchedRule.id} from=${from}`,
    );

    const incomingHeaders = msg.headers ?? natsHeaders();
    const { span, context: spanCtx } = startNatsConsumerSpan(
      resolveServiceName("channel-service"),
      msg.subject,
      incomingHeaders,
    );

    try {
      await otelContext.with(spanCtx, () =>
        this.egress.send(
          tenantId,
          accountId,
          {
            to: from,
            type: "text",
            text: matchedRule.replyText,
          },
          {
            causationId: envelope.id ?? null,
            correlationId: envelope.correlation_id ?? undefined,
            incomingDepth: envelope.transport?.depth ?? 0,
          },
        ),
      );
    } finally {
      span.end();
    }
  }

  private async refreshRulesCache(): Promise<void> {
    const tenantRows = await this.listTenantNames();

    this.rulesCache.clear();

    let total = 0;
    for (const { name: tenantId } of tenantRows) {
      const rows =
        await this.autoReplyRepository.listActiveRulesForTenant(tenantId);
      total += rows.length;

      for (const row of rows) {
        const key = `${tenantId}:${row.account_id}`;
        const rule: AutoReplyRule = {
          id: row.id,
          tenantId,
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
    }

    this.logger.log(`Auto-reply rules cache refreshed: ${total} rules`);
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
      tenantId,
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

  private async listTenantNames(): Promise<Array<{ name: string }>> {
    if (channelServiceConfig.dbEngine === "mongo") {
      if (!this.platformMongo) return [];
      return platformDb(this.platformMongo)
        .collection<{ name: string }>("tenants")
        .find({}, { projection: { name: 1, _id: 0 } })
        .sort({ name: 1 })
        .toArray();
    }
    if (!this.platformSql) return [];
    return this.platformSql<Array<{ name: string }>>`
      SELECT name FROM tenants ORDER BY name
    `;
  }
}
