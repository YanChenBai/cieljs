import { Type } from "typebox";

import { defineTool, prompt } from "@cieljs/agent-kit";

import type { SearchHit, SearchOptions, SearchSource } from "../types.ts";

interface CreateSearchToolOptions {
  name: "search_session" | "search_cross_sessions";
  label: string;
  scope: string;
  readTool: "read_session" | "read_cross_sessions";
  includeSessionId: boolean;
  searchLimit: number;
  search(query: string, options: SearchOptions): Promise<SearchHit[]>;
}

function formatSearchSource(source: SearchSource): string {
  switch (source) {
    case "fts":
      return "全文检索";
    case "trigram":
      return "模糊检索";
    case "vector":
      return "向量检索";
  }
}

export const createSearchTool = defineTool(
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
  (options: CreateSearchToolOptions) => ({
    name: options.name,
    label: options.label,
    description: prompt.inline`
    搜索${options.scope}的历史内容。
    当你需要回忆之前讨论过的概念、决策、实现方案、代码、包名、函数名、变量名或其他历史信息时使用。
    搜索会综合全文检索、模糊检索和可用的向量检索结果。
    如果搜索结果与目标相关但缺少前后文，应继续使用 ${options.readTool} 查看消息附近的原始对话。
    `,
    execute: async (params, { signal }) => {
      signal?.throwIfAborted();

      const hits = await options.search(params.query, {
        signal,
        limit: params.limit ?? options.searchLimit,
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
          details: { query: params.query, hits: [] },
        };
      }

      const text = hits
        .map((hit, index) =>
          [
            `## 结果 ${index + 1}`,
            options.includeSessionId ? `会话 ID：${hit.sessionId}` : "",
            `消息 ID：${hit.messageId}`,
            `消息序号：${hit.messageSeq}`,
            `命中方式：${hit.sources.map(formatSearchSource).join("、")}`,
            "",
            hit.content,
          ]
            .filter(Boolean)
            .join("\n"),
        )
        .join("\n\n");

      return {
        content: [
          {
            type: "text",
            text: prompt.trim`
            ${text}

            如果需要查看某条结果的前后完整对话，请使用 ${options.readTool}，并传入消息 ID。
            `,
          },
        ],
        details: {
          query: params.query,
          hits: hits.map((hit) => ({
            chunkId: hit.chunkId,
            sessionId: hit.sessionId,
            messageId: hit.messageId,
            seq: hit.messageSeq,
            score: hit.score,
            sources: hit.sources,
          })),
        },
      };
    },
  }),
);
