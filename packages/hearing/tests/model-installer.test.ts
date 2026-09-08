import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';

import { checkConfiguration, installModels } from '../src/index.ts';

let directory: string;
let previousDirectory: string | undefined;

beforeEach(async () => {
  previousDirectory = process.env.CIEL_DATA_DIR;
  directory = await mkdtemp(join(tmpdir(), 'hearing-models-'));
  process.env.CIEL_DATA_DIR = directory;
});

afterEach(async () => {
  vi.unstubAllGlobals();

  if (previousDirectory === undefined) {
    delete process.env.CIEL_DATA_DIR;
  } else {
    process.env.CIEL_DATA_DIR = previousDirectory;
  }

  await rm(directory, { recursive: true, force: true });
});

it('通过公共 API 下载完整模型并报告进度', async () => {
  const fetch = vi.fn(() =>
    Promise.resolve(
      new Response(Uint8Array.of(1), {
        headers: { 'content-length': '1' },
      }),
    ),
  );
  vi.stubGlobal('fetch', fetch);
  const progress = vi.fn();

  const modelsPath = await installModels({ onProgress: progress });

  expect(modelsPath).toBe(join(directory, 'models'));
  expect(fetch).toHaveBeenCalledTimes(8);
  expect(progress).toHaveBeenCalledWith(
    expect.objectContaining({ receivedBytes: 1, totalBytes: 1 }),
  );
  await expect(checkConfiguration()).resolves.toMatchObject({ valid: true, missingFiles: [] });
});

it('失败自动重试并保留已完成文件，手动重试只补齐缺失文件', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(Uint8Array.of(1)))
    .mockImplementation(() => Promise.resolve(new Response('unavailable', { status: 503 })));
  vi.stubGlobal('fetch', fetch);
  const progress = vi.fn();
  await expect(installModels({ retryDelayMs: 0, onProgress: progress })).rejects.toThrow(
    '第 3/3 次',
  );
  expect(fetch).toHaveBeenCalledTimes(4);
  expect((await checkConfiguration()).missingFiles).toHaveLength(7);
  expect(progress).toHaveBeenCalledWith(
    expect.objectContaining({ message: expect.stringContaining('503') }),
  );
  fetch.mockImplementation(() => Promise.resolve(new Response(Uint8Array.of(1))));
  fetch.mockClear();
  await installModels();
  expect(fetch).toHaveBeenCalledTimes(7);
  expect((await checkConfiguration()).valid).toBe(true);
});
