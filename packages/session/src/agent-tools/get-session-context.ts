import { Type } from "typebox";

import { defineTool, prompt } from "@cieljs/agent-kit";

import type { CreateSessionToolsOptions } from "./types.ts";
import { formatMessage } from "./format.ts";
import { resolveSessionToolsOptions } from "./options.ts";

export const getSessionContextTool = defineTool(
  Type.Object({}),
  (options: CreateSessionToolsOptions) => {
    const { store, sessionId } = resolveSessionToolsOptions(options);

    return {
      name: "get_session_context",

      label: "获取当前会话上下文",

      description: prompt.inline`
      获取当前会话经过上下文压缩后的有效状态，包括最近一次累计压缩摘要，以及尚未被摘要覆盖的近期消息。
      当你需要确认当前实际保留在上下文中的信息时使用。
      如果需要寻找更早的某段具体历史，应使用 search_session，而不是依赖此工具。
      `,

      execute: async (_params, { signal }) => {
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
  },
);
