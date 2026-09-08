# watch-blive

An Electron application with Vue and TypeScript

## 配置

开发环境从 `process.cwd()/.ciel/config.json` 读取配置；打包后从 `~/.ciel/config.json` 读取。`WATCH_BLIVE_DATA_DIR` 可覆盖数据目录。加载时进行 schema 校验：

```json
{
  "ai": {
    "provider": "xiaomi",
    "model": "mimo-v2.5",
    "apiKey": "your-api-key"
  },
  "interaction": {
    "minimumThinkIntervalMs": 2000,
    "periodicObservationMs": 10000
  },
  "ffmpegPath": "C:/Tools/ffmpeg/bin/ffmpeg.exe"
}
```

`ffmpegPath` 和 `interaction` 可省略。默认思考最小间隔为 2 秒，无语音时每 10 秒观察一次；模型响应和 ASR 推理仍可能增加延迟。运行参数修改后重启应用生效。应用不会要求把 API key 写入环境变量。听觉模型缺失时可直接在应用侧栏下载。

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode) + [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar)

## Project Setup

### Install

```bash
$ pnpm install
```

### Development

```bash
$ pnpm dev
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
