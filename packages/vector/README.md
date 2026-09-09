# @cieljs/vector

共享向量计算、持久化缓存与业务索引任务。Provider 协议由 `@cieljs/model-kit` 定义。

```ts
import { Storage } from '@cieljs/storage';
import { VectorService, vectorStorage } from '@cieljs/vector';

await using storage = await Storage.open({ dataDir: '.ciel/storage', modules: [vectorStorage] });
await using vectors = new VectorService({
  storage,
  provider,
  providerId: 'provider/deployment',
  revision: 'model-v1',
  granularity: 'chunk',
  inputConfig: 'prefix-and-truncation-v1',
});
const result = await vectors.embed('查询文本', { purpose: 'query' });
```

缓存键包含服务商/部署身份、Provider 的模型名称、版本、输出维度、输入粒度、输入处理配置、query/document 用途与实际文本。改变影响向量输出的配置时必须更新对应字段；身份字段不包含 API key。

`vector.cache` 存一份计算结果；`vector.entries` 保存业务 namespace、chunk ID、配置标识和索引状态。跨业务复用缓存不扩大业务查询权限。Session 和 Memory 保留各自的切块、全文检索及结果聚合。

同一服务实例会合并并发请求和批内重复文本，缓存跨实例持久化。单个等待者取消不会中止其他等待者的共享计算。失败结果不进入缓存，可以重试。关闭服务等待当前计算结束，不关闭 Storage。
