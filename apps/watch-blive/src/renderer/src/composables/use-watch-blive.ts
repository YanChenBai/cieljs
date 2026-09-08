import { useTimer } from '@vuetify/v0';
import { computed, onMounted, onUnmounted, shallowRef } from 'vue';

import type { WatchBridgeEvent, WatchSnapshot } from '../../../shared/ipc.ts';
import type {
  Account,
  HearingModelStatus,
  LiveArea,
  StartWatchOptions,
  WatchConfigurationStatus,
} from '../../../shared/types.ts';
import { watchBridge } from '../rpc.ts';
import { describeWatchEvent } from './watch-event.ts';

export function useWatchBlive() {
  const events = shallowRef<{ id: number; time: string; text: string }[]>([]);
  let eventId = 0;
  const state = shallowRef<WatchSnapshot>({ status: 'idle' });
  const account = shallowRef<Account>();
  const areas = shallowRef<readonly LiveArea[]>([]);
  const configuration = shallowRef<WatchConfigurationStatus>();
  const hearingModels = shallowRef<HearingModelStatus>();
  const error = shallowRef('');
  const pending = shallowRef('');
  const ready = shallowRef(false);
  const active = computed(() => !['idle', 'closed'].includes(state.value.status));

  let disposed = false;
  const setupTimer = useTimer(
    () => {
      void refreshSetup();
    },
    { duration: 1_000 },
  );
  onUnmounted(() => {
    disposed = true;
  });

  // 串行轮询可恢复后台安装进度，同时发现用户在外部编辑的配置。
  async function refreshSetup() {
    try {
      const [config, models] = await Promise.all([
        watchBridge.configuration(),
        watchBridge.hearingModels(),
      ]);
      if (disposed) return;
      configuration.value = config;
      hearingModels.value = models;
    } catch (cause) {
      if (!disposed) error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (!disposed) setupTimer.start();
    }
  }
  onMounted(() => {
    void refreshSetup();
  });

  function receive(event: WatchBridgeEvent) {
    const text = describeWatchEvent(event);
    if (text) {
      events.value = [
        ...events.value,
        { id: ++eventId, time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), text },
      ].slice(-60);
    }

    if (event.type === 'status') state.value = { ...state.value, status: event.status };
    if (event.type === 'room_opened') state.value = { ...state.value, room: event.room };
    if (event.type === 'room_closed') state.value = { ...state.value, room: undefined };
    if (event.type === 'error') error.value = event.message;
  }

  const unsubscribe = watchBridge.onEvent(receive);
  onUnmounted(unsubscribe);

  async function run(name: string, action: () => Promise<unknown>) {
    if (pending.value && name !== 'stop') return;

    pending.value = name;
    error.value = '';

    try {
      await action();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (pending.value === name) pending.value = '';
    }
  }

  async function refreshAccount() {
    account.value = await watchBridge.account();
  }

  async function attached() {
    ready.value = true;
    await run('refresh', refreshAccount);
  }

  onMounted(() =>
    run('initialize', async () => {
      const [loadedConfiguration, loadedModels] = await Promise.all([
        watchBridge.configuration(),
        watchBridge.hearingModels(),
      ]);
      configuration.value = loadedConfiguration;
      hearingModels.value = loadedModels;
      areas.value = await watchBridge.areas();
      if (ready.value) await refreshAccount();
    }),
  );

  return {
    events,
    state,
    account,
    areas,
    configuration,
    hearingModels,
    error,
    pending,
    ready,
    active,
    attached,
    start: (options: StartWatchOptions) => run('start', () => watchBridge.start(options)),
    stop: () => run('stop', () => watchBridge.stop()),
    login: () =>
      run('login', async () => {
        account.value = await watchBridge.login();
      }),
    logout: () =>
      run('logout', async () => {
        await watchBridge.logout();
        account.value = undefined;
      }),
    refreshAccount: () => run('refresh', refreshAccount),
    installHearingModels: () =>
      run('install-models', async () => {
        hearingModels.value = await watchBridge.installHearingModels();
      }),
  };
}
