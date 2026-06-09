import type { ToolDef, ToolHandler, ToolResult, ToolExecutionContext } from "../tool-definition";

const COMMUNICATE_TOOL: ToolDef = {
  name: "communicate",
  description:
    "Send, reply, notify, or escalate messages through communication channels",
  builtin: true,
  readOnly: false,
  maxOutputChars: 16_384,
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["send", "reply", "notify", "escalate"],
        description: "Action to perform",
      },
      target_id: {
        type: "string",
        description: "Recipient identifier (user ID, thread ID, etc.)",
      },
      message: {
        type: "string",
        description: "Message content to send",
      },
      channel: {
        type: "string",
        enum: ["whatsapp", "email", "sms", "push"],
        default: "whatsapp",
        description: "Communication channel",
      },
      priority: {
        type: "string",
        enum: ["low", "medium", "high", "urgent"],
        default: "medium",
        description: "Priority level",
      },
      context: {
        type: "string",
        description: "Additional context about the communication",
      },
      metadata: {
        type: "object",
        description: "Custom metadata dictionary",
      },
    },
    required: ["action", "target_id"],
  },
};

export const COMMUNICATE_TOOL_DEF: ToolDef = COMMUNICATE_TOOL;

export const communicateHandler: ToolHandler = async (
  params: Record<string, unknown>,
  _state: ToolExecutionContext,
): Promise<ToolResult> => {
  const action = String(params.action ?? "").trim().toLowerCase();
  const targetId = String(params.target_id ?? "").trim();

  if (!action || !targetId) {
    return {
      success: false,
      output: null,
      error: "action and target_id are required",
    };
  }

  const payload = {
    action,
    target_id: targetId,
    message: String(params.message ?? ""),
    channel: String(params.channel ?? "whatsapp"),
    priority: String(params.priority ?? "medium"),
    context: String(params.context ?? ""),
    ...(params.metadata ? { metadata: params.metadata } : {}),
  };

  return {
    success: true,
    output: payload,
  };
};
