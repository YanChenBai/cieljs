# 多模型 ASR 与关键词唤醒

```ts
import { ASR_MODELS, createASR, createKWS } from '@cieljs/hearing';

console.log(Object.keys(ASR_MODELS));
await using asr = await createASR({ model: 'sensevoice-small', speaker: false });
asr.on('result', result => console.log(result));
await asr.write({ data: pcm, sampleRate: 48_000, channels: 2, startAt: new Date() });
await asr.flush();
```

支持 `qwen3-asr-1.7b-int8`（默认）和 `sensevoice-small`。`createASR` 检查并下载所选资源后初始化实例。已准备资源的同步调用方可以使用 `new ASR(options)`。

PCM 为交错 s16le；省略格式参数时为 16 kHz 单声道。重采样保留跨 chunk 状态。改变采样率或声道前先 flush。输入时间必须连续，新的不连续音频应先 flush。

调用方必须等待 `write`，尤其是 Electron 子进程和唤醒门控模式。队列满时拒绝请求，不无限缓存。`flush` 等待尾部结果；`close` 排空后释放实例，支持异步资源管理。原生 sherpa 句柄由其绑定的 GC 终结器回收；hearing 在关闭时释放持有的引用。

## SenseVoice 结果

结果继续使用 `content`，另有可选 `language`、`emotion`、`events: { type: string }[]`。标签规范化为小写，例如 `zh`、`happy`、`applause`。不生成未经模型提供的置信度或精确事件时间区间。

当前 sherpa 已从特殊 token 提取 `lang/emotion/event`，hearing 保留并规范化这些字段，不需要另加 ONNX runtime 或重写特征提取。解析器也接受原始标签文本。依据：[sherpa SenseVoice 实现](https://github.com/k2-fsa/sherpa-onnx/blob/master/sherpa-onnx/csrc/offline-recognizer-sense-voice-impl.h)。

默认使用 VAD 切分语音。要监听纯音乐、掌声等非语音声音，选择 `mode: 'events'`，按 `eventWindowSeconds`（默认 5 秒）连续识别，不经过语音门控。纯事件允许 `content` 为空。窗口边缘、静音和极短尾段仍可能产生模型误识别；事件时间是输入窗口范围，不是声音的精确边界。

## 独立 KWS 事件

```ts
await using kws = await createKWS({ keywords: ['你好小希'], cooldownMs: 1500 });
const unsubscribe = kws.on('wake', ({ keyword, at }) => {
  console.log('唤醒', keyword, at);
});
await kws.write({ data: pcm16k, startAt: new Date() });
await kws.flush();
unsubscribe();
```

`wake` 独立于 ASR 文本结果。`at` 表示输入时间基准上的关键词起点。KWS 持续监听，冷却期抑制重复事件；flush 会补尾部静音并新建检测流。

默认使用 sherpa WenetSpeech 中文 KWS 模型。中文字符串通过 pinyin-pro 转成带声调声母/韵母；多音字或特殊词可显式传 `{ text: '法国', tokens: ['f', 'ǎ', 'g', 'uó'] }`。不在词表中的 token 会在初始化前报错。默认模型不承诺任意语言的关键词识别。模型配置说明：[sherpa KWS](https://k2-fsa.github.io/sherpa/onnx/kws/pretrained_models/index.html)。

## 可选唤醒门控

```ts
await using asr = await createASR({
  model: 'sensevoice-small',
  speaker: false,
  wake: { keywords: ['你好小希'], preRollMs: 1500, maxListenMs: 15000 },
});
asr.on('wake', event => console.log(event));
asr.on('result', result => console.log(result.content));
await asr.write({ data: pcm16k, startAt: new Date() });
```

待机只运行 KWS；命中后把短音频缓存回放给 ASR，避免截掉指令开头。VAD 语音片段结束或达到最长聆听时间后返回待机。直播连续监听不设置 `wake`。

## 下载和扩展

资源放在 `CIEL_DATA_DIR/models`，默认 `~/.ciel/models`。所选模型的注册项维护资源和创建函数；共享 VAD 与 speaker 按需下载。`speaker: false` 跳过声纹模型，events 模式跳过 VAD。下载使用临时文件和重试；同进程相同目标的下载合并。

```sh
vp run --filter @cieljs/hearing install-model -- --model sensevoice-small --no-speaker
vp run --filter @cieljs/hearing install-model -- --kws
```

KWS 安装需要系统 `tar`，仅从官方归档读取固定模型成员，不把归档路径直接解包到文件系统。Electron 的 ASR 和 KWS 使用独立 Node 进程；可用 `CIEL_NODE_EXECUTABLE` 指定 Node。

新增 ASR 时在 `models/` 实现 `transcribe`，在注册表增加资源清单、`prepare` 和 `create`。模型特有推理配置和输出解析留在实现内，公共事件和 PCM 契约不依赖 sherpa 类型。
