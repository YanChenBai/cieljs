# watch-blive

An Electron application with Vue and TypeScript

## 配置

开发环境从 `process.cwd()/.ciel/config.json` 读取配置；打包后从 `~/.ciel/config.json` 读取。`WATCH_BLIVE_DATA_DIR` 可覆盖数据目录。加载时进行 schema 校验：

```json
{
  "ai": {
    "provider": "xiaomi",
    "model": "mimo-v2.5",
    "baseUrl": "https://api.xiaomimimo.com/v1",
    "apiKey": "your-api-key",
    "thinkingLevel": "off"
  },
  "interaction": {
    "minimumThinkIntervalMs": 2000,
    "periodicObservationMs": 10000,
    "thinkTimeoutMs": 60000
  },
  "wake": {
    "keywords": ["夏尔"],
    "minWaitMs": 1500,
    "maxWaitMs": 4000,
    "cooldownMs": 15000
  },
  "ffmpegPath": "C:/Tools/ffmpeg/bin/ffmpeg.exe"
}
```

`ffmpegPath`、`ai.thinkingLevel` 和 `interaction` 可省略。默认思考最小间隔为 2 秒，无语音时每 10 秒观察一次；模型响应和 ASR 推理仍可能增加延迟。运行参数修改后重启应用生效。应用不会要求把 API key 写入环境变量。听觉模型缺失时可直接在应用侧栏下载。

`ai.thinkingLevel` 控制模型推理强度（`off` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`），省略时沿用模型默认；`interaction.thinkTimeoutMs` 给单轮思考设时间预算，超过就中止本轮，省略表示不限制。

每轮不再强制调用 `send_danmaku`：有自然内容才发送，确实没有想说的可以直接结束本轮，减少一次模型往返。

`ai.baseUrl` 可省略，省略时使用模型注册的地址。自定义地址必须为 HTTP 或 HTTPS，需包含服务要求的路径前缀（例如 `/v1`）；它只覆盖请求地址，`provider` 和 `model` 仍须是已注册的组合，接口协议也保持不变。修改后重启应用生效。

声纹从同一数据目录的 `voiceprints/*.voiceprint` 自动加载，去掉后缀的文件名作为说话人名称，例如 `弥生.voiceprint` 显示为“弥生”。每次开始直播或录播重新扫描；新增、改名或删除文件后重新开始观看即可。声纹加载保留侧栏选择的 ASR 模型和缓冲设置，损坏文件由听觉初始化报错。

`main/application.ts` 的 `createWatchApplication(mainWindow)` 统一持有存储、Devtools、MCP、直播页面和观看运行时，并返回 `router` 与 `close()`。账号与观看路由直接使用应用内状态；`main/ipc.ts` 只负责连接接入与回收。

直播默认启用「夏尔」关键词唤醒，`wake: false` 可关闭。首次启用会准备独立的 KWS 模型，音频仍持续进入 ASR。命中只让下一轮优先思考：至少等 1.5 秒收集后续话语，语音结束后优先思考，最多等待 4 秒；若已有思考运行，则等它结束再处理。4 秒是调度等待上限，不保证 ASR 已完成转写或模型已返回。录播不启用唤醒。

唤醒不会自动发弹幕——被叫到不等于要马上开口，发不发由该轮内容按弹幕规则决定。15 秒冷却内及同一次待处理唤醒期间合并重复命中，该轮上下文包含关键词、音频时间和「不要抢着发言」的提示，DevTools 中也可查看唤醒记录；切房或停止会取消待处理唤醒。配置修改后重启生效。

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode) + [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar)

## Project Setup

### Install

```bash
pnpm install
```

### Development

```bash
pnpm dev
```

### Build

```bash
# For windows
$ pnpm build:win

# For macOS
$ pnpm build:mac

# For Linux
$ pnpm build:linux
```
