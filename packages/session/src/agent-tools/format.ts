import type { AgentMessage } from "@earendil-works/pi-agent-core";

export function formatMessage(message: AgentMessage): string {
  const role = formatRole(message.role);

  const content = formatMessageContent(
    (
      message as {
        content?: unknown;
      }
    ).content,
  );

  return [`角色：${role}`, "", content || "（无文本内容）"].join("\n");
}

export function formatMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    if (content === undefined || content === null) {
      return "";
    }

    return safeStringify(content);
  }

  const output: string[] = [];

  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }

    const value = block as Record<string, unknown>;

    switch (value.type) {
      case "text": {
        if (typeof value.text === "string") {
          output.push(value.text);
        }

        break;
      }

      case "toolCall": {
        const name = typeof value.name === "string" ? value.name : "unknown";

        const args = value.arguments ?? value.input;

        output.push(
          [
            `[调用工具：${name}]`,

            args !== undefined ? safeStringify(args) : "",
          ]
            .filter(Boolean)
            .join("\n"),
        );

        break;
      }

      case "toolResult": {
        output.push(
          [
            "[工具结果]",

            value.content !== undefined ? formatMessageContent(value.content) : "",
          ]
            .filter(Boolean)
            .join("\n"),
        );

        break;
      }

      case "thinking": {
        /**
         * 不重新向 Agent 暴露历史 thinking。
         */
        break;
      }

      default: {
        /**
         * 未知 content block 不直接丢弃，
         * 但也避免把大型内部结构全部展开。
         */
        const text = typeof value.text === "string" ? value.text : undefined;

        if (text) {
          output.push(text);
        }

        break;
      }
    }
  }

  return output.filter(Boolean).join("\n");
}

export function formatRole(role: string): string {
  switch (role) {
    case "user":
      return "用户";

    case "assistant":
      return "助手";

    case "toolResult":
      return "工具结果";

    default:
      return role;
  }
}

export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
