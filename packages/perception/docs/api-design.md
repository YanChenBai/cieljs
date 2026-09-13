# `@cieljs/perception` API 设计

## 目标

`@cieljs/perception` 负责持续接收音频与可选图片，在内部完成 ASR、时间窗口组织、视觉筛选和多帧合成，并在每次语音结束时提供一份稳定的多模态感知快照。

这个包解决以下问题：

- 直接接收 16 kHz 单声道 signed 16-bit little-endian PCM。
- 复用 `@cieljs/hearing` 完成 VAD、ASR 与说话人识别。
- 允许宿主传入已知说话人的声纹配置。
- 图片能力可以完全关闭。
- 图片启用时按来源采样、过滤近似画面，并合成多帧图片。
- 每次 `speechend` 都形成一份截止该时刻的冻结快照。
- 将快照组合成可直接传给 Agent 的 `AgentMessage[]`。

这个包不负责：

- 创建或持有 Agent。
- 决定 Agent 的 system prompt 或业务指令。
- 决定多次思考是并发、排队还是合并。
- 保存长期记忆或会话历史。
- 安装 ASR 模型或创建声纹文件。

## 模块边界

```text
PCM
 │
 ▼
@cieljs/hearing ASR
 │
 ├── result ────────────────┐
 └── speechend              │
          │                 │
          ▼                 │
   freeze snapshot ◄────────┤
          ▲                 │
          │                 │
Image ── sampling ── differ ┘
          │
          ▼
       compose()
          │
          ▼
     AgentMessage[]
```

`@cieljs/perception` 直接依赖 `@cieljs/hearing`，不再额外拆出 ASR adapter 包。

`compose()` 的公开返回类型使用 `@earendil-works/pi-agent-core` 的 `AgentMessage[]`，因此 `@earendil-works/pi-agent-core` 也是正式依赖，不能只放在 `devDependencies`。图片处理继续使用 `sharp`。第一版的运行时依赖关系为：

```text
@cieljs/perception
├── @cieljs/hearing
├── @earendil-works/pi-agent-core
└── sharp
```

`ASR` 实例通过 `perception.asr` 暴露。宿主可以直接写入音频、订阅底层 ASR 事件或主动 `flush()`；资源释放统一通过 `perception.close()` 完成，确保感知包可以等待剩余语音段、图片任务和上层事件发布结束。

## 创建感知实例

```ts
import { createPerception } from '@cieljs/perception';

const perception = createPerception({
  asr: {
    speaker: [
      {
        name: '主播',
        file: './voiceprints/streamer.voiceprint',
      },
    ],
    speakerThreshold: 0.6,
    maxSpeakers: 8,
    bufferSeconds: 30,
  },

  vision: {
    sampleIntervalMs: 5_000,
    differenceThreshold: 0.03,
    maxFrames: 9,
  },

  retentionMs: 60_000,
});
```

纯语音场景不传 `vision`，或显式传入 `false`：

```ts
const perception = createPerception({
  asr: {
    speaker: [
      {
        name: 'alice',
        file: './voiceprints/alice.voiceprint',
      },
    ],
  },

  vision: false,
});
```

## 公共类型

### 初始化配置

```ts
import type { ASROptions } from '@cieljs/hearing';

export interface PerceptionOptions {
  /**
   * 直接传给 @cieljs/hearing。
   * 包括 VAD 缓冲、已知说话人声纹和匿名说话人聚类配置。
   */
  readonly asr?: ASROptions;

  /**
   * 不传或传入 false 时完全关闭图片处理。
   */
  readonly vision?: false | VisionOptions;

  /**
   * 为对应模态的感知数据生成附加上下文。
   * 同一实例产生的所有快照共享该函数。
   */
  readonly context?: PerceptionContext;

  /**
   * 内部最多保留多长时间的感知数据。
   *
   * @default 60_000
   */
  readonly retentionMs?: number;
}

export type PerceptionContext = (
  input: PerceptionContextInput,
) => string | undefined | Promise<string | undefined>;

export type PerceptionContextInput =
  | {
      readonly modality: 'vision';
      readonly snapshotId: string;
      readonly startAt: Date;
      readonly endAt: Date;
      readonly frames: readonly PerceptionFrame[];
      readonly sources: readonly string[];
    }
  | {
      readonly modality: 'hearing';
      readonly snapshotId: string;
      readonly startAt: Date;
      readonly endAt: Date;
      readonly transcripts: readonly ASRResult[];
    };

export interface VisionOptions {
  /**
   * 同一图片来源两次候选采样之间的最小间隔。
   *
   * @default 6_666
   */
  readonly sampleIntervalMs?: number;

  /**
   * 相对上一张已保留画面的平均像素变化阈值，范围为 0-1。
   *
   * @default 0.03
   */
  readonly differenceThreshold?: number;

  /**
   * 每个图片来源合成时最多选择的画面数量，范围为 1-9。
   *
   * @default 9
   */
  readonly maxFrames?: number;
}
```

`ASROptions` 保持 `@cieljs/hearing` 的原始契约：

```ts
export interface ASROptions {
  readonly speaker?: readonly SpeakerProfile[];
  readonly bufferSeconds?: number;
  readonly speakerThreshold?: number;
  readonly maxSpeakers?: number;
}

export interface SpeakerProfile {
  readonly name: string;
  readonly file: string;
}
```

感知包应重新导出外部常用的听觉类型，调用方不需要为了配置感知实例再增加一组 type-only import：

```ts
export type { ASROptions, ASRResult, SpeakerProfile } from '@cieljs/hearing';
```

第一版只支持在创建实例时传入说话人配置。`@cieljs/hearing` 当前没有运行时注册声纹的能力，因此感知包不额外虚构 `registerSpeaker()`。

### 图片输入

```ts
export interface ImageInput {
  /**
   * Sharp 可以读取的图片字节。
   */
  readonly data: Buffer;

  readonly at: Date;

  /**
   * 用于区分直播画面、摄像头等图片来源。
   *
   * @default "default"
   */
  readonly source?: string;
}

export interface ImageStream {
  write(input: ImageInput): Promise<void>;
}
```

不同 `source` 独立维护：

- 上一次采样时间。
- 上一张已保留画面的差异基准。
- 快照中的候选画面集合。
- 最终生成的多帧合成图。

### 快照

```ts
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ASRResult } from '@cieljs/hearing';

export interface SnapshotOptions {
  readonly startAt?: Date;
  readonly endAt?: Date;
}

export interface PerceptionSnapshot {
  readonly id: string;
  readonly startAt: Date;
  readonly endAt: Date;

  readonly transcripts: readonly ASRResult[];
  readonly frames: readonly PerceptionFrame[];

  compose(): Promise<AgentMessage[]>;
}

export interface PerceptionFrame {
  readonly source: string;
  readonly at: Date;
  readonly data: Buffer;
  readonly mimeType: string;
}
```

快照的稳定性语义是：

- 创建后不再加入新的 transcript 或 frame。
- 后续音频和图片写入不会改变已经创建的快照。
- `speechend` 快照的 `endAt` 严格等于该次语音结束时间。
- 快照仅包含 `endAt` 之前、仍在保留窗口内的数据。
- 创建语音结束快照前，需要等待该边界之前已经接收的图片处理任务完成。

这里的“冻结”表示快照持有独立、稳定的数据集合。公开二进制数据仍遵循 JavaScript `Buffer` 的可变语义，调用方不应修改 `frames[].data`。

### Agent 输入

`compose()` 直接返回 `AgentMessage[]`，调用方不需要再把文本和图片转换成 Pi Agent 消息：

```ts
const messages = await snapshot.compose();

await agent.prompt(messages);
```

第一版至多生成一条 `user` message，不生成 `assistant` 或 `toolResult` message。消息先放视觉内容，再放听觉内容：

```ts
const messages: AgentMessage[] = [
  {
    role: 'user',
    content: [
      {
        type: 'text',
        text: ['# 视觉', visionContext].filter(Boolean).join('\n\n'),
      },
      {
        type: 'image',
        data: composedImageBase64,
        mimeType: 'image/jpeg',
      },
      // 可能继续包含其他合成图片
      {
        type: 'text',
        text: ['# 听觉', hearingContext, transcript].filter(Boolean).join('\n\n'),
      },
    ],
    timestamp: snapshot.endAt.getTime(),
  },
];
```

图片 `data` 使用 Pi Agent 要求的 base64 字符串。`timestamp` 使用快照的 `endAt`，使消息时间与触发本轮思考的语音结束边界一致。

模型看到的内容顺序等价于：

```text
# 视觉

{visionContext}

{image content}

{image content ...}

# 听觉

{hearingContext}

[2026-09-05T12:00:01.000Z][speaker_1] xxxxx
[2026-09-05T12:00:04.000Z][主播] xxxxx
```

视觉图片是独立的 `image` content。上面的 `{image content}` 只表示它在消息中的位置，不会真的生成这段占位文字。

`compose()` 的默认行为：

1. 按转写的 `startAt` 排序。
2. 每条转写保留 ISO 时间、说话人和正文。
3. 按图片 `source` 分组。
4. 每组超过 `maxFrames` 时均匀选择画面，并始终保留时间跨度信息。
5. 每组生成一张 1920×1080 JPEG 多帧合成图。
6. 视觉有数据时调用 `context`，先加入一次 `# 视觉` 和返回文本，随后展开合成后的 image content。
7. 听觉有数据时调用 `context`，在所有视觉内容之后加入 `# 听觉`、返回文本和按时间排列的转写。
8. 每条转写使用 `[ISO time][speaker] content` 格式；没有说话人时省略第二组方括号。
9. 没有有效图片时不生成 `# 视觉`、vision text content 或 image content。
10. 没有有效转写时不生成 `# 听觉` 或 hearing text content。
11. 当转写与图片都为空时返回空数组，不依靠提示词制造空感知消息。

未配置 `context` 时，感知实例在包内使用默认视觉和听觉提示词。宿主传入 `context` 后完整覆盖默认处理；包只导出 `DEFAULT_VISION_PROMPT`、`DEFAULT_HEARING_PROMPT` 和可选的 `DEFAULT_PERCEPTION_SYSTEM_PROMPT`。`compose()` 负责把 context 返回的文本放到对应模态数据之前，不读取快照之后的新感知数据。

虽然返回值使用联合类型 `AgentMessage[]`，第一版的实际元素类型固定为 Pi Agent 的 `UserMessage`。保留 `AgentMessage[]` 作为公共返回类型，是为了让结果能够不经过转换直接传给 `agent.prompt()`，并允许未来在不修改调用方式的情况下增加其他合法上下文消息。

## 语音结束事件

```ts
import type { ASR, ASRResult } from '@cieljs/hearing';

export interface SpeechEndEvent {
  readonly at: Date;

  /**
   * 当前语音段成功识别出文本时存在。
   */
  readonly result?: ASRResult;

  /**
   * 截止本次 speechend 的冻结快照。
   */
  readonly snapshot: PerceptionSnapshot;
}

export interface PerceptionEventMap {
  speechend(event: SpeechEndEvent): void;
  error(error: Error): void;
}

export interface Perception {
  /**
   * 完整公开 @cieljs/hearing 的 ASR 实例。
   */
  readonly asr: ASR;

  /**
   * 仅启用 vision 时存在。
   */
  readonly image?: ImageStream;

  on<K extends keyof PerceptionEventMap>(event: K, callback: PerceptionEventMap[K]): () => void;

  snapshot(options?: SnapshotOptions): Promise<PerceptionSnapshot>;

  /**
   * flush ASR，等待图片处理和 speechend 发布，再释放内部资源。
   */
  close(): Promise<void>;
}

export function createPerception(options?: PerceptionOptions): Perception;
```

底层 `ASR` 的 `result` 会先写入内部时间线，然后才处理对应的 `speechend`。即使当前语音段没有识别出文字，感知包仍然发布 `speechend`，并提供当时的视觉与历史听觉快照。

感知包的 `speechend` 和底层 `perception.asr.on("speechend")` 含义不同：

- 底层事件只表示 VAD 检测到语音结束，参数为结束时间。
- 感知包事件表示对应快照已经准备完成，参数包含 `result` 与 `snapshot`。

多个语音结束事件必须保持原始发生顺序。事件监听器本身不由感知包等待，避免 Agent 推理阻塞后续音频摄取；宿主负责管理思考队列。

## 完整使用示例

```ts
import { createPerception } from '@cieljs/perception';

const perception = createPerception({
  asr: {
    speaker: [
      {
        name: '主播',
        file: './voiceprints/streamer.voiceprint',
      },
    ],
  },

  vision: {
    sampleIntervalMs: 5_000,
    maxFrames: 9,
  },
});

let thinkingQueue = Promise.resolve();

const unsubscribe = perception.on('speechend', ({ snapshot }) => {
  thinkingQueue = thinkingQueue.then(async () => {
    const messages = await snapshot.compose();

    await agent.prompt(messages);
  });
});

perception.asr.write({
  data: pcm16le,
  startAt: new Date(),
});

await perception.image?.write({
  source: 'livestream',
  data: image,
  at: new Date(),
});

unsubscribe();

await perception.close();
await thinkingQueue;
```

示例使用 Promise 队列，是因为需求要求每次 `speechend` 都触发一次 Agent 思考。感知包不会擅自合并或丢弃事件。如果宿主以后需要“只保留最新一次尚未开始的思考”，应当在 Agent 调度层增加合并策略，而不是改变感知快照行为。

## 错误与关闭语义

- `perception.asr.write()` 延续 `@cieljs/hearing` 的错误模型。
- 图片解码、差异检测或合成失败时，相关 Promise 应当 reject。
- 异步感知错误同时通过 `perception.on("error")` 通知。
- 错误不能被静默吞掉，也不能导致之后的图片任务永久停止。
- `close()` 必须停止接收新输入。
- `close()` 会调用 ASR `flush()`，因此关闭时可能产生最后一个 `speechend`。
- `close()` 在所有已接收输入、语音结束快照和内部任务完成后 resolve。
- 宿主 Agent 的思考任务不属于 `close()` 的等待范围。

## 内部责任划分

第一版建议保持以下最小结构：

```text
packages/perception/
  docs/
    api-design.md
  src/
    index.ts
    perception.ts
    snapshot.ts
    types.ts
    vision/
      composer.ts
      differ.ts
      stream.ts
```

各模块职责：

- `perception.ts`：组合 ASR、时间线、事件顺序和关闭流程。
- `snapshot.ts`：选择时间范围、冻结数据并生成 Agent 输入。
- `vision/stream.ts`：按来源串行处理图片、执行采样与变化过滤。
- `vision/differ.ts`：计算候选帧与上一张已保留帧的变化比例。
- `vision/composer.ts`：选择最多九帧并生成多帧 JPEG。
- `types.ts`：只放公共契约和确实跨内部模块共享的类型。

第一版不单独引入 Timeline、Cursor、Store、Adapter 或 Plugin 抽象。内部数组与按来源维护的状态已经足以完成当前需求；只有出现多个独立消费者或成功提交游标的真实需求后，再增加 consumer/cursor API。

## 需要保持的约束

- 音频输入固定为 16 kHz、单声道、signed 16-bit little-endian PCM。
- ASR、VAD、说话人识别能力来自 `@cieljs/hearing`。
- 已知说话人通过 `ASROptions.speaker` 从外部传入。
- 未知说话人的稳定标识继续由 `@cieljs/hearing` 管理。
- 视觉差异应与上一张已保留帧比较，而不是上一张收到的帧。
- 视觉采样和变化基准按 `source` 隔离。
- 每次 `speechend` 都产生事件，包括没有识别结果的语音段。
- 快照必须先冻结，再交给异步 Agent 流程。
- 感知包不决定 Agent 调度策略。
- Agent 提示词不混入底层感知数据。
