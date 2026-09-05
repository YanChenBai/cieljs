import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { qwen } from "@cieljs/embed";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { MemoryManager } from "@cieljs/memory";
import { SessionManager } from "@cieljs/session";

import { createSessionAgent, type CreateSessionAgentOptions } from "./agent.ts";
import { createMemory, type MemoryAgentOptions } from "./memory.ts";
import { createSession, type SessionAgentOptions } from "./session.ts";
import { MEMORY_DIR_PATH, SESSION_DIR_PATH } from "./config.ts";
import { prompt } from "@cieljs/agent-kit";

export { createMemory, createSession, createSessionAgent };
export type { CreateSessionAgentOptions, MemoryAgentOptions, SessionAgentOptions };

export interface CreateAgentOptions {
  /**
   * 切换测试空间。
   */
  spaceId: string;

  systemPrompt: string;

  /**
   * Session 集成配置；manager 与 space 由 createAgent 注入。
   */
  session?: Omit<SessionAgentOptions, "manager" | "space">;

  model?: Model<any>;

  /**
   * Session Tools 之外的其他工具。
   */
  tools?: AgentTool[];

  /**
   * 记忆集成配置；manager 与 space 由 createAgent 根据 spaceId 注入。
   */
  memory?: Omit<MemoryAgentOptions, "manager" | "space">;

  sessionDataDir?: string;

  memoryDataDir?: string;
}

/**
 * 组装完整 Agent：打开 Session / Memory 管理器，按 spaceId 选择空间，
 * 再交给 {@link createSessionAgent}。
 */
export async function createAgent(options: CreateAgentOptions) {
  const {
    spaceId,
    systemPrompt,
    session: sessionOptions,
    model,
    tools,
    memory: memoryOptions,
    sessionDataDir = SESSION_DIR_PATH,
    memoryDataDir = MEMORY_DIR_PATH,
  } = options;

  mkdirSync(sessionDataDir, { recursive: true });
  mkdirSync(memoryDataDir, { recursive: true });
  const embedding = qwen({
    dimensions: 1024,
    dtype: "q8",
  });

  const sessionManager = await SessionManager.open({ dataDir: sessionDataDir, embedding });
  const memoryManager = await MemoryManager.open({ dataDir: memoryDataDir, embedding });
  try {
    const memorySpace = memoryManager.space(spaceId);
    const sessionSpace = sessionManager.space(spaceId);

    const agentBundle = await createSessionAgent({
      session: {
        manager: sessionManager,
        space: sessionSpace,
        ...sessionOptions,
      },
      memory: {
        manager: memoryManager,
        space: memorySpace,
        ...memoryOptions,
        crossSpace: true,
      },
      model,
      systemPrompt,
      tools,
    });

    return {
      ...agentBundle,
      memorySpace,
      sessionManager,
      memoryManager,
      close: async () => {
        agentBundle.unsubscribe();
        await agentBundle.flushPersistence();
        await sessionManager.close();
        await memoryManager.close();
      },
    };
  } catch (error) {
    await sessionManager.close();
    await memoryManager.close();

    throw error;
  }
}

/**
 * 终端测试用：修改这里的默认值或设置环境变量 CIEL_SPACE_ID，即可切换 Space。
 */
const SPACE_ID = process.env.CIEL_SPACE_ID ?? "default";

const SOURCES = (process.env.CIEL_SOURCES as string | undefined)?.split(",") ?? [];

const SESSION_ID = process.env.CIEL_SESSION_ID ?? undefined;

async function runRepl() {
  const { agent, session, close } = await createAgent({
    spaceId: SPACE_ID,
    session: {
      sessionId: SESSION_ID,
      sources() {
        return SOURCES;
      },
    },
    memory: {
      maxTokens: 10000,
      recentDays: 3,
      sources() {
        return SOURCES;
      },
    },
    systemPrompt: prompt.dedent`
      你是 Ciel，一个具备会话历史与记忆能力的助手。
      可以通过 search_session / read_session 回忆当前会话历史，
      也可以通过记忆工具检索与保存长期记忆。
    `,
  });

  stdout.write(`\nSpace: ${SPACE_ID}\nSession: ${session.id}\n`);

  agent.subscribe((event) => {
    switch (event.type) {
      case "message_update": {
        if (event.assistantMessageEvent.type === "text_delta") {
          stdout.write(event.assistantMessageEvent.delta);
        }
        break;
      }

      case "tool_execution_start": {
        stdout.write(`\n[工具] ${event.toolName} - ${JSON.stringify(event.args)}\n`);
        break;
      }

      case "tool_execution_end": {
        stdout.write(`\n[工具完成] ${event.toolName} ${event.isError ? event.result : ""}\n`);
        break;
      }
    }
  });

  const rl = createInterface({
    input: stdin,
    output: stdout,
    prompt: "> ",
  });

  let shuttingDown = false;

  const shutdown = () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    agent.abort();
    rl.close();
  };

  rl.on("SIGINT", shutdown);
  process.once("SIGINT", shutdown);

  stdout.write("输入问题并回车发送；输入 /exit 退出。\n");
  rl.prompt();

  try {
    for await (const line of rl) {
      const input = line.trim();

      if (input === "/exit" || input === "/quit") {
        break;
      }

      if (input) {
        try {
          await agent.prompt(input);
          stdout.write("\n");
        } catch (error) {
          console.error("\n[repl] 运行失败：", error);
        }
      }

      if (!shuttingDown) {
        rl.prompt();
      }
    }
  } finally {
    rl.close();

    try {
      await close();
    } catch (error) {
      console.error("[repl] 清理失败：", error);
    }

    stdout.write("\n再见。\n");
  }
}

const isMain =
  process.argv[1] != null && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  await runRepl().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
