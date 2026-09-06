<script setup lang="ts">
import { Button } from "@vuetify/v0/components";
import { LoaderCircle, LogIn, LogOut, RefreshCw, UserRound } from "lucide-vue-next";
import type { Account } from "../../../shared/types.ts";

defineProps<{ account?: Account; pending: string; ready: boolean }>();
defineEmits<{ login: []; logout: []; refresh: [] }>();
</script>

<template>
  <section class="account">
    <div class="account-profile">
      <img
        v-if="account?.face"
        :src="account.face"
        class="avatar"
        alt="账号头像"
        referrerpolicy="no-referrer"
      />
      <span v-else class="avatar"><UserRound :size="20" /></span>
      <div class="account-copy">
        <strong>{{ account?.name ?? "尚未登录" }}</strong
        ><small>{{ account ? `UID ${account.uid}` : "和 Ciel 一起看直播" }}</small>
      </div>
      <Button.Root
        v-if="account"
        class="action icon-button"
        aria-label="退出登录"
        title="退出登录"
        :disabled="!!pending"
        :aria-busy="pending === 'logout'"
        @click="$emit('logout')"
        ><LoaderCircle v-if="pending === 'logout'" class="spinning" :size="14" /><LogOut
          v-else
          :size="14"
      /></Button.Root>
      <Button.Root
        v-if="!account"
        class="action icon-button"
        aria-label="登录 Bilibili"
        title="登录 Bilibili"
        :disabled="!ready || !!pending"
        :aria-busy="pending === 'login'"
        @click="$emit('login')"
        ><LoaderCircle v-if="pending === 'login'" class="spinning" :size="14" /><LogIn
          v-else
          :size="14"
      /></Button.Root>
      <Button.Root
        class="action icon-button"
        :disabled="!ready || !!pending"
        aria-label="刷新登录状态"
        title="刷新登录状态"
        @click="$emit('refresh')"
        ><RefreshCw :size="15" :class="{ spinning: pending === 'refresh' }"
      /></Button.Root>
    </div>
    <p v-if="!account" class="hint">在直播页面完成登录后，点刷新图标同步账号。</p>
  </section>
</template>
