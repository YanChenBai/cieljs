import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/message-port';
import { RPCLink as WebSocketLink } from '@orpc/client/websocket';
import type { RouterClient } from '@orpc/server';

import type { DevtoolsRouter } from '../host/router.ts';

export type DevtoolsClient = RouterClient<DevtoolsRouter>;

export function createMessagePortClient(port: MessagePort): DevtoolsClient {
  port.start();
  return createORPCClient(new RPCLink({ port }));
}

export function createWebSocketClient(connect: () => WebSocket): DevtoolsClient {
  return createORPCClient(new WebSocketLink({ connect }));
}
