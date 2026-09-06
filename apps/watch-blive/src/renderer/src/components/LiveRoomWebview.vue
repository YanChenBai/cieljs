<script setup lang="ts">
import { watchBridge } from "../rpc.ts";

import { onMounted, onUnmounted, useTemplateRef } from "vue";

interface LiveGuest extends HTMLElement {
  getWebContentsId(): number;
}
const emit = defineEmits<{ ready: []; error: [message: string] }>();
const guest = useTemplateRef<LiveGuest>("guest");
let attachedId: number | undefined;

async function attach() {
  const id = guest.value!.getWebContentsId();
  // dom-ready 每次导航都会触发；同一个 guest 只交接一次，避免清空当前房间状态。
  if (id === attachedId) return;
  try {
    await watchBridge.attachLiveWebContents({ id });
    attachedId = id;
    emit("ready");
  } catch (error) {
    emit("error", error instanceof Error ? error.message : String(error));
  }
}
onMounted(() => guest.value!.addEventListener("dom-ready", attach));
onUnmounted(() => guest.value?.removeEventListener("dom-ready", attach));
</script>

<template>
  <webview
    ref="guest"
    class="live-guest"
    partition="persist:watch-blive"
    src="https://live.bilibili.com/"
  />
</template>

<style scoped>
.live-guest {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 420px;
}
</style>
