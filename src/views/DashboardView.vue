<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import NewDownloadDialog from "./NewDownloadView.vue";
import {
  Download,
  CircleCheck,
  Gauge,
  HardDrive,
  Video,
  Music,
  Clock,
  X,
  Plus,
  Inbox,
  AlertTriangle,
  ExternalLink,
  LoaderCircle,
} from "lucide-vue-next";
import {
  useDownloads,
  formatBytes,
  formatSpeed,
  formatEta,
  normalizedPercent,
} from "../composables/useDownloads";
import { useDownloadSettings } from "../composables/useDownloadSettings";
import { detectFfmpeg } from "../services/ytdlp";

const { active, activeCount, queuedCount, completedCount, totalSpeed, diskUsage, cancel } = useDownloads();
const { settings: downloadSettings } = useDownloadSettings();

/* Missing-ffmpeg banner: auto-detect once per mount, skip when the user
   configured an explicit ffmpeg path (it wins over detection). */
const ffmpegMissing = ref(false);
const showNewDownload = ref(false);
onMounted(async () => {
  if (downloadSettings.ffmpegPath.trim()) return;
  try {
    ffmpegMissing.value = (await detectFfmpeg()) === null;
  } catch {
    ffmpegMissing.value = true;
  }
});

const runningTasks = computed(() => active.value.filter((task) => task.status === "downloading" || task.status === "cancelling"));
const queuedTasks = computed(() => active.value.filter((task) => task.status === "pending"));
const hasTasks = computed(() => active.value.length > 0);
const speedText = computed(() => formatSpeed(totalSpeed.value));

const stats = computed(() => [
  { id: "active", icon: Download, accent: true, label: "正在下载", value: String(activeCount.value), unit: "个任务" },
  { id: "queued", icon: Clock, accent: false, label: "等待中", value: String(queuedCount.value), unit: "个任务" },
  { id: "completed", icon: CircleCheck, accent: false, label: "历史记录", value: String(completedCount.value), unit: "条" },
  { id: "speed", icon: Gauge, accent: false, label: "当前总速度", value: speedText.value, unit: "" },
  { id: "disk", icon: HardDrive, accent: false, label: "历史下载累计", value: formatBytes(diskUsage.value), unit: "" },
]);
</script>

<template>
  <div class="min-h-full flex flex-col">
    <!-- Content header: section title + CTA -->
    <div class="flex items-center justify-between mb-6 gap-4">
      <div class="min-w-0">
        <h2 class="text-h2 text-foreground" style="text-wrap: balance">下载概览</h2>
        <p class="text-body-sm text-muted-foreground mt-1">查看下载进度与管理任务</p>
      </div>
      <button
        type="button"
        class="shrink-0 inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2 font-medium text-[13px] transition-opacity hover:opacity-90"
        @click="showNewDownload = true"
      >
        <Plus class="w-4 h-4" />
        <span>新建下载</span>
      </button>
    </div>

    <!-- ffmpeg missing banner -->
    <div
      v-if="ffmpegMissing"
      class="mb-5 flex items-center gap-3 rounded-lg border px-4 py-3 text-[13px]"
      style="border-color: color-mix(in srgb, var(--state-warning) 40%, transparent); background: color-mix(in srgb, var(--state-warning) 10%, transparent);"
    >
      <AlertTriangle class="w-4 h-4 shrink-0" style="color: var(--state-warning);" />
      <span class="flex-1 text-foreground">未检测到 ffmpeg —— 音视频合并与 MP3 转码不可用，请在设置中配置或安装 ffmpeg。</span>
      <RouterLink
        to="/settings"
        class="shrink-0 font-medium text-primary hover:underline"
      >前往设置</RouterLink>
    </div>

    <!-- Stats Strip -->
    <div class="grid grid-cols-5 gap-4 mb-6 max-xl:grid-cols-3 max-lg:grid-cols-2 max-sm:grid-cols-1">
      <div
        v-for="s in stats"
        :key="s.id"
        :data-testid="`stat-${s.id}`"
        class="bg-card border border-border rounded-lg p-4 flex items-center gap-3"
      >
        <div class="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
          <component :is="s.icon" class="w-5 h-5" :class="s.accent ? 'text-primary' : 'text-muted-foreground'" />
        </div>
        <div class="flex flex-col min-w-0">
          <span class="text-[12px] text-muted-foreground">{{ s.label }}</span>
          <span class="text-[20px] font-semibold text-foreground tabular-nums">
            {{ s.value }}<span v-if="s.unit" class="text-[13px] font-normal text-muted-foreground ml-1">{{ s.unit }}</span>
          </span>
        </div>
      </div>
    </div>

    <section class="overflow-hidden rounded-lg border border-border bg-card">
      <header class="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <h3 class="text-[15px] font-semibold text-foreground">下载队列</h3>
          <p class="mt-0.5 text-caption text-muted-foreground">下载过程与等待任务会在这里实时更新</p>
        </div>
        <div v-if="hasTasks" class="flex items-center gap-2 text-caption text-muted-foreground">
          <span class="h-2 w-2 rounded-full bg-primary animate-pulse"></span>
          实时更新中
        </div>
      </header>

      <div v-if="!hasTasks" class="py-16 text-center">
        <Inbox class="mx-auto mb-3 h-8 w-8 text-muted-foreground opacity-60" />
        <p class="text-[13px] text-muted-foreground">当前没有下载任务</p>
        <button type="button" class="mt-3 inline-flex items-center gap-1 text-[13px] text-primary hover:underline underline-offset-4" @click="showNewDownload = true">
          新建下载 <ExternalLink class="h-3.5 w-3.5" />
        </button>
      </div>

      <div v-else>
        <div v-if="runningTasks.length > 0" class="queue-section">
          <div class="queue-label">
            <LoaderCircle class="h-3.5 w-3.5 animate-spin text-primary" />
            <span>正在下载</span>
            <span class="font-mono text-muted-foreground">{{ runningTasks.length }}</span>
          </div>
          <article v-for="d in runningTasks" :key="d.id" class="queue-row">
            <div class="queue-icon">
              <Music v-if="d.kind === 'audio'" class="h-4 w-4" />
              <Video v-else class="h-4 w-4" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between gap-4">
                <h4 class="truncate text-[14px] font-medium text-foreground" :title="d.title">{{ d.title }}</h4>
                <span class="shrink-0 font-mono text-[12px] font-medium tabular-nums text-primary">{{ normalizedPercent(d) }}%</span>
              </div>
              <p class="mt-0.5 truncate font-mono text-[11px] text-muted-foreground" :title="d.url">{{ d.url }}</p>
              <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                <div class="h-full rounded-full bg-primary transition-[width] duration-300 ease-out" :style="{ width: normalizedPercent(d) + '%' }"></div>
              </div>
              <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-muted-foreground">
                <span class="font-mono tabular-nums">{{ formatBytes(d.downloadedBytes) }} / {{ d.totalBytes != null ? formatBytes(d.totalBytes) : '大小未知' }}</span>
                <span class="inline-flex items-center gap-1"><Gauge class="h-3 w-3" /><span class="font-mono">{{ formatSpeed(d.speed) }}</span></span>
                <span class="inline-flex items-center gap-1"><Clock class="h-3 w-3" /><span class="font-mono">预计 {{ formatEta(d.eta) }}</span></span>
                <span v-if="(d.playlistTotal ?? 0) > 1 && (d.playlistIndex ?? 0) >= 1" class="font-mono">播放列表 {{ d.playlistIndex }}/{{ d.playlistTotal }}</span>
              </div>
            </div>
            <button
              type="button"
              class="queue-cancel"
              :aria-label="d.status === 'cancelling' ? '正在取消' : '取消下载'"
              :title="d.status === 'cancelling' ? '正在取消' : '取消下载'"
              :disabled="d.status === 'cancelling'"
              @click="cancel(d.id)"
            >
              <LoaderCircle v-if="d.status === 'cancelling'" class="h-4 w-4 animate-spin" />
              <X v-else class="h-4 w-4" />
            </button>
          </article>
        </div>

        <div v-if="queuedTasks.length > 0" class="queue-section" :class="{ 'border-t border-border': runningTasks.length > 0 }">
          <div class="queue-label">
            <Clock class="h-3.5 w-3.5 text-muted-foreground" />
            <span>等待中</span>
            <span class="font-mono text-muted-foreground">{{ queuedTasks.length }}</span>
          </div>
          <article v-for="(d, index) in queuedTasks" :key="d.id" class="queue-row is-queued">
            <div class="queue-index">{{ String(index + 1).padStart(2, '0') }}</div>
            <div class="min-w-0 flex-1">
              <h4 class="truncate text-[14px] font-medium text-foreground" :title="d.title">{{ d.title }}</h4>
              <p class="mt-0.5 truncate font-mono text-[11px] text-muted-foreground" :title="d.url">{{ d.url }}</p>
              <p class="mt-2 text-caption text-muted-foreground">等待可用下载槽位</p>
            </div>
            <button type="button" class="queue-cancel" aria-label="取消等待任务" title="取消等待任务" @click="cancel(d.id)">
              <X class="h-4 w-4" />
            </button>
          </article>
        </div>
      </div>
    </section>

    <NewDownloadDialog v-if="showNewDownload" @close="showNewDownload = false" />
  </div>
</template>

<style scoped>
.queue-section {
  padding: 12px 0;
}

.queue-label {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 20px 8px;
  color: var(--ydl-muted-foreground);
  font-size: 12px;
  font-weight: 600;
}

.queue-row {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  min-height: 92px;
  padding: 14px 20px;
  transition: background-color 150ms ease;
}

.queue-row:hover {
  background: color-mix(in srgb, var(--ydl-primary) 4%, transparent);
}

.queue-row.is-queued {
  min-height: 74px;
  align-items: center;
}

.queue-icon,
.queue-index {
  display: flex;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--ydl-border);
  border-radius: 6px;
  background: var(--ydl-muted);
  color: var(--ydl-primary);
}

.queue-index {
  color: var(--ydl-muted-foreground);
  font-family: var(--font-mono);
  font-size: 11px;
}

.queue-cancel {
  display: inline-flex;
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: var(--ydl-muted-foreground);
  transition: color 150ms ease, background-color 150ms ease;
}

.queue-cancel:hover:not(:disabled) {
  background: color-mix(in srgb, var(--state-error) 10%, transparent);
  color: var(--state-error);
}

.queue-cancel:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
</style>