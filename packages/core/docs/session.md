# 普通 Session

## 打开与恢复

`ciel.session()` 打开或恢复一个普通对话 Session：

```ts
const session = await ciel.session({
  sessionId: "conversation:1", // 省略时创建新 ID
  spaceId: "livestream",
  sources: () => [currentRoomId],
});

await session.agent.prompt("总结当前直播间的情况");
```

- 传入 `sessionId` 时打开或恢复指定 Session。
- 省略时由 Session 存储创建新 ID。
- Core 不根据 `spaceId` 或 `sources` 隐式推导 Session ID。

## 消息持久化

Session 保存用户、助手和工具结果消息，是对话历史的事实流水。Agent 每产生一条完整消息（`message_end`）就按顺序写入 Session，写入成功后才认为消息已持久化。

同一 Session 再次打开时会恢复历史上下文，因此 `agent.prompt()` 能接着上一轮继续。

## 工具边界

普通 Session 的 Agent 获得：

- 宿主通过 `tools` 提供的 Ciel 工具。
- 当前空间的 Session 检索工具。
- 当前空间与全局 Memory 的读写工具。

Memory 工具绑定 `session.id` 和当前动态来源，Agent 不能自行构造来源。第一版不自动把每轮对话提炼成 Memory，长期信息通过明确的 Memory 工具写入。

## 上下文组合

一次生成的上下文顺序为：

```text
基础 System Prompt
        ↓
当前 Session 身份与动态来源
        ↓
相关 Memory 召回结果
        ↓
已保存的 Session 上下文
        ↓
当前用户输入与工具结果
```

Memory 召回内容带有来源和时间信息，并标记为历史资料，不能被当作当前用户指令。

## 关闭

`session.close()` 等待当前 Agent 运行结束、消息持久化队列清空后取消订阅，并从 Ciel 的活动 Session 集合中移除。重复调用返回同一个关闭流程。

## 可选跨 Space 读取

`ciel.session({ spaceId, sessionId, crossSpace: true })` 为当前会话开启按来源发现其他 Space 的 Session/Memory，再只读搜索和读取。省略时维持当前 Space 边界；当前 Space 写工具和全局记忆工具的既有权限不变。

`ciel.investigate({ spaceId, question, crossSpace: true })` 允许只读搜索全部普通 Session，以及按来源发现、读取其他 Space 的 Memory。不会读取其他 Investigation 的会话，也不会增加记忆写工具。授权范围为当前 Ciel 配置的数据库。
