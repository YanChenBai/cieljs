# @cieljs/runtime-protocol

直接基于 `@earendil-works/pi-agent-core` 的 `AgentEvent` / `AgentMessage` 定义运行记录协议。

`RuntimeRecord` 附加版本、持久化序号、Session / Run / Turn / Message / ToolCall 关联 ID 和展示元数据。工具元数据不包含 `execute`。

`RuntimeReader` 提供游标读取和唤醒订阅，`RuntimeWriter` 提供记录写入与 flush。协议不依赖 Session、Core、DevTools 或数据库，DevTools 可以独立接入 Pi Agent。
