<h1 align="center">@cieljs/agent-kit</h1>

<p align="center">共享 Agent、Prompt 与 Embedding 的轻量公共契约。</p>

`@cieljs/agent-kit` 收拢多个包共同使用的基础能力，不负责具体模型、存储或业务流程。
`@cieljs/session`、`@cieljs/memory` 和 `@cieljs/embed` 都通过这里的契约保持兼容。

## Embedding Provider

业务层可以创建一个 Provider，同时交给会话与记忆模块使用：

```ts
import type { EmbeddingProvider } from "@cieljs/agent-kit";

const embedding: EmbeddingProvider = {
  model: "provider/model-version",
  dimensions: 1_024,
  batchSize: 32,
  async embedBatch(texts, { purpose, signal }) {
    return client.embed({ texts, purpose, signal });
  },
};
```

`purpose` 区分检索查询与待索引文档，Provider 可以据此添加不同前缀或选择任务类型。
`embed()` 是可选入口；省略时，`resolveEmbeddingProvider()` 会通过单元素
`embedBatch()` 补齐它，并填充默认的 `batchSize`。

对于外部模型返回的结果，可以使用 `assertEmbeddingVectors()` 校验数量、维数、有限值
和非零向量：

```ts
import { assertEmbeddingVectors } from "@cieljs/agent-kit";

const vectors = await embedding.embedBatch(texts, { purpose: "document" });
assertEmbeddingVectors(vectors, texts.length, embedding.dimensions);
```

## Prompt 模板

`prompt` 保留模板字符串的原始转义，并提供三种常用整理方式：

```ts
import { prompt } from "@cieljs/agent-kit";

const systemPrompt = prompt.dedent`
  你是一个耐心的助手。
  回答应当简洁、准确。
`;

const description = prompt.inline`
  搜索当前会话中
  与查询相关的历史消息。
`;
```

- `prompt.trim`：移除首尾空白。
- `prompt.dedent`：移除公共缩进并裁剪首尾空白。
- `prompt.inline`：进一步把连续空白折叠为单个空格。

## Agent Tool

`defineTool()` 将 TypeBox 参数 Schema 与工具工厂绑定，并把底层执行参数整理为统一的
`ToolExecuteContext`：

```ts
import { defineTool } from "@cieljs/agent-kit";
import { Type } from "typebox";

const createSearchTool = defineTool(
  Type.Object({ query: Type.String() }),
  (search: (query: string) => Promise<string>) => ({
    name: "search",
    label: "搜索",
    description: "搜索相关内容",
    async execute({ query }, { signal }) {
      signal?.throwIfAborted();

      return {
        content: [{ type: "text", text: await search(query) }],
      };
    },
  }),
);
```

工厂返回的工具参数会从 Schema 自动推导。执行时可通过 Context 访问 `toolCallId`、
`AbortSignal` 与流式更新回调 `onUpdate`。

## 开发

在本包目录运行：

```bash
vp check
vp test
vp run build
```
