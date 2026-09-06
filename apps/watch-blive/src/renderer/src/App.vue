<script setup lang="ts">
import { Button } from "@vuetify/v0/components";
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-vue-next";
import { CielDevtools } from "@cieljs/devtools";
import { rpc } from "./rpc.ts";
import "@cieljs/devtools/style.css";
import EventTimeline from "./components/EventTimeline.vue";
import WatchControls from "./components/WatchControls.vue";
import AccountControls from "./components/AccountControls.vue";
import LiveRoomWebview from "./components/LiveRoomWebview.vue";
import { useWatchBlive } from "./composables/useWatchBlive.ts";
import { useSidebar } from "./composables/useSidebar.ts";

const {
  events,
  state,
  account,
  areas,
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
} = useWatchBlive();
const { collapsed, width, maxWidth, dragging, startDrag, moveDrag, endDrag, keyboardResize } =
  useSidebar();
const right = useSidebar("right");
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <Button.Root
        class="action icon-button"
        :aria-expanded="!collapsed"
        aria-controls="watch-sidebar"
        :aria-label="collapsed ? '展开侧边栏' : '收起侧边栏'"
        @click="collapsed = !collapsed"
        ><PanelLeftOpen v-if="collapsed" :size="16" /><PanelLeftClose v-else :size="16"
      /></Button.Root>
      <strong>Ciel <span>· Watch Blive</span></strong>
      <span class="room-title">{{
        state.room
          ? `${state.room.streamerName} · ${state.room.title}`
          : "一起看看，今天有什么有趣的直播"
      }}</span>
      <span class="status">{{ state.status }}</span>
      <Button.Root
        class="action icon-button"
        :aria-expanded="!right.collapsed.value"
        aria-controls="watch-devtools"
        aria-label="展开或收起 DevTools"
        @click="right.collapsed.value = !right.collapsed.value"
        ><PanelRightOpen v-if="right.collapsed.value" :size="16" /><PanelRightClose
          v-else
          :size="16"
      /></Button.Root>
    </header>
    <main
      class="workspace"
      :class="{
        resizing: dragging || right.dragging.value,
        collapsed,
        'devtools-collapsed': right.collapsed.value,
      }"
      :style="{ '--sidebar-width': `${width}px`, '--devtools-width': `${right.width.value}px` }"
    >
      <aside v-show="!collapsed" id="watch-sidebar" class="sidebar">
        <AccountControls
          :account="account"
          :pending="pending"
          :ready="ready"
          @login="login"
          @logout="logout"
          @refresh="refreshAccount"
        />
        <WatchControls
          :areas="areas"
          :active="active"
          :pending="pending"
          :ready="ready"
          @start="start"
          @stop="stop"
        />
        <EventTimeline :events="events" />
      </aside>
      <div
        v-show="!collapsed"
        class="sidebar-resizer"
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
      <div class="viewer-container" :class="{ 'devtools-collapsed': right.collapsed.value }">
        <section class="live-panel">
          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <LiveRoomWebview @ready="attached" @error="error = $event" />
        </section>
        <div
          v-show="!right.collapsed.value"
          class="sidebar-resizer"
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
        <aside v-show="!right.collapsed.value" id="watch-devtools" class="devtools-panel">
          <CielDevtools :client="rpc.devtools" />
        </aside>
      </div>
    </main>
  </div>
</template>
