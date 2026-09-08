import { existsSync, mkdirSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

import { models } from '@cieljs/core';
import { app } from 'electron';

import { copyMissingResources } from './resources.ts';

export function loadWatchEnvironment(directory: string) {
  const file = join(directory, '.env');
  if (existsSync(file)) {
    process.loadEnvFile(file);
  }
}

export function resolveWatchModel() {
  const provider = process.env.AI_PROVIDER?.trim();
  const id = process.env.AI_MODEL?.trim();
  if (!provider || !id) {
    throw new Error(
      '请在 watch-blive/.env 中配置 AI_PROVIDER、AI_MODEL 和对应提供商的 API key，然后重启应用',
    );
  }
  const model = models.getModel(provider, id);
  if (!model) {
    throw new Error(`模型不存在：${provider}/${id}`);
  }
  return model;
}

export function watchDataDirectory() {
  return resolve(process.env.WATCH_BLIVE_DATA_DIR ?? join(homedir(), '.ciel'));
}

export function prepareWatchResources() {
  const root = watchDataDirectory();
  process.env.CIEL_DATA_DIR = root;
  for (const name of ['electron', 'models', 'cache', 'logs'])
    mkdirSync(join(root, name), { recursive: true });
  app.setPath('sessionData', join(root, 'electron'));
  app.setAppLogsPath(join(root, 'logs'));
}

export async function migrateWatchResources() {
  const root = watchDataDirectory();
  const previousRoots = [join(app.getAppPath(), '.ciel'), join(app.getPath('userData'), '.ciel')];
  for (const previous of previousRoots) {
    if (resolve(previous) === root || !existsSync(previous)) continue;
    for (const name of ['session', 'memory', 'investigation', 'devtools', 'mcp.json']) {
      const source = join(previous, name);
      const target = join(root, name);
      if (existsSync(source) && !existsSync(target))
        await cp(source, target, { recursive: true, force: false });
    }
    for (const name of ['models', 'voiceprints', 'cache']) {
      const source = join(previous, name);
      if (existsSync(source)) await copyMissingResources(source, join(root, name));
    }
  }
  if (app.isPackaged) return;
  const require = createRequire(import.meta.url);
  const packageRoot = resolve(dirname(require.resolve('@cieljs/perception')), '../../hearing');
  for (const name of ['models', 'voiceprints']) {
    const source = join(packageRoot, name);
    const target = join(root, name);
    if (!existsSync(source)) continue;
    await copyMissingResources(source, target);
  }
}
