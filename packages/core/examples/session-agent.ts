import { SessionManager } from "@cieljs/session";
import { createSessionAgent } from "../src/agent.ts";

const manager = await SessionManager.open({ dataDir: ".ciel/session" });
const { agent, unsubscribe, flushPersistence } = await createSessionAgent({
  sessionId: "732",
  manager,
  systemPrompt: "",
});

agent.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
  if (event.type === "tool_execution_update") console.log(event);
});

try {
  await agent.prompt("你好");
  await agent.prompt("使用 read_session 查询");
} finally {
  unsubscribe();
  await flushPersistence();
  await manager.close();
}
