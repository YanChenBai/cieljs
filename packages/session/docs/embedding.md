# 配置向量检索

向量检索用于按语义查找历史消息，与全文和模糊检索结果融合。未配置向量模型时，其他检索方式仍可使用。

## 第一步：准备模型

准备 Embedding 服务的模型标识、输出维数和批量调用函数。模型标识应能区分服务商与版本；即使维数相同，不同模型生成的向量也不能混用。

`EmbeddingProvider` 的批量入口是 `embedBatch(texts, options)`。索引传入多条文档；查询使用可选的单文本入口 `embed(text, options)`，未提供时由 agent kit 自动调用单元素 `embedBatch`。

| 配置         | 说明                         | 默认值 |
| ------------ | ---------------------------- | ------ |
| `model`      | 向量空间的唯一标识           | 必填   |
| `dimensions` | 输出维数，1 到 16,000 的整数 | 必填   |
| `batchSize`  | 单次索引请求的最大文本数     | 32     |
| `embed`      | 单文本向量接口               | 可选   |
| `embedBatch` | 返回与输入顺序一致的向量数组 | 必填   |

## 第二步：接入服务

将你使用的 SDK 或本地模型封装成批量函数。下面的工厂直接接收已配置好模型、地址和凭据的调用函数：

```ts
import type { EmbeddingOptions, EmbeddingProvider } from '@cieljs/model-kit';

type GenerateEmbeddings = (texts: string[], options: EmbeddingOptions) => Promise<number[][]>;

export function createEmbeddingProvider(
  model: string,
  dimensions: number,
  generateEmbeddings: GenerateEmbeddings,
): EmbeddingProvider {
  return {
    model,
    dimensions,
    batchSize: 32,
    embedBatch: generateEmbeddings,
  };
}
```

`options.purpose` 为 `document` 或 `query`。若模型要求不同的任务类型或文本前缀，在调用函数中完成映射。查询会传递 `signal`，调用函数应把它转交给 SDK 或 `fetch`。

如果服务返回结果含有输入索引，适配层应先按该索引还原顺序。返回数量必须与输入数量一致；每个向量必须匹配配置维数、仅包含有限数值且不能为零向量。

## 第三步：启用与验证

下面的函数接收第二步创建的 Provider，写入消息并验证检索：

```ts
import type { EmbeddingProvider } from '@cieljs/model-kit';
import { SessionManager } from '@cieljs/session';

export async function verifyEmbedding(embedding: EmbeddingProvider) {
  const manager = await SessionManager.open({
    dataDir: '.ciel/sessions',
    embedding,
    onIndexError: error => console.error('向量索引失败', error),
  });

  try {
    const session = await manager.space('blive:room:21452505').session();
    await session.appendMessage({
      role: 'user',
      content: '本次决定采用本地数据库保存会话。',
      timestamp: Date.now(),
    });
    await manager.flushIndexes();
    return await session.search('会话保存在哪里', { mode: 'vector' });
  } finally {
    await manager.close();
  }
}
```

索引在消息写入后排队执行。需要立即检索刚写入的内容时，先等待 `flushIndexes()`。向量存储按模型和维数隔离，查询不会比较不同维数的向量。

## 第四步：排查与维护

- **查询没有命中**：检查索引是否完成、模型标识和维数是否正确，以及 `minVectorSimilarity` 是否过高。默认阈值为 0.35。
- **向量服务暂时不可用**：消息仍会保存。混合 `search()` 报告向量错误后继续全文和模糊检索；显式 `{ mode: "vector" }` 会把查询错误交给调用方。
- **更换模型或 tokenizer**：使用新配置打开存储后，调用 `session.rebuildIndexes()`；需要重建所有会话时调用 `manager.rebuildIndexes()`。失败任务也可以通过 `manager.retryIndexes()` 重试。
- **需要重建全部检索投影**：调用 `session.rebuildIndex()`，重建该会话的文本与向量索引。
- **数据量较大**：当前使用模型/维数索引筛选和精确余弦计算，没有 HNSW 近似索引。性能需要按数据规模评估。

历史数据库会在打开时自动迁移，已有向量会保留并回填维数。索引属于派生数据，失败不会撤销会话消息；未配置 `onIndexError` 时打印中文警告。
