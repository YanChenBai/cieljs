<script setup lang="ts">
import { InvestigationChat } from '@cieljs/investigation';
import { PanelLeftClose, PanelLeftOpen } from '@lucide/vue';
import { Button } from '@vuetify/v0/components';
import { onMounted, onUnmounted, shallowRef } from 'vue';

import type { RoomInfo } from '../../../shared/types.ts';
import { rpc, watchBridge } from '../rpc.ts';

import '@cieljs/console/style.css';
import '@cieljs/investigation/style.css';

const currentRoom = shallowRef<RoomInfo>();
const sidebarCollapsed = shallowRef(false);
let unsubscribe: (() => void) | undefined;

onMounted(async () => {
  const snapshot = await watchBridge.snapshot();
  currentRoom.value = snapshot.room;

  unsubscribe = watchBridge.onEvent(event => {
    if (event.type === 'room_opened') {
      currentRoom.value = event.room;
    } else if (event.type === 'status' && event.status === 'idle') {
      currentRoom.value = undefined;
    }
  });
});

onUnmounted(() => unsubscribe?.());
</script>

<template>
  <div class="flex h-screen flex-col overflow-hidden">
    <header class="app-header flex h-9 shrink-0 items-center gap-2 pr-[138px] pl-3 select-none">
      <Button.Root
        class="action icon-button"
        :aria-expanded="!sidebarCollapsed"
        aria-controls="investigation-sidebar"
        :aria-label="sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'"
        :title="sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'"
        @click="sidebarCollapsed = !sidebarCollapsed"
      >
        <PanelLeftOpen v-if="sidebarCollapsed" :size="18" />
        <PanelLeftClose v-else :size="18" />
      </Button.Root>
      <strong class="text-accent text-[14px] font-[650]">Ciel</strong>
      <span class="text-muted text-[12px]">· Investigation</span>
    </header>
    <main class="min-h-0 flex-1">
      <InvestigationChat
        v-model:sidebar-collapsed="sidebarCollapsed"
        :client="rpc.investigation"
        :trace-client="rpc.investigationTrace"
        :current-room="currentRoom"
      />
    </main>
  </div>
</template>
