<script setup lang="ts">
import { ref, computed, watch } from "vue";
import {
  Loader2,
  ScanLine,
  Link,
  ClipboardPaste,
  ListVideo,
  Video,
  ChevronDown,
  Download,
  Search,
} from "lucide-vue-next";
import {
  readClipboardText,
  resolveUrl,
  type ResolveResult,
  type VideoFormatOption,
} from "../services/ytdlp";
import {
  baseSpecFromSettings,
  formatBytes,
  useDownloads,
  type DownloadTask,
} from "../composables/useDownloads";
import { useDownloadSettings } from "../composables/useDownloadSettings";

const { start: startTask } = useDownloads();
const { settings: downloadSettings } = useDownloadSettings();

/* ---- 交互状态 ---- */
const url = ref("");
const resolving = ref(false);
const submitting = ref(false);
const feedback = ref("");

/** Parsed metadata; the list area below stays hidden until it exists. */
const resolvedInfo = ref<{
  kind: "video" | "playlist";
  title: string;
  uploader: string;
  count: number;
} | null>(null);

/* ---- 行模型：单视频解析为 1 行（带可选流），播放列表每条 1 行 ---- */
interface Row {
  no: string;
  id: string;
  url: string;
  title: string;
  duration: string;
  /** Selectable video streams; only a resolved single video carries them. */
  formats: VideoFormatOption[];
  /** Picked stream id (row dropdown); null → yt-dlp default selection. */
  selectedFormatId: string | null;
  selected: boolean;
  status: "ready" | "downloading" | "completed" | "failed" | "cancelled";
}

const rows = ref<Row[]>([]);

const selectedCount = computed(() => rows.value.filter((row) => row.selected).length);
const allSelected = computed(
  () => rows.value.length > 0 && selectedCount.value === rows.value.length,
);

function toggleAll() {
  const next = !allSelected.value;
  rows.value.forEach((row) => {
    row.selected = next;
  });
}

/* URL 变化使上一次解析结果失效 */
function onUrlInput() {
  resolvedInfo.value = null;
  rows.value = [];
}

function formatDuration(sec: number | null): string {
  if (!sec || Number.isNaN(sec) || sec <= 0) return "—";
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** 2160→4K, 1440→2K, else <height>p; null when height unknown. */
function qualityLabel(height: number | null): string | null {
  if (!height || height <= 0) return null;
  if (height >= 4320) return "8K";
  if (height >= 2160) return "4K";
  if (height >= 1440) return "2K";
  return `${height}p`;
}

/** Dropdown label: MP4 · 1080p · 1920×1080 · ~128 MB (missing parts → —). */
function formatOptionLabel(f: VideoFormatOption): string {
  const parts = [
    f.ext ? f.ext.toUpperCase() : "—",
    qualityLabel(f.height) ?? "—",
    f.width && f.height ? `${f.width}×${f.height}` : "—",
    f.filesize ? `~${formatBytes(f.filesize)}` : "—",
  ];
  return parts.every((part) => part === "—") ? f.formatId : parts.join(" · ");
}

function selectedFormat(row: Row): VideoFormatOption | null {
  return row.formats.find((f) => f.formatId === row.selectedFormatId) ?? null;
}

function resolutionText(row: Row): string {
  const f = selectedFormat(row);
  return f?.width && f?.height ? `${f.width}×${f.height}` : "—";
}

function extText(row: Row): string {
  const f = selectedFormat(row);
  return f ? (f.ext ? f.ext.toUpperCase() : "—") : "—";
}

function sizeText(row: Row): string {
  const f = selectedFormat(row);
  return f?.filesize ? `~${formatBytes(f.filesize)}` : "—";
}

function statusText(status: Row["status"]): string {
  switch (status) {
    case "ready":
      return "待下载";
    case "downloading":
      return "下载中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
  }
}

/** Proxy/cookie options shared by resolve calls (downloads already apply them). */
function resolveOptions(): { proxy?: string; cookiePath?: string } {
  return {
    proxy: downloadSettings.proxyEnabled ? downloadSettings.proxyUrl : undefined,
    cookiePath: downloadSettings.cookieEnabled ? downloadSettings.cookiePath : undefined,
  };
}

function seedRows(res: ResolveResult) {
  if (res.kind === "playlist") {
    // Flat playlist entries carry no format metadata → no row dropdown;
    // their downloads use yt-dlp's default selection (URL only).
    rows.value = (res.entries ?? []).map((entry, idx) => ({
      no: String(idx + 1).padStart(2, "0"),
      id: entry.id,
      url: entry.url ?? "",
      title: entry.title,
      duration: formatDuration(entry.duration),
      formats: [],
      selectedFormatId: null,
      selected: true,
      status: "ready" as const,
    }));
    return;
  }
  const formats: VideoFormatOption[] = (res.formats ?? []).map((f) => ({ ...f }));
  rows.value = [
    {
      no: "01",
      id: res.id,
      url: url.value.trim(),
      title: res.title,
      duration: formatDuration(res.duration ?? null),
      formats,
      // Default to the highest-resolution stream (formats arrive sorted).
      selectedFormatId: formats[0]?.formatId ?? null,
      selected: true,
      status: "ready",
    },
  ];
}

async function parseUrl() {
  const target = url.value.trim();
  if (!target) {
    feedback.value = "请先粘贴下载链接";
    return;
  }
  resolving.value = true;
  feedback.value = "";
  resolvedInfo.value = null;
  rows.value = [];
  try {
    const res: ResolveResult = await resolveUrl(target, resolveOptions());
    resolvedInfo.value = {
      kind: res.kind === "playlist" ? "playlist" : "video",
      title: res.title,
      uploader: res.uploader,
      count: res.kind === "playlist" ? res.count : 1,
    };
    seedRows(res);
  } catch (e) {
    feedback.value = `解析失败：${String(e)}`;
  } finally {
    resolving.value = false;
  }
}

/** Paste from the system clipboard into the URL field. */
async function pasteUrl() {
  const text = await readClipboardText();
  if (!text) {
    feedback.value = "剪贴板为空或不可读";
    return;
  }
  url.value = text.trim();
  onUrlInput();
  feedback.value = "";
}

/** Map a task status onto the row badge. */
function statusForTask(status: DownloadTask["status"]): Row["status"] {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  return "downloading"; // pending / downloading / cancelling
}

/**
 * Enqueue one task per selected row. Rows carrying a picked format id
 * download that exact stream (video-only streams combined with bestaudio);
 * rows without one fall back to yt-dlp's default selection (URL only).
 */
async function startSelected() {
  const selected = rows.value.filter((row) => row.selected);
  if (selected.length === 0) {
    feedback.value = "请先勾选要下载的视频";
    return;
  }
  if (submitting.value) return;
  submitting.value = true;
  try {
    let queued = 0;
    for (const row of selected) {
      if (!row.url) {
        row.status = "failed";
        continue;
      }
      const picked = selectedFormat(row);
      const task = await startTask({
        ...baseSpecFromSettings(downloadSettings),
        url: row.url,
        title: row.title,
        kind: "video",
        format: "",
        downloadPath: downloadSettings.downloadPath,
        quality: "",
        filenameTemplate: downloadSettings.filenameTemplate,
        subtitles: false,
        thumbnail: false,
        formatId: row.selectedFormatId ?? undefined,
        videoOnly: picked?.videoOnly,
      });
      queued += 1;
      row.status = "downloading";
      // The task object stays reactive after it moves to history, so the
      // row badge keeps tracking it until it reaches a terminal state.
      watch(
        () => task.status,
        (status) => {
          row.status = statusForTask(status);
        },
      );
    }
    feedback.value = queued > 0
      ? `已将 ${queued} 个视频加入下载队列`
      : "所选条目缺少下载链接";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="max-w-[960px] mx-auto flex flex-col gap-5">
    <!-- ============ Block 1: URL Input + Smart Detection ============ -->
    <section class="ydl-panel">
      <p class="text-[13px] text-muted-foreground mb-4 flex items-center gap-2">
        <ScanLine class="w-4 h-4" />
        <span>粘贴视频或播放列表链接，自动识别类型</span>
      </p>

      <div class="flex items-stretch gap-2">
        <div class="relative flex-1">
          <Link class="w-[18px] h-[18px] absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            v-model="url"
            @input="onUrlInput"
            type="text"
            placeholder="粘贴视频或播放列表链接"
            class="ydl-input pl-10 pr-3 h-12 font-mono"
          />
        </div>
        <button type="button" class="ydl-btn-ghost px-4 h-12 rounded-lg" aria-label="粘贴链接" @click="pasteUrl">
          <ClipboardPaste class="w-4 h-4" />
          <span>粘贴</span>
        </button>
        <button
          type="button"
          class="ydl-btn-ghost px-4 h-12 rounded-lg"
          aria-label="解析链接"
          :disabled="resolving || !url.trim()"
          @click="parseUrl"
        >
          <Loader2 v-if="resolving" class="w-4 h-4 animate-spin" />
          <Search v-else class="w-4 h-4" />
          <span>{{ resolving ? "解析中" : "解析" }}</span>
        </button>
      </div>

      <!-- Resolution result bar: shows what yt-dlp resolved -->
      <div v-if="resolvedInfo" class="detect-bar mt-3">
        <ListVideo v-if="resolvedInfo.kind === 'playlist'" class="w-[18px] h-[18px] text-primary shrink-0" />
        <Video v-else class="w-[18px] h-[18px] text-primary shrink-0" />
        <span class="text-[13px] font-medium text-foreground">
          {{ resolvedInfo.kind === "playlist" ? "已解析播放列表" : "已解析视频" }}
        </span>
        <span class="ydl-tag" :class="resolvedInfo.kind === 'playlist' ? 'ydl-tag-cyan' : 'ydl-tag-green'">
          {{ resolvedInfo.kind === "playlist" ? `${resolvedInfo.count} 个视频` : "1 个视频" }}
        </span>
        <span class="text-[12px] text-muted-foreground font-mono max-w-[45%] truncate">{{ resolvedInfo.title }}</span>
        <span v-if="resolvedInfo.uploader" class="text-[12px] text-muted-foreground">{{ resolvedInfo.uploader }}</span>
      </div>

      <!-- Feedback / status message -->
      <p v-if="feedback" class="text-[13px] mt-3" :class="feedback.includes('失败') ? 'text-[var(--state-error)]' : 'text-primary'">
        {{ feedback }}
      </p>
    </section>

    <!-- ============ Block 2: Resolved Download List ============ -->
    <section v-if="resolvedInfo" class="flex flex-col gap-4">
      <!-- Info bar (playlists only): title + count + select toggle -->
      <div v-if="resolvedInfo.kind === 'playlist'" class="flex items-center justify-between gap-4 flex-wrap">
        <div class="flex items-center gap-5 flex-wrap">
          <h2 class="text-[18px] font-semibold text-foreground">{{ resolvedInfo.title }}</h2>
          <div class="flex items-center gap-4 text-[13px] text-muted-foreground">
            <span class="meta-pill"><ListVideo class="w-3.5 h-3.5" />{{ resolvedInfo.count }} 个视频</span>
          </div>
        </div>
        <button
          type="button"
          @click="toggleAll"
          class="text-[13px] text-primary hover:underline underline-offset-4 font-medium whitespace-nowrap"
        >
          全选 / 取消全选
        </button>
      </div>

      <!-- Download list table -->
      <div class="bg-card border border-border rounded-[var(--radius-lg)] overflow-x-auto">
        <div class="pl-head">
          <span></span>
          <span>ID</span>
          <span>标题</span>
          <span>时长</span>
          <span>清晰度</span>
          <span>分辨率</span>
          <span>格式</span>
          <span>大小</span>
          <span>状态</span>
        </div>
        <div>
          <label
            v-for="row in rows"
            :key="row.no"
            class="pl-row"
            :data-selected="row.selected"
          >
            <input
              type="checkbox"
              class="ydl-check"
              v-model="row.selected"
            />
            <span class="font-mono text-[12px] text-muted-foreground truncate" :title="row.id">{{ row.id }}</span>
            <span class="text-[14px] text-foreground truncate" :title="row.title">{{ row.title }}</span>
            <span class="font-mono text-[13px] text-muted-foreground">{{ row.duration }}</span>
            <div v-if="row.formats.length" class="select-wrap">
              <select v-model="row.selectedFormatId" class="ydl-select-sm" :aria-label="`清晰度（${row.title}）`">
                <option v-for="f in row.formats" :key="f.formatId" :value="f.formatId">
                  {{ formatOptionLabel(f) }}
                </option>
              </select>
              <span class="chev"><ChevronDown class="w-3.5 h-3.5" /></span>
            </div>
            <span v-else class="text-[12px] text-muted-foreground">默认画质</span>
            <span class="font-mono text-[12px] text-muted-foreground">{{ resolutionText(row) }}</span>
            <span class="ydl-tag">{{ extText(row) }}</span>
            <span class="font-mono text-[12px] text-muted-foreground">{{ sizeText(row) }}</span>
            <span class="text-[12px] text-muted-foreground">{{ statusText(row.status) }}</span>
          </label>
        </div>
      </div>

      <!-- Batch action toolbar -->
      <div class="batch-bar flex-wrap">
        <span class="text-[13px] text-foreground font-medium whitespace-nowrap">
          已选择 <span class="text-primary font-mono">{{ selectedCount }}</span>
          <span class="text-muted-foreground">/</span> <span class="font-mono">{{ rows.length }}</span> 项
        </span>
        <div class="flex-1 min-w-[12px]"></div>
        <button
          type="button"
          class="ydl-btn-primary ydl-btn-sm"
          :disabled="submitting"
          @click="startSelected"
        >
          <Download class="w-4 h-4" />
          <span>批量下载</span>
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* ===== 组件样式（来自 ytdlp-gui 设计稿） ===== */
.ydl-panel {
  background: var(--ydl-card);
  border: 1px solid var(--ydl-border);
  border-radius: 16px;
  padding: 24px;
}

/* Inputs */
.ydl-input {
  width: 100%;
  background: var(--ydl-card);
  border: 1px solid var(--ydl-border);
  border-radius: 8px;
  color: var(--ydl-foreground);
  font-family: var(--font-sans);
  font-size: 14px;
  transition: border-color 160ms, box-shadow 160ms;
}
.ydl-input::placeholder {
  color: var(--ydl-muted-foreground);
}
.ydl-input:hover {
  border-color: var(--ydl-muted-foreground);
}
.ydl-input:focus {
  outline: none;
  border-color: var(--ydl-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ydl-ring) 22%, transparent);
}

/* Inline select wrap (row quality / batch bar) */
.select-wrap {
  position: relative;
  display: inline-flex;
  max-width: 100%;
}
.select-wrap .ydl-select-sm {
  appearance: none;
  -webkit-appearance: none;
  background: var(--ydl-muted);
  border: 1px solid var(--ydl-border);
  color: var(--ydl-foreground);
  font-size: 13px;
  padding: 7px 30px 7px 12px;
  border-radius: 8px;
  cursor: pointer;
  font-family: var(--font-sans);
  height: 36px;
  width: 100%;
  max-width: 170px;
  transition: border-color 140ms;
}
.select-wrap .ydl-select-sm:hover {
  border-color: var(--ydl-muted-foreground);
}
.select-wrap .chev {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  pointer-events: none;
  color: var(--ydl-muted-foreground);
  display: inline-flex;
}

/* Buttons */
.ydl-btn-primary {
  background: var(--ydl-primary);
  color: var(--ydl-primary-foreground);
  border: none;
  border-radius: 8px;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  transition: opacity 160ms, transform 160ms;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.ydl-btn-primary:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}
.ydl-btn-primary:active {
  transform: translateY(0);
  opacity: 1;
}
.ydl-btn-outline {
  background: transparent;
  border: 1px solid var(--ydl-border);
  color: var(--ydl-foreground);
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  transition: border-color 160ms, background 160ms;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.ydl-btn-outline:hover {
  border-color: var(--ydl-primary);
  background: var(--ydl-muted);
}
.ydl-btn-ghost {
  background: var(--ydl-muted);
  border: 1px solid var(--ydl-border);
  color: var(--ydl-foreground);
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  transition: background 160ms;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.ydl-btn-ghost:hover {
  background: var(--ydl-surface-2);
}
.ydl-btn-sm {
  height: 36px;
  padding: 0 14px;
  font-size: 13px;
}

/* Custom Checkbox */
.ydl-check {
  appearance: none;
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  border: 1.5px solid var(--ydl-border);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  position: relative;
  flex-shrink: 0;
  margin: 0;
  transition: background-color 140ms cubic-bezier(0.2, 0.8, 0.2, 1), border-color 140ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.ydl-check:hover {
  border-color: var(--ydl-primary);
}
.ydl-check:checked {
  background: var(--ydl-primary);
  border-color: var(--ydl-primary);
}
.ydl-check:checked::after {
  content: "";
  position: absolute;
  left: 4px;
  top: 1px;
  width: 4px;
  height: 8px;
  border: solid var(--ydl-primary-foreground);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

/* Playlist table */
.pl-head,
.pl-row {
  display: grid;
  grid-template-columns: 26px 88px minmax(0, 1fr) 50px 170px 84px 46px 62px 64px;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
}
.pl-head {
  font-size: 11px;
  color: var(--ydl-muted-foreground);
  border-bottom: 1px solid var(--ydl-border);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  background: var(--ydl-surface-2);
}
.pl-row {
  border-bottom: 1px solid var(--ydl-border);
  transition: background-color 120ms cubic-bezier(0.2, 0.8, 0.2, 1);
  cursor: pointer;
}
.pl-row:last-child {
  border-bottom: none;
}
.pl-row:hover {
  background: var(--ydl-muted);
}
.pl-row[data-selected="true"] {
  background: color-mix(in srgb, var(--ydl-primary) 5%, transparent);
  box-shadow: inset 2px 0 0 var(--ydl-primary);
}
.pl-row[data-selected="true"]:hover {
  background: color-mix(in srgb, var(--ydl-primary) 9%, transparent);
}

/* Tag */
.ydl-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-family: var(--font-mono);
  background: var(--ydl-muted);
  color: var(--ydl-muted-foreground);
  line-height: 1.4;
}
.ydl-tag-cyan {
  background: color-mix(in srgb, var(--ydl-primary) 18%, transparent);
  color: var(--ydl-primary);
}
.ydl-tag-green {
  background: color-mix(in srgb, #22c55e 16%, transparent);
  color: #16a34a;
}

/* Meta pill */
.meta-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

/* Smart detection bar */
.detect-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--ydl-primary) 10%, transparent);
}

/* Sticky batch toolbar */
.batch-bar {
  position: sticky;
  bottom: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--ydl-card);
  border: 1px solid var(--ydl-border);
  border-radius: 12px;
  box-shadow: var(--shadow-float);
}
</style>
