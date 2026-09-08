# Core 与应用边界

## 模块职责

- core/ciel.ts：启动、会话、调查与统一关闭；storage.ts：三类存储目录的隔离规则。
- core/agents：普通会话与只读调查各自组装工具和上下文，共用 session-sources.ts 同步来源。ManagedAgent 保留上游 Agent API。
- model-kit：独立于 Agent 的模型能力契约与校验，当前包含 embedding；embed：Qwen 推理实现；agent-kit：工具定义与提示词。
- devtools/host：采集、快照与批量通知；trace-step.ts：原始事件到展示步骤的投影；router.ts：oRPC 查询与订阅。
- devtools/ui：CielDevtools 组合视图，ExecutionView 管理执行列表与分栏，useDevtools 管理连接和分页，useTraceValue 管理按需加载与取消。
- watch-blive/main/ipc.ts：Electron 连接来源校验与端口释放；router.ts：业务 RPC；runtime.ts：启动、停止、切房和资源生命周期。
- watch-blive/main/agent/ciel.ts：Ciel 配置；exploration.ts：候选查询与选房校验；decisions.ts：结构化决策解析。RoomVisit、LiveMedia 与调度器继续各自管理房间、媒体和思考节流。

## 迁移

Embedding 类型与函数从 @cieljs/agent-kit 改为 @cieljs/model-kit，仓库内消费者已迁移。TTS 等能力待具体需求明确后在独立模块定义。

Devtools 不再导出旧 request/transport 协议或专用连接工厂。应用传入 oRPC link，或直接将已有 oRPC client 的 devtools 分支传给面板。鉴权、适配器和连接生命周期由应用管理，具体示例见 packages/devtools/README.md。

## 保持的行为与修复

存储快照不随原对象修改，清空面板不会删除磁盘历史。启动失败与关闭并发时，Ciel 仍进入 closed；关闭请求一旦发起就拒绝新操作。宿主关闭结束等待中的订阅，分页与推送按 ID 和修订合并，详情只加载当前标签页并取消过期请求。

未改变普通 Session 与 Investigation 的权限边界、直播选房策略、弹幕默认模拟模式或模型配置。
