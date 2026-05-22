import { describe, it, expect, mock } from "bun:test";
import { HttpException, type ArgumentsHost } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { ServiceExceptionFilter } from "../../src/filters/service-exception.filter";
import { WebhookPublishUnavailableError } from "../../src/modules/channels/webhook-publish-unavailable.error";

function createReply(overrides: Partial<FastifyReply> = {}): FastifyReply {
  const statusMock = mock((code: number) => reply);
  const sendMock = mock((body: unknown) => reply);
  const headerMock = mock((_name: string, _value: string) => reply);
  const reply = {
    sent: false,
    status: statusMock,
    send: sendMock,
    header: headerMock,
    ...overrides,
  } as unknown as FastifyReply;
  return reply;
}

function createHost(reply: FastifyReply): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => reply,
    }),
  } as unknown as ArgumentsHost;
}

describe("ServiceExceptionFilter", () => {
  it("maps HttpException to response status and body", () => {
    const filter = new ServiceExceptionFilter();
    const reply = createReply();
    const host = createHost(reply);
    const ex = new HttpException({ message: "Not found", custom: 1 }, 404);

    filter.catch(ex, host);

    expect(reply.status).toHaveBeenCalledWith(404);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        message: "Not found",
        custom: 1,
      }),
    );
  });

  it("maps unknown errors to 500 with generic message", () => {
    const filter = new ServiceExceptionFilter();
    const reply = createReply();
    const host = createHost(reply);

    filter.catch(new Error("database exploded"), host);

    expect(reply.status).toHaveBeenCalledWith(500);
    expect(reply.send).toHaveBeenCalledWith({
      statusCode: 500,
      message: "Internal server error",
    });
  });

  it("does not send when reply was already sent", () => {
    const filter = new ServiceExceptionFilter();
    const reply = createReply({ sent: true });
    const host = createHost(reply);

    filter.catch(new Error("late"), host);

    expect(reply.status).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  /**
   * Post-mortem (`post-mortem/POST-MORTEM.md` §P1.2): the publish
   * timeout path must end up as a 503 + `Retry-After` so providers
   * (WhatsApp / Telegram / Meta) trigger their own retry instead of
   * dropping the webhook. The filter is the only place we can set the
   * header without leaking knowledge of HTTP into the publisher.
   */
  it("sets Retry-After when an exception carries retryAfterSeconds (post-mortem §P1.2)", () => {
    const filter = new ServiceExceptionFilter();
    const reply = createReply();
    const host = createHost(reply);
    const ex = new WebhookPublishUnavailableError("jetstream stalled", 5);

    filter.catch(ex, host);

    expect(reply.status).toHaveBeenCalledWith(503);
    expect(reply.header).toHaveBeenCalledWith("Retry-After", "5");
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 503,
        retryAfterSeconds: 5,
        marker: "webhook_publish_unavailable",
      }),
    );
  });

  it("rounds Retry-After up to the next whole second", () => {
    const filter = new ServiceExceptionFilter();
    const reply = createReply();
    const host = createHost(reply);
    const ex = new WebhookPublishUnavailableError("stalled", 2.3);

    filter.catch(ex, host);

    expect(reply.header).toHaveBeenCalledWith("Retry-After", "3");
  });

  it("does not set Retry-After when retryAfterSeconds is absent or zero", () => {
    const filter = new ServiceExceptionFilter();
    const reply = createReply();
    const host = createHost(reply);
    const ex = new HttpException({ message: "boom" }, 500);

    filter.catch(ex, host);

    expect(reply.header).not.toHaveBeenCalled();
  });
});
