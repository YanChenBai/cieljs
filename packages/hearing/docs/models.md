# 模型配置

## 安装

```bash
vp run @cieljs/hearing#install-model
vp run @cieljs/hearing#install-model -- --force
```

安装器下载三组模型并写入 `CIEL_DATA_DIR/models/`；未配置 `CIEL_DATA_DIR` 时默认使用 `~/.ciel/models/`：

| 目录                       | 模型                                | 来源                                              |
| -------------------------- | ----------------------------------- | ------------------------------------------------- |
| `asr/qwen3-asr-1.7b-int8/` | Qwen3-ASR 1.7B INT8（含 tokenizer） | ModelScope `zengshuishui/Qwen3-ASR-onnx` 社区转换 |
| `vad/ten-vad.int8.onnx`    | TEN-VAD                             | sherpa-onnx GitHub release                        |
| `speaker/model.onnx`       | 3D-Speaker ERes2Net base            | sherpa-onnx GitHub release                        |

`--force` 会重新下载。已存在的文件默认跳过。运行时完全使用 Node，不需要 Python。

## 目录布局

模型和声纹都放在 Ciel 数据目录下：

```text
models/asr/qwen3-asr-1.7b-int8/...
models/vad/ten-vad.int8.onnx
models/speaker/model.onnx
voiceprints/...
```

`models/` 已在 `.gitignore` 中忽略，模型不随源码提交。声纹目录固定为包根目录下的 `voiceprints/`。

## 运行时配置

`createModelConfig()` 固定生成 sherpa-onnx-node 的配置：

- ASR：`maxTotalLen 512`、`maxNewTokens 256`、`temperature 1e-6`、`topP 0.8`、`seed 42`，CPU 双线程
- VAD：`threshold 0.25`、`minSpeechDuration 0.5s`、`minSilenceDuration 0.5s`、`maxSpeechDuration 10s`、窗口 256 采样
- Speaker：CPU 单线程

`ASR` 构造时自动调用 `createModelConfig()`，无需手动传入。`checkConfiguration()` 校验所有模型文件是否齐备：

```ts
import { checkConfiguration } from '@cieljs/hearing';

const check = await checkConfiguration();
// { modelsPath, missingFiles, valid }
```

## 限制

- Qwen3-ASR 模型约 2.4 GB，当前预编译 Windows Node 包使用 CPU 推理
- TEN-VAD 仅支持 16 kHz 音频
- Qwen3-ASR 结果保留 VAD 片段级起止时间，不生成词级时间戳与置信度

商用前请确认各上游模型许可证。
