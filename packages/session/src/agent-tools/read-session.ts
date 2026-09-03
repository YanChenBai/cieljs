import { Type } from "typebox";

import { defineTool, prompt } from "@cieljs/agent-kit";

import type { CreateSessionToolsOptions } from "./types.ts";
import { formatMessage } from "./format.ts";
import { resolveSessionToolsOptions } from "./options.ts";

/**
 * before / after 参数的硬性上限。
 *
 * 实际单侧读取数量由 maxReadMessages（默认 10）控制。
 */
const MAX_READ_MESSAGES_CAP = 20;

export const readSessionTool = defineTool(
  Type.Object({
    seq: Type.Integer({
      minimum: 1,

      description: "作为读取中心的消息序号。通常直接使用 search_session 返回的“消息序号”。",
    }),

    before: Type.Optional(
      Type.Integer({
        minimum: 0,
        maximum: MAX_READ_MESSAGES_CAP,

        description: "读取目标消息之前的消息数量，默认读取 2 条。",
      }),
    ),

    after: Type.Optional(
      Type.Integer({
        minimum: 0,
        maximum: MAX_READ_MESSAGES_CAP,

        description: "读取目标消息之后的消息数量，默认读取 2 条。",
      }),
    ),
  }),
  (options: CreateSessionToolsOptions) => {
    const { store, sessionId, maxReadMessages } = resolveSessionToolsOptions(options);

    return {
      name: "read_session",

      label: "读取会话",

      description: prompt.inline`
      读取当前会话中某条消息附近的原始历史消息。
      通常在 search_session 找到相关历史后使用，用于补充命中内容前后的完整上下文。
      该工具适合精确查看某个位置附近的对话，不适合大范围搜索历史内容。
      `,

      execute: async (params, { signal }) => {
        signal?.throwIfAborted();

        const before = Math.min(params.before ?? 2, maxReadMessages);

        const after = Math.min(params.after ?? 2, maxReadMessages);

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
  },
);
