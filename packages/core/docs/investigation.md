# Investigation

## 隔离检索

`ciel.investigate()` 每次执行一轮调查并直接返回结果，把「从大量历史资料中找出答案」从主 Agent 的上下文中分离出来：

```ts
const result = await ciel.investigate({
  spaceId: "livestream",
  sources: () => [currentRoomId],
  question: "主播以前提到过喜欢什么类型的游戏？",
});
```

未传 `sessionId` 时，每次调用都创建新的 Investigation Session 和全新的模型上下文。上一次调查的消息、工具结果和回答不会进入下一次调用。

## 显式续接

传入 `sessionId` 时，Core 从独立存储恢复该 Investigation Session 的历史，在其后继续本次调查：

```ts
const first = await ciel.investigate({
  sessionId: "preference-query:1",
  spaceId: "livestream",
  sources: () => [currentRoomId],
  question: "主播提到过哪些明确的游戏偏好？",
});

const second = await ciel.investigate({
  sessionId: "preference-query:1",
  spaceId: "livestream",
  sources: () => [currentRoomId],
  question: "再核对一次。",
});
```

续接是显式能力，Investigation 不会自动发现或检索其他 Investigation Session。

## 只读工具

Investigation 没有自己的 Memory，只获得只读检索工具：

```text
search_memory
read_memory
search_sessions
read_session
```

`spaceId` 和 `sources` 由 Core 注入，模型不能通过工具参数覆盖。默认不能跨空间检索，也不提供任何写入、更新或归档能力。

宿主可通过 `DefineCielOptions.investigation.tools` 提供额外的只读工具，例如感知时间线或直播间事件查询。

## 结果

```ts
export interface InvestigationResult {
  sessionId: string;
  answer: AgentMessage;
  messages: AgentMessage[];
}
```

`answer` 是最后一次 assistant 消息，`messages` 是本次调查产生的全部消息。结果可直接交给普通 Session 继续判断：

```ts
await session.agent.prompt([
  { role: "user", content: "请结合以下调查结果继续判断" },
  result.answer,
]);
```
