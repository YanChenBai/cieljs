<script setup lang="ts">
import { computed, shallowRef } from 'vue';

import type { DevtoolsClient } from '../../../client/index.ts';
import type { TraceEntry } from '../../../protocol/index.ts';
import { groupTraceSteps } from '../../utils/trace-entries.ts';
import ContentRenderer from '../content/ContentRenderer.vue';
import TraceDetail from './TraceDetail.vue';
import TraceList from './TraceList.vue';

const props = defineProps<{
  client: DevtoolsClient;
  steps: TraceEntry[];
  query: string;
  hasOlder: boolean;
  loadingOlder: boolean;
}>();
const emit = defineEmits<{ older: [] }>();

const selectedId = shallowRef('');
const grouped = computed(() => groupTraceSteps(props.steps).toReversed());
const selected = computed(() => grouped.value.find(entry => entry.id === selectedId.value));
const filtered = computed(() =>
  grouped.value.filter(entry =>
    `${entry.label ?? ''} ${entry.name} ${entry.id} ${entry.sessionId} ${entry.toolCallId ?? ''}`
      .toLowerCase()
      .includes(props.query.toLowerCase()),
  ),
);

const split = shallowRef(36);

function loadOlder(event: Event) {
  const element = event.currentTarget as HTMLElement;
  if (
    props.hasOlder &&
    !props.loadingOlder &&
    element.scrollHeight - element.scrollTop - element.clientHeight < 80
  ) {
    emit('older');
  }
}

function resize(event: PointerEvent) {
  const handle = event.currentTarget as HTMLElement;
  handle.setPointerCapture(event.pointerId);
}
function moveSplit(event: PointerEvent) {
  const handle = event.currentTarget as HTMLElement;
  if (!handle.hasPointerCapture(event.pointerId)) return;

  const bounds = handle.parentElement!.getBoundingClientRect();
  split.value = Math.max(20, Math.min(75, ((event.clientX - bounds.left) / bounds.width) * 100));
}
</script>

<template>
  <div
    class="dt-network"
    :class="{ 'has-detail': selected }"
    :style="{ '--dt-split': `${split}%` }"
  >
    <div class="dt-list-panel" @scroll.passive="loadOlder">
      <TraceList :entries="filtered" :selected-id="selectedId" @select="selectedId = $event.id" />
      <p v-if="hasOlder" class="dt-empty">
        {{ loadingOlder ? '正在加载历史记录…' : '向下滚动加载历史记录' }}
      </p>
    </div>
    <div
      v-if="selected"
      class="dt-resizer"
      role="separator"
      aria-label="调整执行列表宽度"
      aria-orientation="vertical"
      :aria-valuenow="Math.round(split)"
      aria-valuemin="20"
      aria-valuemax="75"
      tabindex="0"
      @pointerdown="resize"
      @pointermove="moveSplit"
      @keydown.left.prevent="split = Math.max(20, split - 2)"
      @keydown.right.prevent="split = Math.min(75, split + 2)"
    />
    <TraceDetail v-if="selected" :client="client" :entry="selected" @close="selectedId = ''">
      <template #content="scope">
        <slot name="content" v-bind="scope">
          <ContentRenderer :value="scope.value" />
        </slot>
      </template>
    </TraceDetail>
  </div>
</template>
