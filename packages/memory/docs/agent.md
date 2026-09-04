# 让 Agent 使用记忆

Agent 的默认工具绑定一个明确的当前空间：

```ts
import { memoryTools } from "@cieljs/memory";

const space = manager.space("space-1");
const tools = memoryTools({
  space,
});
```

默认提供：

- `search_memory`：搜索 `global.long_term` 与当前空间的两层记忆。
- `read_memory`：读取上述范围内的完整记忆与来源。
- `remember_memory`：按复合 layer 保存到全局长期或当前空间的两层记忆。
- `update_memory`：按 `id + layer + expectedRevision` 更新记忆。
- `forget_memory`：按 `id + layer + expectedRevision` 归档记忆。

写入工具没有 scope 或 layer 参数，工具本身决定归属。长正文默认每页读取 12,000 个 UTF-16 字符，并通过 `nextOffset` 分页。

来源可以是静态数组，也可以在每次工具执行时动态生成：

```ts
const tools = memoryTools({
  space,
  sources: () => [{ type: "session", sessionId: currentSessionId }],
});
```

需要搜索所有空间时，单独加入全库只读工具：

```ts
import { allMemoryTools } from "@cieljs/memory";

const tools = allMemoryTools({ manager });
```

它提供 `search_all_memory` 与 `read_all_memory`。两者始终访问全局和所有空间，不接受空间选择参数。

## 准备上下文

分层入口可以独立生成预算内的上下文：

```ts
const globalLongTerm = await manager.global.longTerm.context({ maxTokens: 1000 });
const spaceLongTerm = await space.longTerm.context({ maxTokens: 1000 });
const recentDaily = await space.daily.context({ recentDays: 2, maxTokens: 1000 });
```

日期默认按存储时区计算，也可以传 `date` 进行历史回放。整条记忆放不下时会跳过，不截断事实正文。默认以 UTF-8 字节数保守估算预算；可以通过 `countTokens` 接入模型 tokenizer。

## 在 core 中使用

```ts
import { createSessionAgent } from "core";
import { MemoryManager } from "@cieljs/memory";
import { SessionManager } from "@cieljs/session";

const sessions = await SessionManager.open({ dataDir: ".ciel/sessions" });
const memories = await MemoryManager.open({ dataDir: ".ciel/memory" });

const { agent, unsubscribe, flushPersistence } = await createSessionAgent({
  manager: sessions,
  sessionId: "conversation-1",
  systemPrompt: "你是 Ciel。结合当前上下文与相关记忆帮助用户。",
  memory: {
    space: memories.space("space-1"),
    crossSpaceSearch: true,
    maxTokens: 2000,
  },
});
```

core 在创建 Agent 时把 `global.long_term` 和当前 `space.long_term` 加入 system prompt。每次模型调用前只刷新当前 `space.daily`，临时上下文不会写回 Agent 状态或 session。

`crossSpaceSearch` 只增加全库搜索与读取工具，不扩大自动注入范围，也不改变写入归属。不同 session 复用同一个 `spaceId` 即可共享空间记忆。
