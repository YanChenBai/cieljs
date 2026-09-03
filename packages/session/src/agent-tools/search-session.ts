import { Type } from "typebox";
import { defineTool, prompt } from "@cieljs/agent-kit";

import type { CreateSessionToolsOptions } from "./types.ts";
import { resolveSessionToolsOptions } from "./options.ts";

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

export const searchSessionTool = defineTool(
  Type.Object({
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
  }),
  (options: CreateSessionToolsOptions) => {
    const { store, sessionId, searchLimit } = resolveSessionToolsOptions(options);

    return {
      name: "search_session",

      label: "搜索会话",

      description: prompt.inline`
      搜索当前会话的历史内容。
      当你需要回忆之前讨论过的概念、决策、实现方案、代码、包名、函数名、变量名或其他历史信息时使用。
      搜索会综合全文检索、模糊检索和可用的向量检索结果。
      如果搜索结果与目标相关但缺少前后文，应继续使用 read_session 读取对应消息附近的原始对话。
      `,

      execute: async (params, { signal }) => {
        signal?.throwIfAborted();

        const hits = await store.search(params.query, {
          sessionId,
          signal,

          limit: params.limit ?? searchLimit,
        });

        signal?.throwIfAborted();

        if (!hits.length) {
          return {
            content: [
              {
                type: "text",
                text: prompt.inline`
                没有找到匹配的历史会话内容。
                可以尝试更换关键词、缩短搜索内容，或者使用更接近原始讨论内容的表达。
                `,
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
            return prompt.trim`
            ## 结果 ${index + 1}
            消息序号：${hit.messageSeq}
            命中方式：${hit.sources.map(formatSearchSource).join("、")}

            ${hit.content}
            `;
          })
          .join("\n\n");

        return {
          content: [
            {
              type: "text",
              text: prompt.trim`
                ${text}\n\n
                "如果需要查看某条结果的前后完整对话，请使用 read_session，并传入对应的消息序号。
              `,
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
  },
);
