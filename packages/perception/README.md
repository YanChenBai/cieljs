<h1 align="center">@cieljs/perception</h1>

<p align="center">持续接收音频与可选图片，在每次语音结束时生成可直接交给 Pi Agent 的多模态感知快照。</p>

<p align="center">
  <a href="./docs/audio.md">听觉与时间线</a> ·
  <a href="./docs/vision.md">视觉采样与合成</a> ·
  <a href="./docs/snapshot.md">快照与 Agent 消息</a> ·
  <a href="./docs/lifecycle.md">事件与关闭</a>
</p>

`@cieljs/perception` 复用 `@cieljs/hearing` 完成语音感知，并叠加图片采样、差异过滤、多帧合成与快照冻结：

| 能力 | 实现               | 职责                     |
| ---- | ------------------ | ------------------------ |
| 听觉 | `@cieljs/hearing` | VAD、ASR 与说话人识别    |
| 视觉 | `sharp`            | 采样、差异过滤与多帧合成 |
| 快照 | `compose()`        | 冻结为 `AgentMessage[]`  |

音频固定为 16 kHz、单声道、16 位有符号小端 PCM。图片能力通过省略 `vision` 或传入 `vision: false` 完全关闭。

## 基本使用

```ts
import { createPerception } from "@cieljs/perception";

const perception = createPerception({
  asr: {
    speaker: [{ name: "主播", file: "./voiceprints/streamer.voiceprint" }],
  },
  vision: {
    sampleIntervalMs: 5_000,
    differenceThreshold: 0.03,
    maxFrames: 9,
  },
  hearingPrompt: "一段语音刚刚结束，请结合以下听觉转写作出判断。",
  visionPrompt: "以下画面按采集时间排列，请结合画面变化理解现场。",
});

const unsubscribe = perception.on("speechend", async ({ snapshot }) => {
  const messages = await snapshot.compose();

  await agent.prompt(messages);
});

perception.asr.write({ data: pcm16le, startAt: new Date() });

await perception.image?.write({ source: "livestream", data: image, at: new Date() });

unsubscribe();
await perception.close();
```

## 听觉

`asr` 选项原样传给 `@cieljs/hearing`，已知说话人通过 `speaker` 声纹配置传入，未知说话人继续由底层聚类管理。每次 `speechend` 都形成一份截止该时刻的冻结快照，即使这段语音没有识别出文字。详见[听觉与时间线](./docs/audio.md)。

## 视觉

图片按 `source` 独立采样和过滤：`sampleIntervalMs` 限制采样间隔，`differenceThreshold` 过滤近似画面，`maxFrames` 限制每组合成帧数。每组合成一张 1920×1080 JPEG。详见[视觉采样与合成](./docs/vision.md)。

## 快照与 Agent 消息

快照创建后不再加入新数据，`compose()` 按「先视觉、后听觉」的顺序返回 `AgentMessage[]`，可直接传给 `agent.prompt()`。转写按时间排列，格式为 `[ISO time][speaker] content`。详见[快照与 Agent 消息](./docs/snapshot.md)。

## 事件与关闭

`speechend` 表示快照已准备完成，`error` 通知异步图片错误，`close()` 先 flush 再等待内部任务并幂等。详见[事件与关闭](./docs/lifecycle.md)。

完整类型定义与设计决策见 [API 设计](./docs/api-design.md)。

## 开发

```bash
vp check
vp test --run
vp run build
```

测试使用 `@cieljs/hearing` 的模块替身和 sharp 生成的小图，无需下载模型。
