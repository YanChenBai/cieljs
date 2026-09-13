# 听觉与时间线

## 输入格式

音频通过 `perception.asr.write()` 写入，格式固定为 16 kHz、单声道、16 位有符号小端（s16le）PCM：

```ts
perception.asr.write({
  data: pcm16le, // Buffer
  startAt: new Date(), // 这段 PCM 的起始时间
});
```

格式转换、VAD 分段、ASR 转写和片段时间戳都由 `@cieljs/hearing` 负责，感知包不重复实现。

## ASR 配置

`PerceptionOptions.asr` 原样传给 `@cieljs/hearing` 的 `ASR`：

```ts
const perception = createPerception({
  asr: {
    speaker: [{ name: '主播', file: './voiceprints/streamer.voiceprint' }],
    bufferSeconds: 30,
    speakerThreshold: 0.6,
    maxSpeakers: 8,
  },
});
```

`ASROptions`、`ASRResult` 和 `SpeakerProfile` 会从 `@cieljs/hearing` 重新导出，调用方配置感知实例不需要额外的 type-only import。

## 时间线

底层 `ASR` 的 `result` 先写入内部时间线，再处理对应的 `speechend`。感知包按转写的 `startAt` 排序，`retentionMs`（默认 60 秒）决定内部最多保留多长的感知数据。

每条转写保留 ISO 时间、说话人、声音事件和正文。没有说话人或声音事件的转写在快照中省略对应字段。

## 说话人

已知说话人通过 `asr.speaker` 传入，未知说话人的稳定标识继续由 `@cieljs/hearing` 的声纹聚类管理。第一版只支持在创建实例时传入声纹配置，不提供运行时注册。
