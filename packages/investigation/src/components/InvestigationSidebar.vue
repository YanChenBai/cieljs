<script setup lang="ts">
import { Button, Popover } from '@vuetify/v0/components';
import { shallowRef } from 'vue';

import type {
  InvestigationConversation,
  InvestigationRoom,
  InvestigationTargetInput,
} from '../types.ts';
import InvestigationTargetPicker from './InvestigationTargetPicker.vue';

defineProps<{
  conversations: readonly InvestigationConversation[];
  selectedSessionId?: string;
  currentRoom?: InvestigationRoom;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  create: [target: InvestigationTargetInput];
  select: [sessionId: string];
}>();

const createOpen = shallowRef(false);

function create(target: InvestigationTargetInput) {
  createOpen.value = false;
  emit('create', target);
}

function sessionTime(createdAt: number) {
  return new Date(createdAt).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
</script>

<template>
  <aside id="investigation-sidebar" class="investigation-sidebar" aria-label="调查会话">
    <div class="investigation-sidebar-header">
      <span>Investigation</span>
      <Popover.Root
        v-model="createOpen"
        position-area="bottom span-right"
        position-try="most-width bottom"
      >
        <Popover.Activator
          class="investigation-icon-button"
          :disabled="disabled"
          aria-label="新建调查"
          title="新建调查"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </Popover.Activator>
        <Popover.Content class="investigation-create-popover">
          <InvestigationTargetPicker
            :current-room="currentRoom"
            :disabled="disabled"
            @create="create"
          />
        </Popover.Content>
      </Popover.Root>
    </div>

    <div class="investigation-session-list">
      <p v-if="!conversations.length" class="investigation-session-empty">还没有调查记录</p>
      <Button.Root
        v-for="item in conversations.toReversed()"
        :key="item.sessionId"
        class="investigation-session"
        :class="{ active: item.sessionId === selectedSessionId }"
        :disabled="disabled"
        @click="emit('select', item.sessionId)"
      >
        <span class="investigation-session-label">{{ item.title }}</span>
        <span class="investigation-session-meta">
          <span>{{ item.target.type === 'global' ? '全局' : `房间 ${item.target.roomId}` }}</span>
          <time :datetime="new Date(item.createdAt).toISOString()">
            {{ sessionTime(item.createdAt) }}
          </time>
        </span>
      </Button.Root>
    </div>
  </aside>
</template>
