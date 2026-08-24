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

type FileType = "video" | "audio" | "subtitle";

interface HistoryItem {
  id: number;
  icon: "play" | "music";
  title: string;
  source: string;
  size: string;
  format: string;
  type: FileType;
  time: string;
  status: "completed" | "failed";
}

const records: HistoryItem[] = [
  { id: 1, icon: "play", title: "Rust 异步编程完全指南", source: "youtube.com", size: "456 MB", format: "MP4", type: "video", time: "2小时前", status: "completed" },
  { id: 2, icon: "play", title: "4K 城市夜景航拍合集", source: "bilibili.com", size: "2.4 GB", format: "MP4", type: "video", time: "5小时前", status: "completed" },
  { id: 3, icon: "music", title: "TypeScript 高级类型系统", source: "youtube.com", size: "89 MB", format: "MP3", type: "audio", time: "昨天", status: "completed" },
  { id: 4, icon: "play", title: "Linux 系统管理实战", source: "bilibili.com", size: "1.2 GB", format: "MP4", type: "video", time: "昨天", status: "completed" },
  { id: 5, icon: "play", title: "Go 语言设计哲学", source: "youtube.com", size: "234 MB", format: "MP4", type: "video", time: "3天前", status: "completed" },
  { id: 6, icon: "play", title: "Docker 容器化部署教程", source: "vimeo.com", size: "678 MB", format: "MKV", type: "video", time: "1周前", status: "completed" },
  { id: 7, icon: "music", title: "Vim 编辑器精通之路", source: "youtube.com", size: "45 MB", format: "MP3", type: "audio", time: "1周前", status: "completed" },
  { id: 8, icon: "play", title: "Kubernetes 集群搭建指南", source: "youtube.com", size: "1.5 GB", format: "MP4", type: "video", time: "2周前", status: "completed" },
];

const keyword = ref("");
const filter = ref<"all" | FileType>("all");

const counts = computed(() => ({
  all: records.length,
  video: records.filter((r) => r.type === "video").length,
  audio: records.filter((r) => r.type === "audio").length,
  subtitle: records.filter((r) => r.type === "subtitle").length,
}));

const filtered = computed(() =>
  records.filter((r) => {
    const matchType = filter.value === "all" || r.type === filter.value;
    const kw = keyword.value.trim().toLowerCase();
    const matchKw = !kw || r.title.toLowerCase().includes(kw) || r.source.includes(kw);
    return matchType && matchKw;
  })
);
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
        <button type="button" class="ydl-sort-btn">
          <span>按时间排序</span>
          <ChevronDown class="w-3.5 h-3.5 text-muted-foreground" />
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
        <button
          type="button"
          class="ydl-filter-pill"
          :class="{ 'is-active': filter === 'subtitle' }"
          @click="filter = 'subtitle'"
        >
          <span>字幕</span>
          <span class="opacity-80">{{ counts.subtitle }}</span>
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
        <div v-for="row in filtered" :key="row.id" class="hd-grid hd-row">
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
            {{ row.status === "completed" ? "已完成" : "失败" }}
          </span>
          <div class="flex items-center gap-1">
            <button type="button" class="ydl-action-btn" aria-label="打开文件夹">
              <FolderOpen class="w-4 h-4" />
            </button>
            <button type="button" class="ydl-action-btn" aria-label="重新下载">
              <Download class="w-4 h-4" />
            </button>
            <button type="button" class="ydl-action-btn" aria-label="删除">
              <Trash2 class="w-4 h-4" />
            </button>
            <button type="button" class="ydl-action-btn" aria-label="更多操作">
              <Ellipsis class="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Load more -->
    <div class="flex justify-center">
      <button type="button" class="ydl-load-more">
        <span>加载更多</span>
        <ChevronDown class="w-4 h-4" />
      </button>
    </div>

    <!-- Footer -->
    <footer class="flex items-center justify-between text-[12px] text-muted-foreground pt-4 border-t border-border">
      <span>共 {{ counts.all }} 条记录 · 总计 6.5 GB</span>
      <span>Pulse · 本地存储</span>
    </footer>
  </div>
</template>

<style scoped>
.ydl-input {
  width: 100%;
  background: var(--ydl-card);
  border: 1px solid var(--ydl-border);
  border-radius: 8px;
  color: var(--ydl-foreground);
  font-size: 14px;
  font-family: var(--font-sans);
  transition: border-color 160ms, box-shadow 160ms;
}
.ydl-input::placeholder {
  color: var(--ydl-muted-foreground);
}
.ydl-input:focus {
  outline: none;
  border-color: var(--ydl-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ydl-ring) 22%, transparent);
}

.ydl-sort-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 16px;
  border-radius: 8px;
  background: var(--ydl-card);
  border: 1px solid var(--ydl-border);
  color: var(--ydl-foreground);
  font-size: 13px;
  cursor: pointer;
  transition: background 160ms;
  white-space: nowrap;
}
.ydl-sort-btn:hover {
  background: var(--ydl-muted);
}

.ydl-filter-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 999px;
  font-size: 13px;
  color: var(--ydl-muted-foreground);
  border: 1px solid var(--ydl-border);
  background: transparent;
  cursor: pointer;
  transition: background 160ms, color 160ms;
}
.ydl-filter-pill:hover {
  background: var(--ydl-muted);
  color: var(--ydl-foreground);
}
.ydl-filter-pill.is-active {
  background: var(--ydl-primary);
  border-color: var(--ydl-primary);
  color: var(--ydl-primary-foreground);
}

/* Table grid */
.hd-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 1fr) 92px 80px 120px;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
}
.hd-head {
  font-size: 11px;
  color: var(--ydl-muted-foreground);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  background: var(--ydl-surface-2);
  border-bottom: 1px solid var(--ydl-border);
}
.hd-row {
  border-bottom: 1px solid var(--ydl-border);
  transition: background-color 120ms;
}
.hd-row:last-child {
  border-bottom: none;
}
.hd-row:hover {
  background: var(--ydl-muted);
}

.thumb {
  width: 64px;
  height: 40px;
  border-radius: 6px;
  background: var(--ydl-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ydl-muted-foreground);
}

.src-tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-family: var(--font-mono);
  background: var(--ydl-muted);
  color: var(--ydl-muted-foreground);
  justify-self: start;
}

.status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  justify-self: start;
  white-space: nowrap;
}
.status .dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
}
.status.completed {
  color: var(--state-success);
}
.status.completed .dot {
  background: var(--state-success);
}
.status.failed {
  color: var(--state-error);
}
.status.failed .dot {
  background: var(--state-error);
}

.ydl-action-btn {
  width: 30px;
  height: 30px;
  border-radius: 7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ydl-muted-foreground);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: background 140ms, color 140ms;
}
.ydl-action-btn:hover {
  background: var(--ydl-surface-3);
  color: var(--ydl-foreground);
}

.ydl-load-more {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 24px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--ydl-muted-foreground);
  background: transparent;
  border: 1px solid var(--ydl-border);
  cursor: pointer;
  transition: background 160ms, color 160ms;
}
.ydl-load-more:hover {
  background: var(--ydl-muted);
  color: var(--ydl-foreground);
}
</style>