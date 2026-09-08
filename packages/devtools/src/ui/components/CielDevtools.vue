<script setup lang="ts">
import { Button, Tabs } from '@vuetify/v0/components';
import { computed, shallowRef } from 'vue';

import type { DevtoolsClient } from '../../client/index.ts';
import { useDevtools } from '../composables/use-devtools.ts';
import { vFollowScroll } from '../directives/follow-scroll.ts';
import ContentRenderer from './content/ContentRenderer.vue';
import MessageView from './conversation/MessageView.vue';
import ExecutionView from './execution/ExecutionView.vue';

const props = withDefaults(defineProps<{ client: DevtoolsClient; autoScroll?: boolean }>(), {
  autoScroll: true,
});

const { steps, entries, error, hasOlder, loadingOlder, older, connect, clear } = useDevtools(
  props.client,
);

const query = shallowRef('');

const messages = computed(() => entries.value.filter(entry => entry.kind === 'message').slice(-50));

const tab = shallowRef('conversation');
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
      <Tabs.Panel value="execution" class="dt-execution-panel">
        <ExecutionView
          :client="client"
          :steps="steps"
          :query="query"
          :has-older="hasOlder"
          :loading-older="loadingOlder"
          @older="older"
        >
          <template #content="scope">
            <slot name="content" v-bind="scope"><ContentRenderer :value="scope.value" /></slot>
          </template>
        </ExecutionView>
      </Tabs.Panel>
      <Tabs.Panel v-follow-scroll="autoScroll" value="conversation" class="dt-conversation">
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
