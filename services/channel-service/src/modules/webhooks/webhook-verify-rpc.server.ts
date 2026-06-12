import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type { Msg, NatsConnection, Subscription } from "nats";
import { PinoLoggerService, isWorkerMode } from "@yoizen/observability";
import {
  WEBHOOK_VERIFY_RPC_SUBJECT,
  type Channel,
  type IWebhookVerifyRequest,
  type IWebhookVerifyResponse,
} from "@yoizen/shared";
import { NATS_CONNECTION } from "../../providers/nats.provider";
import { AccountsService } from "../accounts/accounts.service";

const VERIFY_QUEUE = "channel-service.webhook-verify";

@Injectable()
export class WebhookVerifyRpcServer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new PinoLoggerService(WebhookVerifyRpcServer.name);
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();
  private subscription: Subscription | null = null;

  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    private readonly accounts: AccountsService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!isWorkerMode()) {
      this.logger.log(
        `Skipping webhook-verify RPC server in api mode (SERVICE_MODE=api)`,
      );
      return;
    }
    this.subscription = this.nc.subscribe(WEBHOOK_VERIFY_RPC_SUBJECT, {
      queue: VERIFY_QUEUE,
      callback: (_err, msg) => {
        this.handleMessage(msg).catch((err) => {
          this.logger.warn(
            `Webhook verify RPC handler failed: ${err instanceof Error ? err.message : err}`,
          );
        });
      },
    });
    this.logger.log(
      `Webhook verify RPC listening on ${WEBHOOK_VERIFY_RPC_SUBJECT} (queue=${VERIFY_QUEUE})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
  }

  private async handleMessage(msg: Msg): Promise<void> {
    const request = this.decodeRequest(msg);
    if (!request) {
      this.respond(msg, { ok: false, reason: "bad_request" });
      return;
    }

    if (!this.isSupportedChannel(request.channel)) {
      this.respond(msg, { ok: false, reason: "unsupported_channel" });
      return;
    }

    const account = await this.accounts.findByVerifyToken(
      request.tenantId,
      request.channel,
      request.verifyToken,
    );
    if (!account) {
      this.respond(msg, { ok: false, reason: "invalid_token" });
      return;
    }

    this.respond(msg, { ok: true, challenge: request.challenge });
  }

  private decodeRequest(msg: Msg): IWebhookVerifyRequest | null {
    try {
      const parsed = JSON.parse(
        this.decoder.decode(msg.data),
      ) as IWebhookVerifyRequest;
      if (!parsed.tenantId || !parsed.channel) return null;
      if (!parsed.verifyToken || !parsed.challenge) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private respond(msg: Msg, response: IWebhookVerifyResponse): void {
    msg.respond(this.encoder.encode(JSON.stringify(response)));
  }

  private isSupportedChannel(channel: string): channel is Channel {
    return (
      channel === "whatsapp" ||
      channel === "instagram" ||
      channel === "telegram" ||
      channel === "http"
    );
  }
}
