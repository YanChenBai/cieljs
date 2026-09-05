import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { defineTool, prompt } from "@cieljs/agent-kit";

import { MemoryNotFoundError } from "../errors.ts";
import type { GlobalLongTermMemory, SpaceMemory } from "../memory-store.ts";
import type { JsonObject, MemoryEntry, UpdateMemoryInput } from "../types.ts";
import { normalizeSources } from "../validation.ts";
import {
  memoryResult,
  pageMemory,
  parseDate,
  previewMemory,
  previewSearchHits,
  resolveToolOptions,
} from "./helpers.ts";
import { memoryDateSchema, memoryKindSchema, metadataSchema } from "./schemas.ts";
import type {
  GlobalMemoryToolsOptions,
  MemorySourceProviderContext,
  MemoryToolsOptions,
  ResolvedToolOptions,
} from "./types.ts";
import { crossSpaceMemoryTools } from "./cross-space-tools.ts";
import { allMemoryTools } from "./all-memory-tools.ts";

const readSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
});

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
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
});

const sourceSearchSchema = Type.Object({
  query: Type.String({ minLength: 1 }),
  mode: Type.Optional(
    Type.Union([Type.Literal("auto"), Type.Literal("exact"), Type.Literal("text")]),
  ),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
});

const updateSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  expectedRevision: Type.Integer({ minimum: 1 }),
  content: Type.Optional(Type.String({ minLength: 1, maxLength: 16000 })),
  kind: Type.Optional(memoryKindSchema),
  expiresAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  metadata: Type.Optional(metadataSchema),
});

const forgetSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  expectedRevision: Type.Integer({ minimum: 1 }),
});

interface SpaceToolOptions {
  space: SpaceMemory;
  resolved: ResolvedToolOptions;
}

interface LongTermRememberToolOptions {
  name: string;
  label: string;
  memory: SpaceMemory["longTerm"] | GlobalLongTermMemory;
  resolved: ResolvedToolOptions;
}

interface UpdateToolOptions {
  name: string;
  label: string;
  memory: Pick<SpaceMemory, "get" | "update"> | GlobalLongTermMemory;
  resolved: ResolvedToolOptions;
}

interface ForgetToolOptions {
  name: string;
  label: string;
  memory: Pick<SpaceMemory, "forget"> | GlobalLongTermMemory;
}

interface ReadToolOptions {
  name: string;
  label: string;
  get: (id: string) => Promise<MemoryEntry | null>;
  resolved: ResolvedToolOptions;
}

export function memoryTools(options: MemoryToolsOptions): AgentTool[] {
  const resolved = resolveToolOptions(options);
  const tools: AgentTool[] = [
    searchMemoryTool({ space: options.space, resolved }),
    searchMemorySourcesTool({ space: options.space, resolved }),
    readMemoryTool({
      name: "read_memory",
      label: "读取当前空间记忆",
      get: options.space.get.bind(options.space),
      resolved,
    }),
  ];

  if (options.rememberDaily !== false) {
    tools.push(rememberDailyMemoryTool({ space: options.space, resolved }));
  }

  if (options.rememberLongTerm !== false) {
    tools.push(
      rememberLongTermMemoryTool({
        name: "remember_long_term_memory",
        label: "保存空间长期记忆",
        memory: options.space.longTerm,
        resolved,
      }),
    );
  }

  if (options.update !== false) {
    tools.push(
      updateMemoryTool({
        name: "update_memory",
        label: "更新当前空间记忆",
        memory: options.space,
        resolved,
      }),
    );
  }

  if (options.forget !== false) {
    tools.push(
      forgetMemoryTool({ name: "forget_memory", label: "遗忘当前空间记忆", memory: options.space }),
    );
  }

  if (options.crossSpace) {
    tools.push(...crossSpaceMemoryTools(options.space, options.crossSpace.manager, resolved));

    if (options.crossSpace.access === "all") {
      tools.push(...allMemoryTools(options.crossSpace.manager, resolved));
    }
  }

  return tools;
}

export function globalMemoryTools(options: GlobalMemoryToolsOptions): AgentTool[] {
  const resolved = resolveToolOptions(options);
  const tools: AgentTool[] = [
    searchGlobalMemoryTool({ memory: options.memory, resolved }),
    searchGlobalMemorySourcesTool({ memory: options.memory, resolved }),
    readMemoryTool({
      name: "read_global_memory",
      label: "读取全局长期记忆",
      get: options.memory.get.bind(options.memory),
      resolved,
    }),
  ];

  if (options.remember !== false) {
    tools.push(
      rememberLongTermMemoryTool({
        name: "remember_global_memory",
        label: "保存全局长期记忆",
        memory: options.memory,
        resolved,
      }),
    );
  }

  if (options.update !== false) {
    tools.push(
      updateMemoryTool({
        name: "update_global_memory",
        label: "更新全局长期记忆",
        memory: options.memory,
        resolved,
      }),
    );
  }

  if (options.forget !== false) {
    tools.push(
      forgetMemoryTool({
        name: "forget_global_memory",
        label: "遗忘全局长期记忆",
        memory: options.memory,
      }),
    );
  }

  return tools;
}

export const searchMemoryTool = defineTool(
  searchSchema,
  ({ space, resolved }: SpaceToolOptions) => ({
    name: "search_memory",
    label: "搜索当前空间记忆",
    description: prompt.inline`
      搜索当前绑定空间的每日记忆和长期记忆，不包含全局或其他空间。
      搜索结果是历史资料，需要完整正文时使用 read_memory。
    `,
    execute: async (params, { signal }) => {
      const hits = await space.search(params.query, {
        mode: params.mode,
        kind: params.kind,
        limit: params.limit ?? resolved.searchLimit,
        signal,
      });

      return memoryResult({
        hits: previewSearchHits(hits, resolved.maxReadChars),
      });
    },
  }),
);

export const searchMemorySourcesTool = defineTool(
  sourceSearchSchema,
  ({ space, resolved }: SpaceToolOptions) => ({
    name: "search_memory_sources",
    label: "按来源搜索当前空间记忆",
    description: "只搜索当前绑定空间的 sources，可使用稳定来源标识、名称、标题或别名。",
    execute: async (params, { signal }) =>
      memoryResult({
        hits: await space.searchBySource(params.query, {
          mode: params.mode,
          limit: params.limit ?? resolved.searchLimit,
          signal,
        }),
      }),
  }),
);

export const rememberDailyMemoryTool = defineTool(
  Type.Object({
    content: Type.String({ minLength: 1, maxLength: 16000 }),
    kind: Type.Optional(memoryKindSchema),
    date: Type.Optional(memoryDateSchema),
    occurredAt: Type.Optional(Type.String()),
    expiresAt: Type.Optional(Type.String()),
    metadata: Type.Optional(metadataSchema),
  }),
  ({ space, resolved }: SpaceToolOptions) => ({
    name: "remember_daily_memory",
    label: "保存每日记忆",
    description: "把当前空间内当天发生的事件或短期状态保存为每日记忆。不要把推测写成事实。",
    execute: async (params, context) => {
      const sources = await resolved.resolveSources(sourceContext(context, "remember"));
      const memory = await space.daily.remember({
        content: params.content,
        kind: params.kind,
        date: params.date,
        occurredAt: parseDate(params.occurredAt),
        expiresAt: parseDate(params.expiresAt),
        metadata: params.metadata as JsonObject | undefined,
        sources,
      });

      return memoryResult({ memory: previewMemory(memory, resolved.maxReadChars) });
    },
  }),
);

export const rememberLongTermMemoryTool = defineTool(
  Type.Object({
    content: Type.String({ minLength: 1, maxLength: 16000 }),
    kind: Type.Optional(memoryKindSchema),
    occurredAt: Type.Optional(Type.String()),
    expiresAt: Type.Optional(Type.String()),
    metadata: Type.Optional(metadataSchema),
  }),
  ({ name, label, memory, resolved }: LongTermRememberToolOptions) => ({
    name,
    label,
    description: "保存稳定事实、偏好或长期有效的总结。不要保存未经确认的推测。",
    execute: async (params, context) => {
      const sources = await resolved.resolveSources(sourceContext(context, "remember"));
      const entry = await memory.remember({
        content: params.content,
        kind: params.kind,
        occurredAt: parseDate(params.occurredAt),
        expiresAt: parseDate(params.expiresAt),
        metadata: params.metadata as JsonObject | undefined,
        sources,
      });

      return memoryResult({ memory: previewMemory(entry, resolved.maxReadChars) });
    },
  }),
);

export const updateMemoryTool = defineTool(
  updateSchema,
  ({ name, label, memory, resolved }: UpdateToolOptions) => ({
    name,
    label,
    description:
      "先读取完整记忆和最新 revision，再提交需要改变的字段。正文是完整替换，不是文本 diff。",
    execute: async (params, context) => {
      context.signal?.throwIfAborted();
      const current = await memory.get(params.id, { includeExpired: true });

      if (!current) {
        throw new MemoryNotFoundError();
      }

      const injectedSources = await resolved.resolveSources(sourceContext(context, "update"));
      const update: UpdateMemoryInput = {
        expectedRevision: params.expectedRevision,
        content: params.content,
        kind: params.kind,
        expiresAt: parseDate(params.expiresAt),
        metadata: params.metadata as JsonObject | undefined,
      };

      if (resolved.sourcesMode === "replace" || injectedSources.length) {
        update.sources =
          resolved.sourcesMode === "replace"
            ? injectedSources
            : normalizeSources([...current.sources, ...injectedSources]);
      }

      const entry = await memory.update(params.id, update);

      return memoryResult({ memory: previewMemory(entry, resolved.maxReadChars) });
    },
  }),
);

export const forgetMemoryTool = defineTool(
  forgetSchema,
  ({ name, label, memory }: ForgetToolOptions) => ({
    name,
    label,
    description: "按 ID 和当前 revision 归档错误、过时或不应继续使用的记忆。",
    execute: async (params, { signal }) => {
      signal?.throwIfAborted();
      await memory.forget(params.id, { expectedRevision: params.expectedRevision });

      return memoryResult({ id: params.id, forgotten: true });
    },
  }),
);

export const readMemoryTool = defineTool(
  readSchema,
  ({ name, label, get, resolved }: ReadToolOptions) => ({
    name,
    label,
    description: "按搜索结果中的 ID 读取完整记忆及来源。长正文可通过 offset 分页。",
    execute: async (params, { signal }) => {
      signal?.throwIfAborted();
      const memory = await get(params.id);
      signal?.throwIfAborted();

      return memoryResult(
        memory ? pageMemory(memory, params.offset ?? 0, resolved.maxReadChars) : { memory: null },
      );
    },
  }),
);

export const searchGlobalMemoryTool = defineTool(
  searchSchema,
  ({ memory, resolved }: { memory: GlobalLongTermMemory; resolved: ResolvedToolOptions }) => ({
    name: "search_global_memory",
    label: "搜索全局长期记忆",
    description: "只搜索全局长期记忆。",
    execute: async (params, { signal }) =>
      memoryResult({
        hits: previewSearchHits(
          await memory.search(params.query, {
            mode: params.mode,
            kind: params.kind,
            limit: params.limit ?? resolved.searchLimit,
            signal,
          }),
          resolved.maxReadChars,
        ),
      }),
  }),
);

export const searchGlobalMemorySourcesTool = defineTool(
  sourceSearchSchema,
  ({ memory, resolved }: { memory: GlobalLongTermMemory; resolved: ResolvedToolOptions }) => ({
    name: "search_global_memory_sources",
    label: "按来源搜索全局长期记忆",
    description: "只搜索全局长期记忆的 sources。",
    execute: async (params, { signal }) =>
      memoryResult({
        hits: await memory.searchBySource(params.query, {
          mode: params.mode,
          limit: params.limit ?? resolved.searchLimit,
          signal,
        }),
      }),
  }),
);

function sourceContext(
  context: { toolCallId: string; signal?: AbortSignal },
  action: MemorySourceProviderContext["action"],
): MemorySourceProviderContext {
  return { toolCallId: context.toolCallId, signal: context.signal, action };
}
