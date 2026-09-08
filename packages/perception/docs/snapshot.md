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

{visionPrompt}

{image content}

# 听觉

{hearingPrompt}

[2026-09-05T12:00:01.000Z][speaker_1] xxxxx
[2026-09-05T12:00:04.000Z][主播] xxxxx
```

转写按 `startAt` 排序，格式为 `[ISO time][speaker] content`，没有说话人时省略第二组方括号。没有有效图片时不生成视觉部分，没有转写时不生成听觉部分；两者都为空时返回空数组，不依靠提示词制造空消息。

## 提示词

`hearingPrompt` 和 `visionPrompt` 分别由宿主配置，放在对应模态的数据之前，不合并成一个脱离数据位置的总提示词。空字符串表示不添加该提示词。同一个快照重复调用 `compose()` 得到内容等价的消息。
