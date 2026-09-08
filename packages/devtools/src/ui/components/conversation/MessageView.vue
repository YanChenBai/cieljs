<script setup lang="ts">
import { computed } from 'vue';

import type { DevtoolsClient } from '../../../client/index.ts';
import type { TraceEntry } from '../../../protocol/index.ts';
import { useTraceValue } from '../../composables/use-trace-value.ts';
import ContentRenderer from '../content/ContentRenderer.vue';

const props = defineProps<{ client: DevtoolsClient; entry: TraceEntry }>();

const { value, error } = useTraceValue(
  () => props.client,
  () => props.entry,
  () => 'output',
);

const author = computed(() => {
  if (props.entry.name === 'assistant') return 'Ciel';
  if (props.entry.name === 'user') return '观察输入';

  return props.entry.label ?? props.entry.name;
});
</script>

<template>
  <article class="dt-message">
    <header>
      <strong>
        {{ author }}
      </strong>
      <small>
        {{ entry.status === 'running' ? '生成中…' : entry.model?.name }}
      </small>
    </header>
    <p v-if="error" class="dt-error">{{ error }}</p>
    <slot
      v-else
      name="content"
      :entry="entry"
      section="output"
      :value="value"
      :default-renderer="ContentRenderer"
    >
      <ContentRenderer :value="value" :final="entry.status !== 'running'" />
    </slot>
  </article>
</template>
