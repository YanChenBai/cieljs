import { Type } from "typebox";

import { defineTool, prompt } from "@cieljs/agent-kit";

import { integerOption } from "../validation.ts";
import { createMemoryResult } from "./helpers.ts";
import { resolveAllMemoryToolsOptions } from "./options.ts";
import type { CreateAllMemoryToolsOptions } from "./types.ts";

export const readAllMemoryTool = defineTool(
  Type.Object({
    id: Type.String({ minLength: 1 }),
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
  }),
  (options: CreateAllMemoryToolsOptions) => {
    const { manager, maxReadChars } = resolveAllMemoryToolsOptions(options);
    const result = createMemoryResult();

    return {
      name: "read_all_memory",

      label: "读取任意记忆",

      description: prompt.inline`
      按全库搜索结果中的 ID 读取记忆及来源。长正文可通过 offset 分页读取。
      `,

      execute: async (params, { signal }) => {
        signal?.throwIfAborted();

        const memory = await manager.get(params.id);

        signal?.throwIfAborted();

        if (!memory) {
          return result({ memory: null });
        }

        const offset = integerOption(params.offset ?? 0, "offset", 0, Number.MAX_SAFE_INTEGER);
        const end = Math.min(offset + maxReadChars, memory.content.length);

        return result({
          memory: { ...memory, content: memory.content.slice(offset, end) },
          nextOffset: end < memory.content.length ? end : null,
        });
      },
    };
  },
);
