<script setup lang="ts">
import { ref, computed } from "vue";
import {
  Search,
  ChevronDown,
  Play,
  Music,
  Ellipsis,
  History,
  FolderOpen,
  Trash2,
  Download,
} from "lucide-vue-next";
import { useDownloads, formatBytes } from "../composables/useDownloads";
import { openFolder } from "../services/ytdlp";

type FileType = "video" | "audio";

interface Row {
  id: string;
  icon: "play" | "music";
  title: string;
  source: string;
  size: string;
  format: string;
  type: FileType;
  time: string;
  status: "completed" | "failed" | "cancelled";
  /** Finish/create timestamp (for sorting). */
  ts: number;
  /** Directory the file was downloaded into (undefined for legacy records). */
  downloadPath?: string;
}

const { history, removeHistory, restartFromHistory } = useDownloads();

function sourceOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "pulse";
  }
}

function timeAgo(ts: number): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const min = 60_000;
  const hr = 3_600_000;
  const day = 86_400_000;
  if (diff < min) return "刚刚";
  if (diff < hr) return `${Math.floor(diff / min)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hr)} 小时前`;
  if (diff < day * 7) return `${Math.floor(diff / day)} 天前`;
  return new Date(ts).toLocaleDateString();
}

const STATUS_TEXT: Record<Row["status"], string> = {
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

const records = computed<Row[]>(() =>
  history.value.map((t) => ({
    id: t.id,
    icon: t.kind === "audio" ? "music" : "play",
    title: t.title,
    source: sourceOf(t.url),
    size: formatBytes(t.downloadedBytes || t.totalBytes || 0),
    format: t.format.toUpperCase(),
    type: t.kind === "audio" ? "audio" : "video",
    time: timeAgo(t.finishedAt ?? t.createdAt),
    status: t.status === "completed" ? "completed" : t.status === "cancelled" ? "cancelled" : "failed",
    ts: t.finishedAt ?? t.createdAt,
    downloadPath: t.downloadPath,
  })),
);

const keyword = ref("");
const filter = ref<"all" | FileType>("all");
const sortDesc = ref(true);
const PAGE_SIZE = 20;
const visibleCount = ref(PAGE_SIZE);

const counts = computed(() => ({
  all: records.value.length,
  video: records.value.filter((r) => r.type === "video").length,
  audio: records.value.filter((r) => r.type === "audio").length,
}));

const filtered = computed(() => {
  const rows = records.value.filter((r) => {
    const matchType = filter.value === "all" || r.type === filter.value;
    const kw = keyword.value.trim().toLowerCase();
    const matchKw = !kw || r.title.toLowerCase().includes(kw) || r.source.includes(kw);
    return matchType && matchKw;
  });
  rows.sort((a, b) => (sortDesc.value ? b.ts - a.ts : a.ts - b.ts));
  return rows;
});

/** Current page of the filtered list. */
const paged = computed(() => filtered.value.slice(0, visibleCount.value));

const hasMore = computed(() => filtered.value.length > paged.value.length);

/** Reveal the download directory in the system file manager. */
async function openRecordFolder(row: Row) {
  if (!row.downloadPath) return;
  try {
    await openFolder(row.downloadPath);
  } catch {
    /* opener unavailable — ignore */
  }
}

/** Re-enqueue a history record with the current settings. */
function restart(row: Row) {
  restartFromHistory(row.id);
}

const totalFormat = computed(() => formatBytes(history.value.reduce((s, t) => s + (t.downloadedBytes || 0), 0)));
</script>

<template>
  <div class="max-w-[960px] mx-auto flex flex-col gap-5">
    <!-- Search & Filter -->
    <div>
      <div class="flex items-center gap-3 mb-3">
        <div class="relative flex-1">
          <Search
            class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <input
            v-model="keyword"
            type="text"
            placeholder="搜索下载记录..."
            class="w-full h-10 pl-10 pr-4 ydl-input"
          />
        </div>
        <button
          type="button"
          class="ydl-sort-btn"
          :title="sortDesc ? '当前：最新在前，点击切换' : '当前：最旧在前，点击切换'"
          @click="sortDesc = !sortDesc"
        >
          <span>按时间排序</span>
          <ChevronDown class="w-3.5 h-3.5 text-muted-foreground transition-transform" :class="{ 'rotate-180': !sortDesc }" />
        </button>
      </div>

      <!-- Filter tabs -->
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="ydl-filter-pill"
          :class="{ 'is-active': filter === 'all' }"
          @click="filter = 'all'"
        >
          <span>全部</span>
          <span class="opacity-80">{{ counts.all }}</span>
        </button>
        <button
          type="button"
          class="ydl-filter-pill"
          :class="{ 'is-active': filter === 'video' }"
          @click="filter = 'video'"
        >
          <span>视频</span>
          <span class="opacity-80">{{ counts.video }}</span>
        </button>
        <button
          type="button"
          class="ydl-filter-pill"
          :class="{ 'is-active': filter === 'audio' }"
          @click="filter = 'audio'"
        >
          <span>音频</span>
          <span class="opacity-80">{{ counts.audio }}</span>
        </button>
      </div>
    </div>

    <!-- History table -->
    <div class="bg-card rounded-lg border border-border overflow-hidden">
      <div class="hd-grid hd-head">
        <span>名称</span>
        <span>来源</span>
        <span>文件信息</span>
        <span>时间</span>
        <span>状态</span>
        <span>操作</span>
      </div>

      <div v-if="filtered.length === 0" class="py-16 text-center">
        <History class="w-8 h-8 mx-auto mb-3 text-muted-foreground opacity-60" />
        <p class="text-body-sm text-muted-foreground">没有找到匹配的下载记录</p>
      </div>

      <div v-else>
        <div v-for="row in paged" :key="row.id" class="hd-grid hd-row">
          <div class="flex items-center gap-3 min-w-0">
            <div class="thumb shrink-0">
              <Play v-if="row.icon === 'play'" class="w-4 h-4" />
              <Music v-else class="w-4 h-4" />
            </div>
            <span class="text-[14px] text-foreground truncate">{{ row.title }}</span>
          </div>
          <span class="src-tag">{{ row.source }}</span>
          <span class="font-mono text-[13px] text-muted-foreground">{{ row.size }} / {{ row.format }}</span>
          <span class="text-[13px] text-muted-foreground whitespace-nowrap">{{ row.time }}</span>
          <span class="status" :class="row.status">
            <span class="dot"></span>
            {{ STATUS_TEXT[row.status] }}
          </span>
          <div class="flex items-center gap-1">
            <button
              type="button"
              class="ydl-action-btn"
              aria-label="打开文件夹"
              :disabled="!row.downloadPath"
              :title="row.downloadPath ? '打开文件夹' : '该记录未保存下载目录'"
              @click="openRecordFolder(row)"
            >
              <FolderOpen class="w-4 h-4" />
            </button>
            <button
              type="button"
              class="ydl-action-btn"
              aria-label="重新下载"
              title="按当前设置重新下载"
              @click="restart(row)"
            >
              <Download class="w-4 h-4" />
            </button>
            <button type="button" class="ydl-action-btn" aria-label="删除" @click="removeHistory(row.id)">
              <Trash2 class="w-4 h-4" />
            </button>
            <button type="button" class="ydl-action-btn" aria-label="更多操作" disabled title="开发中，敬请期待">
              <Ellipsis class="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Load more -->
    <div v-if="hasMore" class="flex justify-center">
      <button type="button" class="ydl-load-more" @click="visibleCount += PAGE_SIZE">
        <span>加载更多（还有 {{ filtered.length - paged.length }} 条）</span>
        <ChevronDown class="w-4 h-4" />
      </button>
    </div>

    <!-- Footer -->
    <footer class="flex items-center justify-between text-[12px] text-muted-foreground pt-4 border-t border-border">
      <span>共 {{ counts.all }} 条记录 · 总计 {{ totalFormat }}</span>
      <span>Pulse · 本地存储</span>
    </footer>
  </div>
</template>