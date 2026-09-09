import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defineTool } from '@cieljs/agent-kit';
import { memoryStorage } from '@cieljs/memory';
import { sessionStorage } from '@cieljs/session';
import { Storage } from '@cieljs/storage';
import { VectorService, vectorStorage } from '@cieljs/vector';
import type { Context } from '@earendil-works/pi-ai';
import { fauxAssistantMessage, registerFauxProvider } from '@earendil-works/pi-ai/compat';
import { Type } from 'typebox';
import { afterEach, describe, expect, test, vi } from 'vite-plus/test';

import { assertUniqueTools } from '../src/agents/tools.ts';
import { defineCiel } from '../src/index.ts';

const { qwen } = vi.hoisted(() => ({
  qwen: vi.fn((_options?: unknown) => ({
    model: 'test-embedding',
    dimensions: 2,
    batchSize: 32,
    embed: async () => [1, 0],
    embedBatch: async (texts: string[]) => texts.map(() => [1, 0]),
  })),
}));

const { closeMcp, createMcp } = vi.hoisted(() => ({
  closeMcp: vi.fn(async () => {}),
  createMcp: vi.fn(async () => ({
    tools: [] as unknown[],
    close: vi.fn(async () => {}),
    [Symbol.asyncDispose]: vi.fn(async () => {}),
  })),
}));

vi.mock('@cieljs/mcp', () => ({ createMcp }));

const temporaryDirectories: string[] = [];
const storages: Storage[] = [];

async function createStorage() {
  const root = await mkdtemp(join(tmpdir(), 'ciel-core-'));
  temporaryDirectories.push(root);

  const storage = await Storage.open({
    dataDir: root,
    modules: [sessionStorage, memoryStorage, vectorStorage],
  });
  storages.push(storage);
  return { storage };
}

afterEach(async () => {
  for (const storage of storages.splice(0)) await storage.close();
  await Promise.all(
    temporaryDirectories.splice(0).map(directory =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
  qwen.mockClear();
  closeMcp.mockClear();
  createMcp.mockClear();
});

describe('defineCiel', () => {
  test('拒绝重复工具名称', () => {
    const tool = defineTool(Type.Object({}), () => ({
      name: 'search_memory',
      label: '搜索记忆',
      description: 'test',
      execute: async () => ({ content: [], details: {} }),
    }))();

    expect(() => assertUniqueTools([tool, tool])).toThrow('工具名称重复：search_memory');
  });

  test('按配置创建 MCP、向普通 Session 注入工具并统一关闭', async () => {
    const storage = await createStorage();
    const faux = registerFauxProvider();
    const tool = defineTool(Type.Object({}), () => ({
      name: 'mcp_search',
      label: 'MCP 搜索',
      description: 'test',
      execute: async () => ({ content: [], details: {} }),
    }))();

    createMcp.mockResolvedValueOnce({
      tools: [tool],
      close: closeMcp,
      [Symbol.asyncDispose]: closeMcp,
    });

    const ciel = defineCiel({
      model: faux.getModel(),
      systemPrompt: 'Ciel',
      ...storage,
      vectors: new VectorService({
        storage: storage.storage,
        provider: qwen(),
        providerId: 'test',
        revision: '1',
        granularity: 'chunk',
        inputConfig: 'raw',
      }),
      mcp: {
        enabled: true,
        configFile: '.ciel/test-mcp.json',
      },
    });

    await ciel.start();

    expect(qwen).toHaveBeenCalledTimes(1);
    expect(createMcp).toHaveBeenCalledWith({
      configFile: '.ciel/test-mcp.json',
    });

    const session = await ciel.session({ spaceId: 'test' });
    expect(session.agent.state.tools.some(candidate => candidate.name === 'mcp_search')).toBe(true);

    await session.close();
    await ciel.close();
    await ciel.close();

    expect(closeMcp).toHaveBeenCalledTimes(1);
    faux.unregister();
  }, 20_000);

  test('运行普通 Session，并隔离和续接 Investigation Session', async () => {
    const storage = await createStorage();
    const faux = registerFauxProvider();
    const contexts: Context[] = [];
    faux.setResponses([
      context => {
        contexts.push(context);
        return fauxAssistantMessage('普通会话回答');
      },
      context => {
        contexts.push(context);
        return fauxAssistantMessage('第一次调查回答');
      },
      context => {
        contexts.push(context);
        return fauxAssistantMessage('第二次调查回答');
      },
    ]);

    let roomId = 'room:1000';
    const ciel = defineCiel({
      model: faux.getModel(),
      systemPrompt: '你是 Ciel。',
      ...storage,
    });

    const firstStart = ciel.start();
    const secondStart = ciel.start();

    expect(firstStart).toBe(secondStart);
    await firstStart;
    expect(qwen).not.toHaveBeenCalled();
    expect(createMcp).not.toHaveBeenCalled();
    expect(ciel.status).toBe('running');

    const session = await ciel.session({
      sessionId: 'conversation:1',
      spaceId: 'livestream',
      sources: () => [roomId, '', ` ${roomId} `],
    });

    roomId = 'room:2000';
    await session.agent.prompt('当前直播间怎么样？');

    expect(contexts, session.agent.state.errorMessage).toHaveLength(1);
    expect(contexts[0]?.systemPrompt).toBe('你是 Ciel。');
    expect(JSON.stringify(contexts[0]?.messages[0])).toContain('room:2000');
    expect(JSON.stringify(contexts[0]?.messages[0])).not.toContain('room:1000');

    const firstInvestigation = await ciel.investigate({
      sessionId: 'investigation:1',
      spaceId: 'livestream',
      sources: () => [roomId],
      question: '以前发生过什么？',
    });
    const secondInvestigation = await ciel.investigate({
      sessionId: 'investigation:1',
      spaceId: 'livestream',
      sources: () => [roomId],
      question: '再核对一次。',
    });

    expect(firstInvestigation.sessionId).toBe('investigation:1');
    expect(firstInvestigation.messages).toHaveLength(2);
    expect(secondInvestigation.sessionId).toBe('investigation:1');
    expect(JSON.stringify(contexts[1]?.messages)).not.toContain('当前直播间怎么样');
    expect(JSON.stringify(contexts[2]?.messages)).toContain('以前发生过什么');
    expect(JSON.stringify(contexts[2]?.messages)).toContain('第一次调查回答');

    await session.close();
    await ciel.close();
    await ciel.close();

    expect(ciel.status).toBe('closed');
    faux.unregister();
  }, 20_000);
});

test('启动失败时并发关闭仍进入终态，且拒绝重新启动', async () => {
  const storage = await createStorage();
  const faux = registerFauxProvider();
  createMcp.mockRejectedValueOnce(new Error('MCP 启动失败'));
  const ciel = defineCiel({
    model: faux.getModel(),
    systemPrompt: 'test',
    ...storage,
    mcp: { enabled: true },
  });
  try {
    const starting = ciel.start();
    const startFailure = expect(starting).rejects.toThrow('MCP 启动失败');
    const closing = ciel.close();
    await expect(ciel.start()).rejects.toThrow('关闭');
    await startFailure;
    await closing;
    expect(ciel.status).toBe('closed');
    await ciel.close();
  } finally {
    await ciel.close();
    faux.unregister();
  }
}, 20_000);
