import { isIPv4 } from "node:net";
import { Injectable, BadRequestException } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";

export interface WebhookActionResult {
  readonly statusCode: number;
  readonly content: unknown;
}

@Injectable()
export class WebhookActionService {
  private readonly logger = new PinoLoggerService(WebhookActionService.name);

  async execute(
    tenantId: string,
    actionConfig: Record<string, unknown>,
    jobContext: Record<string, unknown> = {},
  ): Promise<WebhookActionResult> {
    const url = String(actionConfig.url ?? "").trim();
    if (!url) {
      throw new BadRequestException("Webhook URL is required");
    }
    this.validateUrl(url);

    const method = String(actionConfig.method ?? "POST").toUpperCase();
    const headers = (actionConfig.headers ?? {}) as Record<string, string>;
    const timeout = Number(actionConfig.timeout ?? 30) * 1000;

    const body =
      (actionConfig.data as Record<string, unknown>) ??
      (actionConfig.body as Record<string, unknown>) ?? {
        ...jobContext,
        tenantId,
        timestamp: new Date().toISOString(),
      };

    this.logger.log(
      `[webhook-action] ${method} ${url} tenant='${tenantId}' timeout=${timeout}ms`,
    );

    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: method !== "GET" && method !== "DELETE" ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      throw new Error(
        `Webhook failed with status ${response.status}: ${response.statusText}`,
      );
    }

    let content: unknown;
    try {
      content = await response.json();
    } catch {
      content = { text: await response.text() };
    }

    this.logger.log(
      `[webhook-action] Completed: status=${response.status}`,
    );

    return {
      statusCode: response.status,
      content,
    };
  }

  private validateUrl(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException(`Invalid webhook URL: '${url}'`);
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new BadRequestException(
        `Webhook URL must use http or https protocol: '${url}'`,
      );
    }

    const hostname = parsed.hostname.toLowerCase();

    // Fast-path: known string literals
    if (hostname === "localhost" || hostname === "::1") {
      throw new BadRequestException("Webhook URL must not target localhost");
    }

    if (hostname === "169.254.169.254") {
      throw new BadRequestException("Webhook URL must not target cloud metadata endpoint");
    }

    if (hostname.startsWith("169.254.") || hostname.startsWith("fe80:")) {
      throw new BadRequestException("Webhook URL must not target link-local addresses");
    }

    // Normalize to decimal IPv4 string (handles octal, hex, decimal-complete)
    const normalizedIP = this.normalizeIPv4(hostname);

    if (this.isBlockedIP(normalizedIP)) {
      throw new BadRequestException(
        `Webhook URL targets a blocked address: ${normalizedIP}`,
      );
    }
  }

  /**
   * Normalizes an IPv4 representation (decimal, octal, hex, or mixed)
   * to a standard "a.b.c.d" decimal string. Returns the original string
   * if it's not an IPv4 literal.
   */
  private normalizeIPv4(hostname: string): string {
    // Already a valid decimal IPv4
    if (isIPv4(hostname)) return hostname;

    // Try as a single 32-bit integer (decimal or hex without dots)
    const asNum = hostname.startsWith("0x")
      ? Number.parseInt(hostname, 16)
      : Number(hostname);
    if (!Number.isNaN(asNum) && asNum >= 0 && asNum <= 0xffffffff) {
      const a = (asNum >>> 24) & 0xff;
      const b = (asNum >>> 16) & 0xff;
      const c = (asNum >>> 8) & 0xff;
      const d = asNum & 0xff;
      return `${a}.${b}.${c}.${d}`;
    }

    // Try as dotted notation with mixed formats (octal/hex per octet)
    const parts = hostname.split(".");
    if (parts.length === 4) {
      const octets: number[] = [];
      for (const part of parts) {
        let val: number;
        if (part.startsWith("0x") || part.startsWith("0X")) {
          val = Number.parseInt(part, 16);
        } else if (part.length > 1 && part.startsWith("0")) {
          // Octal: leading zero (but not "0" itself)
          val = Number.parseInt(part, 8);
        } else {
          val = Number(part);
        }
        if (Number.isNaN(val) || val < 0 || val > 255) return hostname;
        octets.push(val);
      }
      return octets.join(".");
    }

    return hostname;
  }

  private isBlockedIP(ip: string): boolean {
    if (!isIPv4(ip)) return false;

    const parts = ip.split(".").map(Number);

    // 127.0.0.0/8 (loopback)
    if (parts[0] === 127) return true;

    // 10.0.0.0/8 (RFC1918)
    if (parts[0] === 10) return true;

    // 172.16.0.0/12 (RFC1918)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;

    // 192.168.0.0/16 (RFC1918)
    if (parts[0] === 192 && parts[1] === 168) return true;

    // 169.254.0.0/16 (link-local)
    if (parts[0] === 169 && parts[1] === 254) return true;

    // 0.0.0.0/8 (current network)
    if (parts[0] === 0) return true;

    return false;
  }
}
