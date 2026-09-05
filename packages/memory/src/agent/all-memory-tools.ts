import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { defineTool } from "@cieljs/agent-kit";

import type { MemoryManager } from "../memory-manager.ts";
import { memoryResult, pageMemory, previewSearchHits } from "./helpers.ts";
import { memoryKindSchema, memoryLayerSchema } from "./schemas.ts";
import type { ResolvedToolOptions } from "./types.ts";

const searchSchema = Type.Object({
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
  layers: Type.Optional(Type.Array(memoryLayerSchema)),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
});

const sourceSearchSchema = Type.Object({
  query: Type.String({ minLength: 1 }),
  mode: Type.Optional(
    Type.Union([Type.Literal("auto"), Type.Literal("exact"), Type.Literal("text")]),
  ),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
});

const readSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
});

export interface AllMemoryToolFactoryOptions {
  manager: MemoryManager;
  resolved: ResolvedToolOptions;
}

export const searchAllMemoryTool = defineTool(
  searchSchema,
  ({ manager, resolved }: AllMemoryToolFactoryOptions) => ({
    name: "search_all_memory",
    label: "搜索全部记忆",
    description: "搜索全局和所有空间的记忆。只读。",
    execute: async (params, { signal }) =>
      memoryResult({
        hits: previewSearchHits(
          await manager.searchAll(params.query, {
            mode: params.mode,
            kind: params.kind,
            layers: params.layers,
            limit: params.limit ?? resolved.searchLimit,
            signal,
          }),
          resolved.maxReadChars,
        ),
      }),
  }),
);

export const searchAllMemorySourcesTool = defineTool(
  sourceSearchSchema,
  ({ manager, resolved }: AllMemoryToolFactoryOptions) => ({
    name: "search_all_memory_sources",
    label: "按来源搜索全部记忆",
    description: "在全局和所有空间中搜索 sources。只读。",
    execute: async (params, { signal }) =>
      memoryResult({
        hits: await manager.searchBySource(params.query, {
          mode: params.mode,
          limit: params.limit ?? resolved.searchLimit,
          signal,
        }),
      }),
  }),
);

export const readAllMemoryTool = defineTool(
  readSchema,
  ({ manager, resolved }: AllMemoryToolFactoryOptions) => ({
    name: "read_all_memory",
    label: "读取任意记忆",
    description: "按搜索结果中的 ID 读取全局或任意空间的记忆。只读。",
    execute: async (params, { signal }) => {
      signal?.throwIfAborted();
      const memory = await manager.getAny(params.id);

      return memoryResult(
        memory ? pageMemory(memory, params.offset ?? 0, resolved.maxReadChars) : { memory: null },
      );
    },
  }),
);

export function allMemoryTools(manager: MemoryManager, resolved: ResolvedToolOptions): AgentTool[] {
  const options = { manager, resolved };

  return [
    searchAllMemoryTool(options),
    searchAllMemorySourcesTool(options),
    readAllMemoryTool(options),
  ];
}
