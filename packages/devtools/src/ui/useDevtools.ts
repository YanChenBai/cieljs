import { onMounted, onUnmounted, shallowRef } from "vue";
import type { DevtoolsClient } from "../client/index.ts";
import type { TraceEntry } from "../protocol/index.ts";
export function useDevtools(client: DevtoolsClient) {
  const entries = shallowRef<TraceEntry[]>([]);
  const steps = shallowRef<TraceEntry[]>([]);
  const error = shallowRef("");
  const connected = shallowRef(false);
  const hasOlder = shallowRef(true);
  let controller: AbortController | undefined;
  let clearSequence = 0;
  async function connect() {
    controller?.abort();
    controller = new AbortController();
    const current = controller;
    error.value = "";
    try {
      const updates = await client.updates(undefined, { signal: current.signal });
      for await (const incoming of updates) {
        if (current.signal.aborted) break;
        connected.value = true;
        const updatedSteps = new Map(steps.value.map((step) => [step.id, step]));
        for (const step of incoming.steps)
          if (step.sequence > clearSequence) updatedSteps.set(step.id, step);
        steps.value = [...updatedSteps.values()]
          .sort((a, b) => a.sequence - b.sequence)
          .slice(-600);
        const merged = new Map(entries.value.map((entry) => [entry.id, entry]));
        for (const entry of incoming.entries)
          if (entry.sequence > clearSequence) merged.set(entry.id, entry);
        entries.value = [...merged.values()].sort((a, b) => a.sequence - b.sequence).slice(-600);
      }
    } catch (cause) {
      if (!current.signal.aborted) {
        error.value = String(cause);
        connected.value = false;
      }
    }
  }
  async function older() {
    try {
      const incoming = await client.steps.list({
        cursor: steps.value[0]?.sequence,
        limit: 100,
      });
      hasOlder.value = incoming.length === 100;
      steps.value = [...incoming, ...steps.value].slice(0, 600);
    } catch (cause) {
      error.value = String(cause);
    }
  }
  function clear() {
    clearSequence = steps.value.at(-1)?.sequence ?? clearSequence;
    entries.value = [];
    steps.value = [];
  }
  onMounted(connect);
  onUnmounted(() => controller?.abort());
  return { steps, entries, error, connected, hasOlder, older, connect, clear };
}
