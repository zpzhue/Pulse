<script setup lang="ts">
import { Download, LayoutDashboard, PlusCircle, History, Settings } from "lucide-vue-next";

/** On macOS the Overlay traffic-light buttons float in the top-left 80×38px area.
 *  We reserve vertical space at the top of the sidebar so the logo is not covered. */
const isMac =
  /Mac|iPhone|iPad/.test(navigator.platform) || /Mac OS X/.test(navigator.userAgent);

const navItems = [
  { to: "/dashboard", key: "dashboard", label: "主页", icon: LayoutDashboard },
  { to: "/new-download", key: "new-download", label: "新建下载", icon: PlusCircle },
  { to: "/history", key: "history", label: "历史记录", icon: History },
  { to: "/settings", key: "settings", label: "设置", icon: Settings },
];
</script>

<template>
  <aside
    class="w-[240px] shrink-0 flex flex-col border-r border-border bg-card"
    :class="isMac ? 'pt-[38px]' : ''"
  >
    <!-- Brand Logo (below traffic lights on macOS) -->
    <div
      class="flex items-center gap-2.5 px-5 shrink-0"
      :class="isMac ? 'h-[50px] border-b border-border' : 'h-[56px] border-b border-border'"
      data-tauri-drag-region
    >
      <div class="w-7 h-7 rounded-lg bg-primary flex items-center justify-center shrink-0">
        <Download class="w-4 h-4 text-primary-foreground" />
      </div>
      <span class="font-semibold text-[15px] text-foreground">Pulse</span>
    </div>

    <!-- Nav Items -->
    <nav class="flex-1 px-3 py-4 flex flex-col gap-1">
      <RouterLink
        v-for="item in navItems"
        :key="item.key"
        :to="item.to"
        class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        active-class="!text-primary bg-surface-2 font-medium"
      >
        <component :is="item.icon" class="w-[18px] h-[18px] shrink-0" />
        <span>{{ item.label }}</span>
      </RouterLink>
    </nav>
  </aside>
</template>