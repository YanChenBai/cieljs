# @cieljs/agent-kit

Agent 工具定义与提示词工具。Embedding 契约和校验已迁移到 `@cieljs/model-kit`，调用方应更新 import 与依赖。

## Prompt 模板

`prompt` 保留模板字符串的原始转义，并提供三种常用整理方式：

```ts
import { prompt } from '@cieljs/agent-kit';

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
import { defineTool } from '@cieljs/agent-kit';
import { Type } from 'typebox';

const createSearchTool = defineTool(
  Type.Object({ query: Type.String() }),
  (search: (query: string) => Promise<string>) => ({
    name: 'search',
    label: '搜索',
    description: '搜索相关内容',
    async execute({ query }, { signal }) {
      signal?.throwIfAborted();

      return {
        content: [{ type: 'text', text: await search(query) }],
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
