# 配置向量检索

向量检索帮助 Agent 找到意思相近的记忆。全文和模糊检索仍然保留，三路结果一起参与排名。

## 第一步：准备模型

`EmbeddingProvider` 定义在 `@cieljs/agent-kit`。session 和 memory 都兼容并重新导出该类型，因此同一个 Provider 可以直接复用，不需要依赖或共享 Manager。

| 配置         | 说明                                 | 默认值 |
| ------------ | ------------------------------------ | ------ |
| `model`      | 区分服务商、模型版本与向量空间的标识 | 必填   |
| `dimensions` | 输出维数，1 到 16,000 的整数         | 必填   |
| `batchSize`  | 单次文档请求数量，1 到 1,000         | 32     |
| `embed`      | 单文本向量接口                       | 可选   |
| `embedBatch` | 批量生成，输出顺序与输入一致         | 必填   |

查询调用 `embed`；未提供时由 agent kit 自动调用单元素 `embedBatch`。`purpose` 为 `query` 或 `document`，供模型选择任务类型或文本前缀。索引直接使用原始分块正文，不使用中文分词后的文本。

## 第二步：接入并等待索引

```ts
import type { EmbeddingProvider } from "@cieljs/agent-kit";
import { MemoryManager } from "@cieljs/memory";

async function verifyEmbedding(embedding: EmbeddingProvider) {
  const manager = await MemoryManager.open({
    dataDir: ".ciel/memory",
    embedding,
    onIndexError: (error) => console.error("记忆索引失败", error),
  });
  const memory = manager.memory({ type: "global" });

  try {
    await memory.remember({
      layer: "long_term",
      content: "Ciel 默认用中文回答，先给结论，再解释原因。",
    });
    await manager.flushIndexes();
    return await memory.searchVector("回答问题时采用什么表达方式");
  } finally {
    await manager.close();
  }
}
```

Provider 必须返回正确数量、正确维数的有限非零向量。返回错误会记录失败状态，不会撤销已经保存的记忆。

## 第三步：理解索引时机

正文、来源、分块和当前模型的待处理任务在同一个事务中保存。`remember/update` 完成后，全文即可查询；向量在后台串行批次中生成，需要立即做向量查询时先等待 `flushIndexes()`。

正文修改会删除旧分块并生成新 ID。进行中的旧任务即使稍后完成，也无法写回已经删除的分块。归档记忆同样会移除分块及派生向量。

使用期间应复用同一个 MemoryManager；停止提交任务后调用 `close()`。它等待已经提交的操作与索引队列，不会取消正在执行的 Provider 请求。Provider 应自行设置网络超时，避免关闭时无限等待。

## 第四步：恢复与换模型

```ts
console.log(await manager.getIndexStatus());
// { pending: 0, ready: 8, failed: 1 }

await manager.retryEmbeddings();
await manager.flushIndexes();

await memory.rebuildEmbeddings();
await manager.flushIndexes();
```

上例假定 `manager` 已打开、`memory` 已绑定范围。状态按当前模型与维数统计分块数。`flushIndexes` 表示队列执行完毕，不代表所有任务成功；检查 `failed` 了解是否需要重试。

失败任务持久化保存，同一次运行不会无限自动重试。`retryEmbeddings` 补齐缺失任务并重试失败项；重新打开数据目录时也会恢复当前模型尚未完成或失败的任务。

`rebuildEmbeddings` 重新生成指定范围的当前模型向量。换模型后使用新 Provider 打开，系统会补齐新模型任务；其他模型的向量保留。不同模型即使维数相同也不会比较，不同维数之间也不会计算距离。

## 数据增长之后

当前使用精确余弦计算，没有 HNSW。先按空间、模型和维数过滤，再对匹配的分块计算相似度。后续是否引入近似索引，应依据候选数量、延迟和内存测量决定；近似索引的维数限制需要单独核对，不能直接沿用向量列的存储上限。
