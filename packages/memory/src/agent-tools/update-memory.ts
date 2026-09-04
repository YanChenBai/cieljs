import { Type } from "typebox";

import { defineTool, prompt } from "@cieljs/agent-kit";

import { createMemoryPreview, createMemoryResult } from "./helpers.ts";
import { resolveMemoryToolsOptions, resolveWritableMemory } from "./options.ts";
import { memoryKindSchema, memoryLayerSchema } from "./schemas.ts";
import type { CreateMemoryToolsOptions } from "./types.ts";

export const updateMemoryTool = defineTool(
  Type.Object({
    id: Type.String({ minLength: 1 }),
    layer: memoryLayerSchema,
    expectedRevision: Type.Integer({ minimum: 1 }),
    content: Type.Optional(Type.String({ minLength: 1, maxLength: 16000 })),
    kind: Type.Optional(memoryKindSchema),
  }),
  (options: CreateMemoryToolsOptions) => {
    const resolvedOptions = resolveMemoryToolsOptions(options);
    const preview = createMemoryPreview(resolvedOptions.maxReadChars);
    const result = createMemoryResult();

    return {
      name: "update_memory",
      label: "更新记忆",
      description: prompt.inline`
      按 ID 和当前 revision 修改可写范围内的记忆。先读取最新记录，不要用它改写其他空间的记忆。
      `,
      execute: async (params, { signal }) => {
        signal?.throwIfAborted();
        if (params.content === undefined && params.kind === undefined) {
          throw new TypeError("至少提供 content 或 kind");
        }
        const memory = await resolveWritableMemory(resolvedOptions, params.layer).update(
          params.id,
          {
            expectedRevision: params.expectedRevision,
            content: params.content,
            kind: params.kind,
          },
        );

        return result({ memory: preview(memory) });
      },
    };
  },
);
