import { os } from '@orpc/server';

import type { LivePage } from '../bilibili/live-page.ts';
import type { WatchBlive } from '../runtime.ts';

export function createAccountRoutes(livePage: LivePage, current: () => WatchBlive | undefined) {
  return {
    get: os.handler(() => livePage.account()),
    login: os.handler(async ({ signal }) => {
      await current()?.stop();
      await livePage.login();
      return livePage.waitForLogin(signal);
    }),
    logout: os.handler(async () => {
      await current()?.stop();
      await livePage.logout();
    }),
  };
}
