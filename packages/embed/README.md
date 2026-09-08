<h1 align="center">@cieljs/embed</h1>

<p align="center">在 Node.js 中运行 Qwen3 Embedding，为检索查询与文档生成本地向量。</p>

`@cieljs/embed` 基于 Transformers.js 加载
`onnx-community/Qwen3-Embedding-0.6B-ONNX`，并实现
`@cieljs/model-kit` 的 `ResolvedEmbeddingProvider` 契约。模型按需加载，同一个
Provider 会复用已经创建的推理管线。模型文件默认从 ModelScope 的同名仓库下载，
沿用原有本地缓存；下载失败后，下次调用会重新尝试加载。

## 基本使用

```ts
import { qwen } from '@cieljs/embed';

const embedding = qwen();

const query = await embedding.embed('怎么保存长期记忆？', {
  purpose: 'query',
});

const documents = await embedding.embedBatch(
  ['长期记忆按空间隔离。', '会话历史保存在本地数据库中。'],
  { purpose: 'document' },
);
```

查询文本会自动加入检索任务说明，文档文本保持原样。输出使用 last-token pooling
并进行归一化，可以直接交给 `@cieljs/memory` 或 `@cieljs/session`。

## 配置

```ts
const embedding = qwen({
  cacheDir: '.cache',
  dimensions: 512,
  batchSize: 16,
  dtype: 'q8',
  device: 'wasm',
  instruction: '根据查询找出相关文档。',
});
```

| 选项          | 默认值   | 说明                                            |
| ------------- | -------- | ----------------------------------------------- |
| `cacheDir`    | `.cache` | Transformers.js 模型缓存目录                    |
| `dimensions`  | `1024`   | 输出维数，支持 1 到 1024 维的 MRL 截断          |
| `batchSize`   | `32`     | 单次推理允许的最大文本数量                      |
| `dtype`       | `"q8"`   | ONNX 权重精度，可选 `fp32`、`fp16` 或 `q8`      |
| `device`      | 自动     | Transformers.js 推理设备，可选 `wasm`、`webgpu` |
| `instruction` | 内置     | 仅用于 `purpose: "query"` 的检索任务说明        |

截断后的向量会再次归一化。`AbortSignal` 会在加载模型前后及推理完成后被检查；模型加载
已经开始时不会强制中断底层推理。

## 开发

在本包目录运行：

```bash
vp check
vp test
vp run build
```

单元测试使用推理管线替身，不会下载模型。
