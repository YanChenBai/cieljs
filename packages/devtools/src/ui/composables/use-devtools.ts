import { onMounted, onUnmounted, shallowRef } from 'vue';

import type { DevtoolsClient } from '../../client/index.ts';
import type { TraceEntry } from '../../protocol/index.ts';
import { mergeTraceEntries } from '../utils/trace-entries.ts';

const VIEW_CAPACITY = 600;
const PAGE_SIZE = 100;

export function useDevtools(client: DevtoolsClient) {
  const entries = shallowRef<TraceEntry[]>([]);
  const steps = shallowRef<TraceEntry[]>([]);
  const error = shallowRef('');
  const connected = shallowRef(false);
  const hasOlder = shallowRef(true);
  const loadingOlder = shallowRef(false);
  let controller: AbortController | undefined;
  let historyController: AbortController | undefined;

  // Entry 和原始事件各有自己的序号，清空水位不能混用。
  let clearedEntrySequence = 0;
  let clearedStepSequence = 0;

  async function connect() {
    controller?.abort();

    const current = new AbortController();
    controller = current;
    connected.value = false;
    error.value = '';

    try {
      const updates = await client.updates(undefined, { signal: current.signal });
      for await (const incoming of updates) {
        if (current.signal.aborted) break;

        connected.value = true;
        steps.value = mergeTraceEntries(
          steps.value,
          incoming.steps.filter(step => step.sequence > clearedStepSequence),
        );
        entries.value = mergeTraceEntries(
          entries.value,
          incoming.entries.filter(entry => entry.sequence > clearedEntrySequence),
        ).slice(-VIEW_CAPACITY);
      }
    } catch (cause) {
      if (!current.signal.aborted) error.value = String(cause);
    } finally {
      // 旧连接结束时不能覆盖已经建立的新连接状态。
      if (controller === current) connected.value = false;
    }
  }

  async function older() {
    if (loadingOlder.value || !hasOlder.value) return;
    const current = new AbortController();
    historyController = current;
    loadingOlder.value = true;
    try {
      const incoming = await client.steps.list(
        { cursor: steps.value[0]?.sequence, limit: PAGE_SIZE },
        { signal: current.signal },
      );
      if (current.signal.aborted) return;

      const visible = incoming.filter(step => step.sequence > clearedStepSequence);
      hasOlder.value = incoming.length === PAGE_SIZE && visible.length === incoming.length;
      steps.value = mergeTraceEntries(steps.value, visible);
    } catch (cause) {
      if (!current.signal.aborted) error.value = String(cause);
    } finally {
      if (historyController === current) loadingOlder.value = false;
    }
  }

  function clear() {
    historyController?.abort();
    loadingOlder.value = false;
    clearedEntrySequence = Math.max(
      clearedEntrySequence,
      ...entries.value.map(entry => entry.sequence),
    );
    clearedStepSequence = Math.max(clearedStepSequence, ...steps.value.map(step => step.sequence));

    entries.value = [];
    steps.value = [];
    hasOlder.value = false;
  }

  onMounted(connect);
  onUnmounted(() => {
    controller?.abort();
    historyController?.abort();
  });

  return { steps, entries, error, connected, hasOlder, loadingOlder, older, connect, clear };
}
