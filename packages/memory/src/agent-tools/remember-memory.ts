import { Type } from "typebox";

import { defineTool, prompt } from "@cieljs/agent-kit";

import { createMemoryPreview, createMemoryResult } from "./helpers.ts";
import { resolveMemoryToolsOptions, resolveWritableMemory } from "./options.ts";
import { memoryDateSchema, memoryKindSchema, memoryLayerSchema } from "./schemas.ts";
import type { CreateMemoryToolsOptions } from "./types.ts";

export const rememberMemoryTool = defineTool(
  Type.Object({
    content: Type.String({ minLength: 1, maxLength: 16000 }),
    layer: memoryLayerSchema,
    date: Type.Optional(memoryDateSchema),
    kind: Type.Optional(memoryKindSchema),
  }),
  (options: CreateMemoryToolsOptions) => {
    const resolvedOptions = resolveMemoryToolsOptions(options);
    const preview = createMemoryPreview(resolvedOptions.maxReadChars);
    const result = createMemoryResult();

    return {
      name: "remember_memory",
      label: "保存记忆",
      description: prompt.inline`
      保存有依据的记忆。layer 必须明确选择 global.long_term、space.long_term 或 space.daily。
      只有 space.daily 可以传 date；不要把推测写成事实。
      `,
      execute: async (params, { toolCallId, signal }) => {
        signal?.throwIfAborted();

        if (params.layer !== "space.daily" && params.date !== undefined) {
          throw new TypeError("长期记忆不能设置日期");
        }

        const memory = await resolveWritableMemory(resolvedOptions, params.layer).remember({
          content: params.content,
          kind: params.kind,
          sources: await resolvedOptions.resolveSources({ toolCallId, signal }),
          ...(params.layer === "space.daily" ? { date: params.date } : {}),
        });

        return result({ memory: preview(memory) });
      },
    };
  },
);
