import { Type } from "typebox";

import { defineTool, prompt } from "@cieljs/agent-kit";

import type { sessionMessages } from "../schema.ts";
import type { Session } from "../session.ts";
import { formatMessage } from "./format.ts";

type SessionMessageRow = typeof sessionMessages.$inferSelect;

interface CreateReadToolOptions {
  name: "read_session" | "read_cross_sessions";
  label: string;
  scope: string;
  searchTool: "search_session" | "search_cross_sessions";
  maxReadMessages: number;
  getMessage(messageId: string): Promise<SessionMessageRow | null>;
  getSession(message: SessionMessageRow): Promise<Session>;
}

/** before / after 参数的硬性上限。 */
const MAX_READ_MESSAGES_CAP = 10;

export const createReadTool = defineTool(
  Type.Object({
    messageId: Type.String({
      minLength: 1,
      description: "作为读取中心的消息 ID。直接使用对应搜索工具返回的“消息 ID”。",
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
  (options: CreateReadToolOptions) => ({
    name: options.name,
    label: options.label,
    description: prompt.inline`
    读取${options.scope}中某条消息附近的原始历史消息。
    通常在 ${options.searchTool} 找到相关历史后使用，用于补充命中内容前后的完整上下文。
    该工具适合精确查看某个位置附近的对话，不适合大范围搜索历史内容。
    `,
    execute: async (params, { signal }) => {
      signal?.throwIfAborted();

      const before = Math.min(params.before ?? 2, options.maxReadMessages);
      const after = Math.min(params.after ?? 2, options.maxReadMessages);
      const targetMessage = await options.getMessage(params.messageId);

      if (!targetMessage) {
        return {
          content: [
            {
              type: "text",
              text: "没有找到该消息，或当前工具无权访问它所属的 Session。",
            },
          ],
          details: { messageId: params.messageId, messages: [] },
        };
      }

      const fromSeq = Math.max(1, targetMessage.seq - before);
      const toSeq = targetMessage.seq + after;
      const session = await options.getSession(targetMessage);
      const rows = await session.getMessagesRange(fromSeq, toSeq);

      signal?.throwIfAborted();

      if (!rows.length) {
        return {
          content: [{ type: "text", text: "没有找到该消息附近的历史消息。" }],
          details: {
            messageId: params.messageId,
            sessionId: session.id,
            fromSeq,
            toSeq,
            messages: [],
          },
        };
      }

      const text = rows
        .map((row) => {
          const marker = row.id === params.messageId ? " ← 目标消息" : "";

          return [`## 消息 ${row.seq}${marker}`, formatMessage(row.message)].join("\n");
        })
        .join("\n\n");

      return {
        content: [{ type: "text", text }],
        details: {
          requestedMessageId: params.messageId,
          requestedSeq: targetMessage.seq,
          sessionId: session.id,
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
  }),
);
