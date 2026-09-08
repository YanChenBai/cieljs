import { defineTool } from '@cieljs/agent-kit';
import type { MemoryManager } from '@cieljs/memory';
import { memoryTools } from '@cieljs/memory/agent';
import type { SessionManager } from '@cieljs/session';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from 'typebox';

const memoryLayer = Type.Union([Type.Literal('global'), Type.Literal('space')]);

function result(details: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(details, null, 2) }],
    details,
  };
}

export function createInvestigationTools(options: {
  sessionManager: SessionManager;
  memoryManager: MemoryManager;
  spaceId: string;
  crossSpace?: boolean;
  resolveSources: () => string[];
}): AgentTool[] {
  const sessionSpace = options.sessionManager.space(options.spaceId);
  const memorySpace = options.memoryManager.space(options.spaceId);

  const crossSpaceTools = options.crossSpace
    ? memoryTools({
        space: memorySpace,
        crossSpace: { manager: options.memoryManager, access: 'related' },
        rememberDaily: false,
        rememberLongTerm: false,
        update: false,
        forget: false,
      })
    : [];

  return [
    ...crossSpaceTools,
    defineTool(
      Type.Object({
        query: Type.String({ minLength: 1 }),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
      }),
      () => ({
        name: 'search_memory',
        label: '搜索记忆',
        description:
          '只读搜索当前空间记忆与全局长期记忆。spaceId 和当前 sources 由宿主注入，结果是可能过时的历史资料。',
        execute: async ({ query, limit = 8 }, { signal }) => {
          const sources = options.resolveSources();
          const [space, global] = await Promise.all([
            memorySpace.search(query, { limit, signal }),
            options.memoryManager.global.search(query, { limit, signal }),
          ]);

          return result({ spaceId: options.spaceId, sources, space, global });
        },
      }),
    )(),
    defineTool(
      Type.Object({
        id: Type.String({ minLength: 1 }),
        layer: memoryLayer,
      }),
      () => ({
        name: 'read_memory',
        label: '读取记忆',
        description:
          '按 ID 只读获取当前空间或全局长期记忆。不能读取其他空间，也不能创建、更新或归档记忆。',
        execute: async ({ id, layer }, { signal }) => {
          signal?.throwIfAborted();
          const sources = options.resolveSources();
          const memory =
            layer === 'global'
              ? await options.memoryManager.global.get(id)
              : await memorySpace.get(id);
          signal?.throwIfAborted();

          return result({ spaceId: options.spaceId, sources, memory });
        },
      }),
    )(),
    defineTool(
      Type.Object({
        query: Type.String({ minLength: 1 }),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
      }),
      () => ({
        name: 'search_sessions',
        label: '搜索会话',
        description: options.crossSpace
          ? '只读搜索全部空间的普通 Session 正文，结果包含来源和 Session ID；不搜索 Investigation Session。'
          : '只读搜索当前空间的普通 Session 正文，不搜索 Investigation Session。',
        execute: async ({ query, limit = 8 }, { signal }) => {
          const sources = options.resolveSources();
          const hits = options.crossSpace
            ? await options.sessionManager.searchAll(query, { limit, signal })
            : await sessionSpace.search(query, { limit, signal });

          return result({ spaceId: options.spaceId, sources, hits });
        },
      }),
    )(),
    defineTool(
      Type.Object({
        sessionId: Type.String({ minLength: 1 }),
        messageId: Type.String({ minLength: 1 }),
        before: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
        after: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
      }),
      () => ({
        name: 'read_session',
        label: '读取会话消息',
        description: options.crossSpace
          ? '按搜索结果的 Session ID 和消息 ID，只读获取任意空间普通 Session 的局部上下文。'
          : '按 Session ID 和消息 ID 只读获取当前空间普通 Session 的局部上下文。',
        execute: async ({ sessionId, messageId, before = 3, after = 3 }, { signal }) => {
          signal?.throwIfAborted();
          const sources = options.resolveSources();
          const session = options.crossSpace
            ? await options.sessionManager.getAnySession(sessionId)
            : await sessionSpace.getSession(sessionId);

          if (!session) {
            return result({ spaceId: options.spaceId, sources, messages: [] });
          }

          const message = await session.getMessage(messageId);

          if (!message) {
            return result({ spaceId: options.spaceId, sources, messages: [] });
          }

          const messages = await session.getMessagesRange(
            Math.max(1, message.seq - before),
            message.seq + after,
          );
          signal?.throwIfAborted();

          return result({ spaceId: options.spaceId, sources, sessionId, messageId, messages });
        },
      }),
    )(),
  ];
}
