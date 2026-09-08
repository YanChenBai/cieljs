<h1 align="center">@cieljs/hearing</h1>

<p align="center">基于 sherpa-onnx-node 的流式语音感知，负责 PCM 缓冲、VAD 分段、离线转写、片段时间戳与说话人识别。</p>

<p align="center">
  <a href="./docs/streaming.md">流式与时间戳</a> ·
  <a href="./docs/speaker.md">说话人与声纹</a> ·
  <a href="./docs/models.md">模型配置</a> ·
  <a href="./docs/api-design.md">API 设计</a>
</p>

`@cieljs/hearing` 使用 sherpa-onnx-node 在纯 Node 中完成语音感知，分为三条管线：

| 组件    | 模型                | 职责                    |
| ------- | ------------------- | ----------------------- |
| VAD     | TEN-VAD             | 从 PCM 缓冲切分语音片段 |
| ASR     | Qwen3-ASR 1.7B INT8 | 离线转写片段正文        |
| Speaker | 3D-Speaker          | 声纹提取与说话人聚类    |

输入固定为 16 kHz、单声道、16 位有符号小端 PCM。识别结果保留 VAD 片段级起止时间，不生成词级时间戳与置信度。

## 基本使用

```ts
import { ASR } from '@cieljs/hearing';

const asr = new ASR({
  bufferSeconds: 30,
  speakerThreshold: 0.6,
  maxSpeakers: 8,
});

asr.on('result', result => {
  console.log(result.content, result.speaker, result.startAt, result.endAt);
});

asr.write({ data: pcm16le, startAt: new Date() });
asr.flush();
```

`write()` 接收一段 PCM 和它的起始时间；`flush()` 排空缓冲并输出最后一段。错误通过 `error` 事件报告，不会从 `write()` 抛出。

## 事件与时间戳

`ASR` 在 VAD 片段上触发四个事件：

| 事件          | 载荷        | 含义                   |
| ------------- | ----------- | ---------------------- |
| `speechstart` | `Date`      | 片段开始               |
| `result`      | `ASRResult` | 正文、说话人和起止时间 |
| `speechend`   | `Date`      | 片段结束               |
| `error`       | `Error`     | 输入或识别错误         |

正文由 Qwen3-ASR 输出解析而来。识别最多生成 64 个 token，在 sherpa 的 65-token 重复保护前触发退化检测；异常长片段会二分重试，仍然退化的结果直接丢弃。详见[流式与时间戳](./docs/streaming.md)。

## 说话人

`ASR` 用 3D-Speaker 对每个片段计算声纹，与已注册声纹或动态聚类的中心做余弦相似度匹配：

```ts
const asr = new ASR({
  speaker: [{ name: 'alice', file: 'alice.voiceprint' }],
  speakerThreshold: 0.6,
  maxSpeakers: 8,
});
```

未命中已注册声纹的片段会被聚成 `speaker_0`、`speaker_1` 等动态标签。注册声纹通过 CLI 生成。详见[说话人与声纹](./docs/speaker.md)。

## 模型与 CLI

```bash
vp run @cieljs/hearing#install-model
vp run @cieljs/hearing#install-model -- --force
vp run @cieljs/hearing#voiceprint -- --output alice.voiceprint 1.wav 2.wav 3.wav
```

模型安装在包目录下的 `models/`，声纹写入包目录下的 `voiceprints/`。运行时完全使用 Node，不需要 Python。详见[模型配置](./docs/models.md)。

## 开发

```bash
vp check
vp test --run
vp run build
```

测试使用 sherpa-onnx-node 的模块替身，无需下载模型。
