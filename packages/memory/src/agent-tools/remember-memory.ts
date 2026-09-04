import { Type } from "typebox";

import { defineTool, prompt } from "@cieljs/agent-kit";

import type { CreateMemoryToolsOptions } from "./types.ts";
import { resolveMemoryToolsOptions } from "./options.ts";
import { memoryDateSchema, memoryKindSchema, memoryLayerSchema } from "./schemas.ts";
import { createMemoryPreview, createMemoryResult } from "./helpers.ts";

export const rememberMemoryTool = defineTool(
  Type.Object({
    content: Type.String({ minLength: 1, maxLength: 16000 }),
    layer: memoryLayerSchema,
    date: Type.Optional(memoryDateSchema),
    kind: Type.Optional(memoryKindSchema),
    dedupeKey: Type.Optional(Type.String({ minLength: 1 })),
  }),
  (options: CreateMemoryToolsOptions) => {
    const resolvedOptions = resolveMemoryToolsOptions(options);
    const { memory: scopedMemory, maxReadChars } = resolvedOptions;
    const preview = createMemoryPreview(maxReadChars);
    const result = createMemoryResult();

    return {
      name: "remember_memory",

      label: "保存记忆",

      description: prompt.inline`
      保存有依据的事件、事实或偏好到当前绑定范围。
      每日事件使用 daily，稳定事实使用 long_term。
      长期记忆不传 date；不要把推测写成事实。
      `,

      execute: async (params, { toolCallId, signal }) => {
        signal?.throwIfAborted();

        if (params.layer === "long_term" && params.date !== undefined) {
          throw new TypeError("长期记忆不能设置日期");
        }

        const common = {
          sources: await resolvedOptions.resolveSources({ toolCallId, signal }),
          content: params.content,
          kind: params.kind,
          dedupeKey: params.dedupeKey,
        };

        const memory = await scopedMemory.remember(
          params.layer === "daily"
            ? { ...common, layer: "daily" as const, date: params.date }
            : { ...common, layer: "long_term" as const },
        );

        return result({ memory: preview(memory) });
      },
    };
  },
);
