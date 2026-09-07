<script setup lang="ts">
import { shallowRef, watch } from "vue";
import type { DevtoolsClient } from "../client/index.ts";
import type { TraceEntry } from "../protocol/index.ts";
import ContentRenderer from "./ContentRenderer.vue";
const props = defineProps<{ client: DevtoolsClient; entry: TraceEntry }>();
const value = shallowRef<unknown>();
const error = shallowRef("");
watch(
  () => [props.entry.id, props.entry.revision],
  async (_next, _old, onCleanup) => {
    let disposed = false;
    onCleanup(() => {
      disposed = true;
    });
    try {
      const content = await props.client.messages.get({ messageId: props.entry.id });
      if (!disposed) {
        value.value = content;
        error.value = "";
      }
    } catch (cause) {
      if (!disposed) error.value = String(cause);
    }
  },
  { immediate: true },
);
</script>
<template>
  <article class="dt-message">
    <header>
      <strong>
        {{
          entry.name === "assistant"
            ? "Ciel"
            : entry.name === "user"
              ? "观察输入"
              : (entry.label ?? entry.name)
        }}
      </strong>
      <small>
        {{ entry.status === "running" ? "生成中…" : entry.model?.name }}
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
