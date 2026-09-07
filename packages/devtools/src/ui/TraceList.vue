<script setup lang="ts">
import { Button } from "@vuetify/v0/components";
import type { TraceEntry } from "../protocol/index.ts";
defineProps<{ entries: TraceEntry[]; selectedId: string }>();
defineEmits<{ select: [entry: TraceEntry] }>();
function duration(entry: TraceEntry) {
  const elapsed = Math.max(0, (entry.endedAt ?? Date.now()) - entry.startedAt);
  const value = elapsed < 1000 ? `${Math.round(elapsed)} ms` : `${(elapsed / 1000).toFixed(1)} s`;
  return entry.status === "running" ? `${value}…` : value;
}
</script>
<template>
  <div class="dt-list">
    <div class="dt-list-heading"><span>Name</span><span>耗时</span></div>
    <Button.Root
      v-for="entry in entries"
      :key="entry.id"
      class="dt-row"
      :class="{ selected: selectedId === entry.id }"
      :aria-pressed="selectedId === entry.id"
      @click="$emit('select', entry)"
    >
      <span class="dt-step-icon" :data-kind="entry.kind">
        {{ entry.kind === "tool" ? "{}" : entry.kind === "message" ? "≡" : "◇" }}
      </span>
      <span class="dt-step-name">{{ entry.label ? `${entry.label} · ` : "" }}{{ entry.name }}</span>
      <span class="dt-duration" :title="entry.status === 'running' ? '执行中' : '执行耗时'">
        {{ duration(entry) }}
      </span>
    </Button.Root>
    <p v-if="!entries.length" class="dt-empty">暂无执行步骤</p>
  </div>
</template>
