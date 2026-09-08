import { defineTool } from '@cieljs/agent-kit';
import { Type } from 'typebox';

import { investigationResult, type InvestigationToolContext } from './context.ts';

const memoryLayer = Type.Union([Type.Literal('global'), Type.Literal('space')]);

export const createSearchMemoryTool = defineTool(
  Type.Object({
    query: Type.String({ minLength: 1 }),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
  }),
  ({ options, memorySpace }: InvestigationToolContext) => ({
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

      return investigationResult({ spaceId: options.spaceId, sources, space, global });
    },
  }),
);

export const createReadMemoryTool = defineTool(
  Type.Object({
    id: Type.String({ minLength: 1 }),
    layer: memoryLayer,
  }),
  ({ options, memorySpace }: InvestigationToolContext) => ({
    name: 'read_memory',
    label: '读取记忆',
    description:
      '按 ID 只读获取当前空间或全局长期记忆。不能读取其他空间，也不能创建、更新或归档记忆。',
    execute: async ({ id, layer }, { signal }) => {
      signal?.throwIfAborted();
      const sources = options.resolveSources();
      const store = layer === 'global' ? options.memoryManager.global : memorySpace;
      const memory = await store.get(id);
      signal?.throwIfAborted();

      return investigationResult({ spaceId: options.spaceId, sources, memory });
    },
  }),
);
