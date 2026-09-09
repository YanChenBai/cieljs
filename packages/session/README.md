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
import { Storage } from '@cieljs/storage';
import { SessionManager, sessionStorage } from '@cieljs/session';

await using storage = await Storage.open({
  dataDir: '.ciel/storage',
  modules: [sessionStorage],
});
const manager = await SessionManager.open({ storage, namespace: 'session' });
const space = manager.space('blive:room:21452505');

try {
  // ID 已存在时复用已有 Session。
  const session = await space.session({
    id: 'conversation-1',
    sources: ['project:ciel', 'user:alice'],
  });

  await session.appendMessage({
    role: 'user',
    content: '我们决定用本地数据库保存会话。',
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

- `search_current_session_messages`：找到当前 Session 的相关历史片段。
- `read_current_session_messages`：读取当前 Session 中某条消息附近的上下文。
- `find_sessions_by_source`：在当前空间中根据业务 ID、名称、昵称、标题或别名等 `sources` 发现相关会话。
- `search_discovered_session_messages`：搜索已经发现的会话。
- `read_discovered_session_messages`：读取已经发现的会话中某条消息附近的上下文。

### 跨空间搜索与读取

默认不开放跨空间访问，消息正文、来源发现和后续读取都受各自范围约束：当前会话正文直接搜索，同空间的其他会话先按来源发现，再逐个搜索。没有直接搜索当前空间全部会话正文的工具。

| 配置                | 来源发现范围            | 正文搜索与读取范围                                          |
| ------------------- | ----------------------- | ----------------------------------------------------------- |
| 不传 `crossSpace`   | 当前 Space              | 当前 Session，以及已发现的同空间 Session                    |
| `access: "related"` | 所传 Manager 的全部空间 | 当前 Session，以及按来源发现的 Session                      |
| `access: "all"`     | 所传 Manager 的全部空间 | 额外允许直接搜索、读取该 Manager 中全部 Session，无需先发现 |

下面三组工具是不同授权方式，按需要选择一组：

```ts
import { sessionTools } from '@cieljs/session/agent';

// 默认：仅在当前空间内找回历史。
const localTools = sessionTools({ session, space });

// 跨空间：先按来源发现会话，再搜索、读取。
const relatedTools = sessionTools({
  session,
  space,
  crossSpace: {
    manager,
    access: 'related',
  },
});

// 跨空间：也允许直接搜索全部会话正文。
const allTools = sessionTools({
  session,
  space,
  crossSpace: { manager, access: 'all' },
});
```

跨空间配置对应的实际调用名称如下。`related` 复用基础工具名，扩大来源发现范围；`all` 额外增加两个工具：

| Tool name                            | 可用配置               | 行为                                                       |
| ------------------------------------ | ---------------------- | ---------------------------------------------------------- |
| `search_current_session_messages`    | 默认、`related`、`all` | 始终只搜索当前 Session 正文                                |
| `read_current_session_messages`      | 默认、`related`、`all` | 始终只读取当前 Session 的消息前后文                        |
| `find_sessions_by_source`            | 默认、`related`、`all` | 只匹配 `sources`，按上表范围发现会话，不搜索正文           |
| `search_discovered_session_messages` | 默认、`related`、`all` | 按 `sessionId` 搜索已发现会话的正文                        |
| `read_discovered_session_messages`   | 默认、`related`、`all` | 按 `sessionId`、`messageId` 读取已发现会话的消息前后文     |
| `search_all_session_messages`        | 仅 `all`               | 跨全部空间搜索消息正文，不搜索 `sources`                   |
| `read_any_session_messages`          | 仅 `all`               | 按 `sessionId`、`messageId` 直接读取消息前后文，无需先发现 |

`related` 的调用顺序是 `find_sessions_by_source` → `search_discovered_session_messages` → `read_discovered_session_messages`。发现结果包含 `session.id`、`session.spaceId` 和 `matchedSources`；用 `session.id` 作为后续的 `sessionId`，用正文搜索结果的 `message.id` 作为 `messageId`。发现记录在这组工具实例存续期间有效，重新创建工具后需要重新发现。

`all` 可以直接调用 `search_all_session_messages`，再将结果的 `message.sessionId` 和 `message.id` 交给 `read_any_session_messages`。读取工具返回目标消息及 `before`、`after` 指定的相邻消息，不会返回整段会话。

这些工具全部只读。`all` 只覆盖所传 Manager 的会话库，不会搜索其他独立数据库。Agent Tool 不提供 `list_sessions`；宿主若需要管理列表，可以调用 `space.list()` 或 `manager.list()`。

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
