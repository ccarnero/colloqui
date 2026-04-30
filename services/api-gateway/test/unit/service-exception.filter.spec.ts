import { describe, it, expect, mock } from "bun:test";
import { HttpException, type ArgumentsHost } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { ServiceExceptionFilter } from "../../src/filters/service-exception.filter";

function createReply(overrides: Partial<FastifyReply> = {}): FastifyReply {
  const statusMock = mock((code: number) => reply);
  const sendMock = mock((body: unknown) => reply);
  const reply = {
    sent: false,
    status: statusMock,
    send: sendMock,
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
});
