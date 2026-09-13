<h1 align="center">@cieljs/mcp</h1>

<p align="center">把任意 MCP Server 暴露的工具，动态转换成 Ciel Agent 可以直接调用的工具。</p>

`@cieljs/mcp` 是 Ciel 的外部工具来源。它通过 MCP `tools/list` 在启动时发现工具定义，把每个 MCP Tool 转换成一个普通的 `AgentTool`；Agent 调用工具时，再通过 `tools/call` 转发给对应的 MCP Server。

> MCP 由宿主持有。多个 runtime 可以复用同一个实例；runtime 不创建或关闭 MCP 服务。

| 概念             | 作用                                         |
| ---------------- | -------------------------------------------- |
| MCP Server       | 用 stdio 启动的外部进程，暴露一组 Tool       |
| `.ciel/mcp.json` | 声明要连接哪些 MCP Server 以及各自的配置     |
| `AgentTool[]`    | pi-agent-core 的统一工具形态，直接交给 Agent |

## 基本使用

在项目目录创建 `.ciel/mcp.json`：

```json
{
  "mcpServers": {
    "search": {
      "command": "npx",
      "args": ["-y", "agent-search-mcp"]
    }
  }
}
```

使用 `@cieljs/runtime` 时，传入已连接的 MCP 实例：

```ts
import { defineCiel } from 'cieljs';
import { createMcp } from '@cieljs/mcp';

await using mcp = await createMcp({
  cwd: process.cwd(),
  configFile: '.ciel/mcp.json',
});

const ciel = defineCiel({
  // ...
  mcp,
});

await ciel.start();
await ciel.close();
```

直接使用 Agent 时，也可以直接打开 MCP，把 `mcp.tools` 与本地工具一起交给 Agent：

```ts
import { createMcp } from '@cieljs/mcp';

const mcp = await createMcp({
  cwd: process.cwd(),
  configFile: '.ciel/mcp.json',
});

const tools = [...mcp.tools];

await mcp.close();
```

Server 暴露的工具会在启动时自动发现，不需要提前声明 `webSearch()`、`webFetch()` 之类的函数。

## 连接多个 Server

```json
{
  "mcpServers": {
    "search": {
      "command": "npx",
      "args": ["-y", "agent-search-mcp"]
    },
    "bilibili": {
      "command": "npx",
      "args": ["-y", "bilibili-mcp"]
    }
  }
}
```

所有 Server 的工具会合并到同一个 `mcp.tools`：

```ts
console.log(mcp.tools.map(tool => tool.name));
// ["web_search", "web_fetch", "search_video", "get_video_info", "get_dynamic"]
```

## 环境变量

配置支持引用环境变量，避免把 API Key 直接写进 `.ciel/mcp.json`：

```json
{
  "mcpServers": {
    "search": {
      "command": "npx",
      "args": ["-y", "agent-search-mcp"],
      "env": {
        "BOCHA_API_KEY": "${BOCHA_API_KEY}"
      }
    }
  }
}
```

引用的环境变量不存在时，MCP 初始化会直接失败。

## 工具过滤

默认暴露 Server 的全部工具，可以用 `tools` 只启用部分：

```json
{
  "mcpServers": {
    "search": {
      "command": "npx",
      "args": ["-y", "agent-search-mcp"],
      "tools": ["web_search", "web_fetch"]
    }
  }
}
```

也可以用 `excludeTools` 排除指定工具；两者同时存在时 `excludeTools` 优先。暂时不需要某个 Server 时，设置 `enabled: false`，它就不会启动，也不会暴露工具。

## 工具名冲突

不同 Server 可能提供同名工具，`@cieljs/mcp` 不会静默覆盖，而是直接报错。可以为 Server 开启 namespace：

```json
{
  "mcpServers": {
    "web": {
      "command": "web-mcp",
      "prefix": true
    },
    "bilibili": {
      "command": "bilibili-mcp",
      "prefix": "bili"
    }
  }
}
```

得到 `web__search`、`bili__search`。`prefix: true` 用 Server 名做前缀，也可以传自定义字符串。

## 工作目录与超时

MCP Server 默认继承 Ciel 项目的 cwd，可用 `cwd` 指定相对路径；`timeout` 控制每次请求的超时（毫秒）：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "node",
      "args": ["./server.js"],
      "cwd": "./tools/filesystem",
      "timeout": 30000
    }
  }
}
```

## 配置位置与可选性

MCP 不决定配置目录，调用方必须显式传入项目目录和配置文件：

```ts
const mcp = await createMcp({
  cwd: '/path/to/project',
  configFile: './config/mcp.json',
});
```

文件不存在时默认不报错，`mcp.tools` 返回空数组；如果当前程序必须依赖 MCP，传 `required: true`，配置文件缺失时直接失败。

## 工作原理

MCP Server 负责描述工具，`@cieljs/mcp` 在连接后执行 `tools/list`，把每个工具的 `inputSchema`（JSON Schema）直接作为 AgentTool 的参数 schema：

```text
MCP Server
  ↓ tools/list
AgentTool[]
  ↓ Agent 调用
tools/call
  ↓
MCP Server
```

## 作用范围

当前支持 stdio transport、工具发现、工具调用、多 Server、工具过滤与 namespace、环境变量、MCP Content → Agent Content、AbortSignal 与超时。

暂不处理 Resources、Prompts、Sampling、Elicitation、OAuth 和 Streamable HTTP。

## 开发

```bash
vp check
vp run build
```
