import { Type } from "typebox";

import { defineTool, prompt } from "@cieljs/agent-kit";

import type { CreateMemoryToolsOptions } from "./types.ts";
import { resolveMemoryToolsOptions } from "./options.ts";
import { createMemoryResult } from "./helpers.ts";
import { integerOption } from "../validation.ts";

export const readMemoryTool = defineTool(
  Type.Object({
    id: Type.String({ minLength: 1 }),
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
  }),
  (options: CreateMemoryToolsOptions) => {
    const { store, maxReadChars, scopes } = resolveMemoryToolsOptions(options);
    const result = createMemoryResult();

    return {
      name: "read_memory",

      label: "读取记忆",

      description: prompt.inline`
      按搜索结果中的 ID 读取记忆及来源，只允许当前绑定范围。长正文可通过 offset 分页读取。
      `,

      execute: async (params, { signal }) => {
        signal?.throwIfAborted();

        const memory = await store.get(params.id, { scopes });

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
