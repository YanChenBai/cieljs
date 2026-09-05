<h1 align="center">@cieljs/session</h1>

<p align="center">让 Agent 记得聊过什么，也能找回当时的原话。</p>

<p align="center">
  <a href="./docs/compaction.md">会话压缩</a> ·
  <a href="./docs/embedding.md">向量检索</a>
</p>

一段对话聊久了，会留下许多值得记住的东西：最初的目标、几次讨论后的决定，还有那些说好稍后再做的事。下一次打开会话时，我们希望能接着聊；上下文装不下时，也希望重要的信息能留下来。

`@cieljs/session` 为这些内容提供一个本地的存放处。它用 PGlite 保存完整消息，用递归摘要整理较早的对话，再通过历史检索把需要的细节找回来。

一个 `spaceId` 表示稳定的业务空间，例如某个直播间；同一空间可以包含多段 Session。`sources` 保存主播昵称、房间标题和其他可检索来源，不参与空间隔离。

## 对话可以留下什么？

- **完整的历史。** 用户消息、助手回复和工具结果按顺序保存，重新打开会话就能恢复上下文。
- **持续更新的摘要。** 上一份摘要与新增的旧消息合并成新摘要，最近的原文继续保留，工具调用与结果保持在同一轮次里。
- **能找回的细节。** 全文、模糊和向量检索共同查找历史，也可以根据消息序号回到原始对话。
- **你选择的模型。** 摘要和 Embedding 分别配置，可以连接云端服务，也可以接入本地模型。

> [!NOTE]
> 压缩整理的是送给模型的上下文。原始消息仍留在数据库里，随时可以搜索和读取。

## 试一下

打开一个会话，写入消息，再取回它的当前上下文：

```ts
import { SessionManager } from "@cieljs/session";

const manager = await SessionManager.open({ dataDir: ".ciel/sessions" });
const space = manager.space("blive:room:21452505");

try {
  // ID 已存在时复用已有 Session。
  const session = await space.session({
    id: "conversation-1",
    sources: ["project:ciel", "user:alice"],
  });

  await session.appendMessage({
    role: "user",
    content: "我们决定用本地数据库保存会话。",
    timestamp: Date.now(),
  });

  const messages = await session.context();
  console.log(messages);
} finally {
  await manager.close();
}
```

`context()` 返回可直接交给 Agent 的 `AgentMessage[]`。存在累计摘要时，摘要会作为第一条历史消息，后面是它尚未覆盖的原文。再次使用相同的数据目录、空间 ID 和会话 ID，就可以继续读取这段历史。

消息完成后等待 `appendMessage()`；使用结束、停止提交新任务后再关闭存储。`close()` 会等待已排队的压缩和索引任务。

## 对话越来越长时

我们沿用 Pi 的方式判断上下文用量：优先读取最近有效的模型 usage，再估算后续新增消息。用量超过 `contextWindow - reserveTokens` 时，调用 `session.compact()` 就会尝试压缩较早的对话。

`contextWindow` 使用对话模型的窗口大小，`reserveTokens` 默认预留 16,384 tokens。你也可以通过 `keepRecentMessages` 指定至少保留最近多少条原文，默认是 10 条。

每次压缩都接着上一份摘要往下整理：

```text
旧消息                 → 摘要 S1
S1 + 新增的旧消息      → 摘要 S2
S2 + 最近保留的原文    → 当前上下文
```

摘要模型由你提供，上层决定什么时候检查压缩、什么时候更新模型上下文。模型配置、完整示例和 token 计算细节放在[会话压缩文档](./docs/compaction.md)里。

## 找回之前聊过的内容

Agent Tool 从独立入口导入。通过 `sessionTools({ session, space })`，可以同时获得当前会话和当前空间的历史工具：

- `search_session`：找到当前 Session 的相关历史片段。
- `read_session`：读取当前 Session 中某条消息附近的上下文。
- `find_sessions_by_source`：在当前空间中根据业务 ID、名称、昵称、标题或别名等 `sources` 发现相关会话。
- `search_found_session`：搜索已经发现的会话。
- `read_found_session`：读取已经发现的会话中某条消息附近的上下文。

同一直播间内的跨 Session 查询属于基础能力。只有需要越过当前 `spaceId` 时，才显式传入 Manager 与跨空间访问级别：

```ts
import { sessionTools } from "@cieljs/session/agent";

const tools = sessionTools({
  session,
  space,
  crossSpace: {
    manager,
    access: "related",
  },
});
```

`crossSpace` 未配置时，来源发现和后续读取始终限制在当前 Space。`access: "related"` 允许按 sources 发现其他空间的 Session；`access: "all"` 还会提供 `search_all_sessions` 与 `read_any_session`。Agent Tool 不提供 `list_sessions`；宿主若需要管理列表，可以调用 `space.list()` 或 `manager.list()`。

独立全局问答 Agent 可以用另一个数据目录保存自身 Session，再把普通空间的 Manager 只作为跨会话查询来源。这样问答历史不会混入普通空间数据。

> [!TIP]
> 可以先从全文和模糊检索开始。需要语义检索时，再接入一个提供 `embedBatch()` 的 Embedding Provider。

向量模型的维数、批量接口和索引维护方式，请看[向量检索文档](./docs/embedding.md)。

宿主需要跨会话查找时，使用 `manager.searchAll(query)`；`session.search(query)` 始终只查询当前会话。通过 `manager.findSessionsBySource(query)` 可以按来源定位会话。

来源全文检索与查询使用同一个 tokenizer，支持中文多关键词查询。更换 tokenizer 后，`rebuildIndexes()` 会同时重建正文与来源索引。

## 开发

在本包目录运行：

```bash
vp check
vp test
vp run build
```

测试使用本地数据库和模型替身，无需 API Key。你可以直接验证会话恢复、递归压缩、token 判断与历史检索，再接入自己的模型服务。
