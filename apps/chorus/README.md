<h1 align="center">@cieljs/chorus</h1>

<p align="center">多人语音聊天参与者：持续感知、择机思考、通过 TTS 发言并播放的纯 Node.js 应用。</p>

`@cieljs/chorus` 把 `@cieljs/perception` 产生的多人语音感知快照交给 `@cieljs/core` 管理的 Ciel Session，让 Agent 作为群聊成员判断何时发言，并通过小米 MiMo TTS 与指定输出设备说出回复。详细设计见 [docs/design.md](./docs/design.md)。

## 定位

- 不是浏览器或桌面 UI，也不是每次检测到语音都必须回答的问答机器人。
- 任意时刻最多执行一次 Agent 思考；`speechend` 是唯一的自动思考触发器。
- Agent 通过一个带门控的 `speak` 工具决定“是否说”和“说什么”；“是否仍适合说”由实时调度状态决定。
- 第一版只处理本机音频输入和输出，聊天平台接入以后作为外层 transport 添加。

## 安装

```bash
vp install
```

音频层使用 [decibri](https://decibri.com)（Rust 核心 + cpal，预编译二进制），**无需 MSVC、node-gyp 或系统音频库**，安装即用。decibri 内置 AEC（回声消除）和可选的 VAD/降噪/AGC，本应用只启用 AEC 处理自身扬声器回采，VAD 仍由 `@cieljs/hearing` 负责。

## 基本使用

```ts
import { createChorus, defaultChorusConfig, resolveChorusModel } from '@cieljs/chorus';

const chorus = createChorus({
  config: defaultChorusConfig,
  model: resolveChorusModel(),
});

chorus.onEvent(event => console.log(event));

await chorus.start();

process.on('SIGINT', async () => {
  await chorus.close();
});
```

`model` 由 `resolveChorusModel()` 从 `@cieljs/core` 的模型 registry 解析 Xiaomi `mimo-v2.5`；Agent 模型与 MiMo TTS 都读取 `XIAOMI_API_KEY`。

## 启动与设备

```bash
cd apps/chorus

vp run list-devices   # 列出输入/输出设备（index、稳定 id、声道数、采样率）
vp run start          # 启动（读取 chorus.config.ts 与 XIAOMI_API_KEY）
```

## 配置

使用类型化的 `chorus.config.ts`：

```ts
import { defineChorusConfig } from '@cieljs/chorus';

export default defineChorusConfig({
  embedding: {
    cacheDir: '.cache',
  },
  mcp: {
    enabled: true,
  },
  audio: {
    input: { sampleRate: 48_000, channels: 1 },
    output: {},
  },
  conversation: {
    spaceId: 'voice-chat',
    sessionId: 'local-group',
    sources: ['voice-chat:local-group'],
    minimumThinkIntervalMs: 2_000,
  },
  perception: {
    asr: { speaker: [], speakerThreshold: 0.6, maxSpeakers: 8 },
    retentionMs: 60_000,
  },
  tts: {
    provider: 'xiaomi',
    model: 'mimo-v2.5-tts',
    voice: '冰糖',
    format: 'wav',
    instructions: '自然、轻松，像正在和熟人聊天；语速适中。',
  },
});
```

`embedding.cacheDir` 指定本地 Qwen Embedding 模型缓存目录。默认 `.cache` 相对于 Chorus 的启动目录。

`mcp.enabled` 控制是否启用 MCP。启用后由 Core 在 `start()` 时读取 `.ciel/mcp.json`、创建 MCP，并在 `close()` 时统一释放；Chorus 不直接管理 MCP 生命周期。

`audio.input.device` 与 `audio.output.device` 省略时使用系统默认设备，也可以设置为：

- 数值 `index`（来自 `list-devices`）
- 名称子串（大小写不敏感，如 `"USB"`）
- `{ id: "wasapi:{...}" }` 稳定 per-host ID（跨设备枚举、重启有效）

显式选择不存在时启动失败，不静默回退。

## 目录结构

```text
src/
├── index.ts                 # 公共入口
├── config.ts                # 类型化配置与校验
├── runtime.ts               # 生命周期编排
├── system-prompt.ts         # 系统提示词
├── conversation/
│   ├── scheduler.ts         # 调度状态机
│   └── speak-tool.ts        # speak 工具与发言门控
├── audio/
│   ├── types.ts             # 音频设备接口与设备选择器
│   ├── normalizer.ts        # 16 kHz / mono / s16le 归一化
│   ├── resample.ts          # 单次线性重采样（TTS → 采集率）
│   ├── input.ts             # decibri 输入 adapter（含 AEC）
│   ├── output.ts            # decibri 输出 adapter（含 AEC 参考注入）
│   └── wav.ts               # WAV 解析与校验
└── tts/
    ├── types.ts             # 通用 TTS 契约
    └── xiaomi.ts            # 小米 MiMo TTS adapter
```

`audio/input.ts` 和 `audio/output.ts` 是唯一接触 `decibri` 的模块，其余业务只依赖本文定义的接口，方便用内存 fake 完成确定性测试。

## 开发

```bash
vp check
vp test --run
vp run build
```

## 尚未验证的决策

进入实机联调前仍需真实环境确认：

1. decibri AEC（`'tau'`）在实际全双工设备上的回声消除效果；文本近似过滤仍作为兜底保留。
2. `@cieljs/core` 的 Xiaomi 模型 registry 是否作为公共 API 导出（当前已通过 `models` 导出）。
3. MiMo 预置音色最终使用哪一个 voice ID；默认暂定为 `冰糖`。
