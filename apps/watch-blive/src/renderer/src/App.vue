<script setup lang="ts">
import { CielDevtools } from '@cieljs/devtools';
import { Button } from '@vuetify/v0/components';
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-vue-next';
import { computed } from 'vue';

import AccountControls from './components/AccountControls.vue';

import '@cieljs/devtools/style.css';
import EventTimeline from './components/EventTimeline.vue';
import LiveRoomWebview from './components/LiveRoomWebview.vue';
import RuntimeSetup from './components/RuntimeSetup.vue';
import WatchControls from './components/WatchControls.vue';
import { useSidebar } from './composables/use-sidebar.ts';
import { useWatchBlive } from './composables/use-watch-blive.ts';
import { rpc } from './rpc.ts';

const {
  events,
  state,
  account,
  areas,
  configuration,
  hearingModels,
  error,
  pending,
  ready,
  active,
  attached,
  start,
  stop,
  login,
  logout,
  refreshAccount,
  installHearingModels,
} = useWatchBlive();

const { collapsed, width, maxWidth, dragging, startDrag, moveDrag, endDrag, keyboardResize } =
  useSidebar();
const right = useSidebar('right');

const roomTitle = computed(() => {
  const room = state.value.room;
  if (!room) return '一起看看，今天有什么有趣的直播';

  return room.streamerName + ' · ' + room.title;
});
</script>

<template>
  <div class="flex h-screen flex-col overflow-hidden">
    <header
      class="app-header flex h-9 shrink-0 basis-9 items-center gap-3 pr-[148px] pl-2.5 select-none"
    >
      <Button.Root
        class="action icon-button"
        :aria-expanded="!collapsed"
        aria-controls="watch-sidebar"
        :aria-label="collapsed ? '展开侧边栏' : '收起侧边栏'"
        @click="collapsed = !collapsed"
      >
        <PanelLeftOpen v-if="collapsed" :size="16" />
        <PanelLeftClose v-else :size="16" />
      </Button.Root>
      <strong class="text-accent text-[13px] font-[650] whitespace-nowrap"
        >Ciel <span class="text-muted text-[11px] font-normal">· Watch Blive</span></strong
      >
      <span class="text-muted truncate text-[11px]">{{ roomTitle }}</span>
      <span class="text-muted ml-auto shrink-0 text-[11px]">{{ state.status }}</span>
      <Button.Root
        class="action icon-button"
        :aria-expanded="!right.collapsed.value"
        aria-controls="watch-devtools"
        aria-label="展开或收起 DevTools"
        @click="right.collapsed.value = !right.collapsed.value"
      >
        <PanelRightOpen v-if="right.collapsed.value" :size="16" />
        <PanelRightClose v-else :size="16" />
      </Button.Root>
    </header>
    <main
      class="workspace grid min-h-0 flex-1 p-0"
      :class="{
        resizing: dragging || right.dragging.value,
        'grid-cols-[var(--sidebar-width)_5px_minmax(0,1fr)]': !collapsed,
        'grid-cols-[minmax(0,1fr)] pl-2!': collapsed,
      }"
      :style="{ '--sidebar-width': `${width}px`, '--devtools-width': `${right.width.value}px` }"
    >
      <aside
        v-show="!collapsed"
        id="watch-sidebar"
        class="flex min-h-0 max-w-[560px] min-w-[260px] flex-col overflow-auto"
      >
        <AccountControls
          :account="account"
          :pending="pending"
          :ready="ready"
          @login="login"
          @logout="logout"
          @refresh="refreshAccount"
        />
        <RuntimeSetup
          :configuration="configuration"
          :models="hearingModels"
          :pending="pending"
          @install-models="installHearingModels"
        />
        <WatchControls
          :areas="areas"
          :active="active"
          :pending="pending"
          :ready="!!configuration?.valid && !!hearingModels?.valid"
          :live-page-ready="ready"
          @start="start"
          @stop="stop"
        />
        <EventTimeline :events="events" />
      </aside>
      <div
        v-show="!collapsed"
        class="resize-handle my-2 rounded-lg"
        role="separator"
        tabindex="0"
        aria-label="调整侧边栏宽度"
        aria-orientation="vertical"
        aria-controls="watch-sidebar"
        :aria-valuenow="width"
        :aria-valuemin="260"
        :aria-valuemax="maxWidth"
        @pointerdown="startDrag"
        @pointermove="moveDrag"
        @pointerup="endDrag"
        @pointercancel="endDrag"
        @lostpointercapture="endDrag"
        @keydown="keyboardResize"
      />
      <div
        class="viewer-container bg-surface grid min-h-0 min-w-0 overflow-hidden rounded-tl-xl border border-r-0 border-b-0 border-[#ffffff16] [box-shadow:0_2px_12px_#00000018,inset_0_1px_0_#ffffff04]"
        :class="{
          'grid-cols-[minmax(240px,1fr)_3px_var(--devtools-width)]': !right.collapsed.value,
          'grid-cols-[minmax(0,1fr)]': right.collapsed.value,
        }"
      >
        <section class="bg-surface flex min-h-0 min-w-0 flex-col overflow-hidden">
          <p
            v-if="error"
            class="m-0 bg-[#442936] px-4 py-2.5 text-[12px] [overflow-wrap:anywhere] text-[#ffc1d2]"
            role="alert"
          >
            {{ error }}
          </p>
          <LiveRoomWebview @ready="attached" @error="error = $event" />
        </section>
        <div
          v-show="!right.collapsed.value"
          class="resize-handle"
          role="separator"
          tabindex="0"
          aria-label="调整 DevTools 宽度"
          aria-orientation="vertical"
          aria-controls="watch-devtools"
          :aria-valuenow="right.width.value"
          :aria-valuemin="260"
          :aria-valuemax="right.maxWidth.value"
          @pointerdown="right.startDrag"
          @pointermove="right.moveDrag"
          @pointerup="right.endDrag"
          @pointercancel="right.endDrag"
          @lostpointercapture="right.endDrag"
          @keydown="right.keyboardResize"
        />
        <aside
          v-show="!right.collapsed.value"
          id="watch-devtools"
          class="min-h-0 min-w-0 overflow-hidden"
        >
          <CielDevtools :client="rpc.devtools" />
        </aside>
      </div>
    </main>
  </div>
</template>
