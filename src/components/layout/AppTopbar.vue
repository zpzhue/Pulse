<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { Search, Bell, Sun, Moon, Minus, Square, X } from "lucide-vue-next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTheme } from "../../composables/useTheme";
import { isWindowsPlatform } from "../../services/paths";

const route = useRoute();
const { isDark, accents, accent, toggleDark, setAccent } = useTheme();

const pageTitle = computed(() => (route.meta.title as string) ?? "Pulse");

// Windows 下原生标题栏已被关闭（见 main.ts），由这三个按钮接管窗口控制。
const windows = isWindowsPlatform();
const appWindow = getCurrentWindow();
</script>

<template>
  <header
    class="flex items-center justify-between px-6 h-[56px] border-b border-border shrink-0 bg-card"
    data-tauri-drag-region
  >
    <div class="flex items-center gap-3 flex-1 min-w-0 select-none">
      <h1 class="text-[15px] font-semibold text-foreground">{{ pageTitle }}</h1>
    </div>

    <div class="flex items-center gap-2">
      <button
        class="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
        aria-label="搜索"
      >
        <Search class="w-4 h-4" />
      </button>
      <button
        class="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
        aria-label="通知"
      >
        <Bell class="w-4 h-4" />
      </button>

      <div class="w-px h-5 bg-border mx-1"></div>

      <!-- Accent theme dots -->
      <div class="flex items-center gap-2 px-1">
        <button
          v-for="t in accents"
          :key="t.id"
          :disabled="t.disabled"
          :title="t.label"
          :aria-label="t.label"
          :style="{ backgroundColor: t.color }"
          class="w-4 h-4 rounded-full cursor-pointer shrink-0 transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
          :class="accent === t.id ? 'ring-2 ring-offset-2 ring-primary bg-card' : ''"
          @click="setAccent(t.id)"
        ></button>
      </div>

      <div class="w-px h-5 bg-border mx-1"></div>

      <!-- Dark / light toggle -->
      <button
        class="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
        :aria-label="isDark ? '切换至亮色模式' : '切换至暗色模式'"
        @click="toggleDark"
      >
        <Sun v-if="isDark" class="w-4 h-4" />
        <Moon v-else class="w-4 h-4" />
      </button>

      <!-- Windows 自绘窗口控制（原生标题栏已关闭）；macOS 用红绿灯，隐藏 -->
      <div v-if="windows" class="flex items-center gap-1 ml-2 -mr-2">
        <button
          class="w-8 h-7 rounded flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
          aria-label="最小化"
          @click="appWindow.minimize()"
        >
          <Minus class="w-4 h-4" />
        </button>
        <button
          class="w-8 h-7 rounded flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
          aria-label="最大化"
          @click="appWindow.toggleMaximize()"
        >
          <Square class="w-3.5 h-3.5" />
        </button>
        <button
          class="w-8 h-7 rounded flex items-center justify-center text-muted-foreground hover:bg-[#e11d48] hover:text-white transition-colors"
          aria-label="关闭"
          @click="appWindow.close()"
        >
          <X class="w-4 h-4" />
        </button>
      </div>
    </div>
  </header>
</template>