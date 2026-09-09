# @cieljs/model-kit

不依赖 Agent、存储或具体推理运行时的模型能力契约。当前提供 Embedding 类型、默认值与向量校验；后续 TTS 等能力可在此按独立模块定义，不提前约束具体供应商。

```ts
import type { EmbeddingProvider } from '@cieljs/model-kit';
import { resolveEmbeddingProvider, assertEmbeddingVectors } from '@cieljs/model-kit';
```

`EmbeddingProvider.embedBatch` 必须保持输入顺序；`purpose` 区分查询与文档。`resolveEmbeddingProvider` 校验配置并补齐单文本接口。Qwen 推理实现仍位于 `@cieljs/embed`，资源由应用创建与释放。

迁移：将原有从 `@cieljs/agent-kit` 导入的 Embedding 类型和函数改为本包，并添加 workspace 依赖。

## 模型注册表

```ts
import { models } from '@cieljs/model-kit/models';
const model = models.getModel('xiaomi', 'mimo-v2.5');
```

注册表单独导出；只使用根入口的 embedding 契约不会初始化 providers。
