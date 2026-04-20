import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { NatsConnection } from "nats";
import {
  WEBHOOK_VERIFY_RPC_SUBJECT,
  type Channel,
  type IWebhookVerifyRequest,
  type IWebhookVerifyResponse,
} from "@yoizen/shared";
import { NATS_CONNECTION } from "../../providers/nats.provider";
import type { WebhookVerificationQueryDto } from "./webhooks-gateway.dto";

const VERIFY_TIMEOUT_MS = 5_000;

@Injectable()
export class WebhookVerifyRpcClient {
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();

  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
  ) {}

  async verify(params: {
    tenantId: string;
    channel: string;
    query: WebhookVerificationQueryDto;
  }): Promise<string> {
    const request = this.toRequest(params);
    const response = await this.requestVerify(request);
    if (response.ok) return response.challenge;
    if (response.reason === "invalid_token") {
      throw new NotFoundException("Invalid verify token");
    }
    throw new BadRequestException("Unsupported or malformed verify request");
  }

  private toRequest(params: {
    tenantId: string;
    channel: string;
    query: WebhookVerificationQueryDto;
  }): IWebhookVerifyRequest {
    const { tenantId, channel, query } = params;
    const mode = query["hub.mode"];
    const verifyToken = query["hub.verify_token"];
    const challenge = query["hub.challenge"];

    if (mode !== "subscribe" || !verifyToken || !challenge) {
      throw new BadRequestException("Missing verification parameters");
    }

    return {
      tenantId,
      channel: channel as Channel,
      verifyToken,
      challenge,
    };
  }

  private async requestVerify(
    request: IWebhookVerifyRequest,
  ): Promise<IWebhookVerifyResponse> {
    try {
      const reply = await this.nc.request(
        WEBHOOK_VERIFY_RPC_SUBJECT,
        this.encoder.encode(JSON.stringify(request)),
        { timeout: VERIFY_TIMEOUT_MS },
      );
      return JSON.parse(
        this.decoder.decode(reply.data),
      ) as IWebhookVerifyResponse;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes("timeout")) {
        throw new GatewayTimeoutException(
          "Timed out waiting for webhook verification",
        );
      }
      throw new BadGatewayException("Webhook verification RPC failed");
    }
  }
}
