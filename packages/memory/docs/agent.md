# Agent 接入

## 当前 Space

`memoryTools({ space })` 默认提供：

```text
search_memory
search_memory_sources
read_memory
remember_daily_memory
remember_long_term_memory
update_memory
forget_memory
```

工具绑定宿主传入的 `SpaceMemory`，参数中没有 `spaceId`。Daily 和 long-term 使用两个 remember 工具，Agent 不需要传数据库 layer。

## Sources 注入

Agent 不直接提交 sources。宿主可以提供静态数组或每次调用时执行的 provider：

```ts
const tools = memoryTools({
  space,
  sources: ({ toolCallId, action }) => [
    `session:${sessionId}`,
    `tool-call:${toolCallId}`,
    `action:${action}`,
  ],
});
```

更新时默认把宿主来源追加到旧来源。传入 `sourcesMode: "replace"` 可以改为替换，但 Agent 仍不能自行构造 sources。

`replace` 模式下，宿主返回空数组会清空旧来源；`append` 模式下空数组不改变旧来源。

## 跨 Space 只读探索

`crossSpace.access: "related"` 增加 `find_memory_spaces`、`search_space_memory`、`search_space_memory_sources` 和 `read_space_memory`。必须先发现一个 space，后续工具才允许访问它。

`all` 还增加 `search_all_memory`、`search_all_memory_sources` 和 `read_all_memory`。两种模式都不会扩大更新或遗忘权限。

当前空间、跨空间和全局的正文搜索工具均按 `maxReadChars` 截断正文预览和片段；完整正文可通过对应读取工具的 `offset` 分页获取。

## 全局授权

全局工具必须单独创建：

```ts
const tools = globalMemoryTools({
  memory: manager.global,
  sources: ["session:conversation-1"],
});
```

它包含全局搜索、来源搜索、读取、保存、更新和遗忘。宿主可以分别关闭三个写入能力。

## 上下文

`loadMemoryContext()` 独立返回全局长期、空间长期和近期每日三个 section。建议把两类长期记忆用于稳定上下文，把 daily 作为每次模型调用前刷新的临时上下文。

```ts
const context = await loadMemoryContext({
  manager,
  space,
  query: currentUserMessage,
  recentDays: 2,
});
```

三个 section 使用独立 token 预算，避免近期事件挤掉长期事实。
