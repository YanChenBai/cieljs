<h1 align="center">@cieljs/memory</h1>

<p align="center">让空间保留近期上下文，让稳定事实跨空间或跨会话继续使用。</p>

<p align="center">
  <a href="./docs/scopes.md">层级与日期</a> ·
  <a href="./docs/search.md">记忆检索</a> ·
  <a href="./docs/embedding.md">向量配置</a> ·
  <a href="./docs/agent.md">Agent 接入</a>
</p>

`@cieljs/memory` 使用 PGlite 保存整理后的事件和事实。公开模型只有三个层级：

| Layer              | 归属     | 用途                       |
| ------------------ | -------- | -------------------------- |
| `global.long_term` | 全局     | 跨空间成立的事实与稳定偏好 |
| `space.long_term`  | 单个空间 | 空间独有的长期知识与约定   |
| `space.daily`      | 单个空间 | 当天事件、话题和短期状态   |

## 基本使用

```ts
import { MemoryManager } from "@cieljs/memory";

const memories = await MemoryManager.open({ dataDir: ".ciel/memory" });
const space = memories.space("space-1");

try {
  await memories.global.longTerm.remember({
    content: "用户偏好简洁的回答。",
  });

  await space.longTerm.remember({
    content: "这个空间使用本地数据库保存历史记录。",
  });

  await space.daily.remember({
    content: "今天决定重构记忆层级。",
    sources: [{ type: "session", sessionId: "conversation-1" }],
  });
} finally {
  await memories.close();
}
```

写入入口已经固定归属和层级。每日记忆可以传 `date`，长期记忆不能传日期。

## 局部与全库检索

```ts
// global.long_term + 当前空间的 long_term/daily
const localHits = await space.search("之前决定如何保存历史记录");

// 全局长期记忆 + 所有空间记忆
const allHits = await memories.search("之前决定如何保存历史记录");
```

`space.get(id)` 只能读取全局与当前空间的记录；`memories.get(id)` 可以读取全库记录。全库入口不接受空间列表，它的语义始终是全部记忆。

## Agent Tools

`memoryTools({ space })` 提供 `search_memory`、`read_memory`、`remember_memory`、`update_memory` 和 `forget_memory`。三个写入工具使用复合 `layer`，当前 `spaceId` 由 `space` 固定。

`allMemoryTools({ manager })` 提供只读的 `search_all_memory` 与 `read_all_memory`，直接搜索全局和所有空间。工具参数不包含 scope；模型不能自行改变写入归属。

## 开发

```bash
vp check
vp test
vp run build
```

测试使用本地数据库和 Embedding 替身，无需 API Key。
