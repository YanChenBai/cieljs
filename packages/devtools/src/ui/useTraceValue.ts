import { shallowRef, watch } from 'vue';

import type { DevtoolsClient } from '../client/index.ts';
import type { TraceEntry } from '../protocol/index.ts';

export type TraceSection = 'input' | 'output' | 'raw';

/** 仅加载当前查看的内容；切换记录或版本时取消旧请求，避免旧响应覆盖新选择。 */
export function useTraceValue(
  client: () => DevtoolsClient,
  entry: () => TraceEntry,
  section: () => TraceSection | undefined,
) {
  const value = shallowRef<unknown>();
  const error = shallowRef('');
  const loading = shallowRef(false);

  watch(
    () => [client(), entry().id, entry().revision, section()] as const,
    async (_next, _previous, onCleanup) => {
      const controller = new AbortController();
      onCleanup(() => controller.abort());
      const selectionChanged =
        _next[0] !== _previous?.[0] || _next[1] !== _previous?.[1] || _next[3] !== _previous?.[3];
      if (selectionChanged) value.value = undefined;
      error.value = '';
      loading.value = false;

      const key = section();
      const reference = key ? entry()[key] : undefined;
      if (!reference) return;

      loading.value = true;
      try {
        const result = await client().values.get(reference, { signal: controller.signal });
        if (!controller.signal.aborted) value.value = result;
      } catch (cause) {
        if (!controller.signal.aborted) error.value = String(cause);
      } finally {
        if (!controller.signal.aborted) loading.value = false;
      }
    },
    { immediate: true },
  );

  return { value, error, loading };
}
