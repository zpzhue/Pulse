<script setup lang="ts">
import { computed } from "vue";
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
} from "lucide-vue-next";
import {
  useDownloads,
  formatBytes,
  formatSpeed,
  formatEta,
} from "../composables/useDownloads";

const { active, activeCount, queuedCount, completedCount, totalSpeed, diskUsage, cancel } = useDownloads();

const speedMB = computed(() => (totalSpeed.value / 1048576).toFixed(1));
const diskGB = computed(() => (diskUsage.value / 1073741824).toFixed(1));

const stats = computed(() => [
  { id: "active", icon: Download, accent: true, label: "正在下载", value: String(activeCount.value), unit: "" },
  { id: "queued", icon: Clock, accent: false, label: "等待中", value: String(queuedCount.value), unit: "" },
  { id: "completed", icon: CircleCheck, accent: false, label: "已完成", value: String(completedCount.value), unit: "" },
  { id: "speed", icon: Gauge, accent: false, label: "下载速度", value: speedMB.value, unit: "MB/s" },
  { id: "disk", icon: HardDrive, accent: false, label: "磁盘占用", value: diskGB.value, unit: "GB" },
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
      <RouterLink
        to="/new-download"
        class="shrink-0 inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2 font-medium text-[13px] transition-opacity hover:opacity-90"
      >
        <Plus class="w-4 h-4" />
        <span>新建下载</span>
      </RouterLink>
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

    <!-- Download List: active downloads from the shared store -->
    <div v-if="active.length === 0" class="bg-card border border-border rounded-lg py-16 text-center">
      <Inbox class="w-8 h-8 mx-auto mb-3 text-muted-foreground opacity-60" />
      <p class="text-[13px] text-muted-foreground">当前没有进行中的下载任务</p>
      <RouterLink to="/new-download" class="inline-block mt-3 text-[13px] text-primary hover:underline underline-offset-4">
        去新建下载 →
      </RouterLink>
    </div>

    <div v-else class="flex flex-col gap-4">
      <div
        v-for="d in active"
        :key="d.id"
        class="bg-card border border-border rounded-lg p-4"
      >
        <div class="flex items-start gap-4">
          <!-- Thumbnail -->
          <div class="w-20 h-12 rounded bg-muted flex items-center justify-center shrink-0">
            <Music v-if="d.kind === 'audio'" class="w-5 h-5 text-muted-foreground" />
            <Video v-else class="w-5 h-5 text-muted-foreground" />
          </div>

          <!-- Content -->
          <div class="flex-1 min-w-0">
            <h3 class="text-[14px] font-semibold text-foreground truncate">{{ d.title }}</h3>
            <p class="font-mono text-[12px] text-muted-foreground truncate mt-0.5">{{ d.url }}</p>

            <!-- Progress -->
            <div class="mt-3">
              <div class="flex items-center justify-between mb-1.5">
                <span class="font-mono text-[12px] text-muted-foreground">
                  {{ formatBytes(d.downloadedBytes) }} / {{ d.totalBytes != null ? formatBytes(d.totalBytes) : "未知" }}
                </span>
                <span class="font-mono text-[12px] text-primary font-medium tabular-nums">{{ d.percent }}%</span>
              </div>
              <div class="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  class="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                  :style="{ width: (d.status === 'pending' ? 0 : d.percent) + '%' }"
                ></div>
              </div>
            </div>

            <!-- Speed + ETA -->
            <div class="flex items-center gap-4 mt-2">
              <span class="text-[12px] text-muted-foreground flex items-center gap-1">
                <Gauge class="w-3 h-3" />
                <span class="font-mono">{{ d.status === 'pending' ? '等待中…' : formatSpeed(d.speed) }}</span>
              </span>
              <span class="text-[12px] text-muted-foreground flex items-center gap-1">
                <Clock class="w-3 h-3" />
                <span class="font-mono">ETA {{ formatEta(d.eta) }}</span>
              </span>
            </div>
          </div>

          <!-- Controls -->
          <div class="flex items-center gap-1 shrink-0">
            <button
              class="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              :aria-label="d.status === 'cancelling' ? '正在取消' : '取消'"
              :disabled="d.status === 'cancelling'"
              @click="cancel(d.id)"
            >
              <X class="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>