# Watch Blive Agent 架构设计

## 1. 目标

`apps/watch-blive` 是一个使用 Electron 嵌入 Bilibili 直播、持续理解直播内容并自然发送弹幕的桌面 Agent。

第一阶段包含两种运行模式：

- **探索模式**：从指定直播分区读取真实候选，由 Agent 选择房间；观看过程中持续评分，满足宿主侧切换策略后重新探索。
- **单推模式**：从 UI 接受固定主播 UID，解析该主播当前直播间后持续观看和互动，不因评分、无聊或短时断流切换到其他主播。

本应用复用当前仓库的 `@cieljs/core`、`@cieljs/perception` 与 TypeBox。Electron 主进程负责运行时与直播 guest `WebContents`；渲染进程使用 Vue 3、Vuetify Zero 与 Tailwind CSS，并通过 `<webview>` 将 Bilibili 登录和直播页面直接嵌入应用界面。

## 2. 不在第一阶段解决的问题

- 不抽取新的通用 Bilibili SDK 或 Electron 框架包。
- 不让模型生成任意 JavaScript 并交给 Webview 执行。
- 不依赖 Webview 页面直接提供音频 PCM 或稳定截图能力。
- 不做礼物、关注、私信、舰长等具有额外成本或权限的动作。
- 不在 `@cieljs/perception` 内加入直播间、评分或 Agent 调度逻辑。
- 不以一次低分或一次 `explore` 输出直接切换房间。
- 不把旧 `C:\Users\bycrx\MyCode\ciel` 的 Core 插件或已废弃 API 原样迁入当前仓库。

## 3. 核心设计结论

### 3.1 Electron guest 页面与感知媒体分离

Vue 渲染进程中的 `<webview>` 负责 Bilibili 登录、直播展示和页面交互。它创建独立 guest renderer；渲染进程取得 guest 的 `WebContents` ID 后，通过窄 IPC 上报主进程。主进程再用 `webContents.fromId(id)` 取得 guest `WebContents`，统一执行页面 JavaScript。

Agent 感知仍使用独立 FFmpeg 链路，不依赖 guest 页面暴露稳定的音频 PCM：

```text
┌─────────────────────────────────────────────────────────────┐
│ Electron BrowserWindow / Vue renderer                       │
│                                                             │
│ 登录、选模式、填 UID/分区、状态与轨迹                       │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ <webview partition="persist:watch-blive">              │ │
│ │ Bilibili 登录与直播页面                                 │ │
│ └──────────────┬──────────────────────────────────────────┘ │
└────────────────┼────────────────────────────────────────────┘
                 │ getWebContentsId() → typed IPC
                 ▼
       ┌────────────────────┐  webContents.fromId(id)
       │ Electron main      │ ─────────────────────────┐
       │ WatchRuntime       │                          │
       └─────────┬──────────┘                          │
                 │                                     ▼
                 │                         guest WebContents
                 │                         executeJavaScript()
                 ▼
       ┌────────────────────┐
       │ RoomVisit          │
       └─────────┬──────────┘
                 ▼
       ┌────────────────────┐    ┌────────────────────┐
       │ FFmpeg PCM + JPEG  │ ──▶│ @cieljs/perception│
       └────────────────────┘    └─────────┬──────────┘
                                           ▼
                                 ┌────────────────────┐
                                 │ Ciel room session  │
                                 └────────────────────┘
```

直播 guest 和 FFmpeg 可能各自拉取一份直播流。第一阶段接受这个成本，以换取 UI 展示、登录/弹幕动作与 Agent 感知之间的稳定边界。

### 3.2 一个房间对应一个 `RoomVisit`

`RoomVisit` 聚合一次真实观看期间的资源：

- 房间元数据与进入时间。
- 房间页面的 generation。
- FFmpeg 子进程。
- `Perception` 实例。
- 当前房间的 Ciel Session `CielSession`。
- 感知事件订阅、周期观察任务和思考调度器。
- 当前访问期间的弹幕记录与评分窗口。

切换房间时先关闭旧 `RoomVisit`，再创建新访问。旧访问的异步回调必须检查 generation；关闭过程中产生的最后一次 `speechend` 不能进入新房间 Session。

这样可以从资源所有权上阻止旧音频、旧画面、旧评分和旧弹幕结果污染新房间。

### 3.3 Agent 提建议，宿主拥有动作与生命周期权限

Agent 可以：

- 在真实候选中选择直播间。
- 调用 `send_danmaku` 选择发送或暂缓。
- 输出当前房间评分、置信度和继续/探索建议。

宿主控制器必须负责：

- 验证候选房间确实来自本轮分区查询。
- 验证弹幕长度、内容、登录状态、当前房间和发送模式。
- 聚合多轮评分并决定是否切换。
- 打开、关闭和重试房间资源。
- 在单推模式中彻底忽略切换建议。

`send_danmaku` 工具内部不能停止 Ciel、关闭当前 Session 或触发房间切换。房间切换只能发生在一轮 Agent 运行完全结束后。

## 4. 模块边界

建议保持以下目录，不为单次转发再拆层：

```text
apps/watch-blive/
  docs/
    design.md
  src/
    main/
      index.ts
      runtime.ts
      config.ts
      prompts.ts
      room-score-policy.ts
      ipc.ts
      scheduling/
        thought-scheduler.ts
      bilibili/
        api.ts
        live-page.ts
        page-executor.ts
        schemas.ts
      media/
        live-media.ts
        ffmpeg.ts
      agent/
        decisions.ts
        tools.ts
    preload/
      index.ts
    renderer/
      index.html
      src/
        main.ts
        App.vue
        style.css
        components/
          AppHeader.vue
          LoginPanel.vue
          SetupView.vue
          RuntimeView.vue
          LiveRoomWebview.vue
          EventTimeline.vue
        composables/
          use-watch-blive.ts
          useLiveRoomWebview.ts
    shared/
      ipc.ts
      schemas.ts
      types.ts
```

职责如下：

| 模块                                      | 职责                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `main/runtime.ts`                         | 应用状态机、探索/单推策略、`RoomVisit` 所有权、启动和关闭            |
| `main/config.ts`                          | 解析并验证模型、数据目录、模式、主播/分区和弹幕执行配置              |
| `main/ipc.ts`                             | 注册窄 IPC、校验 sender、参数与 guest WebContents 归属               |
| `main/bilibili/api.ts`                    | 分区、候选房间、房间信息和播放地址等无 UI HTTP 查询                  |
| `main/bilibili/live-page.ts`              | 持有当前 guest WebContents、导航状态、登录检测与真实弹幕发送         |
| `main/bilibili/page-executor.ts`          | 在主进程调用 `executeJavaScript`，并用 TypeBox 校验返回值            |
| `main/media/live-media.ts`                | 获取流地址、管理 FFmpeg，并向 Perception 写 PCM/JPEG                 |
| `main/scheduling/thought-scheduler.ts`    | 单飞思考、事件合并、最小思考间隔、关闭等待                           |
| `main/agent/tools.ts`                     | `send_danmaku` 工具及其宿主侧权限检查                                |
| `main/agent/decisions.ts`                 | 探索选择、房间判断的 TypeBox Schema 与解析                           |
| `main/room-score-policy.ts`               | 纯确定性的多轮评分切换策略                                           |
| `main/prompts.ts`                         | Ciel 身份、直播互动规则、模式规则和动态房间上下文                    |
| `preload/index.ts`                        | 通过 `contextBridge` 暴露最小 `watchBlive` API                       |
| `renderer/components/LiveRoomWebview.vue` | 持有 `<webview>` DOM，并在 attach 后上报 WebContents ID              |
| `renderer/`                               | Vue 3 控制台、Vuetify Zero 交互语义与 Tailwind CSS 视觉样式          |
| `shared/`                                 | Main、Preload、Renderer 共用的 IPC 名称、TypeBox Schema 和纯数据类型 |

如果实现时 `RoomVisit` 仍然很小，应先留在 `runtime.ts`，不要仅为了目录对称创建 `room-visit.ts`。

## 5. 公共启动形状

模式使用可辨识联合，不使用多个布尔参数：

```ts
type WatchMode =
  | {
      type: 'explore';
      areaId: number;
    }
  | {
      type: 'follow';
      streamerUid: number;
    };

type DanmakuDelivery = 'simulate' | 'live';

interface WatchBliveOptions {
  dataDir?: string;
  model: Model<Api>;
}

interface StartWatchOptions {
  mode: WatchMode;
  danmakuDelivery?: DanmakuDelivery;
}

interface WatchBlive {
  readonly status: WatchStatus;
  readonly room?: RoomInfo;

  start(options: StartWatchOptions): Promise<void>;
  stop(): Promise<void>;
  login(): Promise<Account>;
  logout(): Promise<void>;
  areas(): Promise<readonly LiveArea[]>;
  close(): Promise<void>;
  onEvent(listener: (event: WatchEvent) => void): () => void;
}

function createWatchBlive(options: WatchBliveOptions): WatchBlive;
```

约束：

- `danmakuDelivery` 默认是 `simulate`。启用 `live` 必须是显式配置。
- `follow` 必须有正整数 `streamerUid`；宿主使用 UID 查询该主播当前真实直播间，UI 不要求用户理解短房间号与真实房间号的差异。
- `explore` 必须有正整数 `areaId`。
- 启动时不静默降级模型、登录或媒体错误。
- `start()` 接受来自 Vue UI 的本次观看配置；`stop()` 回到可重新选择模式的待机状态。
- `close()` 幂等；开始关闭后不能重新启动同一个实例。

## 6. Electron `<webview>` 与页面执行边界

### 6.1 BrowserWindow 与 guest 安全配置

应用只创建一个 Electron `BrowserWindow`。本地 Vue renderer 和远程 Bilibili guest 运行在不同 renderer 进程中：

```ts
new BrowserWindow({
  webPreferences: {
    preload,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
    webviewTag: true,
  },
});
```

本地 preload 使用 `index.mjs`（ESM），因此宿主配置 `sandbox: false`；保留上下文隔离和禁用 Node 集成。远程 guest 仍强制启用沙箱。

Vue 模板中嵌入一个持久化 guest：

```vue
<webview ref="liveRoom" class="h-full w-full" partition="persist:watch-blive" src="about:blank" />
```

约束：

- `<webview>` 不设置 `allowpopups`、`preload`、`nodeIntegration` 或 `disablewebsecurity`。
- 使用固定 `persist:watch-blive` partition 保存登录 Cookie；partition 在首次导航后不再修改。
- 主进程监听宿主 renderer 的 `will-attach-webview`，强制 `nodeIntegration=false`、`contextIsolation=true`、`sandbox=true`，删除未知 preload，并验证初始 URL。
- guest 的 `setWindowOpenHandler` 默认拒绝新窗口。
- 主进程为 guest session 设置权限请求处理器，只允许直播实际需要且已经确认的权限。
- 只允许 HTTPS 的 Bilibili 登录、主页与直播域名导航；其他 URL 默认拒绝。
- Electron 官方不推荐将 `<webview>` 作为通用网页嵌入方案，但本应用明确需要 DOM 内嵌和 guest WebContents ID，因此接受其稳定性风险，并用集成测试锁定当前 Electron 版本行为。

### 6.2 WebContents ID 交接

`LiveRoomWebview.vue` 保持 `<webview>` 持续挂载。setup/running 切换使用布局或 `v-show`，不能用 `v-if` 反复销毁 guest，否则 WebContents ID、登录页面和事件订阅都会变化。

guest 触发 `did-attach` 后，渲染进程只读取并上报 ID：

```ts
const webview = document.querySelector('webview')!;
const id = webview.getWebContentsId();

await window.watchBlive.attachLiveWebContents({ id });
```

Preload 只把这个动作映射为固定 IPC。主进程收到后必须同时验证：

1. IPC sender 是应用主窗口的本地 renderer。
2. `id` 通过 TypeBox 正整数 Schema。
3. `webContents.fromId(id)` 返回仍然存活的 guest。
4. `contents.hostWebContents === event.sender`，证明该 guest 确实属于当前主窗口。
5. guest 当前 URL 是 `about:blank` 或允许的 Bilibili HTTPS URL。

通过后由 `LivePage` 持有 `WebContents` 引用和当前 generation。guest `destroyed`、`render-process-gone` 或被重新 attach 时，旧引用立即失效。

渲染进程不得调用 `<webview>.executeJavaScript()`；页面执行能力只存在于主进程。

### 6.3 类型安全页面执行器

页面执行器改为直接接受 Electron guest `WebContents`：

```ts
interface ExecutePageOptions {
  timeoutMs?: number;
  generation?: number;
}

function executePage<T extends TSchema>(
  contents: WebContents,
  code: string,
  schema: T,
  options?: ExecutePageOptions,
): Promise<Static<T>>;
```

`code` 的契约是一个 JavaScript 表达式。内部统一包裹异步立即执行函数，并调用：

```ts
const source = `(async () => await (${code}))()`;

const value = await contents.executeJavaScript(source);
return Value.Parse(schema, value);
```

例如读取标题最终由主进程执行：

```ts
const title = await contents.executeJavaScript('document.title');
```

Electron 的 `executeJavaScript()` 本身返回 Promise，并会等待页面脚本返回的 Promise；不再需要 callback、JSON envelope 或二次 JSON 解码。

需要多条语句时，由固定页面脚本自身提供内部 IIFE 并显式 `return`；执行器不猜测一段字符串是表达式还是函数体。

执行器仍须保证：

- `code` 只来自仓库内固定脚本，不接受 Agent 输出。
- 动态值先 `JSON.stringify`，禁止直接插入 JavaScript 字符串。
- 执行前后都检查当前 guest、generation、销毁状态与允许的 URL。
- 使用 timeout 和调用方 `AbortSignal` 放弃过期结果；底层执行无法取消时，晚到结果不得提交业务状态。
- 页面异常、navigation、destroyed、timeout 和 TypeBox 校验失败均 reject，并携带动作名、room ID 和 generation 上下文。
- Bilibili 的 `window.livePlayer` 位于页面 main world，因此这里有意使用 `executeJavaScript()`，不改成看不到页面全局对象的 isolated world。

### 6.4 页面脚本能力

首版只提供少量固定能力：

```ts
interface LivePage {
  open(roomId: number): Promise<void>;
  account(): Promise<Account | undefined>;
  readiness(): Promise<LivePageReadiness>;
  sendDanmaku(content: string): Promise<DanmakuPageResult>;
  close(): Promise<void>;
}
```

`sendDanmaku` 的页面脚本应：

1. 确认当前 URL 对应目标房间。
2. 确认 `window.livePlayer?.sendDanmaku` 存在。
3. 调用页面播放器的真实发送方法。
4. 将 `undefined` 视为可能的成功返回；只有抛错或明确的非零错误码表示失败。
5. 返回可被 TypeBox 校验的稳定结果，不把页面内部任意对象直接穿透到 Node。

发送前后的权威事实仍由工具层记录。`simulate` 模式不能执行页面脚本，也不能写入“已真实发送”历史。

### 6.5 Vue 控制台与直播嵌入

Vue UI 同时承载应用控制面和 `<webview>` 直播画面，但不接触 Ciel、FFmpeg、Cookie、Node API 或 guest `WebContents` 对象。渲染进程唯一持有的是无特权的 `<webview>` DOM 元素。

技术约束：

- Vue 3 Composition API，所有 SFC 使用 `<script setup lang="ts">`。
- Vuetify Zero 提供无样式的可访问交互语义，Tailwind CSS 负责全部视觉样式。
- 表单、选择、按钮、提醒和弹层优先使用 `@vuetify/v0/components`；不手写原生按钮、选择状态或弹层行为。
- 根组件只组合页面；运行时状态、副作用和桥接订阅集中在 `useWatchBlive()`。
- `<webview>` DOM 和 guest 生命周期事件只由 `useLiveRoomWebview()` 管理。
- 宿主每次推送完整、不可变的 `AppState`，composable 使用 `shallowRef` 替换根对象，派生状态使用 `computed`。
- 子组件遵循 props down / events up；只有真实表单双向绑定使用 `defineModel`。
- 主播名、标题、错误和事件均使用普通文本插值，不使用 `v-html`。
- 首版只有 setup/running 两个状态视图，不引入 Vue Router 或 Pinia；`LiveRoomWebview` 始终挂载，只改变布局和可见性。

应用依赖边界：

- 运行依赖：`vue`、`@vuetify/v0`。
- 桌面与构建依赖：`electron`、`electron-vite-plus`、`tailwindcss`、`@vitejs/plugin-vue`、`@tailwindcss/vite`、`vue-tsc`。
- Electron Vite 构建 Main、Preload 和 Renderer 三个入口；生产环境由 `BrowserWindow` 加载本地 renderer 产物，不启动 HTTP 服务。

组件边界：

| 组件                  | 单一职责                                            | 主要契约                                 |
| --------------------- | --------------------------------------------------- | ---------------------------------------- |
| `App.vue`             | 组合顶栏、登录/配置页、运行页和全局错误             | 无业务状态，只调用 `useWatchBlive()`     |
| `AppHeader.vue`       | 展示账号、运行状态与登录/退出/停止动作              | `state` props；`login/logout/stop` emits |
| `LoginPanel.vue`      | 未登录时解释并发起网页登录                          | `pending` props；`login` emit            |
| `SetupView.vue`       | 选择模式、填写主播 UID 或选择分区、选择弹幕执行方式 | typed models；`start` emit               |
| `RuntimeView.vue`     | 组织直播区域、当前主播、评分、最近弹幕和运行状态    | `state` props                            |
| `LiveRoomWebview.vue` | 持续挂载 Bilibili guest，并上报 WebContents ID      | `visible` props；`attached` emit         |
| `EventTimeline.vue`   | 展示查询、选房、感知、思考、弹幕和切换事件          | `events` props，只读                     |

UI 表单规则：

- 未登录时可以使用 `simulate` 启动；选择 `live` 时必须先登录。
- 点击登录后不创建新窗口：主进程通过已绑定的 guest `contents.loadURL()` 导航到 Bilibili 登录页，Vue 展示内嵌 `<webview>`；检测到账号后回到配置/直播布局。
- 单推模式展示正整数“主播 UID”输入框，隐藏分区选择。
- 探索模式展示实时分区选择，隐藏 UID 输入框。
- 切换模式时保留用户已填值，但只提交当前模式对应字段。
- 启动期间禁用重复提交；运行后显示停止按钮和真实运行轨迹。
- “真实发送弹幕”需要清晰风险文案，但不额外设计自制确认弹窗；若确认弹窗确有需要，使用 Vuetify Zero `AlertDialog`。

控制台桥接保持窄接口：

```ts
interface WatchBliveUiBridge {
  state(): Promise<AppState>;
  areas(): Promise<readonly LiveArea[]>;
  attachLiveWebContents(input: { id: number }): Promise<void>;
  login(): Promise<void>;
  logout(): Promise<void>;
  start(options: StartWatchOptions): Promise<void>;
  stop(): Promise<void>;
}
```

Preload 使用 `contextBridge.exposeInMainWorld("watchBlive", api)` 暴露逐方法 IPC 包装，不暴露原始 `ipcRenderer`。Node 到页面的状态更新使用 `mainWindow.webContents.send()`，Preload 订阅固定 channel 后只把纯数据交给 Vue callback。

所有 IPC sender、桥接参数、页面事件与状态在边界使用 TypeBox 校验。Vue 页面返回的数据不能直接作为运行时配置，Bilibili guest 页面不能访问 `watchBlive` bridge。

## 7. 感知链路

### 7.1 媒体输入

`LiveMedia` 获取当前房间播放地址，并启动一个 FFmpeg 子进程，输出：

- stdout：16 kHz、单声道、signed 16-bit little-endian PCM。
- 独立 pipe：低频 JPEG 画面。

PCM 直接写入：

```ts
perception.asr.write({
  data: pcm,
  startAt,
});
```

JPEG 写入：

```ts
await perception.image?.write({
  source: `room:${roomId}`,
  data: jpeg,
  at,
});
```

建议初始感知配置：

```ts
createPerception({
  retentionMs: 5 * 60_000,
  vision: {
    sampleIntervalMs: 6_666,
    differenceThreshold: 0.03,
    maxFrames: 9,
  },
});
```

`retentionMs` 表示可用于快照的时间窗口，不表示每轮都会把五分钟的全部原始帧交给模型；视觉仍经过采样、差异过滤和最多九帧合成。

### 7.2 思考触发与合并

只依赖 `speechend` 会让无语音直播间永远不评分，因此有两个触发源：

- `speechend`：主播或现场一段语音结束。
- 周期观察：即使无语音，也按固定周期请求一份快照。

`ThoughtScheduler` 使用单飞 + 最新待处理合并：

```text
speechend / periodic tick
          │
          ▼
  no active run? ── yes ──▶ compose snapshot ──▶ agent.prompt
          │
          no
          ▼
 replace pending boundary with newest one
          │
          ▼
 current run finished ──▶ run latest pending boundary once
```

建议默认最小思考间隔为 20 秒，周期观察为 45 秒。它们应当是应用常量，待真实运行数据验证后再决定是否开放配置。

每轮 prompt 由以下内容组成：

1. `snapshot.compose()` 产生的视觉与听觉消息内容。
2. 当前房间真实元数据。
3. 已观察时长及探索模式是否已经允许切换。
4. 当前房间最近真实发送的弹幕。
5. 本轮触发原因（语音结束或周期观察）。

## 8. Ciel Session 与记忆边界

应用级只创建一个 `Ciel`：

```ts
defineCiel({
  model,
  systemPrompt,
  tools: [sendDanmakuTool],
  investigation: {
    systemPrompt: explorationSystemPrompt,
  },
  storage: {
    session: { dataDir: join(dataDir, 'session') },
    memory: { dataDir: join(dataDir, 'memory') },
    investigation: { dataDir: join(dataDir, 'investigation') },
  },
});
```

房间身份与会话身份分开：`spaceId` 只标识房间，日期只属于 `sessionId`，两者都不包含登录账号。

| 身份         | 规则                                  | 示例                                     |
| ------------ | ------------------------------------- | ---------------------------------------- |
| 房间 Space   | `bilibili:room:{roomId}`              | `bilibili:room:123`                      |
| 房间 Session | `bilibili:room:{roomId}:{YYYY-MM-DD}` | `bilibili:room:123:2026-09-06`           |
| 探索 Space   | 固定 `bilibili:exploration`           | 每轮 Investigation 自动生成新 Session ID |

日期使用进入房间时的 `Asia/Shanghai` 日历日期，不受电脑时区影响。使用 API 返回的真实房间号。

- A → B：先关闭 A 的访问资源，再为 B 打开其 Space 与当日 Session。
- 同一天 A → B → A：重新创建 A 的访问资源，恢复 A 当日的会话历史。
- 次日进入 A：沿用 A 的 Space 和长期记忆，打开新日期的 Session。
- 持续观看跨过午夜：当前访问不自动中断换 Session；下一次进入时按新日期选择。
- 登录、退出登录不会改变 Space、Session 或来源身份；账号只用于真实弹幕权限检查。
- 不自动搬迁或合并旧账号级数据，也不在查不到新会话时回退读取旧 ID。

```ts
ciel.session({
  spaceId: `bilibili:room:${roomId}`,
  sessionId: `bilibili:room:${roomId}:${date}`,
  crossSpace: true,
  sources: [
    `bilibili:room:${roomId}`,
    `bilibili:streamer:${streamerUid}`,
    `bilibili:streamer-name:${encodeURIComponent(streamerName.trim())}`,
  ],
});
```

主播来源同时包含稳定 UID 和经过编码的当前昵称：

- `bilibili:streamer:{uid}` 是跨改名稳定的主来源，用于可靠关联同一主播的 Session 和 Memory。
- `bilibili:streamer-name:{encodedName}` 是人类可识别、可按昵称检索的别名来源。

昵称发生变化时，新的交互写入稳定 UID 与新昵称来源；旧昵称仍保留在既有记录中，不做破坏性重写。主播标题、简介、分区和直播间标题属于会变化的上下文，放进每轮动态房间信息，不作为 source，避免每次修改标题都制造新来源。

房间 Space 保存该房间的每日与长期记忆，Session 保存一次日历日期内的对话。允许通过 Core 的 `crossSpace: true` 显式只读检索其他 Space；普通房间 Agent 先使用来源发现工具，再搜索、读取相关 Session/Memory。结果必须结合房间、主播来源及时间解释，不自动将其他房间的经历当成当前房间的经历。

当前房间的记忆写入仍绑定其 Space；跨空间读取不授予其他房间的写入权限。全局长期记忆工具保留 Core 既有语义，只保存明确适用于全局的偏好。

探索使用一次隔离的只读 Investigation，而不是复用房间 Session：

```text
spaceId: bilibili:exploration
crossSpace: true
sources:
  bilibili:area:{areaId}
  bilibili:room:{candidateRoomId} ...
  bilibili:streamer:{candidateStreamerUid} ...
  bilibili:streamer-name:{candidateEncodedName} ...
```

候选列表必须包含房间号、主播 UID、主播昵称、标题和分区。宿主将本轮所有候选的房间与主播 sources 传给 Investigation，同时显式开启跨空间读取，使它能检索普通 Session，并按稳定 UID 或昵称来源发现与读取相关 Memory，再从同一批真实候选中选择。每轮探索默认创建新的 Investigation Session，避免旧候选污染新一轮选择。

探索 Investigation 使用独立 system prompt，不复用“每轮必须发弹幕”的房间互动提示，也不能写 Memory 或发送弹幕。选中房间后，宿主才创建对应房间 Session。

当前 `@cieljs/core` 的宿主工具属于 Ciel 级别，因此工具实现必须额外检查运行时 phase；在 `exploring`、`opening`、`closing` 阶段调用 `send_danmaku` 必须明确失败。

## 9. 两种模式

### 9.1 单推模式

```text
start
  ↓
resolve streamer UID to current room
  ↓
open RoomVisit
  ↓
observe ↔ interact
  ↓
offline / media failure
  ↓
retry the same room with backoff
```

规则：

- 不查询分区候选。
- 不向 Agent 请求选房。
- `bilibili/api.ts` 通过主播 UID 查询当前直播状态、规范房间号、主播昵称和分区信息；这些返回值必须经过 TypeBox 校验。
- Agent 最终输出不需要 `score`、`confidence` 或 `action`。
- 即使 Agent 文本中建议离开，控制器也不会切换到其他房间。
- 主播未开播、页面结束或媒体失败时，保留固定主播 UID，按退避策略重新查询该主播的开播状态；不进入探索，也不打开其他主播的房间。

### 9.2 探索模式

```text
query area candidates
        ↓
agent selects one candidate
        ↓
host validates membership
        ↓
open RoomVisit
        ↓
observe / interact / score
        ↓
host score policy says switch?
   no ─┘              yes
                       ↓
              close current visit
                       ↓
              query fresh candidates
```

探索选择输出使用 TypeBox 校验：

```ts
const RoomSelectionSchema = Type.Object({
  roomId: Type.Integer({ minimum: 1 }),
  reason: Type.String({ minLength: 1, maxLength: 160 }),
});
```

宿主还必须检查 `roomId` 存在于本轮查询结果中。若选择无效，允许把校验错误和同一候选列表反馈一次；再次无效则结束本轮探索并在 10 秒后重新查询，避免无限工具循环。

候选过滤：

- 排除当前房间。
- 排除最近刚离开的房间，默认冷却 30 分钟。
- 排除未开播或打开失败的候选。
- 每次重新探索都查询新列表，不能只复用旧 room ID。

## 10. 房间评分策略

Agent 每轮在探索模式输出：

```ts
const RoomDecisionSchema = Type.Object({
  action: Type.Union([Type.Literal('stay'), Type.Literal('explore')]),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
  danmakuAction: Type.Union([Type.Literal('send'), Type.Literal('defer')]),
  evidence: Type.Array(Type.String({ maxLength: 120 }), { maxItems: 5 }),
  reason: Type.String({ minLength: 1, maxLength: 200 }),
  score: Type.Number({ minimum: 0, maximum: 100 }),
});
```

评分含义：

- 80～100：强烈值得继续观看。
- 60～79：有稳定观看或互动价值。
- 40～59：一般，需要继续观察。
- 20～39：持续乏味、难以理解或兴趣较低。
- 0～19：明显不匹配、无法观看或完全没有价值。

宿主侧首版策略沿用经过验证的保守规则：

- 进入房间前 3 分钟不因主观评分切换。
- 任一轮 `score >= 60` 清空低分窗口。
- 最近两轮都 `score <= 20`，允许切换。
- 最近两轮都为 `action=explore`、`score <= 50`、`confidence >= 0.7`，允许切换。
- 最近三轮平均分 `<= 40`，且至少两轮 `confidence >= 0.6`，允许切换。
- 页面明确结束、房间下播、媒体连续恢复失败属于客观终止，不必等待三分钟评分门槛。

Agent 的单轮结果是观测建议，不是切换命令。`RoomScorePolicy` 应实现为无 I/O 的纯状态对象，并为所有边界写单元测试。

## 11. 弹幕工具

工具参数：

```ts
const SendDanmakuSchema = Type.Object({
  action: Type.Union([Type.Literal('send'), Type.Literal('defer')]),
  content: Type.String({ maxLength: 40 }),
  reason: Type.String({ minLength: 1, maxLength: 120 }),
});
```

执行顺序：

```text
schema validated
      ↓
action = defer ──▶ return deferred result
      ↓ send
runtime phase / current room / generation check
      ↓
normalize + non-empty + length + duplicate check
      ↓
delivery = simulate ──▶ return simulated result
      ↓ live
login check
      ↓
LivePage.sendDanmaku
      ↓
record delivered history + emit event
```

真实发送记录只有在页面动作确认成功后才写入。失败和模拟结果不能伪装成已经发送。

工具返回应明确区分：

```ts
type DanmakuToolResult =
  | { status: 'deferred'; reason: string }
  | { status: 'simulated'; content: string }
  | { status: 'delivered'; content: string; roomId: number };
```

## 12. 提示规则

提示词由四层组成：

```text
Ciel 稳定身份与事实边界
          ↓
Bilibili 公共互动规则
          ↓
探索 / 单推模式规则
          ↓
当前房间和当前感知动态上下文
```

从参考实现迁移以下行为，不迁移旧运行时 API：

### 12.1 事实与行动

- 只依据当前感知、房间信息、Session、带来源 Memory 和工具结果判断。
- 区分看见/听见的事实、合理推断、主观感受和未知信息。
- 只有 `send_danmaku` 返回 `delivered` 才能声称弹幕已经发出。
- `simulate`、`deferred` 或错误都不能写入真实发送历史。
- 每轮至多调用一次 `send_danmaku`。

### 12.2 互动节奏

- 自然参与，不把长期沉默当作默认行为。
- 没有明确新内容或互动价值时可以暂缓。
- 不设置机械发送间隔；同一话题出现真实新进展时可以继续互动。
- 不围绕同一个瞬间连续发近义改写。
- 当前房间已有发送历史必须注入 prompt，并做规范化去重。

### 12.3 表达风格

- 熟人式陪伴：自然接话、捧场、吐槽，偶尔整活，但不虚构共同经历。
- 简短、口语、有现场感，优先 4～14 个汉字，通常约 8 个字，硬上限 40 字符。
- 可以按语境偶尔使用即时反应和轻微口癖，但不为展示风格而拼凑。
- 提及直播者时优先使用真实昵称；语境不自然时省略称呼或用“主播”，不强行使用“你”。
- 不冒犯、不越界、不刷屏，不推断敏感身份或关系。

### 12.4 Bilibili 表情

内置白名单从参考实现迁移到单独常量。每条弹幕最多一个标签；唱歌或刚唱完时允许纯 `[喝彩]`。

首版白名单：

```text
[dog] [花] [妙] [哇] [爱] [手机] [撇嘴] [委屈] [抓狂] [比心]
[赞] [滑稽] [吃瓜] [笑哭] [捂脸] [喝彩] [偷笑] [大笑] [惊喜]
[傲娇] [疼] [吓] [阴险] [惊讶] [生病] [嘘] [奸笑] [囧]
[捂脸2] [出窍] [吐了啊] [鼻子] [调皮] [酸] [冷] [OK] [微笑]
[藏狐] [龇牙] [防护] [笑] [一般] [嫌弃] [无语] [哈欠] [可怜]
[歪嘴笑] [亲亲] [问号] [波吉] [OH] [再见] [白眼] [鼓掌]
[大哭] [呆] [流汗] [生气] [加油] [害羞] [虎年] [doge2]
[金钱豹] [瓜子] [墨镜] [难过] [抱抱] [跪了] [摊手] [热]
[三星堆] [鼠] [汤圆] [泼水] [鬼魂] [不行] [响指] [牛]
[保佑] [抱拳] [给力] [耶]
```

表情标签是否仍被 Bilibili 接受需要在真实页面验证；无效标签应从白名单移除，不能让 Agent 自行发明新标签。

## 13. 运行时状态机

```text
idle
  │ start
  ▼
starting ── needs login ──▶ awaiting-login
  │                            │ logged in
  │                            ▼
  ├── follow ─────────────▶ opening
  └── explore ────────────▶ exploring
                               │ selected
                               ▼
                            opening
                               │ ready
                               ▼
                            watching
                               │ switch
                               ▼
                            exploring

any active state ── close ──▶ closing ──▶ closed
```

`WatchStatus` 应是可辨识状态，而不是多个可能互相矛盾的布尔值。每次状态变化通过 `onEvent` 对外发布，至少包含：

- 登录状态变化。
- 分区查询开始/完成/失败。
- 候选选择及理由。
- 房间打开、就绪、离开及原因。
- 感知快照与 Agent 思考开始/完成。
- 评分结果与宿主切换裁决。
- 弹幕 deferred/simulated/delivered/failed。
- FFmpeg、页面和模型错误。

日志和事件不得包含 Cookie、CSRF、完整模型密钥或播放地址鉴权参数。

## 14. 错误与恢复

| 场景                     | 行为                                                       |
| ------------------------ | ---------------------------------------------------------- |
| 未登录且请求真实弹幕     | 工具明确失败，运行时进入/提示 `awaiting-login`，不伪装发送 |
| 页面还未 ready           | 等待有限次数 readiness probe；超时后报告 page 错误         |
| 页面导航发生变化         | generation 失效，拒绝旧页面执行结果和旧发送结果            |
| FFmpeg 异常退出          | 当前访问尝试有限次数重连；探索模式持续失败后重新探索       |
| 感知图片失败             | 发布错误但不永久阻断后续图片任务                           |
| 模型调用失败             | 保留当前房间，按调度器退避重试，不重复执行未确认动作       |
| Agent JSON 不符合 Schema | 记录结构化错误；房间评分不生效，不能切换                   |
| 候选选择不在列表         | 同一轮纠正一次，仍失败则延迟后重新查询                     |
| 单推房间下播             | 只重试同一房间，不进入探索                                 |
| 关闭中仍有页面执行       | generation/AbortSignal 拒绝结果，等待受管任务 settle       |

## 15. 安全边界

- Agent 不能接触 `executePage(code, schema)`。
- Agent 只能看到固定的 `send_danmaku` 工具。
- 页面脚本不能读取本地文件、环境变量或模型密钥。
- 页面脚本返回值默认不可信，必须通过 TypeBox 校验。
- 所有文本动态值使用 JSON 编码，禁止直接插入脚本字符串字面量。
- guest 导航使用 HTTPS 与域名 allowlist。
- 所有 IPC 必须验证 sender；guest WebContents ID 必须验证 `hostWebContents` 归属。
- 远程 guest 禁用 Node.js integration、preload、popup 和不安全 webPreferences。
- Cookie 只用于登录状态判断；不写日志、不进入 Agent prompt、不存进 Session/Memory。
- 真实发送具有外部副作用，首版默认 `simulate`。
- 房间切换、进程关闭和重试由宿主控制器串行化。

## 16. 实现顺序与验收

### 阶段 0：Electron `<webview>` 技术验证

先写最小实验，不接 Agent：

1. 启用 `webviewTag`，验证 `persist:watch-blive` partition 重启后保留登录态。
2. 在 `did-attach` 后读取 `getWebContentsId()`，主进程通过 `webContents.fromId(id)` 取得同一个 guest，并验证 `hostWebContents`。
3. 验证 `executeJavaScript()` 的 string、object、throw、`undefined` 和 Promise 返回语义，再通过 TypeBox 校验结果。
4. 验证导航、guest 重建和 renderer 崩溃后旧 WebContents/旧 generation 的行为。
5. 验证 Bilibili 直播页 `livePlayer.sendDanmaku` 的存在、成功返回和错误返回。
6. 验证 `dom-ready`/`did-finish-load` 后播放器就绪所需等待条件。

这些结果决定 guest 绑定、页面执行器和恢复流程的最终实现。未通过阶段 0，不开始真实弹幕接入。

### 阶段 1：Vue 控制台、页面与登录

- Electron Main/Preload/Renderer 生命周期。
- Vue 3、Vuetify Zero 与 Tailwind CSS 控制台。
- 类型安全 IPC bridge、sender 校验、登录、模式/UID/分区配置和运行状态。
- 持久化 guest partition 与内嵌直播区域。
- `getWebContentsId()` → `webContents.fromId()` guest 交接。
- 房间导航与 readiness。
- `executePage` + TypeBox。
- 登录状态和模拟弹幕。

### 阶段 2：真实弹幕

- 固定 `sendDanmaku` 页面脚本。
- live/simulate 权限边界。
- 去重、结果记录和错误事件。
- 使用测试账号手工验证一次真实发送。

### 阶段 3：感知与单推

- FFmpeg PCM/JPEG 输出。
- `@cieljs/perception` 接入。
- 思考调度器。
- 单推 Session、提示词和互动。

### 阶段 4：探索模式

- 分区与候选 API。
- 带候选主播 sources 的只读 Investigation。
- 房间选择 Schema 与候选归属校验。
- 评分策略、冷却与真正的重新查询/开房流程。

### 阶段 5：稳定性与可观测性

- generation 和关闭竞态测试。
- 页面、媒体、模型重试。
- 全链路事件：查询 → 选择 → 打开 → 感知 → 互动 → 评分 → 重新探索。
- 密钥、Cookie 和播放 URL 脱敏检查。

## 17. 测试范围

### 单元测试

- `executePage` 的 IIFE、Promise、timeout、generation 和 TypeBox 校验。
- guest WebContents ID 的 sender/host 归属校验。
- 页面脚本动态文本的转义。
- `RoomScorePolicy` 的低分、恢复、置信度和重置边界。
- `ThoughtScheduler` 的单飞、合并、关闭和失败恢复。
- 探索候选归属、冷却与重复选择拒绝。
- `send_danmaku` 的 defer/simulate/live、去重和失败不落历史。
- 单推模式永不进入其他 room ID。
- 旧 generation 的媒体、页面执行和 Agent 结果全部失效。

### 集成测试

- 用假的 guest `WebContents` 和假的 FFmpeg stream 验证完整 `RoomVisit` 生命周期。
- 用假的模型验证探索选择、房间评分和宿主切换。
- 验证不同房间 Space 隔离、同日 Session 恢复、上海日期边界和次日新 Session；验证跨 Space 读取可用且不授予跨房间写权限。

### 手工运行验证

- 登录并重启应用，登录态仍存在。
- 直播画面可以正常播放。
- Perception 收到真实 PCM 和变化帧。
- simulate 不触碰页面发送方法。
- live 只发一条预期弹幕，且页面可见。
- 探索模式低分后重新查询并打开新的真实直播间。
- 单推模式在下播或错误后没有打开其他房间。

最终实现阶段按项目规范执行：

```bash
vp install
vp -C apps/watch-blive check
vp -C apps/watch-blive test --run
vp -C apps/watch-blive run build
```

## 18. 实现前必须先确认的 API

架构边界已经确定，但开始编码前需要根据阶段 0 的结果确认以下最终形状：

1. Bilibili 当前页面发送入口及其真实成功判据。
2. 登录页、主页和直播页实际需要的最小导航/权限域名 allowlist。
3. guest 崩溃或被 Vue 重新挂载后的重新 attach 与房间恢复行为。
4. `@vuetify/v0` 的最终组件导出名与当前安装版本是否一致。
5. 首版是否在 UI 中为 `live` 增加 Vuetify Zero `AlertDialog` 二次确认；无论是否增加，内部默认仍为 simulate。

在这些接口得到确认前，不修改应用依赖或实现文件。

## 19. 参考

- [Electron `<webview>` API](https://www.electronjs.org/docs/latest/api/webview-tag)
- [Electron `webContents` API](https://www.electronjs.org/docs/latest/api/web-contents)
- [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)
- 当前仓库 `packages/core`、`packages/perception`、`packages/agent-kit`
- 行为参考：`C:\Users\bycrx\MyCode\ciel\apps\watch-blive`

## 17. 本轮实现边界

- `agent/room-session.ts` 集中定义房间 Space、日期 Session 和来源规则。
- `runtime.ts` 保留启动/停止/探索策略与 RoomVisit 所有权；启动、切房和停止串行执行。
- 停止先取消当前运行；每个房间打开前后的异步边界检查取消信号，阻止旧探索结果在停止后继续导航。
- 房间切换只排入宿主队列，不能在思考回调内等待自身调度器关闭。
- 保留有限页面 readiness 等待和真实资源释放；不为业务错误添加备用身份、备用模型或静默吞错。
- 本轮修改运行时、会话边界与测试。现有 Electron IPC 尚仅接入 guest attach，完整观看控制台与运行时启动接线仍属于后续实现，不能视为已完成。
