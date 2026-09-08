import { createRouterClient } from '@orpc/server';
import { expect, it, vi } from 'vite-plus/test';

const mocks = vi.hoisted(() => ({
  install: vi.fn(),
  check: vi.fn(async () => ({ valid: false, missingFiles: ['encoder'], modelsPath: '/models' })),
}));
vi.mock('@cieljs/hearing', () => ({
  installModels: mocks.install,
  checkConfiguration: mocks.check,
}));
vi.mock('../config.ts', () => ({
  watchConfigurationStatus: () => ({ valid: true, path: '/config.json' }),
}));

import { createSetupRoutes } from './setup.ts';

it('后台安装立即返回、并发去重，失败原因可读取且允许重试', async () => {
  const download = Promise.withResolvers<string>();
  mocks.install.mockReturnValueOnce(download.promise);
  const client = createRouterClient(createSetupRoutes());
  expect(await client.installHearingModels()).toMatchObject({ installing: true });
  await client.installHearingModels();
  expect(mocks.install).toHaveBeenCalledTimes(1);
  download.reject(new Error('encoder 下载失败：HTTP 503'));
  await vi.waitFor(async () => {
    expect(await client.hearingModels()).toMatchObject({
      installing: false,
      error: 'encoder 下载失败：HTTP 503',
    });
  });
  mocks.install.mockResolvedValueOnce('/models');
  await client.installHearingModels();
  expect(mocks.install).toHaveBeenCalledTimes(2);
  expect((await client.hearingModels()).error).toBeUndefined();
});
