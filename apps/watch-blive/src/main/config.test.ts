import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const getModel = vi.hoisted(() => vi.fn(() => ({ id: 'mimo-v2.5' })));
vi.mock('@cieljs/core', () => ({ models: { getModel } }));
const electronApp = vi.hoisted(() => ({ isPackaged: false }));
vi.mock('electron', () => ({ app: electronApp }));

const { resolveWatchConfig, resolveWatchModel, watchConfigFile, watchConfigurationStatus } =
  await import('./config.ts');

let directory: string;
let previousDirectory: string | undefined;

beforeEach(async () => {
  previousDirectory = process.env.WATCH_BLIVE_DATA_DIR;
  directory = await mkdtemp(join(tmpdir(), 'watch-blive-config-'));
  process.env.WATCH_BLIVE_DATA_DIR = directory;
  getModel.mockClear();
});

afterEach(async () => {
  if (previousDirectory === undefined) {
    delete process.env.WATCH_BLIVE_DATA_DIR;
  } else {
    process.env.WATCH_BLIVE_DATA_DIR = previousDirectory;
  }

  await rm(directory, { recursive: true, force: true });
});

describe('Watch Blive 配置', () => {
  it('从数据目录 config.json 读取并校验 AI 凭据', async () => {
    await writeFile(
      watchConfigFile(),
      JSON.stringify({
        ai: { provider: 'xiaomi', model: 'mimo-v2.5', apiKey: 'secret' },
      }),
    );

    const config = resolveWatchConfig();

    expect(resolveWatchModel(config)).toEqual({ model: { id: 'mimo-v2.5' }, apiKey: 'secret' });
    expect(getModel).toHaveBeenCalledWith('xiaomi', 'mimo-v2.5');
    expect(watchConfigurationStatus()).toEqual({ path: watchConfigFile(), valid: true });
  });

  it('缺少配置时返回包含目标路径的提示', () => {
    const status = watchConfigurationStatus();

    expect(status).toMatchObject({ path: watchConfigFile(), valid: false });
    expect(status.message).toContain('请创建');
  });
});

it('开发目录与打包目录分别使用 cwd 和 homedir', () => {
  delete process.env.WATCH_BLIVE_DATA_DIR;
  electronApp.isPackaged = false;
  expect(watchConfigFile()).toBe(join(process.cwd(), '.ciel', 'config.json'));
  electronApp.isPackaged = true;
  expect(watchConfigFile()).toBe(join(homedir(), '.ciel', 'config.json'));
  electronApp.isPackaged = false;
});
