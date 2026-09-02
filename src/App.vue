<script setup lang="ts">
import { ref, onMounted } from "vue";
import { TriangleAlert, Download, FolderSearch } from "lucide-vue-next";
import AppSidebar from "./components/layout/AppSidebar.vue";
import AppTopbar from "./components/layout/AppTopbar.vue";
import { useYtdlp } from "./composables/useYtdlp";
import { useDownloadSettings } from "./composables/useDownloadSettings";
import { useDownloads } from "./composables/useDownloads";
import { useTheme } from "./composables/useTheme";

const { status: ytdlpStatus, path: ytdlpPath, init, setManual, downloadYtdlp } = useYtdlp();
const { init: initDownloadSettings } = useDownloadSettings();
const { init: initDownloads } = useDownloads();
const { init: initTheme } = useTheme();
const showDialog = ref(false);
const customPath = ref("");

function openPathDialog() {
  customPath.value = ytdlpPath.value;
  showDialog.value = true;
}

async function applyPath() {
  const path = customPath.value.trim();
  if (!path) return;
  showDialog.value = false;
  await setManual(path);
}

onMounted(() => {
  void initTheme();
  void initDownloadSettings();
  void initDownloads();
  void init();
});
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-background text-foreground">
    <AppSidebar />

    <div class="flex-1 flex flex-col min-w-0">
      <AppTopbar />

      <!-- yt-dlp missing / invalid banner -->
      <div
        v-if="ytdlpStatus === 'missing' || ytdlpStatus === 'invalid'"
        class="px-6 py-2.5 flex items-center gap-3 text-[13px] border-b border-border bg-[var(--state-warning)]/10"
      >
        <TriangleAlert class="w-4 h-4 text-[var(--state-warning)] shrink-0" />
        <p class="text-foreground min-w-0 flex-1">
          <template v-if="ytdlpStatus === 'missing'">
            未检测到 yt-dlp 下载引擎，需要安装后才能开始下载。
          </template>
          <template v-else>
            yt-dlp 路径无效（{{ ytdlpPath }}），无法启动下载。
          </template>
        </p>
        <button
          type="button"
          class="shrink-0 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 bg-primary text-primary-foreground font-medium transition-opacity hover:opacity-90"
          @click="downloadYtdlp"
        >
          <Download class="w-3.5 h-3.5" />
          <span>下载 yt-dlp</span>
        </button>
        <button
          type="button"
          class="shrink-0 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          @click="openPathDialog"
        >
          <FolderSearch class="w-3.5 h-3.5" />
          <span>设置路径</span>
        </button>
      </div>

      <main class="flex-1 overflow-y-auto p-6">
        <RouterView />
      </main>
    </div>

    <!-- Custom path dialog -->
    <Teleport to="body">
      <div
        v-if="showDialog"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        @click.self="showDialog = false"
      >
        <div class="w-[440px] max-w-[90vw] bg-popover text-popover-foreground rounded-lg border border-border shadow-float p-5">
          <h3 class="text-[15px] font-semibold text-foreground">设置 yt-dlp 路径</h3>
          <p class="text-[13px] text-muted-foreground mt-1">
            请输入 yt-dlp 可执行文件的完整路径，或可执行文件名（将按系统 PATH 查找）。
          </p>
          <input
            v-model="customPath"
            type="text"
            placeholder="如 /usr/local/bin/yt-dlp 或 yt-dlp"
            class="ytdlp-input mt-3"
            @keyup.enter="applyPath"
          />
          <div class="flex justify-end gap-2 mt-4">
            <button type="button" class="ydlp-btn-ghost" @click="showDialog = false">取消</button>
            <button type="button" class="ydlp-btn-primary" @click="applyPath">应用</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.ytdlp-input {
  width: 100%;
  height: 38px;
  border-radius: 8px;
  border: 1px solid var(--ydl-input);
  background: var(--ydl-surface-2);
  color: var(--ydl-foreground);
  padding: 0 12px;
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s;
}
.ytdlp-input:focus {
  border-color: var(--ydl-ring);
}
.ydlp-btn-ghost {
  height: 36px;
  padding: 0 14px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--ydl-muted-foreground);
  transition: background 0.15s;
}
.ydlp-btn-ghost:hover {
  background: var(--ydl-muted);
}
.ydlp-btn-primary {
  height: 36px;
  padding: 0 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  background: var(--ydl-primary);
  color: var(--ydl-primary-foreground);
  transition: opacity 0.15s;
}
.ydlp-btn-primary:hover {
  opacity: 0.9;
}
</style>