import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { defineTool } from "@cieljs/agent-kit";

import { MemoryAccessError } from "../errors.ts";
import type { MemoryManager } from "../memory-manager.ts";
import type { SpaceMemory } from "../memory-store.ts";
import { memoryResult, pageMemory, previewSearchHits } from "./helpers.ts";
import { memoryKindSchema } from "./schemas.ts";
import type { ResolvedToolOptions } from "./types.ts";

const sourceSearchSchema = Type.Object({
  query: Type.String({ minLength: 1 }),
  mode: Type.Optional(
    Type.Union([Type.Literal("auto"), Type.Literal("exact"), Type.Literal("text")]),
  ),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
});

const spaceSearchSchema = Type.Object({
  spaceId: Type.String({ minLength: 1 }),
  query: Type.String({ minLength: 1 }),
  mode: Type.Optional(
    Type.Union([
      Type.Literal("hybrid"),
      Type.Literal("full_text"),
      Type.Literal("trigram"),
      Type.Literal("vector"),
    ]),
  ),
  kind: Type.Optional(memoryKindSchema),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
});

const spaceSourceSearchSchema = Type.Intersect([
  sourceSearchSchema,
  Type.Object({ spaceId: Type.String({ minLength: 1 }) }),
]);

const spaceReadSchema = Type.Object({
  spaceId: Type.String({ minLength: 1 }),
  id: Type.String({ minLength: 1 }),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
});

export interface CrossSpaceToolFactoryOptions {
  manager: MemoryManager;
  discoveredSpaces: Set<string>;
  resolved: ResolvedToolOptions;
}

export const findMemorySpacesTool = defineTool(
  sourceSearchSchema,
  ({ manager, discoveredSpaces, resolved }: CrossSpaceToolFactoryOptions) => ({
    name: "find_memory_spaces",
    label: "按来源发现相关空间",
    description: "先通过来源名称、标题或稳定标识发现相关 space，结果会授权本轮工具继续只读探索。",
    execute: async (params, { signal }) => {
      const spaces = await manager.findSpacesBySource(params.query, {
        mode: params.mode,
        limit: params.limit ?? resolved.searchLimit,
        signal,
      });

      for (const space of spaces) {
        discoveredSpaces.add(space.spaceId);
      }

      return memoryResult({ spaces });
    },
  }),
);

export const searchSpaceMemoryTool = defineTool(
  spaceSearchSchema,
  ({ manager, discoveredSpaces, resolved }: CrossSpaceToolFactoryOptions) => ({
    name: "search_space_memory",
    label: "搜索已发现空间",
    description: "搜索当前空间或已经由 find_memory_spaces 发现的空间。只读。",
    execute: async (params, { signal }) => {
      assertDiscovered(discoveredSpaces, params.spaceId);
      const hits = await manager.space(params.spaceId).search(params.query, {
        mode: params.mode,
        kind: params.kind,
        limit: params.limit ?? resolved.searchLimit,
        signal,
      });

      return memoryResult({ hits: previewSearchHits(hits, resolved.maxReadChars) });
    },
  }),
);

export const searchSpaceMemorySourcesTool = defineTool(
  spaceSourceSearchSchema,
  ({ manager, discoveredSpaces, resolved }: CrossSpaceToolFactoryOptions) => ({
    name: "search_space_memory_sources",
    label: "按来源搜索已发现空间",
    description: "在当前空间或已经发现的空间中搜索 sources。只读。",
    execute: async (params, { signal }) => {
      assertDiscovered(discoveredSpaces, params.spaceId);
      const hits = await manager.space(params.spaceId).searchBySource(params.query, {
        mode: params.mode,
        limit: params.limit ?? resolved.searchLimit,
        signal,
      });

      return memoryResult({ hits });
    },
  }),
);

export const readSpaceMemoryTool = defineTool(
  spaceReadSchema,
  ({ manager, discoveredSpaces, resolved }: CrossSpaceToolFactoryOptions) => ({
    name: "read_space_memory",
    label: "读取已发现空间记忆",
    description: "读取当前空间或已经发现的空间中的具体记忆。只读。",
    execute: async (params, { signal }) => {
      assertDiscovered(discoveredSpaces, params.spaceId);
      signal?.throwIfAborted();
      const memory = await manager.space(params.spaceId).get(params.id);

      return memoryResult(
        memory ? pageMemory(memory, params.offset ?? 0, resolved.maxReadChars) : { memory: null },
      );
    },
  }),
);

export function crossSpaceMemoryTools(
  currentSpace: SpaceMemory,
  manager: MemoryManager,
  resolved: ResolvedToolOptions,
): AgentTool[] {
  const options: CrossSpaceToolFactoryOptions = {
    manager,
    resolved,
    discoveredSpaces: new Set([currentSpace.spaceId]),
  };

  return [
    findMemorySpacesTool(options),
    searchSpaceMemoryTool(options),
    searchSpaceMemorySourcesTool(options),
    readSpaceMemoryTool(options),
  ];
}

function assertDiscovered(spaces: Set<string>, spaceId: string): void {
  if (!spaces.has(spaceId)) {
    throw new MemoryAccessError("必须先通过 find_memory_spaces 发现这个 space");
  }
}
