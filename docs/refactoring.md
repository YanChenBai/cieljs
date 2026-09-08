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

## 文件命名与本轮细化

TypeScript 文件统一使用 kebab-case，Vue 组件保留 PascalCase.vue；composable 的导出函数仍使用 useXxx，文件名为 use-xxx.ts。apps/chorus 不在本轮范围内。

Devtools 的 router.ts 仅组装 routes 下的查询、内容读取、事件与更新订阅。host.ts 管理存储与通知，agent-trace.ts 按运行生命周期、消息、工具调用分别归并事件。trace-step.ts 分开处理分类、内容引用和展示元数据。调查工具按 memory/sessions 拆工厂；Memory 工具按 read/search/write 拆模块，入口仅装配授权工具。

## 直播下播

每次房间访问创建独立监视器，默认每 5 秒检查一次（每次查询结束后计时）。livePlayer.getPlayerInfo().liveStatus 的 0/1/2 分别是未直播/直播/轮播，轮播不视为实时直播。播放器不可用或报告离线时用 API 核实，避免页面初始化瞬间误判。FFmpeg EOF 与异常退出都触发 API 核实。

确认下播后立即禁止新弹幕、中止当前 Agent，再通过已有操作队列释放感知、媒体和 Session。跟随模式回到 idle；探索模式重新选房。媒体退出但仍在直播或无法核实时，报告媒体错误并停止当前访问。停止和切房会取消监视器；迟到结果不能关闭新房间。

## 界面组织与样式

Devtools UI 的公开入口为 `ui/index.ts`。`components` 按 content、conversation、execution 分组；`composables` 维护连接和详情加载；`directives` 存放跟随滚动；`utils` 处理内容格式与记录归并；`styles/main.css` 保持独立的包样式出口。

watch-blive 使用 Tailwind CSS 4：布局放在 SFC 工具类中，共用控件通过 `@apply` 保留语义类，Electron 拖拽区域和滚动条使用原生 CSS。迁移保留原有色值、间距、字体、折叠布局和交互状态。

登录等待每 1.5 秒检查 `BilibiliLive.UID`，只有明确的非零 UID 才请求账号 API。独立 `setTimeout` 在六分钟后结束等待，成功、取消与失败均清理计时器。登录返回账号后直接同步侧栏。进房等待播放器挂载，再执行网页全屏和 `hide-aside-area`；等待超过十五秒则报告初始化超时。注入代码集中在 `bilibili/page-scripts.ts`，页面绑定和生命周期仍由 `LivePage` 管理。
