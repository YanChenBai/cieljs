> 多模型、结构化事件和 KWS 的当前接口见 [多模型接口](./multi-model.md)。

# Hearing API 设计

本文定义 `@cieljs/hearing` 第一版的公开 API、数据语义和运行边界。

当前版本只实现流式离线转写、VAD 分段、片段时间戳、声纹提取和动态说话人聚类，不实现在线流式识别、词级时间戳、自动说话人分离或模型热更新。

## 设计目标

- 对外只暴露一个 `ASR` 事件流，隐藏环形缓冲、VAD 和模型配置细节
- 输入约定为单一 PCM 格式，转换与校验集中在包内部
- 时间戳由调用者提供的 `startAt` 推导，包不依赖系统时钟
- Electron 与普通 Node 共享同一事件接口，运行时自动选择后端
- 声纹作为二进制资产独立于代码，通过 CLI 生成

## 包入口

```json
{
  "exports": {
    ".": "./dist/index.mjs",
    "./ciel": "./dist/ciel.mjs",
    "./worker": "./dist/worker.mjs",
    "./package.json": "./package.json"
  }
}
```

主入口只包含运行时 API 和配置检查：

```ts
import { ASR, createASR, checkConfiguration } from '@cieljs/hearing';
```

`./ciel` 是 CLI 入口，`./worker` 是 Electron 后端启动的独立进程，两者都不作为公共子路径导出类型。

## ASR

```ts
export class ASR {
  constructor(options?: ASROptions);

  write(segment: ASRSegment): void;
  flush(): void;
  on<K extends keyof ASREventMap>(event: K, callback: ASREventMap[K]): Unsubscribe;
  close(): Promise<void>;
}
```

`ASR` 是门面：普通 Node 下包装 `NativeASR`，Electron 下包装 `ProcessASR`，两者事件语义完全一致。

### Options

```ts
export interface ASROptions {
  speaker?: readonly SpeakerProfile[];
  bufferSeconds?: number;
  speakerThreshold?: number;
  maxSpeakers?: number;
}
```

| 选项               | 默认 | 含义               |
| ------------------ | ---- | ------------------ |
| `bufferSeconds`    | 30   | 环形缓冲容量（秒） |
| `speakerThreshold` | 0.6  | 声纹余弦相似度阈值 |
| `maxSpeakers`      | 8    | 动态说话人数量上限 |
| `speaker`          | `[]` | 已注册声纹         |

`bufferSeconds` 必须至少容纳一个 VAD 窗口；`speakerThreshold` 在 `(0, 1]`；`maxSpeakers` 为正整数。非法值在构造时抛出。

### 输入

```ts
export interface ASRSegment {
  data: Buffer;
  startAt: Date;
}
```

`data` 必须是 16 kHz、单声道、s16le PCM，字节数为偶数。`startAt` 是这段数据的起始时间，第一次 `write()` 时固定为流开始时间。

## 事件

```ts
export type Unsubscribe = () => void;

export interface ASREventMap {
  result(data: ASRResult): void;
  speechstart(at: Date): void;
  speechend(at: Date): void;
  error(error: Error): void;
}
```

`on()` 返回取消订阅函数。`write()` 和 `flush()` 内部错误都转成 `error` 事件，不向上抛出。

### ASRResult

```ts
export interface ASRResult {
  content: string;
  speaker?: string;
  confidence?: number;
  startAt: Date;
  endAt: Date;
  tokens?: readonly ASRToken[];
}
```

`content` 是去除 `<asr_text>` 前缀后的正文。`speaker` 来自声纹匹配或动态聚类。`confidence` 和 `tokens` 当前恒为空：Qwen3-ASR 只提供片段级时间戳。

## SpeakerProfile 与声纹

```ts
export interface SpeakerProfile {
  name: string;
  file: string;
}
```

`file` 是相对包目录下 `voiceprints/` 的路径。构造时读取并校验维度；维度不匹配、文件非法或名字重复都会抛错。

## 进程后端

`ProcessASR` 用新行 JSON 与 worker 通信：

```ts
export type ASRWorkerCommand =
  | { type: 'init'; options: ASROptions }
  | { type: 'write'; data: string; startAt: string }
  | { type: 'flush' }
  | { type: 'close' };
```

PCM 以 base64 传输，时间戳用 ISO 字符串。`init` 完成后 worker 回 `ready`，之前排队的 `write`/`flush` 会暂存并在就绪后重放。worker 在 `init` 失败时标记 fatal 并退出，普通错误只回传 `error`。

启动的 Node 可执行文件由 `CIEL_NODE_EXECUTABLE` 覆盖，默认是 `node`。

## 内部结构

```text
ASR（门面）
├── NativeASR（普通 Node）
│   ├── CircularBuffer → 缓冲 PCM
│   ├── Vad → TEN-VAD 分段
│   ├── OfflineRecognizer → Qwen3-ASR 转写
│   └── SpeakerTracker → 声纹匹配与聚类
└── ProcessASR（Electron）
    └── spawn worker.mjs → NativeASR
```

`createASR()` 负责模型准备和实例创建，`checkConfiguration(options)` 检查所选资源，原生推理配置不对外暴露。

## 关键设计原因

### 为什么时间戳由调用者传入

流式识别无法从 PCM 本身得知绝对时间。要求调用者在 `write()` 提供 `startAt`，包只需按样本偏移累加，就能把片段映射回原始时间轴，同时保持样本处理的纯函数式。

### 为什么退化结果要二分重试

Qwen3-ASR 在极长片段上可能重复输出或撞到 token 上限。当前把 `maxNewTokens` 设为 64，在 sherpa 的 65-token 重复保护前触发已有退化检测。二分重试把长片段切成两半重新识别，比丢弃整段更能保住有效内容；重试深度和最小样本数避免无限递归和过碎片段。

### 为什么 Electron 单独走进程

Electron 的 V8 memory cage 不允许 sherpa 返回堆外 ArrayBuffer。把识别移入独立 Node ESM 进程，宿主无需改动事件用法，代价只是 base64 序列化 PCM。

### 为什么声纹用自定义二进制格式

声纹是归一化 embedding，维度固定但内容不可读。自定义 `magic + 维度 + float32[]` 格式比 JSON 更小、读取更快，并且可以在读取时校验魔数和长度，避免把损坏文件当作有效声纹。

### 为什么不生成词级时间戳

上游社区转换的 Qwen3-ASR 模型只提供 VAD 片段级对齐，没有可靠的词级时间戳与置信度。第一版只承诺片段级时间，避免暴露不稳定输出。以后接入支持词级对齐的模型时，可以填充 `tokens` 而不改变事件契约。
