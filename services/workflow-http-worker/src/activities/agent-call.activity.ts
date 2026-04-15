import { tracedFetch } from "@yoizen/observability";
import { TENANT_HEADER } from "@yoizen/shared";
import type { AgentCallArgs } from "@yoizen/shared";
import { workflowHttpWorkerConfig } from "../config";

const YOIZEN_USER_ID_HEADER = "x-yoizen-user-id";

/** Aligns with YoizenClaw runtime chat timeout (see agents-runtime.service). */
const AGENT_CALL_TIMEOUT_MS = 5 * 60 * 1000;

interface IAgentCallResult {
  status: number;
  data: unknown;
  headers: Record<string, string>;
}

/**
 * POST /admin/agents/:id/chat on yoizenclaw-admin-service (tenant header required).
 *
 * @param args - Agent id and chat payload (message may include `{{results.*}}` templates).
 * @param tenantId - `x-yoizen-tenant` value.
 * @returns Normalized HTTP result (same shape as endpoint/service call activities).
 */
export async function executeAgentCall(
  args: AgentCallArgs,
  tenantId: string,
): Promise<IAgentCallResult> {
  const base = workflowHttpWorkerConfig.yoizenclawAdminServiceUrl.replace(
    /\/$/,
    "",
  );
  const url = `${base}/admin/agents/${encodeURIComponent(args.agentId)}/chat`;

  const payload: Record<string, unknown> = {
    message: args.message,
  };
  if (args.conversationId !== undefined) {
    payload.conversationId = args.conversationId;
  }
  if (args.customerName !== undefined) {
    payload.customerName = args.customerName;
  }
  if (args.channel !== undefined) {
    payload.channel = args.channel;
  }
  if (args.context !== undefined) {
    payload.context = args.context;
  }
  if (args.userId !== undefined) {
    payload.userId = args.userId;
  }

  const headers: Record<string, string> = {
    [TENANT_HEADER]: tenantId,
    "Content-Type": "application/json",
  };
  if (args.userId !== undefined && args.userId.length > 0) {
    headers[YOIZEN_USER_ID_HEADER] = args.userId;
  }

  const res = await tracedFetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(AGENT_CALL_TIMEOUT_MS),
  });

  return buildResult(res);
}

async function buildResult(res: Response): Promise<IAgentCallResult> {
  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    responseHeaders[k] = v;
  });

  let data: unknown;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    data = await res.json();
  } else {
    data = await res.text();
  }

  return { status: res.status, data, headers: responseHeaders };
}
