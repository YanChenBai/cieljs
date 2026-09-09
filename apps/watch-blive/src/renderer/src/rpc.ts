import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/message-port';
import type { RouterClient } from '@orpc/server';

import type { WatchRouter } from '../../main/router.ts';
import type { WatchBliveBridge } from '../../shared/ipc.ts';

const channel = new MessageChannel();
window.postMessage('watch-blive:connect', '*', [channel.port2]);
channel.port1.start();

export const rpc: RouterClient<WatchRouter> = createORPCClient(
  new RPCLink({ port: channel.port1 }),
);

const controllers = new Set<AbortController>();

window.addEventListener('beforeunload', () => {
  for (const controller of controllers) controller.abort();
  channel.port1.close();
});

export const watchBridge: WatchBliveBridge = {
  attachLiveWebContents: input => rpc.window.attach(input),
  start: input => rpc.watch.start(input),
  stop: () => rpc.watch.stop(),
  login: () => rpc.account.login(),
  logout: () => rpc.account.logout(),
  account: () => rpc.account.get(),
  areas: () => rpc.watch.areas(),
  configuration: () => rpc.setup.configuration(),
  hearingModels: () => rpc.setup.hearingModels(),
  installHearingModels: () => rpc.setup.installHearingModels(),
  pickRecordingFile: () => rpc.recording.pickFile(),
  snapshot: () => rpc.watch.snapshot(),
  onEvent(listener) {
    const controller = new AbortController();
    controllers.add(controller);
    void (async () => {
      try {
        for await (const event of await rpc.watch.events(undefined, { signal: controller.signal }))
          listener(event);
      } catch (error) {
        if (!controller.signal.aborted)
          listener({ type: 'error', stage: 'connection', message: String(error) });
      }
    })();
    return () => {
      controller.abort();
      controllers.delete(controller);
    };
  },
};
