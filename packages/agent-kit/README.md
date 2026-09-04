# @cieljs/agent-kit

Agent 公共契约与轻量工具。`@cieljs/session` 和 `@cieljs/memory` 共享这里定义的
`EmbeddingProvider`，业务层可以创建一个 Provider 并同时交给两者使用。

```ts
import type { EmbeddingProvider } from "@cieljs/agent-kit";

const embedding: EmbeddingProvider = {
  model: "provider/model-version",
  dimensions: 1_024,
  batchSize: 32,
  async embed(text, { purpose, signal }) {
    return client.embedOne({ text, purpose, signal });
  },
  async embedBatch(texts, { purpose, signal }) {
    return client.embed({ texts, purpose, signal });
  },
};
```

`embed` 是可选的；省略时 `resolveEmbeddingProvider` 会通过单元素 `embedBatch` 实现它。
`resolveEmbeddingProvider` 同时负责校验配置并填充默认批量大小；
`assertEmbeddingVectors` 用于验证不受信任的模型返回值。

## Development

- Install dependencies:

```bash
vp install
```

- Run the unit tests:

```bash
vp test
```

- Build the library:

```bash
vp pack
```
