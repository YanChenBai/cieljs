import { Type } from "typebox";

import { defineTool, prompt } from "@cieljs/agent-kit";

import { createMemoryResult } from "./helpers.ts";
import { resolveMemoryToolsOptions, resolveWritableMemory } from "./options.ts";
import { memoryLayerSchema } from "./schemas.ts";
import type { CreateMemoryToolsOptions } from "./types.ts";

export const forgetMemoryTool = defineTool(
  Type.Object({
    id: Type.String({ minLength: 1 }),
    layer: memoryLayerSchema,
    expectedRevision: Type.Integer({ minimum: 1 }),
  }),
  (options: CreateMemoryToolsOptions) => {
    const resolvedOptions = resolveMemoryToolsOptions(options);
    const result = createMemoryResult();

    return {
      name: "forget_memory",
      label: "遗忘记忆",
      description: prompt.inline`
      按 ID 和当前 revision 归档可写范围内的错误、过时或不应保留的记忆。
      `,
      execute: async (params, { signal }) => {
        signal?.throwIfAborted();
        await resolveWritableMemory(resolvedOptions, params.layer).forget(params.id, {
          expectedRevision: params.expectedRevision,
        });

        return result({ id: params.id, forgotten: true });
      },
    };
  },
);
