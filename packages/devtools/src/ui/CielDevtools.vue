<script setup lang="ts">
import { computed, shallowRef } from "vue";
import { Button, Tabs } from "@vuetify/v0/components";
import type { DevtoolsClient } from "../client/index.ts";
import TraceList from "./TraceList.vue";
import MessageView from "./MessageView.vue";
import TraceDetail from "./TraceDetail.vue";
import ContentRenderer from "./ContentRenderer.vue";
import { vFollowScroll } from "./follow-scroll.ts";
import type { TraceEntry } from "../protocol/index.ts";
import { useDevtools } from "./useDevtools.ts";
const props = defineProps<{ client: DevtoolsClient }>();
const { steps, entries, error, hasOlder, older, connect, clear } = useDevtools(props.client);
const query = shallowRef("");
const selectedId = shallowRef("");
const grouped = computed(() => {
  const records = new Map<string, TraceEntry>();
  for (const step of steps.value) {
    const key =
      step.kind === "message" && step.messageId
        ? `${step.runId}:message:${step.messageId}`
        : step.kind === "tool" && step.toolCallId
          ? `${step.runId}:tool:${step.toolCallId}`
          : step.id;
    const previous = records.get(key);
    records.set(key, {
      ...step,
      id: key,
      revision: step.sequence,
      startedAt: previous?.startedAt ?? step.startedAt,
      input: step.input ?? previous?.input,
      output: step.output ?? previous?.output,
      name:
        step.kind === "message" ? "message" : step.kind === "tool" ? "tool_execution" : step.name,
    });
  }
  return [...records.values()];
});
const selected = computed(() => grouped.value.find((entry) => entry.id === selectedId.value));
const filtered = computed(() =>
  grouped.value.filter((entry) =>
    `${entry.label ?? ""} ${entry.name} ${entry.id} ${entry.sessionId} ${entry.toolCallId ?? ""}`
      .toLowerCase()
      .includes(query.value.toLowerCase()),
  ),
);
const messages = computed(() =>
  entries.value.filter((entry) => entry.kind === "message").slice(-50),
);
const tab = shallowRef("conversation");
const split = shallowRef(36);
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
  <section class="ciel-devtools" aria-label="Ciel DevTools">
    <Tabs.Root v-model="tab">
      <div class="dt-toolbar">
        <Tabs.List aria-label="DevTools 视图" class="dt-tabs">
          <Tabs.Item value="conversation" class="dt-tab">对话</Tabs.Item>
          <Tabs.Item value="execution" class="dt-tab">执行记录</Tabs.Item>
        </Tabs.List>
        <input
          v-if="tab === 'execution'"
          v-model="query"
          class="dt-filter"
          type="search"
          aria-label="搜索执行记录"
          placeholder="搜索记录…"
        />
        <Button.Root
          class="dt-button dt-clear"
          aria-label="清空视图"
          title="清空视图"
          @click="clear"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" />
          </svg>
        </Button.Root>
      </div>
      <p v-if="error" class="dt-error">
        {{ error }}<Button.Root class="dt-button" @click="connect">重新连接</Button.Root>
      </p>
      <Tabs.Panel
        value="execution"
        class="dt-network"
        :class="{ 'has-detail': selected }"
        :style="{ '--dt-split': `${split}%` }"
      >
        <div v-follow-scroll class="dt-list-panel">
          <TraceList
            :entries="filtered"
            :selected-id="selectedId"
            @select="selectedId = $event.id"
          />
          <Button.Root v-if="hasOlder" class="dt-button" @click="older"> 加载历史记录</Button.Root>
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
      </Tabs.Panel>
      <Tabs.Panel v-follow-scroll value="conversation" class="dt-conversation">
        <p v-if="!messages.length" class="dt-empty">开始观看后，对话会出现在这里。</p>
        <MessageView v-for="entry in messages" :key="entry.id" :client="client" :entry="entry">
          <template #content="scope">
            <slot name="content" v-bind="scope">
              <ContentRenderer :value="scope.value" :final="entry.status !== 'running'" />
            </slot>
          </template>
        </MessageView>
      </Tabs.Panel>
    </Tabs.Root>
  </section>
</template>
