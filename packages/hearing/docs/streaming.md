# 流式处理与时间戳

## 输入格式

`ASR.write()` 只接受 16 kHz、单声道、16 位有符号小端（s16le）PCM：

```ts
asr.write({
  data: pcm16le, // Buffer
  startAt: new Date(), // 这段 PCM 的起始时间
});
```

`data` 的字节数必须是 2 的倍数，否则触发 `error` 事件。包内部把 s16le 转成 `[-1, 1)` 的 `Float32Array` 再交给 sherpa-onnx-node。

## 缓冲与 VAD

`write()` 先把样本写入环形缓冲。缓冲容量由 `bufferSeconds` 决定，默认 30 秒；缓冲满时触发 `error`，而不是静默丢弃样本。

每次写入后，包按 256 采样（16 kHz 下 16 ms）的 VAD 窗口推进 TEN-VAD。TEN-VAD 用 `minSpeechDuration`（默认 0.5 秒）和 `minSilenceDuration`（默认 0.5 秒）决定一个语音片段的边界，`maxSpeechDuration`（默认 10 秒）强制切分过长的片段。

VAD 每产出一个片段，包就立刻转写，并把结果按写入顺序通过事件发出。

## flush

`flush()` 把缓冲中剩余的样本补零到完整窗口、交给 VAD 后取走最后一段：

```ts
asr.flush();
```

调用后 VAD 和缓冲复位，流开始时间清空。之后再次 `write()` 会开始一条新的流。`flush()` 不关闭实例；结束时应调用 `close()`（原生后端下是空操作，进程后端下关闭 worker）。

## 时间戳

每个片段的时间戳都由流开始时间和样本偏移推导：

| 时间             | 来源                        |
| ---------------- | --------------------------- |
| `speechstart`    | 流开始时间 + 片段起始样本数 |
| `result.startAt` | 片段起始样本数              |
| `result.endAt`   | 片段结束样本数              |
| `speechend`      | 片段结束样本数              |

第一次 `write()` 传入的 `startAt` 成为流开始时间。`result.tokens` 和 `result.confidence` 当前为空：Qwen3-ASR 结果只保留 VAD 片段级起止时间，不生成词级时间戳与置信度。

## 退化结果重试

Qwen3-ASR 输出带有 `<asr_text>` 前缀，包解析后只保留前缀之后的正文。两类结果被判定为退化：

- `tokens` 数量达到 `maxNewTokens`（默认 256）
- 正文出现过度重复（连续重复单元占据正文一半以上）

退化结果会把片段从中间二分，递归转写，最多重试两层。短于 4 秒的片段不再细分。重试后仍退化则丢弃该片段，不发出 `result`。

## Electron 进程后端

Electron 的 V8 memory cage 不允许 sherpa 返回堆外 ArrayBuffer，因此检测到 Electron 时，`ASR` 自动把识别移入独立的 Node ESM 进程（`./worker`）：

- 命令、PCM 和时间戳通过 stdin/stdout 的新行 JSON 交换
- `CIEL_NODE_EXECUTABLE` 可覆盖启动的 Node 可执行文件
- worker 崩溃或异常退出会转成 `error` 事件
- `close()` 等待 worker 退出

普通 Node 环境直接使用原生 sherpa，行为与事件完全一致。
