# 配置会话压缩

会话历史接近对话模型的上下文上限时，可以用累计摘要替换较早的上下文。原始消息仍保存在数据库中，搜索与历史读取不受影响。

## 第一步：设置 token 预算

压缩判断参考当前仓库安装的 Pi 0.84.4：

```text
contextTokens > contextWindow - reserveTokens
```

| 参数                 | 说明                                 | 默认值 |
| -------------------- | ------------------------------------ | ------ |
| `contextWindow`      | 对话模型的上下文窗口，单位为 token   | 必填   |
| `reserveTokens`      | 为后续生成预留的 token，必须小于窗口 | 16,384 |
| `keepRecentMessages` | 至少保留的最近原始消息条数           | 10     |
| `force`              | 跳过 token 阈值检查，仍保留完整轮次  | false  |
| `signal`             | 取消或超时信号                       | 可选   |

例如窗口为 128,000、预留 16,384 时，超过 111,616 tokens 才触发，恰好等于阈值不触发。窗口属于**对话模型**，可以与摘要模型不同。较小窗口需要显式减小预留值。

### token 如何计算？

1. 从后向前找到最近一条有效 assistant usage，跳过错误、取消和全零用量。
2. 优先读取 `usage.totalTokens`；总量为零时使用 `input + output + cacheRead + cacheWrite`。
3. 只估算该消息之后新增的内容，再加到 usage 上。有效 usage 已覆盖的历史和摘要不会重复累计。
4. 没有有效 usage 时，估算最新摘要和全部未压缩消息。文本按每条消息的字符数除以 4 向上取整；thinking、工具名与 JSON 参数也计入；每张图片按 1,200 tokens 计入。

这与 Pi 一样，是“真实 usage + 尾部估算”，不是精确 tokenizer。字符估算在中文等内容上可能偏低；没有 usage 时也不包含存储层无法得知的系统提示和工具定义开销，应留出合适余量。

压缩后，保留消息中的 usage 可能仍反映压缩前的大上下文。Session 根据数据库写入时间排除这些旧 usage，先估算新摘要与保留消息，等压缩后产生新的有效 assistant usage 再使用真实用量。

## 第二步：配置摘要模型

摘要函数由调用方直接实现。服务地址、鉴权、模型、消息序列化和输出上限都由外部管理，Session 不调用模型，也不自动注入提示词。

包导出 `DEFAULT_SESSION_SUMMARY_SYSTEM_PROMPT` 作为可选默认值。是否使用它由调用方决定：

```ts
import { DEFAULT_SESSION_SUMMARY_SYSTEM_PROMPT, type SessionSummarizer } from '@cieljs/session';
import { createModels } from '@earendil-works/pi-ai';
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';

const models = createModels();
for (const provider of builtinProviders()) models.setProvider(provider);

const model = models.getModel(
  process.env.SESSION_COMPACTION_PROVIDER!,
  process.env.SESSION_COMPACTION_MODEL!,
);
if (!model) throw new Error('未找到会话压缩模型');
const summaryModel = model;

const summarize: SessionSummarizer = async ({ summary, messages, signal }) => {
  const response = await models.completeSimple(
    summaryModel,
    {
      systemPrompt: DEFAULT_SESSION_SUMMARY_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: JSON.stringify({ summary, messages }),
          timestamp: Date.now(),
        },
      ],
    },
    { maxTokens: 2048, signal },
  );

  // 不使用失败或被截断的摘要替换历史。
  if (response.stopReason !== 'stop') {
    throw new Error(response.errorMessage ?? `摘要未完整生成：${response.stopReason}`);
  }

  return response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');
};
```

`SessionSummarizer` 会收到原始 `AgentMessage[]`。对 thinking、图片和工具结果的取舍属于外部模型适配器；上面的直接 JSON 序列化只是最小示例。输出 token 上限属于摘要请求预算，不等同于前面的 `reserveTokens`。

## 第三步：检查并执行压缩

在完整消息写入后调用。可以在开始下一个用户请求前，或一组工具结果写入完成、准备请求模型之前检查。SessionManager 不自行监听 Agent 事件；上层负责调用以及更新实际传给模型的上下文。

接着上面的 `summarize` 示例：

```ts
import { Storage } from '@cieljs/storage';
import { SessionManager, sessionStorage } from '@cieljs/session';

await using storage = await Storage.open({
  dataDir: '.ciel/storage',
  modules: [sessionStorage],
});
const manager = await SessionManager.open({ storage, namespace: 'session' });
try {
  const session = await manager.space('blive:room:21452505').session({
    id: 'conversation-1',
  });
  const result = await session.compact({
    summarize,
    contextWindow: 128_000,
    reserveTokens: 16_384,
    keepRecentMessages: 10,
    signal: AbortSignal.timeout(60_000),
  });

  if (result) {
    const context = await session.context();
    // 下一次模型请求使用最新 summary 和 messages。
    console.log(context);
  }
} finally {
  await manager.close();
}
```

返回 `null` 表示未超出预算或没有可以安全压缩的旧轮次。保留边界向前对齐到用户消息，避免拆开工具调用与结果，所以实际保留条数可能超过配置。单个超长轮次不会被截断，压缩也不保证结果一定低于预算。

### 递归摘要

```text
旧消息 A                  → 摘要 S1
S1 + 新增旧消息 B         → 摘要 S2
S2 + 新增旧消息 C         → 摘要 S3
当前上下文                = S3 + 最近保留的原文
```

每次只读取尚未被摘要覆盖的旧消息，并把上一份摘要传给模型。数据库保留历史摘要以便检查，`session.context()` 始终只包含最新摘要对应的历史消息。

## 第四步：验证与排查

- **一直没有触发**：检查 `contextWindow`、`reserveTokens` 和有效 usage；也可能全部消息都处于保留范围或同一轮次。
- **压缩后仍接近上限**：检查摘要长度和保留消息大小，调整摘要输出上限或保留条数。上层应重新评估实际请求的预算。
- **摘要模型报上下文过长**：摘要模型自身也需要容纳旧摘要和本次待压缩消息，主对话的预算并不保证摘要模型能接收相同内容。
- **生成失败、空摘要或取消**：本次不会推进压缩边界，调用方收到错误，可以重试；原始历史仍完整。
- **同会话并发调用**：同一 SessionManager 内会串行处理；写入前还会检查摘要边界，拒绝覆盖生成期间被外部更新的摘要。

## 实现参考

计量与阈值参考 Pi 0.84.4 的 `estimateContextTokens`、`estimateAgentMessageTokens` 和 `shouldCompact`，可在已安装包的 `dist/core/compaction/compaction.js` 与 `docs/compaction.md` 中核对。本包按使用需求保留最近 N 条消息，不使用 Pi 的近期 token 保留预算。
