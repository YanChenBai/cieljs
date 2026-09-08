# 事件与关闭

## speechend

感知包的 `speechend` 与底层 `perception.asr.on("speechend")` 含义不同：

- 底层事件只表示 VAD 检测到语音结束，参数是结束时间。
- 感知包事件表示对应快照已经准备完成，参数包含 `result` 与 `snapshot`。

```ts
perception.on('speechend', ({ at, result, snapshot }) => {
  // result 在当前语音段识别出文本时存在
  // snapshot 是截止本次 speechend 的冻结快照
});
```

即使当前语音段没有识别出文字，感知包仍然发布 `speechend`，并提供当时的视觉与历史听觉快照。多个语音结束事件保持原始发生顺序，事件监听器本身不由感知包等待——宿主负责管理思考队列。

## error

图片解码、差异检测或合成失败时，相关 Promise 会 reject，同时通过 `perception.on("error")` 通知。错误不会被静默吞掉，也不会导致之后的图片任务永久停止。

## close()

```ts
await perception.close();
```

`close()` 会：

1. 停止接收新输入
2. 调用 ASR `flush()`，因此关闭时可能产生最后一个 `speechend`
3. 等待所有已接收输入、语音结束快照和内部任务完成
4. 释放内部资源

重复调用返回同一个关闭流程，幂等。宿主 Agent 的思考任务不在 `close()` 的等待范围内。
