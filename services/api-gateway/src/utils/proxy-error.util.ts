import { HttpException, type HttpStatus, Logger } from "@nestjs/common";

/**
 * Reads the response body from a failed downstream service call,
 * parses it as JSON when possible, and throws an `HttpException`
 * that preserves the original status code and structured body.
 */
export async function throwProxyError(
  res: Response,
  serviceName: string,
  logger: Logger,
): Promise<never> {
  const text = await res.text().catch(() => "");
  logger.error(`${serviceName} responded ${res.status}: ${text}`);

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    body = { message: text || `${serviceName} error` };
  }

  throw new HttpException(body, res.status as HttpStatus);
}
