import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";

import { Type } from "typebox";

import type { SessionStore } from "./store.ts";

export interface CreateSessionToolsOptions {
  /**
   * 当前 Agent 所绑定的 Session。
   */
  sessionId: string;

  /**
   * search_session 默认返回数量。
   *
   * @default 8
   */
  searchLimit?: number;

  /**
   * read_session 单侧最多允许读取多少条消息。
   *
   * @default 20
   */
  maxReadMessages?: number;
}

/**
 * 创建 Session 相关 Agent Tools。
 *
 * 包含：
 *
 * - search_session
 * - read_session
 * - get_session_context
 */
export function createSessionTools(
  store: SessionStore,
  options: CreateSessionToolsOptions,
): AgentTool[] {
  const { sessionId, searchLimit = 8, maxReadMessages = 20 } = options;

  const searchSessionParameters = Type.Object({
    query: Type.String({
      minLength: 1,

      description:
        "要搜索的内容。可以是关键词、函数名、包名，也可以是自然语言问题，例如“之前为什么决定不用 parentId”。",
    }),

    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 20,

        description: "最多返回多少条搜索结果。通常不需要指定。",
      }),
    ),
  });

  const searchSessionTool: AgentTool<typeof searchSessionParameters> = {
    name: "search_session",

    label: "搜索会话",

    description:
      "搜索当前会话的历史内容。" +
      "当你需要回忆之前讨论过的概念、决策、实现方案、代码、包名、函数名、变量名或其他历史信息时使用。" +
      "搜索会综合全文检索、模糊检索和可用的向量检索结果。" +
      "如果搜索结果与目标相关但缺少前后文，应继续使用 read_session 读取对应消息附近的原始对话。",

    parameters: searchSessionParameters,

    execute: async (_toolCallId, params, signal) => {
      signal?.throwIfAborted();

      const hits = await store.search(params.query, {
        sessionId,

        limit: params.limit ?? searchLimit,
      });

      signal?.throwIfAborted();

      if (!hits.length) {
        return {
          content: [
            {
              type: "text",
              text:
                "没有找到匹配的历史会话内容。" +
                "可以尝试更换关键词、缩短搜索内容，或者使用更接近原始讨论内容的表达。",
            },
          ],

          details: {
            query: params.query,

            hits: [],
          },
        };
      }

      const text = hits
        .map((hit, index) => {
          const sources = hit.sources.map(formatSearchSource).join("、");

          return [
            `## 结果 ${index + 1}`,
            `消息序号：${hit.messageSeq}`,
            `命中方式：${sources}`,
            "",
            hit.content,
          ].join("\n");
        })
        .join("\n\n");

      return {
        content: [
          {
            type: "text",

            text:
              `${text}\n\n` +
              "如果需要查看某条结果的前后完整对话，请使用 read_session，并传入对应的消息序号。",
          },
        ],

        details: {
          query: params.query,

          hits: hits.map((hit) => ({
            chunkId: hit.chunkId,

            messageId: hit.messageId,

            seq: hit.messageSeq,

            score: hit.score,

            sources: hit.sources,
          })),
        },
      };
    },
  };

  const readSessionParameters = Type.Object({
    seq: Type.Integer({
      minimum: 1,

      description: "作为读取中心的消息序号。通常直接使用 search_session 返回的“消息序号”。",
    }),

    before: Type.Optional(
      Type.Integer({
        minimum: 0,
        maximum: maxReadMessages,

        description: "读取目标消息之前的消息数量，默认读取 2 条。",
      }),
    ),

    after: Type.Optional(
      Type.Integer({
        minimum: 0,
        maximum: maxReadMessages,

        description: "读取目标消息之后的消息数量，默认读取 2 条。",
      }),
    ),
  });

  const readSessionTool: AgentTool<typeof readSessionParameters> = {
    name: "read_session",

    label: "读取会话",

    description:
      "读取当前会话中某条消息附近的原始历史消息。" +
      "通常在 search_session 找到相关历史后使用，用于补充命中内容前后的完整上下文。" +
      "该工具适合精确查看某个位置附近的对话，不适合大范围搜索历史内容。",

    parameters: readSessionParameters,

    execute: async (_toolCallId, params, signal) => {
      signal?.throwIfAborted();

      const before = params.before ?? 2;

      const after = params.after ?? 2;

      const fromSeq = Math.max(1, params.seq - before);

      const toSeq = params.seq + after;

      const rows = await store.getMessagesRange(sessionId, fromSeq, toSeq);

      signal?.throwIfAborted();

      if (!rows.length) {
        return {
          content: [
            {
              type: "text",

              text: `没有找到消息序号 ${params.seq} 附近的历史消息。`,
            },
          ],

          details: {
            seq: params.seq,

            fromSeq,

            toSeq,

            messages: [],
          },
        };
      }

      const text = rows
        .map((row) => {
          const marker = row.seq === params.seq ? " ← 目标消息" : "";

          return [`## 消息 ${row.seq}${marker}`, formatMessage(row.message)].join("\n");
        })
        .join("\n\n");

      return {
        content: [
          {
            type: "text",
            text,
          },
        ],

        details: {
          requestedSeq: params.seq,

          fromSeq: rows[0]?.seq ?? fromSeq,

          toSeq: rows.at(-1)?.seq ?? toSeq,

          messages: rows.map((row) => ({
            id: row.id,

            seq: row.seq,

            role: row.message.role,
          })),
        },
      };
    },
  };

  const getSessionContextTool: AgentTool = {
    name: "get_session_context",

    label: "获取当前会话上下文",

    description:
      "获取当前会话经过上下文压缩后的有效状态，包括最近一次累计压缩摘要，以及尚未被摘要覆盖的近期消息。" +
      "当你需要确认当前实际保留在上下文中的信息时使用。" +
      "如果需要寻找更早的某段具体历史，应使用 search_session，而不是依赖此工具。",

    parameters: Type.Object({}),

    execute: async (_toolCallId, _params, signal) => {
      signal?.throwIfAborted();

      const context = await store.getContext(sessionId);

      signal?.throwIfAborted();

      const sections: string[] = [];

      if (context.summary) {
        sections.push(["## 历史压缩摘要", context.summary].join("\n"));
      }

      if (context.messages.length) {
        sections.push(
          [
            "## 近期未压缩消息",

            ...context.messages.map((message, index) =>
              [`### 消息 ${index + 1}`, formatMessage(message)].join("\n"),
            ),
          ].join("\n\n"),
        );
      }

      if (!sections.length) {
        sections.push("当前会话还没有任何有效上下文。");
      }

      return {
        content: [
          {
            type: "text",

            text: sections.join("\n\n"),
          },
        ],

        details: {
          hasSummary: context.summary !== null,

          messageCount: context.messages.length,
        },
      };
    },
  };

  return [searchSessionTool, readSessionTool, getSessionContextTool];
}

function formatMessage(message: AgentMessage): string {
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

function formatMessageContent(content: unknown): string {
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

function formatRole(role: string): string {
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

function formatSearchSource(source: "fts" | "trigram" | "vector"): string {
  switch (source) {
    case "fts":
      return "全文检索";

    case "trigram":
      return "模糊检索";

    case "vector":
      return "向量检索";
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
