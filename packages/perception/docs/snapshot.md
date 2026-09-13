# 快照与 Agent 消息

## 冻结语义

快照创建后不再加入新的 transcript 或 frame，后续音频和图片写入不会改变已经创建的快照。`speechend` 快照的 `endAt` 严格等于该次语音结束时间，只包含 `endAt` 之前、仍在保留窗口内的数据。

```ts
const unsubscribe = perception.on('speechend', ({ snapshot }) => {
  // snapshot 已冻结，后续写入不会改变它
});
```

也可以手动生成一份快照：

```ts
const snapshot = await perception.snapshot({
  startAt: new Date('2026-09-05T11:59:00.000Z'),
  endAt: new Date('2026-09-05T12:00:10.000Z'),
});
```

省略参数时，`endAt` 取当前时间，`startAt` 取 `endAt - retentionMs`。

## compose()

`compose()` 返回 `AgentMessage[]`，可直接传给 `agent.prompt()`。第一版至多生成一条 `user` message，内容先放视觉、再放听觉：

```ts
const messages = await snapshot.compose();

await agent.prompt(messages);
```

模型看到的内容顺序等价于：

```text
# 视觉

{context({ modality: "vision" })}

{image content}

# 听觉

{context({ modality: "hearing" })}

时间: 2026-09-05T12:00:01.000Z, 说话人: [speaker_1]
xxxxx
时间: 2026-09-05T12:00:04.000Z, 说话人: [主播]
xxxxx
```

转写按 `startAt` 排序，每条转写先输出一行 `时间: ...` 元信息，再输出正文；没有说话人时省略 `说话人` 字段，没有声音事件时省略 `声音事件` 字段。没有有效图片时不生成视觉部分，没有转写时不生成听觉部分；两者都为空时返回空数组，不依靠提示词制造空消息。

## 上下文

`context` 在 `createPerception()` 时配置，同一实例产生的所有快照共享该函数。`compose()` 仅在对应模态有数据时调用它，并将返回文本放到该模态数据之前。宿主未配置时使用包内默认处理；传入后完整覆盖，返回 `undefined` 可省略该模态的附加上下文。

包导出 `DEFAULT_HEARING_PROMPT`、`DEFAULT_VISION_PROMPT` 和 `DEFAULT_PERCEPTION_SYSTEM_PROMPT`，便于宿主在自定义 context 或 system prompt 时显式复用。
