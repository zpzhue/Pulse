<script setup lang="ts">
import { ref, computed, watch } from "vue";
import {
  Loader2,
  ScanLine,
  Link,
  ClipboardPaste,
  ListVideo,
  ChevronDown,
  Video,
  Folder,
  FolderOpen,
  SlidersHorizontal,
  Captions,
  Image,
  FileStack,
  Download,
  Bookmark,
  Search,
  Play,
  HardDrive,
  CircleUser,
  Settings2,
  FileDown,
} from "lucide-vue-next";
import {
  chooseDirectory,
  readClipboardText,
  resolveUrl,
  type ResolveResult,
} from "../services/ytdlp";
import {
  baseSpecFromSettings,
  useDownloads,
  type DownloadTask,
} from "../composables/useDownloads";
import { useDownloadSettings } from "../composables/useDownloadSettings";

const { start: startTask } = useDownloads();
const { settings: downloadSettings } = useDownloadSettings();

/* ---- 交互状态 ---- */
const url = ref("");
const mode = ref<"single" | "playlist">("playlist");

/** Parsed metadata shown after resolving, so the user sees what yt-dlp
    actually resolved (single video or playlist). */
const resolvedInfo = ref<{ title: string; uploader: string; count: number } | null>(null);

/* URL 变化时粗略识别类型 */
function detectMode() {
  mode.value =
    url.value.includes("playlist") || url.value.includes("list=") ? "playlist" : "single";
  // A new URL invalidates the previous resolution result.
  resolvedInfo.value = null;
}

function singleFormatLabel(format: string): string {
  return format === "MP4" ? "MP4 视频" : format;
}

/* ---- 单视频模式选项 ---- */
const singleFormat = ref(singleFormatLabel(downloadSettings.format));
const singleQuality = ref(downloadSettings.quality);
const singlePath = ref(downloadSettings.downloadPath);
const singleSubs = ref(true);
const singleThumb = ref(false);
const singleKeepFormat = ref(false);

const singleDirty = {
  format: false,
  quality: false,
  path: false,
};

/* ---- 播放列表数据 ---- */
interface PlaylistItem {
  index: number;
  no: string;
  title: string;
  duration: string;
  size: string;
  format: string;
  selected: boolean;
  status: "unselected" | "ready" | "downloading" | "completed" | "failed" | "cancelled";
}
const playlist = ref<PlaylistItem[]>([]);
const playlistTitle = ref("");
const playlistUploader = ref("");
const playlistCount = ref(0);
const playlistSize = ref("—");
const batchTask = ref<DownloadTask | null>(null);

const selectedCount = computed(() => playlist.value.filter((i) => i.selected).length);
const allSelected = computed(() => selectedCount.value === playlist.value.length);
function toggleAll() {
  const next = !allSelected.value;
  playlist.value.forEach((item) => {
    item.selected = next;
    if (!batchTask.value) item.status = next ? "ready" : "unselected";
  });
}

const batchQuality = ref(downloadSettings.quality);
const batchFormat = ref(downloadSettings.format);

/* ---- 通用选项 ---- */
const commonPath = ref(downloadSettings.downloadPath);
const commonSubs = ref(true);
const commonThumb = ref(false);

const batchDirty = {
  quality: false,
  format: false,
  path: false,
};

watch(() => downloadSettings.quality, (quality) => {
  if (!singleDirty.quality) singleQuality.value = quality;
  if (!batchDirty.quality) batchQuality.value = quality;
});

watch(() => downloadSettings.format, (format) => {
  if (!singleDirty.format) singleFormat.value = singleFormatLabel(format);
  if (!batchDirty.format) batchFormat.value = format;
});

watch(() => downloadSettings.downloadPath, (path) => {
  if (!singleDirty.path) singlePath.value = path;
  if (!batchDirty.path) commonPath.value = path;
});

watch(() => batchTask.value?.status, (status) => {
  if (!status || status === "pending" || status === "downloading" || status === "cancelling") return;
  const playlistStatus = status === "completed"
    ? "completed"
    : status === "cancelled"
      ? "cancelled"
      : "failed";
  playlist.value.forEach((item) => {
    if (item.selected) item.status = playlistStatus;
  });
});

/* ---- 解析 / 下载状态 ---- */
const resolving = ref(false);
const submitting = ref(false);
const feedback = ref("");

function formatDuration(sec: number | null): string {
  if (!sec || Number.isNaN(sec) || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function seedItems(entries: { id: string; title: string; duration: number | null }[]): PlaylistItem[] {
  return entries.map((e, idx) => ({
    index: idx + 1,
    no: String(idx + 1).padStart(2, "0"),
    title: e.title,
    duration: formatDuration(e.duration),
    size: "—",
    format: batchFormat.value,
    selected: true,
    status: "ready",
  }));
}

/** Proxy/cookie options shared by resolve calls (downloads already apply them). */
function resolveOptions(): { proxy?: string; cookiePath?: string } {
  return {
    proxy: downloadSettings.proxyEnabled ? downloadSettings.proxyUrl : undefined,
    cookiePath: downloadSettings.cookieEnabled ? downloadSettings.cookiePath : undefined,
  };
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
  try {
    const res: ResolveResult = await resolveUrl(target, resolveOptions());
    mode.value = res.kind === "playlist" ? "playlist" : "single";
    resolvedInfo.value = { title: res.title, uploader: res.uploader, count: res.count };
    playlistTitle.value = res.title;
    playlistUploader.value = res.uploader;
    playlistCount.value = res.count;
    playlist.value = seedItems(res.entries ?? []);
    if (res.kind !== "playlist") playlist.value = [];
  } catch (e) {
    feedback.value = `解析失败：${String(e)}`;
  } finally {
    resolving.value = false;
  }
}

/** Map a UI format label ("MP4 视频/MP3 音频/WebM/MKV") to a yt-dlp token. */
function mapFormat(label: string): string {
  const lower = label.toLowerCase();
  if (lower.includes("mp3") || lower.includes("audio")) return "mp3";
  if (lower.includes("webm")) return "webm";
  if (lower.includes("mkv")) return "mkv";
  return "mp4";
}

/** Paste from the system clipboard into the URL field. */
async function pasteUrl() {
  const text = await readClipboardText();
  if (!text) {
    feedback.value = "剪贴板为空或不可读";
    return;
  }
  url.value = text.trim();
  detectMode();
  feedback.value = "";
}

/** Pick a download directory with the native folder dialog. */
async function browsePath(target: "single" | "batch") {
  const current = target === "single" ? singlePath.value : commonPath.value;
  const dir = await chooseDirectory(current);
  if (!dir) return;
  if (target === "single") singlePath.value = dir;
  else commonPath.value = dir;
}

async function startSingle() {
  const target = url.value.trim();
  if (!target) {
    feedback.value = "请先粘贴下载链接";
    return;
  }
  if (submitting.value) return;
  submitting.value = true;
  try {
    await startTask({
      ...baseSpecFromSettings(downloadSettings),
      url: target,
      kind: singleFormat.value.includes("MP3") ? "audio" : "video",
      format: mapFormat(singleFormat.value),
      downloadPath: singlePath.value,
      quality: singleQuality.value,
      filenameTemplate: downloadSettings.filenameTemplate,
      subtitles: singleSubs.value,
      thumbnail: singleThumb.value,
      keepOriginalFormat: singleKeepFormat.value && !singleFormat.value.includes("MP3"),
    });
    // The queue resolves the title; the dashboard reflects real state.
    feedback.value = "已加入下载队列";
  } finally {
    submitting.value = false;
  }
}

async function startBatch() {
  const selected = playlist.value.filter((i) => i.selected);
  if (selected.length === 0) {
    feedback.value = "请先勾选要下载的视频";
    return;
  }
  if (submitting.value) return;
  submitting.value = true;
  try {
    batchTask.value = await startTask({
      ...baseSpecFromSettings(downloadSettings),
      url: url.value.trim(),
      title: playlistTitle.value || "播放列表",
      kind: batchFormat.value.includes("MP3") ? "audio" : "video",
      format: mapFormat(batchFormat.value),
      downloadPath: commonPath.value,
      quality: batchQuality.value,
      filenameTemplate: downloadSettings.filenameTemplate,
      subtitles: commonSubs.value,
      thumbnail: commonThumb.value,
      playlistItems: selected.map((item) => item.index),
    });
    feedback.value = `已将 ${selected.length} 个视频加入下载队列`;
    playlist.value.forEach((item) => {
      item.status = item.selected ? "downloading" : "unselected";
    });
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="max-w-[720px] mx-auto flex flex-col gap-5">
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
            @input="detectMode"
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
        <ListVideo v-if="mode === 'playlist'" class="w-[18px] h-[18px] text-primary shrink-0" />
        <Video v-else class="w-[18px] h-[18px] text-primary shrink-0" />
        <span class="text-[13px] font-medium text-foreground">
          {{ mode === "playlist" ? "已解析播放列表" : "已解析视频" }}
        </span>
        <span class="ydl-tag" :class="mode === 'playlist' ? 'ydl-tag-cyan' : 'ydl-tag-green'">
          {{ mode === "playlist" ? `${resolvedInfo.count} 个视频` : "1 个视频" }}
        </span>
        <span class="text-[12px] text-muted-foreground font-mono max-w-[45%] truncate">{{ resolvedInfo.title }}</span>
        <span v-if="resolvedInfo.uploader" class="text-[12px] text-muted-foreground">{{ resolvedInfo.uploader }}</span>
      </div>

      <!-- Feedback / status message -->
      <p v-if="feedback" class="text-[13px] mt-3" :class="feedback.includes('失败') ? 'text-[var(--state-error)]' : 'text-primary'">
        {{ feedback }}
      </p>
    </section>

    <!-- ============ Block 2A: Single Video Mode ============ -->
    <section v-if="mode === 'single'" class="ydl-panel">
      <div class="ydl-section-title">
        <Video class="w-[18px] h-[18px] text-muted-foreground" />
        <h2 class="text-[16px] font-semibold text-foreground">下载选项</h2>
        <span class="ydl-tag ydl-tag-cyan">单视频模式</span>
      </div>

      <!-- Format select -->
      <div class="mb-5">
        <label class="ydl-label">输出格式</label>
        <div class="relative">
          <select v-model="singleFormat" class="ydl-select" @change="singleDirty.format = true">
            <option>MP4 视频</option>
            <option>MP3 音频</option>
            <option>WebM</option>
            <option>MKV</option>
          </select>
          <ChevronDown class="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        </div>
      </div>

      <!-- Quality cards 2x2 -->
      <div class="mb-5">
        <label class="ydl-label">画质选择</label>
        <div class="ydl-quality-grid">
          <label
            v-for="q in [
              { v: '4k', name: '4K', sub: '2160p · 超高清', size: '~2.4 GB', rec: false },
              { v: '1080p', name: '1080p', sub: '全高清', size: '~780 MB', rec: true },
              { v: '720p', name: '720p', sub: '高清', size: '~420 MB', rec: false },
              { v: '480p', name: '480p', sub: '标清', size: '~180 MB', rec: false },
            ]"
            :key="q.v"
            class="ydl-q-card"
          >
            <input type="radio" name="single-quality" :value="q.v" v-model="singleQuality" @change="singleDirty.quality = true" />
            <div class="ydl-q-inner">
              <div class="flex items-center justify-between mb-1.5">
                <span class="text-[14px] font-semibold text-foreground">{{ q.name }}</span>
                <span class="ydl-q-radio"></span>
              </div>
              <div class="text-[12px] text-muted-foreground">{{ q.sub }}</div>
              <div class="flex items-center gap-2 mt-1">
                <span v-if="q.rec" class="ydl-badge">推荐</span>
                <span class="font-mono text-[12px] text-muted-foreground">{{ q.size }}</span>
              </div>
            </div>
          </label>
        </div>
      </div>

      <!-- Save path -->
      <div class="mb-5">
        <label class="ydl-label">保存位置</label>
        <div class="flex items-stretch gap-2">
          <div class="relative flex-1">
            <Folder class="w-[18px] h-[18px] absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input v-model="singlePath" type="text" class="ydl-input pl-10 pr-3 h-11 font-mono" @input="singleDirty.path = true" />
          </div>
          <button type="button" class="ydl-btn-ghost px-4 h-11 rounded-lg" aria-label="浏览文件夹" @click="browsePath('single')">
            <FolderOpen class="w-4 h-4" />
            <span>浏览</span>
          </button>
        </div>
      </div>

      <!-- Advanced options -->
      <details class="ydl-details mb-5" open>
        <summary>
          <SlidersHorizontal class="w-[18px] h-[18px] text-muted-foreground" />
          <span>高级选项</span>
          <ChevronDown class="w-4 h-4 ydl-details-chevron text-muted-foreground" />
        </summary>
        <div class="ydl-details-body">
          <div class="ydl-toggle-row">
            <div class="flex items-center gap-3">
              <Captions class="w-[18px] h-[18px] text-muted-foreground" />
              <div>
                <div class="text-[14px] text-foreground">下载字幕</div>
                <div class="text-[12px] text-muted-foreground">自动获取可用字幕</div>
              </div>
            </div>
            <label class="ydl-toggle">
              <input type="checkbox" v-model="singleSubs" aria-label="下载字幕" />
              <span class="ydl-toggle-track"><span class="ydl-toggle-thumb"></span></span>
            </label>
          </div>
          <div class="ydl-toggle-row">
            <div class="flex items-center gap-3">
              <Image class="w-[18px] h-[18px] text-muted-foreground" />
              <div>
                <div class="text-[14px] text-foreground">下载缩略图</div>
                <div class="text-[12px] text-muted-foreground">保存视频封面图片</div>
              </div>
            </div>
            <label class="ydl-toggle">
              <input type="checkbox" v-model="singleThumb" aria-label="下载缩略图" />
              <span class="ydl-toggle-track"><span class="ydl-toggle-thumb"></span></span>
            </label>
          </div>
          <div class="ydl-toggle-row">
            <div class="flex items-center gap-3">
              <FileStack class="w-[18px] h-[18px] text-muted-foreground" />
              <div>
                <div class="text-[14px] text-foreground">保留原始格式</div>
                <div class="text-[12px] text-muted-foreground">不进行格式转换</div>
              </div>
            </div>
            <label class="ydl-toggle">
              <input type="checkbox" v-model="singleKeepFormat" aria-label="保留原始格式" />
              <span class="ydl-toggle-track"><span class="ydl-toggle-thumb"></span></span>
            </label>
          </div>
        </div>
      </details>

      <!-- Action buttons -->
      <section class="flex items-stretch gap-3">
        <button
          type="button"
          class="ydl-btn-primary flex-1 h-12 rounded-lg disabled:opacity-50"
          :disabled="submitting"
          @click="startSingle"
        >
          <Download class="w-[18px] h-[18px]" />
          <span>开始下载</span>
        </button>
        <button
          type="button"
          class="ydl-btn-outline h-12 px-5 rounded-lg"
          disabled
          title="开发中，敬请期待"
        >
          <Bookmark class="w-[18px] h-[18px]" />
          <span>保存为预设</span>
        </button>
      </section>
    </section>

    <!-- ============ Block 2B: Playlist Mode ============ -->
    <section v-else class="flex flex-col gap-4">
      <!-- Info bar -->
      <div class="flex items-center justify-between gap-4 flex-wrap">
        <div class="flex items-center gap-5 flex-wrap">
          <h2 class="text-[18px] font-semibold text-foreground">{{ playlistTitle || "播放列表" }}</h2>
          <div class="flex items-center gap-4 text-[13px] text-muted-foreground">
            <span class="meta-pill"><ListVideo class="w-3.5 h-3.5" />{{ playlistCount }} 个视频</span>
            <span class="meta-pill font-mono"><HardDrive class="w-3.5 h-3.5" />{{ playlistSize }}</span>
            <span class="meta-pill"><CircleUser class="w-3.5 h-3.5" />{{ playlistUploader || "未知作者" }}</span>
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

      <!-- Video list table -->
      <div class="bg-card border border-border rounded-[var(--radius-lg)] overflow-hidden">
        <div class="pl-head">
          <span></span>
          <span>#</span>
          <span>缩略图</span>
          <span>标题</span>
          <span>时长</span>
          <span>大小</span>
          <span>格式</span>
          <span>状态</span>
        </div>
        <div>
          <label
            v-for="row in playlist"
            :key="row.no"
            class="pl-row"
            :data-selected="row.selected"
          >
            <input
              type="checkbox"
              class="ydl-check"
              v-model="row.selected"
              @change="!batchTask && (row.status = row.selected ? 'ready' : 'unselected')"
            />
            <span class="font-mono text-[12px] text-muted-foreground">{{ row.no }}</span>
            <div class="thumb"><Play class="w-3.5 h-3.5" /></div>
            <span class="text-[14px] text-foreground truncate">{{ row.title }}</span>
            <span class="font-mono text-[13px] text-muted-foreground">{{ row.duration }}</span>
            <span class="font-mono text-[13px] text-muted-foreground">{{ row.size }}</span>
            <span class="ydl-tag">{{ row.format }}</span>
            <span class="text-[12px] text-muted-foreground">
              {{ row.status === "unselected" ? "未选择" : row.status === "ready" ? "待下载" : row.status === "downloading" ? "下载中" : row.status === "completed" ? "批次已完成" : row.status === "cancelled" ? "已取消" : "批次失败" }}
            </span>
          </label>
        </div>
      </div>

      <!-- Batch action toolbar -->
      <div class="batch-bar flex-wrap">
        <span class="text-[13px] text-foreground font-medium whitespace-nowrap">
          已选择 <span class="text-primary font-mono">{{ selectedCount }}</span>
          <span class="text-muted-foreground">/</span> <span class="font-mono">{{ playlist.length }}</span> 项
        </span>
        <div class="flex-1 min-w-[12px]"></div>
        <div class="select-wrap">
          <select v-model="batchQuality" class="ydl-select-sm" aria-label="清晰度" @change="batchDirty.quality = true">
            <option>1080p</option>
            <option>720p</option>
            <option>480p</option>
          </select>
          <span class="chev"><ChevronDown class="w-3.5 h-3.5" /></span>
        </div>
        <div class="select-wrap">
          <select v-model="batchFormat" class="ydl-select-sm" aria-label="格式" @change="batchDirty.format = true">
            <option>MP4</option>
            <option>MP3</option>
            <option>WebM</option>
          </select>
          <span class="chev"><ChevronDown class="w-3.5 h-3.5" /></span>
        </div>
        <button
          type="button"
          class="ydl-btn-outline ydl-btn-sm"
          disabled
          title="开发中，敬请期待"
        >
          <FileDown class="w-4 h-4" />
          <span>导出列表</span>
        </button>
        <button
          type="button"
          class="ydl-btn-primary ydl-btn-sm"
          :disabled="submitting"
          @click="startBatch"
        >
          <Download class="w-4 h-4" />
          <span>批量下载</span>
        </button>
      </div>
    </section>

    <!-- ============ Block 3: Quick Unified Options ============ -->
    <section class="ydl-panel-sm">
      <div class="flex items-center gap-2.5 mb-4">
        <Settings2 class="w-[18px] h-[18px] text-muted-foreground" />
        <h3 class="text-[15px] font-semibold text-foreground">通用快速选项</h3>
        <span class="ydl-tag">影响所有选中项</span>
      </div>

      <!-- Universal save path -->
      <div class="mb-4">
        <label class="ydl-label">通用保存路径</label>
        <div class="flex items-stretch gap-2">
          <div class="relative flex-1">
            <Folder class="w-[18px] h-[18px] absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input v-model="commonPath" type="text" class="ydl-input pl-10 pr-3 h-11 font-mono" @input="batchDirty.path = true" />
          </div>
          <button type="button" class="ydl-btn-ghost px-4 h-11 rounded-lg" aria-label="浏览文件夹" @click="browsePath('batch')">
            <FolderOpen class="w-4 h-4" />
            <span>浏览</span>
          </button>
        </div>
      </div>

      <!-- Advanced options collapse -->
      <details class="ydl-details" open>
        <summary>
          <SlidersHorizontal class="w-[18px] h-[18px] text-muted-foreground" />
          <span>高级选项</span>
          <ChevronDown class="w-4 h-4 ydl-details-chevron text-muted-foreground" />
        </summary>
        <div class="ydl-details-body">
          <div class="ydl-toggle-row">
            <div class="flex items-center gap-3">
              <Captions class="w-[18px] h-[18px] text-muted-foreground" />
              <div>
                <div class="text-[14px] text-foreground">下载字幕</div>
                <div class="text-[12px] text-muted-foreground">为所有选中视频获取字幕</div>
              </div>
            </div>
            <label class="ydl-toggle">
              <input type="checkbox" v-model="commonSubs" aria-label="下载字幕" />
              <span class="ydl-toggle-track"><span class="ydl-toggle-thumb"></span></span>
            </label>
          </div>
          <div class="ydl-toggle-row">
            <div class="flex items-center gap-3">
              <Image class="w-[18px] h-[18px] text-muted-foreground" />
              <div>
                <div class="text-[14px] text-foreground">下载缩略图</div>
                <div class="text-[12px] text-muted-foreground">为所有选中视频保存封面</div>
              </div>
            </div>
            <label class="ydl-toggle">
              <input type="checkbox" v-model="commonThumb" aria-label="下载缩略图" />
              <span class="ydl-toggle-track"><span class="ydl-toggle-thumb"></span></span>
            </label>
          </div>
        </div>
      </details>
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
.ydl-panel-sm {
  background: var(--ydl-card);
  border: 1px solid var(--ydl-border);
  border-radius: 16px;
  padding: 18px;
}
.ydl-label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--ydl-foreground);
  margin-bottom: 8px;
}
.ydl-section-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
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

/* Select */
.ydl-select {
  width: 100%;
  height: 44px;
  background: var(--ydl-card);
  border: 1px solid var(--ydl-border);
  border-radius: 8px;
  color: var(--ydl-foreground);
  font-size: 14px;
  padding: 0 36px 0 12px;
  appearance: none;
  -webkit-appearance: none;
  cursor: pointer;
  transition: border-color 160ms, box-shadow 160ms;
}
.ydl-select:hover {
  border-color: var(--ydl-muted-foreground);
}
.ydl-select:focus {
  outline: none;
  border-color: var(--ydl-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ydl-ring) 22%, transparent);
}
.ydl-select option {
  background: var(--ydl-card);
  color: var(--ydl-foreground);
}

/* Inline select wrap (batch bar) */
.select-wrap {
  position: relative;
  display: inline-flex;
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

/* Quality cards */
.ydl-quality-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
@media (max-width: 639px) {
  .ydl-quality-grid {
    grid-template-columns: 1fr;
  }
}
.ydl-q-card {
  display: flex;
  cursor: pointer;
  position: relative;
}
.ydl-q-card input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}
.ydl-q-inner {
  flex: 1;
  border: 1px solid var(--ydl-border);
  border-radius: 8px;
  padding: 12px;
  transition: border-color 160ms, background 160ms;
}
.ydl-q-card:hover .ydl-q-inner {
  border-color: var(--ydl-muted-foreground);
}
.ydl-q-card input:checked ~ .ydl-q-inner {
  border-color: var(--ydl-primary);
  background: color-mix(in srgb, var(--ydl-primary) 8%, transparent);
}
.ydl-q-radio {
  width: 16px;
  height: 16px;
  border-radius: 999px;
  border: 2px solid var(--ydl-border);
  flex-shrink: 0;
  transition: border-color 160ms, background 160ms;
}
.ydl-q-card input:checked ~ .ydl-q-inner .ydl-q-radio {
  border-color: var(--ydl-primary);
  background: radial-gradient(circle, var(--ydl-primary) 0 3.5px, transparent 4px);
}
.ydl-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ydl-primary) 15%, transparent);
  color: var(--ydl-primary);
  font-weight: 500;
  line-height: 1.4;
}

/* Toggle */
.ydl-toggle {
  display: inline-flex;
  cursor: pointer;
  position: relative;
  flex-shrink: 0;
}
.ydl-toggle input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}
.ydl-toggle-track {
  width: 44px;
  height: 24px;
  border-radius: 999px;
  background: var(--ydl-surface-3);
  position: relative;
  transition: background-color 160ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.ydl-toggle-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: var(--ydl-foreground);
  transition: transform 160ms cubic-bezier(0.2, 0.8, 0.2, 1), background-color 160ms;
}
.ydl-toggle input:checked ~ .ydl-toggle-track {
  background: var(--ydl-primary);
}
.ydl-toggle input:checked ~ .ydl-toggle-track .ydl-toggle-thumb {
  transform: translateX(20px);
  background: var(--ydl-primary-foreground);
}

/* Details */
.ydl-details > summary {
  list-style: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--ydl-border);
  border-radius: 8px;
  background: var(--ydl-muted);
  font-size: 14px;
  font-weight: 500;
  color: var(--ydl-foreground);
  transition: background 160ms;
}
.ydl-details > summary:hover {
  background: var(--ydl-surface-2);
}
.ydl-details-chevron {
  margin-left: auto;
  transition: transform 160ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.ydl-details[open] > summary .ydl-details-chevron {
  transform: rotate(180deg);
}
.ydl-details-body {
  padding: 8px 4px 4px;
}
.ydl-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 8px;
}
.ydl-toggle-row + .ydl-toggle-row {
  border-top: 1px solid var(--ydl-border);
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
  grid-template-columns: 28px 32px 56px minmax(0, 1fr) 56px 64px 52px 68px;
  align-items: center;
  gap: 12px;
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

/* Thumbnail placeholder */
.thumb {
  width: 48px;
  height: 32px;
  border-radius: 4px;
  background: var(--ydl-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ydl-muted-foreground);
  flex-shrink: 0;
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