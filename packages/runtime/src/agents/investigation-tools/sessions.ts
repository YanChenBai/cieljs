import { defineTool } from '@cieljs/agent-kit';
import { Type } from 'typebox';

import { investigationResult, type InvestigationToolContext } from './context.ts';

export const createSearchSessionsTool = defineTool(
  Type.Object({
    query: Type.String({ minLength: 1 }),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
  }),
  ({ options, sessionSpace }: InvestigationToolContext) => ({
    name: 'search_sessions',
    label: '搜索会话',
    description: options.crossSpace
      ? '只读搜索全部空间的普通 Session 正文，结果包含来源和 Session ID；不搜索 Investigation Session。'
      : '只读搜索当前空间的普通 Session 正文，不搜索 Investigation Session。',
    execute: async ({ query, limit = 8 }, { signal }) => {
      const sources = options.resolveSources();
      // 检索范围取自宿主配置，模型只能提供查询词。
      let hits;
      if (options.crossSpace)
        hits = await options.sessionManager.searchAll(query, { limit, signal });
      else hits = await sessionSpace.search(query, { limit, signal });

      return investigationResult({ spaceId: options.spaceId, sources, hits });
    },
  }),
);

export const createReadSessionTool = defineTool(
  Type.Object({
    sessionId: Type.String({ minLength: 1 }),
    messageId: Type.String({ minLength: 1 }),
    before: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
    after: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
  }),
  ({ options, sessionSpace }: InvestigationToolContext) => ({
    name: 'read_session',
    label: '读取会话消息',
    description: options.crossSpace
      ? '按搜索结果的 Session ID 和消息 ID，只读获取任意空间普通 Session 的局部上下文。'
      : '按 Session ID 和消息 ID 只读获取当前空间普通 Session 的局部上下文。',
    execute: async ({ sessionId, messageId, before = 3, after = 3 }, { signal }) => {
      signal?.throwIfAborted();
      const sources = options.resolveSources();
      let session;
      if (options.crossSpace) session = await options.sessionManager.getAnySession(sessionId);
      else session = await sessionSpace.getSession(sessionId);

      if (!session) {
        return investigationResult({ spaceId: options.spaceId, sources, messages: [] });
      }

      const message = await session.getMessage(messageId);

      if (!message) {
        return investigationResult({ spaceId: options.spaceId, sources, messages: [] });
      }

      const messages = await session.getMessagesRange(
        Math.max(1, message.seq - before),
        message.seq + after,
      );
      signal?.throwIfAborted();

      return investigationResult({
        spaceId: options.spaceId,
        sources,
        sessionId,
        messageId,
        messages,
      });
    },
  }),
);
