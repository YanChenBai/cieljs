import { createORPCClient, type ClientLink } from '@orpc/client';
import type { RouterClient } from '@orpc/server';

import type { DevtoolsRouter } from '../host/router.ts';

export type DevtoolsClient = RouterClient<DevtoolsRouter>;

/** 应用选择 oRPC 适配器，并负责连接的建立、鉴权和释放。 */
export function createDevtoolsClient(link: ClientLink<Record<never, never>>): DevtoolsClient {
  return createORPCClient(link);
}
