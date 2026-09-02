<script setup lang="ts">
import { ref, computed, watch } from "vue";
import {
  Search,
  ChevronDown,
  Play,
  Music,
  MoreHorizontal,
  History,
  FolderOpen,
  Trash2,
  Download,
  RotateCcw,
  CheckCircle2,
  CircleX,
  Ban,
  ListFilter,
  Info,
  X,
  Copy,
} from "lucide-vue-next";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useDownloads, formatBytes, formatSpeed, type DownloadTask } from "../composables/useDownloads";
import { openFolder } from "../services/ytdlp";
import { normalizeStoredPath } from "../services/paths";

type FileType = "video" | "audio";

interface Row {
  id: string;
  task: DownloadTask;
  icon: "play" | "music";
  title: string;
  source: string;
  size: string;
  format: string;
  type: FileType;
  time: string;
  duration: string;
  speed: string;
  status: "completed" | "failed" | "cancelled" | "interrupted";
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

function formatDuration(createdAt: number, finishedAt?: number): string {
  if (!createdAt || !finishedAt || finishedAt < createdAt) return "—";
  const totalSeconds = Math.floor((finishedAt - createdAt) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}时${minutes}分${seconds}秒`;
  if (minutes > 0) return `${minutes}分${seconds}秒`;
  return `${seconds}秒`;
}

const STATUS_TEXT: Record<Row["status"], string> = {
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
};

const records = computed<Row[]>(() =>
  history.value.map((t) => ({
    id: t.id,
    task: t,
    icon: t.kind === "audio" ? "music" : "play",
    title: t.title,
    source: sourceOf(t.url),
    size: formatBytes(t.downloadedBytes || t.totalBytes || 0),
    format: t.format.toUpperCase(),
    type: t.kind === "audio" ? "audio" : "video",
    time: timeAgo(t.finishedAt ?? t.createdAt),
    duration: formatDuration(t.createdAt, t.finishedAt),
    speed: formatSpeed(t.speed),
    status: t.status === "completed"
      ? "completed"
      : t.status === "cancelled"
        ? "cancelled"
        : t.status === "interrupted"
          ? "interrupted"
          : "failed",
    ts: t.finishedAt ?? t.createdAt,
    // 老数据里可能存有 `~/Downloads/Pulse/` 字面量（旧版默认值），读库时展开成
    // 等价真实路径；没有持久化过目录的记录保持为空 → 按钮继续禁用。
    downloadPath: normalizeStoredPath(t.downloadPath),
  })),
);

const keyword = ref("");
const filter = ref<"all" | FileType>("all");
const sortDesc = ref(true);
const activeMenuId = ref<string | null>(null);
const menuPosition = ref({ left: 0, top: 0 });
const detailRow = ref<Row | null>(null);
const PAGE_SIZE = 20;
const visibleCount = ref(PAGE_SIZE);

watch([keyword, filter, sortDesc], () => {
  visibleCount.value = PAGE_SIZE;
  activeMenuId.value = null;
});

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

/** 打开目录失败时的可见提示（此前是 `catch {}`，用户完全看不到原因）。 */
const folderFeedback = ref("");
let folderFeedbackTimer: ReturnType<typeof setTimeout> | undefined;

function reportFolderError(message: string) {
  folderFeedback.value = message;
  if (folderFeedbackTimer) clearTimeout(folderFeedbackTimer);
  folderFeedbackTimer = setTimeout(() => {
    folderFeedback.value = "";
  }, 8000);
}

/** Reveal the download directory in the system file manager. */
async function openRecordFolder(row: Row) {
  const dir = normalizeStoredPath(row.downloadPath);
  if (!dir) {
    reportFolderError("该记录没有可用的下载目录（旧数据未持久化路径），如需再次下载请使用「重新下载」。");
    return;
  }
  try {
    await openFolder(dir);
    folderFeedback.value = "";
  } catch (error) {
    // opener 会因 ACL scope 不覆盖该路径或目录已不存在而报错，必须显示出来，
    // 否则表现就是"点了没反应"。
    reportFolderError(`无法打开下载目录 ${dir}：${String(error)}`);
  }
}

/** Re-enqueue a history record with the current settings. */
function restart(row: Row) {
  activeMenuId.value = null;
  restartFromHistory(row.id);
}

function remove(row: Row) {
  activeMenuId.value = null;
  removeHistory(row.id);
}

function showDetails(row: Row) {
  activeMenuId.value = null;
  detailRow.value = row;
}

async function openFolderFromMenu(row: Row) {
  activeMenuId.value = null;
  await openRecordFolder(row);
}

const MENU_WIDTH = 176;
const MENU_MARGIN = 8;

function setMenuPosition(left: number, top: number) {
  const maxLeft = Math.max(MENU_MARGIN, window.innerWidth - MENU_WIDTH - MENU_MARGIN);
  // The menu has four to five actions; reserve enough room before clamping
  // near the bottom edge without requiring a layout measurement.
  const estimatedHeight = 240;
  const maxTop = Math.max(MENU_MARGIN, window.innerHeight - estimatedHeight - MENU_MARGIN);
  menuPosition.value = {
    left: Math.min(Math.max(MENU_MARGIN, left), maxLeft),
    top: Math.min(Math.max(MENU_MARGIN, top), maxTop),
  };
}

function toggleMenu(row: Row, event: MouseEvent) {
  if (activeMenuId.value === row.id) {
    activeMenuId.value = null;
    return;
  }

  const target = event.currentTarget;
  if (target instanceof HTMLElement && event.type === "click") {
    const rect = target.getBoundingClientRect();
    setMenuPosition(rect.right - MENU_WIDTH, rect.bottom + 6);
  } else {
    setMenuPosition(event.clientX, event.clientY);
  }
  activeMenuId.value = row.id;
}

async function copySourceLink(row: Row) {
  try {
    await writeText(row.task.url);
  } catch {
    /* Clipboard unavailable — keep the menu usable without a toast. */
  }
  activeMenuId.value = null;
}

function statusIcon(status: Row["status"]) {
  if (status === "completed") return CheckCircle2;
  if (status === "cancelled") return Ban;
  if (status === "interrupted") return CircleX;
  return CircleX;
}

const totalFormat = computed(() => formatBytes(history.value.reduce((s, t) => s + (t.downloadedBytes || 0), 0)));
</script>

<template>
  <div class="mx-auto flex w-full max-w-[1180px] flex-col gap-5">
    <header class="flex items-end justify-between gap-4">
      <div>
        <h2 class="text-h2 text-foreground">历史记录</h2>
        <p class="mt-1 text-body-sm text-muted-foreground">管理已完成、失败和取消的下载任务</p>
      </div>
      <div class="hidden text-right text-caption text-muted-foreground sm:block">
        <div class="font-mono text-foreground tabular-nums">{{ counts.all }}</div>
        <div>全部记录</div>
      </div>
    </header>

    <!-- 打开目录失败的可见反馈（替代原先被吞掉的异常） -->
    <p v-if="folderFeedback" role="alert" class="hd-alert">
      <CircleX class="h-4 w-4 shrink-0" />
      <span class="min-w-0 flex-1 break-all">{{ folderFeedback }}</span>
      <button type="button" class="hd-alert-close" aria-label="关闭提示" @click="folderFeedback = ''">
        <X class="h-4 w-4" />
      </button>
    </p>

    <section class="rounded-lg border border-border bg-card p-3 sm:p-4">
      <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div class="relative min-w-0 flex-1 lg:max-w-[480px]">
          <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            v-model="keyword"
            type="search"
            placeholder="搜索标题或来源..."
            class="h-10 w-full rounded-md border border-input bg-transparent py-2 pl-10 pr-4 text-[13px] outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <div class="flex items-center justify-between gap-3 lg:justify-end">
          <div class="flex items-center rounded-md bg-muted p-1" role="tablist" aria-label="文件类型筛选">
            <button
              type="button"
              class="hd-filter"
              :class="{ 'is-active': filter === 'all' }"
              role="tab"
              :aria-selected="filter === 'all'"
              @click="filter = 'all'"
            >
              全部 <span>{{ counts.all }}</span>
            </button>
            <button
              type="button"
              class="hd-filter"
              :class="{ 'is-active': filter === 'video' }"
              role="tab"
              :aria-selected="filter === 'video'"
              @click="filter = 'video'"
            >
              视频 <span>{{ counts.video }}</span>
            </button>
            <button
              type="button"
              class="hd-filter"
              :class="{ 'is-active': filter === 'audio' }"
              role="tab"
              :aria-selected="filter === 'audio'"
              @click="filter = 'audio'"
            >
              音频 <span>{{ counts.audio }}</span>
            </button>
          </div>
          <button
            type="button"
            class="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-border px-3 text-[13px] text-foreground transition-colors hover:bg-muted"
            :title="sortDesc ? '当前：最新在前，点击切换' : '当前：最旧在前，点击切换'"
            @click="sortDesc = !sortDesc"
          >
            <ListFilter class="h-3.5 w-3.5 text-muted-foreground" />
            <span class="hidden sm:inline">{{ sortDesc ? '最新优先' : '最早优先' }}</span>
            <ChevronDown class="h-3.5 w-3.5 text-muted-foreground transition-transform" :class="{ 'rotate-180': !sortDesc }" />
          </button>
        </div>
      </div>
    </section>

    <section class="overflow-hidden rounded-lg border border-border bg-card" @click="activeMenuId = null">
      <div class="overflow-x-auto">
        <div class="min-w-[1120px]">
          <div class="hd-grid hd-head">
            <span>下载内容</span>
            <span>来源</span>
            <span>文件</span>
            <span>耗时</span>
            <span>速度</span>
            <span>完成时间</span>
            <span>状态</span>
            <span class="text-right">操作</span>
          </div>

          <div v-if="filtered.length === 0" class="py-20 text-center">
            <History class="mx-auto mb-3 h-8 w-8 text-muted-foreground opacity-60" />
            <p class="text-body-sm text-muted-foreground">没有找到匹配的下载记录</p>
            <button v-if="keyword || filter !== 'all'" type="button" class="mt-3 text-[13px] text-primary hover:underline" @click="keyword = ''; filter = 'all'">
              清除筛选条件
            </button>
          </div>

          <div v-else>
            <article
              v-for="row in paged"
              :key="row.id"
              class="hd-grid hd-row"
              @contextmenu.prevent.stop="toggleMenu(row, $event)"
            >
              <div class="flex min-w-0 items-center gap-3">
                <div class="hd-media-icon shrink-0" :class="row.type">
                  <Play v-if="row.icon === 'play'" class="h-4 w-4" />
                  <Music v-else class="h-4 w-4" />
                </div>
                <div class="min-w-0">
                  <p class="truncate text-[14px] font-medium text-foreground" :title="row.title">{{ row.title }}</p>
                </div>
              </div>
              <span class="hd-source" :title="row.source">{{ row.source }}</span>
              <span class="font-mono text-[12px] text-muted-foreground tabular-nums">{{ row.size }} <span class="text-border">/</span> {{ row.format }}</span>
              <span class="font-mono text-[12px] text-muted-foreground tabular-nums">{{ row.duration }}</span>
              <span class="font-mono text-[12px] text-muted-foreground tabular-nums">{{ row.speed }}</span>
              <span class="whitespace-nowrap text-[12px] text-muted-foreground">{{ row.time }}</span>
              <span class="hd-status" :class="row.status">
                <component :is="statusIcon(row.status)" class="h-3.5 w-3.5" />
                {{ STATUS_TEXT[row.status] }}
              </span>
              <div class="relative flex items-center justify-end gap-1">
                <button
                  v-if="row.status === 'failed' || row.status === 'interrupted'"
                  type="button"
                  class="hd-icon-btn"
                  aria-label="重新下载"
                  title="按当前设置重新下载"
                  @click.stop="restart(row)"
                >
                  <RotateCcw class="h-4 w-4" />
                </button>
                <button
                  type="button"
                  class="hd-icon-btn"
                  :aria-label="activeMenuId === row.id ? '关闭更多操作' : '更多操作'"
                  title="更多操作"
                  @click.stop="toggleMenu(row, $event)"
                >
                  <MoreHorizontal class="h-4 w-4" />
                </button>
                <div
                  v-if="activeMenuId === row.id"
                  class="hd-menu"
                  :style="{ left: `${menuPosition.left}px`, top: `${menuPosition.top}px` }"
                  @click.stop
                >
                  <button type="button" @click="showDetails(row)">
                    <Info class="h-4 w-4" />
                    查看详情
                  </button>
                  <button v-if="row.status === 'completed'" type="button" :disabled="!row.downloadPath" @click="openFolderFromMenu(row)">
                    <FolderOpen class="h-4 w-4" />
                    {{ row.downloadPath ? '打开所在文件夹' : '下载目录不可用' }}
                  </button>
                  <button type="button" @click="copySourceLink(row)">
                    <Copy class="h-4 w-4" />
                    复制来源链接
                  </button>
                  <button v-if="row.status === 'failed' || row.status === 'interrupted'" type="button" @click="restart(row)">
                    <Download class="h-4 w-4" />
                    重新下载
                  </button>
                  <button type="button" class="is-danger" @click="remove(row)">
                    <Trash2 class="h-4 w-4" />
                    删除记录
                  </button>
                </div>
              </div>
            </article>
          </div>
        </div>
      </div>
    </section>

    <div v-if="hasMore" class="flex justify-center">
      <button type="button" class="inline-flex h-9 items-center gap-2 rounded-md border border-border px-4 text-[13px] text-foreground transition-colors hover:bg-muted" @click="visibleCount += PAGE_SIZE">
        加载更多 <span class="font-mono text-muted-foreground">{{ filtered.length - paged.length }}</span>
        <ChevronDown class="h-4 w-4" />
      </button>
    </div>

    <footer class="flex items-center justify-between border-t border-border pt-4 text-[12px] text-muted-foreground">
      <span>共 {{ counts.all }} 条记录 · 已下载 {{ totalFormat }}</span>
      <span>本地存储</span>
    </footer>

    <Teleport to="body">
      <div
        v-if="detailRow"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
        @click.self="detailRow = null"
      >
        <section class="hd-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="history-detail-title">
          <header class="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div class="min-w-0">
              <p class="text-caption text-muted-foreground">下载任务详情</p>
              <h3 id="history-detail-title" class="mt-1 truncate text-[15px] font-semibold text-foreground" :title="detailRow.title">{{ detailRow.title }}</h3>
            </div>
            <button type="button" class="hd-icon-btn shrink-0" aria-label="关闭详情" title="关闭" @click="detailRow = null">
              <X class="h-4 w-4" />
            </button>
          </header>

          <dl class="grid grid-cols-[96px_minmax(0,1fr)] gap-x-4 gap-y-3 px-5 py-5 text-[13px]">
            <dt>状态</dt>
            <dd><span class="hd-status" :class="detailRow.status"><component :is="statusIcon(detailRow.status)" class="h-3.5 w-3.5" />{{ STATUS_TEXT[detailRow.status] }}</span></dd>
            <dt>来源链接</dt>
            <dd class="break-all font-mono text-[12px] text-foreground">{{ detailRow.task.url }}</dd>
            <dt>文件格式</dt>
            <dd class="font-mono text-foreground">{{ detailRow.format }}</dd>
            <dt>已下载</dt>
            <dd class="font-mono text-foreground">{{ detailRow.size }}</dd>
            <dt v-if="detailRow.task.totalBytes">文件总大小</dt>
            <dd v-if="detailRow.task.totalBytes" class="font-mono text-foreground">{{ formatBytes(detailRow.task.totalBytes) }}</dd>
            <dt>创建时间</dt>
            <dd class="text-foreground">{{ new Date(detailRow.task.createdAt).toLocaleString() }}</dd>
            <dt v-if="detailRow.task.finishedAt">结束时间</dt>
            <dd v-if="detailRow.task.finishedAt" class="text-foreground">{{ new Date(detailRow.task.finishedAt).toLocaleString() }}</dd>
            <dt v-if="detailRow.downloadPath">保存位置</dt>
            <dd v-if="detailRow.downloadPath" class="break-all font-mono text-[12px] text-foreground">{{ detailRow.downloadPath }}</dd>
            <dt v-if="detailRow.task.playlistTotal && detailRow.task.playlistTotal > 1">播放列表进度</dt>
            <dd v-if="detailRow.task.playlistTotal && detailRow.task.playlistTotal > 1" class="font-mono text-foreground">{{ detailRow.task.playlistIndex ?? 0 }} / {{ detailRow.task.playlistTotal }}</dd>
            <dt v-if="detailRow.task.subtitles || detailRow.task.thumbnail">附加内容</dt>
            <dd v-if="detailRow.task.subtitles || detailRow.task.thumbnail" class="text-foreground">{{ [detailRow.task.subtitles ? '字幕' : '', detailRow.task.thumbnail ? '缩略图' : ''].filter(Boolean).join('、') }}</dd>
            <dt v-if="detailRow.task.error">错误信息</dt>
            <dd v-if="detailRow.task.error" class="break-words text-[12px] text-[color:var(--state-error)]">{{ detailRow.task.error }}</dd>
          </dl>
        </section>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.hd-grid {
  display: grid;
  grid-template-columns: minmax(260px, 2.1fr) minmax(104px, 0.75fr) minmax(120px, 0.8fr) minmax(90px, 0.65fr) minmax(90px, 0.65fr) minmax(104px, 0.8fr) minmax(88px, 0.65fr) 84px;
  column-gap: 20px;
  align-items: center;
}

.hd-head {
  min-height: 42px;
  padding: 0 20px;
  border-bottom: 1px solid var(--ydl-border);
  background: var(--ydl-surface-2);
  color: var(--ydl-muted-foreground);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0;
}

.hd-row {
  min-height: 72px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--ydl-border);
  transition: background-color 150ms ease;
}

.hd-row:last-child {
  border-bottom: 0;
}

.hd-row:hover {
  background: color-mix(in srgb, var(--ydl-primary) 4%, transparent);
}

.hd-filter {
  height: 30px;
  padding: 0 10px;
  border-radius: 4px;
  color: var(--ydl-muted-foreground);
  font-size: 12px;
  transition: color 150ms ease, background-color 150ms ease, box-shadow 150ms ease;
}

.hd-filter span {
  margin-left: 4px;
  font-family: var(--font-mono);
  font-size: 11px;
}

.hd-filter:hover {
  color: var(--ydl-foreground);
}

.hd-filter.is-active {
  background: var(--ydl-card);
  color: var(--ydl-foreground);
  box-shadow: var(--shadow-static);
}

.hd-media-icon {
  display: flex;
  width: 34px;
  height: 34px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--ydl-border);
  border-radius: 6px;
  background: var(--ydl-muted);
  color: var(--ydl-muted-foreground);
}

.hd-media-icon.video {
  color: var(--ydl-primary);
}

.hd-source {
  overflow: hidden;
  color: var(--ydl-muted-foreground);
  font-family: var(--font-mono);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hd-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: max-content;
  font-size: 12px;
  font-weight: 500;
}

.hd-status.completed {
  color: var(--state-success);
}

.hd-status.failed {
  color: var(--state-error);
}

.hd-status.cancelled,
.hd-status.interrupted {
  color: var(--state-warning);
}

.hd-icon-btn {
  display: inline-flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: var(--ydl-muted-foreground);
  transition: color 150ms ease, background-color 150ms ease;
}

.hd-icon-btn:hover {
  background: var(--ydl-muted);
  color: var(--ydl-foreground);
}

.hd-menu {
  position: fixed;
  z-index: 50;
  width: 176px;
  overflow: hidden;
  border: 1px solid var(--ydl-border);
  border-radius: 6px;
  background: var(--ydl-popover);
  box-shadow: var(--shadow-float);
}

.hd-menu button {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 9px;
  padding: 9px 10px;
  color: var(--ydl-foreground);
  font-size: 12px;
  text-align: left;
  transition: background-color 150ms ease;
}

.hd-menu button:hover:not(:disabled) {
  background: var(--ydl-muted);
}

.hd-menu button:disabled {
  cursor: not-allowed;
  color: var(--ydl-muted-foreground);
  opacity: 0.55;
}

.hd-menu .is-danger {
  border-top: 1px solid var(--ydl-border);
  color: var(--state-error);
}

.hd-detail-dialog {
  width: min(620px, 100%);
  max-height: min(720px, 85vh);
  overflow-y: auto;
  border: 1px solid var(--ydl-border);
  border-radius: 8px;
  background: var(--ydl-popover);
  box-shadow: var(--shadow-overlay);
}

.hd-detail-dialog dt {
  color: var(--ydl-muted-foreground);
}

.hd-detail-dialog dd {
  min-width: 0;
}

.hd-alert {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--state-error) 45%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--state-error) 10%, transparent);
  color: var(--ydl-foreground);
  font-size: 13px;
  line-height: 1.5;
}

.hd-alert > svg:first-child {
  color: var(--state-error);
  margin-top: 1px;
}

.hd-alert-close {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  color: var(--ydl-muted-foreground);
  cursor: pointer;
  background: transparent;
}

.hd-alert-close:hover {
  background: var(--ydl-muted);
  color: var(--ydl-foreground);
}

@media (max-width: 640px) {
  .hd-head,
  .hd-row {
    padding-right: 14px;
    padding-left: 14px;
  }
}
</style>