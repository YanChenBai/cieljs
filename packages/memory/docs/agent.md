# 让 Agent 使用记忆

Agent 可以通过工具主动查找记忆，也可以在调用模型前获得一小段相关资料。两种方式使用相同的范围规则。

## 加入记忆工具

假定 `store` 已打开，为当前空间创建工具：

```ts
import { memoryTools } from "@cieljs/memory";

const tools = memoryTools({
  store,
  scope: { type: "space", spaceId: "space-1" },
  includeGlobal: true,
  allowWrite: false,
});
```

默认提供 `search_memory` 与 `read_memory`。`includeGlobal` 默认为 true；为 false 时只读取绑定空间。绑定 global 时只读取 global。

工具参数不提供 scope 字段，范围在创建时捕获。`read_memory` 按 ID 读取也会检查范围。长正文默认每页 12,000 个 UTF-16 字符，通过返回的 `nextOffset` 继续读取。

设置 `allowWrite: true` 后加入 `remember_memory`。它只向绑定 scope 写入，即使允许读取全局，也不会让空间工具写入全局。可以通过 `sources` 为每次写入附加当前 session 等来源。

当前不暴露模型可调用的修改、归档工具；应用可以通过 `store.update/forget` 执行带版本检查的变更。

## 准备上下文

```ts
import { getMemoryContext } from "@cieljs/memory";

const context = await getMemoryContext(store, {
  scopes: [scope, { type: "global" }],
  query: "我们之前决定如何保存历史记录？",
  recentDays: 2,
  maxTokens: 2000,
});
```

上例假定 `scope` 为当前空间。函数读取最近两天（含当天）的每日记忆，并按 query 搜索长期记忆；没有 query 时读取近期长期记忆。两层交替选取，整条记忆放不下就跳过，不会截断事实正文。

日期默认按存储时区计算，也可以显式传 `date` 进行历史回放。候选上限为 50 条每日记忆与 20 条长期记忆；大量历史的精确查询交给搜索工具。

`maxTokens` 的预算包括记忆边界说明、正文和来源。默认以 UTF-8 字节数做保守估算；需要匹配对话模型时，传 `countTokens(text)`，预算按该函数返回值计算。设置 `maxTokens: 0` 可禁用自动注入。

上下文把内容标记为历史资料，附带范围、日期和来源。它不应替代 system prompt 中的行为规则。

## 在 core 中使用

工作区的 core 包导出 `createSessionAgent`，可以同时接入 session 与 memory：

```ts
import { createSessionAgent } from "core";
import { SessionStore } from "@cieljs/session";
import { MemoryStore } from "@cieljs/memory";

const sessions = await SessionStore.open({ dataDir: ".ciel/sessions" });
const memory = await MemoryStore.open({ dataDir: ".ciel/memory" });

const { agent, unsubscribe, flushPersistence } = await createSessionAgent({
  store: sessions,
  sessionId: "conversation-1",
  systemPrompt: "你是 Ciel。结合当前上下文与相关记忆，帮助用户完成任务。",
  memory: {
    store: memory,
    scope: { type: "space", spaceId: "space-1" },
    includeGlobal: true,
    allowWrite: true,
    maxTokens: 2000,
  },
});

try {
  await agent.prompt("帮我记住，我们决定用本地数据库保存历史记录。");
} finally {
  unsubscribe();
  await flushPersistence();
  await sessions.close();
  await memory.close();
}
```

运行此示例需要先完成工作区包构建，并配置对话模型。省略 `model` 时沿用 core 当前的默认模型和凭据配置；memory 的文本检索自身不需要 API Key。

core 通过 Agent 的 `transformContext` 在每次模型请求前刷新记忆。临时资料只进入模型调用，不写回 Agent 消息状态或 session 原始消息，因此不会逐轮堆积。工具的正常执行结果仍会按 session 的既有规则保存。

不同 session 使用相同 spaceId，即可继续访问同一空间的记忆。core 不会根据 sessionId 推导 spaceId，也不会自动从所有消息中提取事实。
