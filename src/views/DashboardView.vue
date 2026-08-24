<script setup lang="ts">
import { Download, CircleCheck, Gauge, HardDrive, Video, Clock, Pause, X, Plus } from "lucide-vue-next";

/* 模拟统计数据（阶段 2 为前端状态驱动，后续可接真实下载引擎） */
const stats = [
  { icon: Download, accent: true, label: "正在下载", value: "3", unit: "" },
  { icon: CircleCheck, accent: false, label: "已完成", value: "127", unit: "" },
  { icon: Gauge, accent: false, label: "下载速度", value: "15.4", unit: "MB/s" },
  { icon: HardDrive, accent: false, label: "磁盘占用", value: "42.8", unit: "GB" },
];

/* 模拟进行中的下载任务 */
interface DownloadTask {
  title: string;
  url: string;
  downloaded: string;
  total: string;
  percent: number;
  speed: string;
  eta: string;
}

const downloads: DownloadTask[] = [
  {
    title: "Linux Kernel 编译教程 - Full Course",
    url: "https://youtube.com/watch?v=linux-kernel-2025",
    downloaded: "4.2 GB",
    total: "6.3 GB",
    percent: 67,
    speed: "15.4 MB/s",
    eta: "2m 15s",
  },
  {
    title: "Rust 入门到实践（2025版）",
    url: "https://youtube.com/watch?v=rust-practice-2025",
    downloaded: "180 MB",
    total: "780 MB",
    percent: 23,
    speed: "8.7 MB/s",
    eta: "1m 8s",
  },
  {
    title: "4K 城市夜景航拍合集",
    url: "https://youtube.com/watch?v=4k-city-night",
    downloaded: "2.1 GB",
    total: "2.4 GB",
    percent: 89,
    speed: "12.1 MB/s",
    eta: "24s",
  },
];
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

    <!-- Stats Strip: 4 stat cards -->
    <div class="grid grid-cols-4 gap-4 mb-6 max-lg:grid-cols-2 max-sm:grid-cols-1">
      <div
        v-for="s in stats"
        :key="s.label"
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

    <!-- Download List: active downloads -->
    <div class="flex flex-col gap-4">
      <div
        v-for="d in downloads"
        :key="d.url"
        class="bg-card border border-border rounded-lg p-4"
      >
        <div class="flex items-start gap-4">
          <!-- Thumbnail -->
          <div class="w-20 h-12 rounded bg-muted flex items-center justify-center shrink-0">
            <Video class="w-5 h-5 text-muted-foreground" />
          </div>

          <!-- Content -->
          <div class="flex-1 min-w-0">
            <h3 class="text-[14px] font-semibold text-foreground truncate">{{ d.title }}</h3>
            <p class="font-mono text-[12px] text-muted-foreground truncate mt-0.5">{{ d.url }}</p>

            <!-- Progress -->
            <div class="mt-3">
              <div class="flex items-center justify-between mb-1.5">
                <span class="font-mono text-[12px] text-muted-foreground">{{ d.downloaded }} / {{ d.total }}</span>
                <span class="font-mono text-[12px] text-primary font-medium">{{ d.percent }}%</span>
              </div>
              <div class="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  class="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                  :style="{ width: d.percent + '%' }"
                ></div>
              </div>
            </div>

            <!-- Speed + ETA -->
            <div class="flex items-center gap-4 mt-2">
              <span class="text-[12px] text-muted-foreground flex items-center gap-1">
                <Gauge class="w-3 h-3" />
                <span class="font-mono">{{ d.speed }}</span>
              </span>
              <span class="text-[12px] text-muted-foreground flex items-center gap-1">
                <Clock class="w-3 h-3" />
                <span class="font-mono">ETA {{ d.eta }}</span>
              </span>
            </div>
          </div>

          <!-- Controls -->
          <div class="flex items-center gap-1 shrink-0">
            <button
              class="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              aria-label="暂停"
            >
              <Pause class="w-4 h-4" />
            </button>
            <button
              class="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              aria-label="取消"
            >
              <X class="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>