# Agent 接入

## 当前 Space

`memoryTools({ space })` 默认提供：

```text
search_current_space_memory
search_current_space_memory_by_source
read_current_space_memory
remember_current_space_daily_memory
remember_current_space_long_term_memory
update_current_space_memory
archive_current_space_memory
```

工具绑定宿主传入的 `SpaceMemory`，参数中没有 `spaceId`。Daily 和 long-term 使用两个 remember 工具，Agent 不需要传数据库 layer。

工具名直接表达范围：`current_space` 是当前绑定空间，`discovered_space` 是允许只读探索的指定空间，`global` 仅指全局长期记忆，`all` 包含全局层和全部空间。`by_source` 只匹配来源字段，普通 search 匹配正文。

正文搜索返回 `memory.id`，来源搜索返回 `memoryId`。将其传给读取工具的 `id`，首次从 `offset: 0` 开始，再沿 `nextOffset` 读取，直到 `null`。更新前读取完整正文并使用最新 `revision`；归档工具返回 `{ id, archived: true }`，保留历史，不执行物理删除。

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

## 跨空间搜索与读取

不传 `crossSpace` 时，正文搜索、来源搜索、读取和写入都只作用于当前空间的 daily 与 long-term 记忆，不包含其他空间或全局层。

| 配置                | 跨空间能力                                          | 是否包含全局层                               |
| ------------------- | --------------------------------------------------- | -------------------------------------------- |
| 不传 `crossSpace`   | 无，只访问当前空间                                  | 否                                           |
| `access: "related"` | 按记忆来源发现空间，再搜索、读取已发现空间          | 否                                           |
| `access: "all"`     | 包含 `related` 能力，额外允许直接搜索、读取全部记忆 | 是，通过 `search_all_*` 与 `read_any_memory` |

下面三组工具是不同授权方式，按需要选择一组。`manager` 是已打开的 `MemoryManager`，`space` 是当前绑定的 `SpaceMemory`：

```ts
import { memoryTools } from "@cieljs/memory/agent";

// 默认：正文和来源都只搜索当前空间。
const localTools = memoryTools({ space });

// 跨空间：先根据来源发现相关空间。
const relatedTools = memoryTools({
  space,
  crossSpace: { manager, access: "related" },
});

// 跨空间：也允许直接搜索全部空间及全局层。
const allTools = memoryTools({
  space,
  crossSpace: { manager, access: "all" },
});
```

当前空间的七个工具保持原范围。跨空间配置额外提供以下实际调用名称：

| Tool name                                  | 可用配置         | 行为                                                             |
| ------------------------------------------ | ---------------- | ---------------------------------------------------------------- |
| `find_memory_spaces_by_source`             | `related`、`all` | 按记忆的 `sources` 发现空间，不搜索正文或全局层，不枚举空空间    |
| `search_discovered_space_memory`           | `related`、`all` | 按 `spaceId` 搜索指定已发现空间的 daily 与 long-term 正文        |
| `search_discovered_space_memory_by_source` | `related`、`all` | 按 `spaceId` 匹配指定已发现空间记忆的 `sources`                  |
| `read_discovered_space_memory`             | `related`、`all` | 按 `spaceId`、`id` 分页读取指定已发现空间的记忆                  |
| `search_all_memory`                        | 仅 `all`         | 搜索全局长期记忆及全部空间的 daily 与 long-term 正文，无需先发现 |
| `search_all_memory_by_source`              | 仅 `all`         | 匹配全局层及全部空间记忆的 `sources`，无需先发现                 |
| `read_any_memory`                          | 仅 `all`         | 按 `id` 直接分页读取全局层或任意空间记忆，无需先发现             |

`related` 的调用顺序是 `find_memory_spaces_by_source` → `search_discovered_space_memory`（或其 `by_source` 版本）→ `read_discovered_space_memory`。发现结果的 `spaces[]` 包含 `spaceId`、匹配来源和记忆引用。将 `spaceId` 传给后续工具，再用正文结果的 `memory.id` 或来源结果的 `memoryId` 作为读取参数 `id`。

当前空间已允许使用 `discovered_space` 工具；其他空间必须先按记忆来源发现。发现记录在这组工具实例存续期间有效，重新创建工具后需要重新发现。

`all` 可以直接调用 `search_all_memory` 或 `search_all_memory_by_source`，再使用结果中的记忆 ID 调用 `read_any_memory`。`all` 只覆盖所传 Manager 的记忆库，不会搜索其他独立数据库。返回的 `spaceId`、`layer` 和来源用于区分记忆归属，不应把其他空间的事实当作当前空间的事实。

两种模式都只扩大搜索与读取权限。保存、更新、归档仍限于当前空间；全局写入需要下面的独立授权。即使启用 `all`，名称带 `current_space` 的工具也始终只访问当前空间。

当前空间、跨空间和全局的正文搜索工具均按 `maxReadChars` 截断正文预览和片段；完整正文可通过对应读取工具的 `offset` 分页获取。

## 全局授权

全局工具必须单独创建：

```ts
const tools = globalMemoryTools({
  memory: manager.global,
  sources: ["session:conversation-1"],
});
```

它提供 `search_global_memory`、`search_global_memory_by_source`、`read_global_memory`、`remember_global_memory`、`update_global_memory` 和 `archive_global_memory`。这些工具仅访问全局长期记忆，不搜索空间记忆；宿主可以通过 `remember`、`update`、`forget` 分别关闭三个写入能力。

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

上下文注入与工具权限独立。注入全局记忆不会自动开放全局或跨空间搜索工具。
