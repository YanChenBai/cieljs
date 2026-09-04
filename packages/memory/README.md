<h1 align="center">@cieljs/memory</h1>

<p align="center">让今天发生的事有处可查，让值得记住的事跨过下一次会话。</p>

<p align="center">
  <a href="./docs/scopes.md">范围与日期</a> ·
  <a href="./docs/search.md">记忆检索</a> ·
  <a href="./docs/embedding.md">向量配置</a> ·
  <a href="./docs/agent.md">Agent 接入</a>
</p>

一次会话结束后，今天的决定、用户的偏好、尚未完成的约定，可能还会在下一次对话里用到。原始对话可以留在 session；经过整理的事件与事实，则可以存进 memory，在不同会话之间继续使用。

`@cieljs/memory` 用 PGlite 在本地保存这些记忆。Scope 决定记忆属于谁、属于哪里；Layer 决定它按日归档，还是跨天保留。全局与各个空间共用一套存储和检索接口。

## 可以记住什么？

- **今天发生的事。** 用 `daily` 保存事件、约定与当天的摘要，之后仍然能按日期查找。
- **跨天使用的信息。** 用 `long_term` 保存稳定事实、偏好与长期约定。
- **按空间组织的信息。** 用 `spaceId` 区分业务上下文，多个 session 可以共享同一个空间的记忆。
- **明确的全局知识。** 用 `global` 保存允许跨空间使用的信息。
- **可以回头核对的来源。** 记忆可以关联原始 session、消息区间、外部事件或另一条记忆。

> [!NOTE]
> 每日记忆不会在零点自动删除。`daily` 表示按日期组织，过期由 `expiresAt` 单独控制。

## 试一下

打开存储，留下今天的一件事，再找回它：

```ts
import { MemoryManager } from "@cieljs/memory";

const manager = await MemoryManager.open({ dataDir: ".ciel/memory" });
const memory = manager.memory({ type: "space", spaceId: "space-1" });

try {
  await memory.remember({
    layer: "daily",
    content: "今天决定用本地数据库保存历史记录。",
    sources: [{ type: "session", sessionId: "conversation-1", fromSeq: 12, toSeq: 16 }],
  });

  const hits = await memory.search("历史记录");
  console.log(hits.map((hit) => hit.memory.content));
} finally {
  await manager.close();
}
```

没有配置模型时，全文与模糊检索即可使用。默认使用 `Intl.Segmenter` 处理中文分词。再次使用相同数据目录打开存储，就能继续读取之前的记忆。

## 同一空间，可以记住今天和更久以前

| Scope    | Layer       | 适合保存                     |
| -------- | ----------- | ---------------------------- |
| `global` | `daily`     | Ciel 今天的跨空间安排        |
| `global` | `long_term` | Ciel 的稳定偏好、通用知识    |
| `space`  | `daily`     | 某个空间今天的事件与决定     |
| `space`  | `long_term` | 某个空间的稳定事实与长期约定 |

写入长期记忆时使用 `layer: "long_term"`，不传 `date`。空间如何命名、日期如何计算、记忆如何修改和归档，请看[范围与日期](./docs/scopes.md)。

## 让 Agent 找回记忆

`memoryTools({ memory })` 默认提供两个工具：

- `search_memory`：在当前空间与全局记忆中搜索，支持层级和日期范围。
- `read_memory`：读取命中记忆的正文与来源，长文本可分页。

需要让 Agent 查询多个授权空间时，使用
`crossScopeMemoryTools({ manager, scopes })`。它提供 `search_cross_scopes` 与
`read_cross_scopes`，范围在创建工具时固定，不允许模型自行指定 scope。

需要允许 Agent 保存记忆时，设置 `allowWrite: true`，加入 `remember_memory`。写入始终归属于创建工具时绑定的 scope。

`memory.context()` 可以在预算内组合近期每日记忆与长期记忆。core 的 `createSessionAgent({ memory })` 已将它接入每次模型调用前的上下文准备；用法见 [Agent 接入](./docs/agent.md)。

> [!TIP]
> session 保存原始对话，memory 保存值得跨会话使用的信息。来源引用可以帮助回到原话，但两个存储之间不会自动复制消息。

## 当前已经支持什么？

统一存储、记忆修改与归档、来源引用、中文全文检索、模糊与向量检索、索引恢复、Agent 工具和上下文召回都已实现。

当前由调用方或可选写入工具决定保存哪些记忆。自动从 session 增量提取、生成每日摘要、将每日事件沉淀为长期事实，是后续的整理流程；本包不会在后台自行调用摘要模型。实施边界见[开发计划](./docs/roadmap.md)。

## 开发

在本包目录运行：

```bash
vp check
vp test
vp run build
```

测试使用本地数据库和 Embedding 替身，无需 API Key。覆盖范围隔离、日期归档、并发修改、混合检索、索引失败恢复与数据目录重开。
