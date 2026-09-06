<h1 align="center">@cieljs/memory</h1>

<p align="center">严格分层、保留版本历史，并能沿来源发现相关空间的长期记忆。</p>

<p align="center">
  <a href="./docs/scopes.md">层级与版本</a> ·
  <a href="./docs/search.md">内容与来源检索</a> ·
  <a href="./docs/embedding.md">向量配置</a> ·
  <a href="./docs/agent.md">Agent 接入</a>
</p>

`@cieljs/memory` 使用 PGlite、Drizzle 和 pgvector 保存三层记忆：

| Layer              | 归属     | 用途                       |
| ------------------ | -------- | -------------------------- |
| `global.long_term` | 全局     | 跨空间成立的事实与稳定偏好 |
| `space.long_term`  | 单个空间 | 空间独有的长期知识与约定   |
| `space.daily`      | 单个空间 | 当天事件、话题和短期状态   |

Space API 不会隐式合并全局记忆。跨空间访问只在管理端或显式授权的只读 Agent Tools 中发生。

## 基本使用

```ts
import { MemoryManager } from "@cieljs/memory";

await using memories = await MemoryManager.open({
  dataDir: ".ciel/memory",
  timeZone: "Asia/Shanghai",
  embedding,
});

const space = memories.space("blive:room:21452505");

await memories.global.remember({
  content: "用户偏好简洁且自然的表达",
  sources: ["session:conversation-1"],
});

await space.longTerm.remember({
  content: "这个直播间经常讨论独立游戏",
  sources: ["bilibili:room:21452505", "主播昵称"],
});

await space.daily.remember({
  content: "今天主播开始体验新的独立游戏",
  sources: ["bilibili:room:21452505", "今晚第一次挑战新模式"],
});
```

## 更新与遗忘

更新只提交变化字段和当前 revision。数据库会创建下一份完整快照，旧内容仍可通过历史 API 读取。

```ts
const current = await space.get(memoryId);

if (current) {
  await space.update(current.id, {
    expectedRevision: current.revision,
    content: "修正后的完整内容",
  });

  const history = await space.history(current.id);
  const firstRevision = await space.getRevision(current.id, 1);
}
```

`forget()` 是软归档，不物理删除正文、来源或 revision。

## 沿来源查找

```ts
const memoriesFromTitle = await memories.searchBySource("今晚第一次挑战新模式");
const relatedSpaces = await memories.findSpacesBySource("主播昵称");

for (const related of relatedSpaces) {
  const hits = await memories.space(related.spaceId).search("之前对这个游戏有什么看法");
}
```

`sources` 是业务定义的 `string[]`。包只负责规范化、精确匹配和文本检索，不解释主播、直播间、session 等业务含义。

## Agent Tools

```ts
import { globalMemoryTools, loadMemoryContext, memoryTools } from "@cieljs/memory/agent";

const tools = memoryTools({
  space,
  sources: ["session:conversation-1", "bilibili:room:21452505"],
  crossSpace: {
    manager: memories,
    access: "related",
  },
});
```

当前空间工具不接受 `spaceId`。跨空间搜索需要通过 `crossSpace` 显式开启：

| 配置                | Agent 可用范围                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 不传 `crossSpace`   | 正文、来源搜索及读取都仅限当前空间                                                                                                                                       |
| `access: "related"` | 用 `find_memory_spaces_by_source` 发现空间，再用 `search_discovered_space_memory`、`search_discovered_space_memory_by_source` 和 `read_discovered_space_memory` 只读访问 |
| `access: "all"`     | 额外提供 `search_all_memory`、`search_all_memory_by_source` 和 `read_any_memory`，直接搜索、读取全部空间及全局层，无需先发现                                             |

上述跨空间配置不会扩大写入权限。全局写入工具由宿主通过 `globalMemoryTools()` 单独授权；`global` 仅指全局长期记忆，`all` 才包含全局层与全部空间。

完整工具名称、三种配置示例、来源发现与后续读取流程见 [Agent 接入：跨空间搜索与读取](./docs/agent.md#跨空间搜索与读取)。

第一版不包含自动记忆整理。新记忆属于 daily、space long-term 还是 global long-term，由调用者或具体工具显式决定。

## 开发

```bash
vp check
vp test --run
vp run build
```

测试使用内存数据库和 Embedding 替身，无需 API Key。
