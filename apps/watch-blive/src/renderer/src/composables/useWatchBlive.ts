import { computed, onMounted, onUnmounted, shallowRef } from 'vue';

import type { WatchBridgeEvent, WatchSnapshot } from '../../../shared/ipc.ts';
import type { Account, LiveArea, StartWatchOptions } from '../../../shared/types.ts';
import { watchBridge } from '../rpc.ts';

export function useWatchBlive() {
  const events = shallowRef<{ id: number; time: string; text: string }[]>([]);
  let eventId = 0;
  const state = shallowRef<WatchSnapshot>({ status: 'idle' });
  const account = shallowRef<Account>();
  const areas = shallowRef<readonly LiveArea[]>([]);
  const error = shallowRef('');
  const pending = shallowRef('');
  const ready = shallowRef(false);
  const active = computed(() => !['idle', 'closed'].includes(state.value.status));

  function receive(event: WatchBridgeEvent) {
    let text = '';
    if (event.type === 'room_opened')
      text = `进入 ${event.room.streamerName} · ${event.room.roomId}`;
    if (event.type === 'room_closed') text = `离开 ${event.roomId}：${event.reason}`;
    if (event.type === 'exploration_started') text = `正在寻找直播间 · 分区 ${event.areaId}`;
    if (event.type === 'room_selected') text = `选中直播间 ${event.roomId}`;
    if (event.type === 'danmaku_delivered') text = `已发送：${event.content}`;
    if (event.type === 'danmaku_simulated') text = `模拟弹幕：${event.content}`;
    if (event.type === 'error') text = event.message;
    if (text)
      events.value = [
        ...events.value,
        { id: ++eventId, time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), text },
      ].slice(-60);
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
      state.value = await watchBridge.snapshot();
      areas.value = await watchBridge.areas();
      if (ready.value) await refreshAccount();
    }),
  );

  return {
    events,
    state,
    account,
    areas,
    error,
    pending,
    ready,
    active,
    attached,
    start: (options: StartWatchOptions) => run('start', () => watchBridge.start(options)),
    stop: () => run('stop', () => watchBridge.stop()),
    login: () => run('login', () => watchBridge.login()),
    logout: () =>
      run('logout', async () => {
        await watchBridge.logout();
        account.value = undefined;
      }),
    refreshAccount: () => run('refresh', refreshAccount),
  };
}
