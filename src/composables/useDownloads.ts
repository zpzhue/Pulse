import { ref, computed, readonly, reactive, watch, effectScope } from "vue";
import {
  cancelDownload,
  startDownload,
  resolveUrl,
  type DownloadOptions,
} from "../services/ytdlp";
import { useDownloadSettings, type DownloadSettings } from "./useDownloadSettings";
import { effectiveDownloadPath, initKnownPaths, normalizeStoredPath } from "../services/paths";
import {
  getActiveDownloads,
  getDownloadHistory,
  replaceActiveDownloads,
  replaceDownloadHistory,
} from "../services/storage";

export type TaskStatus = "pending" | "downloading" | "cancelling" | "completed" | "failed" | "cancelled" | "interrupted";

/** A download task tracked by the app (active or persisted history). */
export interface DownloadTask {
  id: string;
  title: string;
  url: string;
  kind: "video" | "audio";
  format: string;
  status: TaskStatus;
  percent: number;
  downloadedBytes: number;
  totalBytes: number | null;
  speed: number | null; // bytes/sec
  eta: number | null; // seconds
  /** Absolute directory the task downloads into (persisted for history). */
  downloadPath?: string;
  /** Subtitle / thumbnail choices, persisted so history restarts reproduce
      the original task (absent on legacy records → treated as false). */
  subtitles?: boolean;
  thumbnail?: boolean;
  /** Playlist progress: 1-based index of the item now downloading. */
  playlistIndex?: number | null;
  playlistTotal?: number | null;
  error?: string;
  createdAt: number;
  finishedAt?: number;
}

/** Input used to launch a download through the store. */
export interface StartSpec {
  url: string;
  title?: string;
  kind: "video" | "audio";
  format: string;
  downloadPath: string;
  quality: string;
  filenameTemplate: string;
  subtitles: boolean;
  thumbnail: boolean;
  /** Row-selected yt-dlp format id; absent → yt-dlp default selection. */
  formatId?: string;
  /** Whether the picked format lacks an audio track (+bestaudio needed). */
  videoOnly?: boolean;
  proxy?: string;
  playlistItems?: number[];
  rateLimitKiB?: number;
  resume?: boolean;
  removePartialFiles?: boolean;
  retries?: number;
  cookiePath?: string;
  ffmpegPath?: string;
  /** 显式跳过"已完成/在队"查重（历史页「重新下载」用；默认查重）。 */
  force?: boolean;
}

/**
 * The settings-derived portion of every StartSpec (shared by single, batch
 * and history-restart entry points so the mapping lives in one place).
 */
export function baseSpecFromSettings(settings: DownloadSettings) {
  return {
    proxy: settings.proxyEnabled ? settings.proxyUrl : undefined,
    rateLimitKiB: settings.rateLimitEnabled ? settings.rateLimitKiB : undefined,
    resume: settings.resumeEnabled,
    removePartialFiles: settings.removePartialFiles,
    retries: settings.retryCount,
    cookiePath: settings.cookieEnabled ? settings.cookiePath : undefined,
    ffmpegPath: settings.ffmpegPath || undefined,
  };
}

/**
 * 查重用的 URL 归一化：
 * - 走 URL 解析：主机名自动小写、hash 一律去掉（不影响内容定位）
 * - 剔除常见跟踪噪声：`si`（YouTube 分享追踪）、`feature`、`utm_*`——
 *   重新粘贴同一视频时差异基本都来自这几个参数
 * - 其余查询参数（v / list / p / t / bvid / av 等参与内容定位）原样保留，
 *   宁可漏判也不能误杀真实新任务
 * - 解析不了的输入退回 trim 后的原串（非 URL 值不误伤）
 */
export function canonicalDownloadUrl(url: string): string {
  const raw = url.trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (key === "si" || key === "feature" || key.startsWith("utm_")) {
        parsed.searchParams.delete(key);
      }
    }
    return parsed.toString();
  } catch {
    return raw;
  }
}

const HISTORY_KEY = "pulse.history";
const HISTORY_LIMIT = 200;

/* ------------------------------------------------------------------ */
/*  Util helpers                                                        */
/* ------------------------------------------------------------------ */

function genId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0 || !Number.isFinite(bytes)) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatSpeed(bytesPerSec: number | null | undefined): string {
  if (!bytesPerSec || bytesPerSec <= 0 || !Number.isFinite(bytesPerSec)) return "—";
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatEta(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0 || !Number.isFinite(seconds)) return "—";
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/* ------------------------------------------------------------------ */
/*  Store state                                                         */
/* ------------------------------------------------------------------ */

function loadHistory(): DownloadTask[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

interface PersistedActiveDownload {
  task: DownloadTask;
  spec: StartSpec;
}

interface DownloadStoreDependencies {
  settings: DownloadSettings;
  loadHistory: () => Promise<DownloadTask[]>;
  persistHistory: (tasks: DownloadTask[]) => Promise<void>;
  loadActive: () => Promise<PersistedActiveDownload[]>;
  persistActive: (downloads: PersistedActiveDownload[]) => Promise<void>;
}

/**
 * Overall percent across playlist items (item N of M contributes
 * (N-1 + percent/100) / M). Falls back to the raw percent.
 */
export function normalizedPercent(task: {
  percent: number;
  playlistIndex?: number | null;
  playlistTotal?: number | null;
}): number {
  const total = task.playlistTotal ?? 0;
  const index = task.playlistIndex ?? 0;
  if (total > 1 && index >= 1) {
    const within = Math.min(100, Math.max(0, task.percent)) / 100;
    return Math.min(100, Math.round(((index - 1 + within) / total) * 100));
  }
  return task.percent;
}

export function createDownloadStore(dependencies: DownloadStoreDependencies) {
  const active = ref<DownloadTask[]>([]);
  const history = ref<DownloadTask[]>([]);
  const pendingSpecs = new Map<string, StartSpec>();
  const scope = effectScope();
  let drainingQueue = false;
  let initialized = false;
  let historyPersistTimer: ReturnType<typeof setTimeout> | undefined;
  let activePersistTimer: ReturnType<typeof setTimeout> | undefined;

  /** 读库侧一次性清洗：把老数据里的 `~/...` 展开成等价真实路径。 */
  function normalizeTaskPath(task: DownloadTask): DownloadTask {
    if (typeof task.downloadPath !== "string") return task;
    return { ...task, downloadPath: normalizeStoredPath(task.downloadPath) };
  }

  /**
   * 入队前查重：同一（归一化后）URL 是否已在历史里成功完成。命中已完成是
   * 用户最常踩的场景——yt-dlp 遇到已存在文件只是白跑一趟，这里直接不建
   * 任务并让 UI 给提醒。刻意不管"在队/下载中"的同 URL：同一视频选不同格式
   * 两次入队是合法场景，误伤比放过更烦人。
   */
  function findDuplicate(url: string): DownloadTask | null {
    const key = canonicalDownloadUrl(url);
    if (!key) return null;
    return (
      history.value.find(
        (task) => task.status === "completed" && canonicalDownloadUrl(task.url) === key,
      ) ?? null
    );
  }

  async function init(): Promise<void> {
    if (initialized) return;
    // 先解析真实目录，才能把库里存的 `~/...` 老值展开成等价路径。
    await initKnownPaths();
    const [savedHistory, recovered] = await Promise.all([
      dependencies.loadHistory(),
      dependencies.loadActive(),
    ]);
    history.value = savedHistory.slice(-HISTORY_LIMIT).map(normalizeTaskPath);
    for (const { task } of recovered) {
      history.value.push({
        ...normalizeTaskPath(task),
        status: "interrupted",
        speed: null,
        eta: null,
        error: "应用上次退出时下载未完成",
        finishedAt: Date.now(),
      });
    }
    initialized = true;
    if (recovered.length > 0) {
      await Promise.all([
        dependencies.persistHistory(history.value.slice(-HISTORY_LIMIT)),
        dependencies.persistActive([]),
      ]).catch(() => {});
    }
  }

  scope.run(() => {
    watch(history, (h) => {
      if (!initialized) return;
      if (historyPersistTimer) clearTimeout(historyPersistTimer);
      historyPersistTimer = setTimeout(() => {
        void dependencies.persistHistory(h.slice(-HISTORY_LIMIT)).catch(() => {});
      }, 150);
    }, { deep: true });

    watch(active, (tasks) => {
      if (!initialized) return;
      if (activePersistTimer) clearTimeout(activePersistTimer);
      activePersistTimer = setTimeout(() => {
        const downloads = tasks
          .map((task) => {
            const spec = pendingSpecs.get(task.id);
            return spec ? { task: { ...task }, spec } : null;
          })
          .filter((download): download is PersistedActiveDownload => download !== null);
        void dependencies.persistActive(downloads).catch(() => {});
      }, 150);
    }, { deep: true });
  });

function moveToHistory(task: DownloadTask) {
  const idx = active.value.findIndex((activeTask) => activeTask.id === task.id);
  if (idx < 0) return;
  pendingSpecs.delete(task.id);
  active.value.splice(idx, 1);
  history.value.push(task);
  void drainQueue();
}

/** Remove a persisted history record. */
function removeHistory(id: string) {
  const idx = history.value.findIndex((t) => t.id === id);
  if (idx >= 0) history.value.splice(idx, 1);
}

/** Cancel a running task and preserve the final state in history. */
async function cancel(id: string): Promise<void> {
  const task = active.value.find((candidate) => candidate.id === id);
  if (!task || task.status === "cancelling") return;

  if (task.status === "pending") {
    task.status = "cancelled";
    task.error = "已取消";
    task.finishedAt = Date.now();
    moveToHistory(task);
    return;
  }

  task.status = "cancelling";
  try {
    await cancelDownload(id);
  } catch (error) {
    task.status = "downloading";
    task.error = `取消失败：${String(error)}`;
  }
}

async function runTask(task: DownloadTask, spec: StartSpec) {
  if (!spec.title) {
    try {
      const meta = await resolveUrl(spec.url, { proxy: spec.proxy, cookiePath: spec.cookiePath });
      task.title = meta.title || spec.url;
    } catch {
      task.title = spec.url;
    }
  }
  if (!active.value.some((activeTask) => activeTask.id === task.id)) return;

  const options: DownloadOptions = {
    taskId: task.id,
    url: spec.url,
    downloadPath: spec.downloadPath,
    format: spec.format,
    quality: spec.quality,
    filenameTemplate: spec.filenameTemplate,
    subtitles: spec.subtitles,
    thumbnail: spec.thumbnail,
    formatId: spec.formatId,
    videoOnly: spec.videoOnly,
    proxy: spec.proxy,
    playlistItems: spec.playlistItems,
    rateLimitKiB: spec.rateLimitKiB,
    resume: spec.resume,
    removePartialFiles: spec.removePartialFiles,
    retries: spec.retries,
    cookiePath: spec.cookiePath,
    ffmpegPath: spec.ffmpegPath,
  };

  try {
    await startDownload(options, (ev) => {
      if (!active.value.some((activeTask) => activeTask.id === task.id)) return;
      if (ev.type === "started") {
        task.status = "downloading";
      } else if (ev.type === "progress") {
        task.status = "downloading";
        if (ev.percent != null) task.percent = ev.percent;
        if (ev.downloadedBytes != null) task.downloadedBytes = ev.downloadedBytes;
        if (ev.totalBytes != null) task.totalBytes = ev.totalBytes;
        if (ev.speed != null) task.speed = ev.speed;
        if (ev.eta != null) task.eta = ev.eta;
      } else if (ev.type === "item") {
        // yt-dlp moved on to the next playlist entry.
        task.status = "downloading";
        task.percent = 0;
        task.downloadedBytes = 0;
        task.totalBytes = null;
        task.speed = null;
        task.eta = null;
        task.playlistIndex = ev.playlistIndex ?? null;
        task.playlistTotal = ev.playlistTotal ?? null;
      } else if (ev.type === "finished") {
        task.status = "completed";
        task.percent = 100;
        // Reconcile sizes: merged downloads rarely end with downloaded == total.
        if (ev.totalBytes != null) task.totalBytes = ev.totalBytes;
        if (ev.downloadedBytes != null && ev.downloadedBytes > task.downloadedBytes) {
          task.downloadedBytes = ev.downloadedBytes;
        }
        task.finishedAt = Date.now();
        moveToHistory(task);
      } else if (ev.type === "cancelled") {
        task.status = "cancelled";
        task.error = "已取消";
        task.finishedAt = Date.now();
        moveToHistory(task);
      } else if (ev.type === "error") {
        task.status = "failed";
        task.error = ev.message;
        task.finishedAt = Date.now();
        moveToHistory(task);
      }
    });
  } catch (error) {
    task.status = "failed";
    task.error = String(error);
    task.finishedAt = Date.now();
    moveToHistory(task);
  }
}

async function drainQueue(): Promise<void> {
  if (drainingQueue) return;
  drainingQueue = true;
  try {
    while (active.value.filter((task) => task.status === "downloading" || task.status === "cancelling").length < dependencies.settings.concurrent) {
      const next = active.value.find((task) => task.status === "pending");
      if (!next) break;
      const spec = pendingSpecs.get(next.id);
      if (!spec) {
        next.status = "failed";
        next.error = "下载任务配置丢失";
        next.finishedAt = Date.now();
        moveToHistory(next);
        continue;
      }
      next.status = "downloading";
      void runTask(next, spec);
    }
  } finally {
    drainingQueue = false;
  }
}

/**
 * Enqueue a download again from a history record, applying the current
 * settings for everything the record does not carry. Returns null when the
 * record is missing.
 */
async function restartFromHistory(id: string): Promise<DownloadTask | null> {
  const record = history.value.find((t) => t.id === id);
  if (!record) return null;
  const settings = dependencies.settings;
  return start({
    ...baseSpecFromSettings(settings),
    url: record.url,
    kind: record.kind,
    format: record.format,
    downloadPath: effectiveDownloadPath(record.downloadPath) || effectiveDownloadPath(settings.downloadPath),
    quality: settings.quality,
    filenameTemplate: settings.filenameTemplate,
    // Reproduce the original task's choices; legacy records without the
    // fields restart bare (previous behaviour).
    subtitles: record.subtitles ?? false,
    thumbnail: record.thumbnail ?? false,
    // 「重新下载」是用户对这一条的显式重下意图，不参与查重拦截。
    force: true,
  });
}

/**
 * Enqueue a real download. Resolves the title via yt-dlp when none is given.
 * Returns the task so callers can follow its status.
 */
async function start(spec: StartSpec): Promise<DownloadTask> {
  // 查重兜底：视图层拦过之后这里仍要挡（绕过 UI 的调用方）。命中时返回既有
  // 的已完成任务本身；「重新下载」通过 force 显式放行（见 restartFromHistory）。
  if (!spec.force) {
    const duplicate = findDuplicate(spec.url);
    if (duplicate) return duplicate;
  }
  // 唯一收口点：无论入口是新建下载、批量入队还是「重新下载」，落库与下发的
  // 目录都在这里规范化成绝对路径，`~/...` 老值与"未设置"哨兵都不会再流到后端
  // （后端不做 `~` 展开，Windows 上会依赖 yt-dlp 的 expand_path 落到意外目录）。
  const downloadPath = effectiveDownloadPath(spec.downloadPath);
  const task = reactive<DownloadTask>({
    id: genId(),
    title: spec.title ?? spec.url,
    url: spec.url,
    kind: spec.kind,
    format: spec.format,
    status: "pending",
    percent: 0,
    downloadedBytes: 0,
    totalBytes: null,
    speed: null,
    eta: null,
    downloadPath,
    subtitles: spec.subtitles,
    thumbnail: spec.thumbnail,
    playlistIndex: null,
    playlistTotal: null,
    createdAt: Date.now(),
  });
  active.value.push(task);
  if (!downloadPath) {
    task.status = "failed";
    task.error = "未能确定下载目录（系统下载目录解析失败），请在设置中手动选择下载路径";
    task.finishedAt = Date.now();
    moveToHistory(task);
    return task;
  }
  pendingSpecs.set(task.id, { ...spec, downloadPath });
  void drainQueue();
  return task;
}

  scope.run(() => {
    watch(() => dependencies.settings.concurrent, () => {
      void drainQueue();
    });
  });

/* ------------------------------------------------------------------ */
/*  Dashboard aggregates                                                */
/* ------------------------------------------------------------------ */

const activeCount = computed(() => active.value.filter((task) => task.status === "downloading" || task.status === "cancelling").length);
const queuedCount = computed(() => active.value.filter((task) => task.status === "pending").length);
const completedCount = computed(() => history.value.length);
const totalSpeed = computed(() => active.value.reduce((sum, t) => sum + (t.speed || 0), 0));
const diskUsage = computed(() =>
  history.value.reduce((sum, t) => sum + (t.downloadedBytes || 0), 0),
);

  return {
    active: readonly(active),
    history: readonly(history),
    activeCount,
    queuedCount,
    completedCount,
    totalSpeed,
    diskUsage,
    init,
    start,
    findDuplicate,
    restartFromHistory,
    removeHistory,
    cancel,
    dispose: () => {
      if (historyPersistTimer) clearTimeout(historyPersistTimer);
      if (activePersistTimer) clearTimeout(activePersistTimer);
      scope.stop();
    },
  };
}

const { settings: downloadSettings } = useDownloadSettings();
const sharedStore = createDownloadStore({
  settings: downloadSettings,
  async loadHistory() {
    const saved = await getDownloadHistory<DownloadTask>().catch(() => []);
    if (saved.length > 0) return saved;
    const legacy = loadHistory();
    if (legacy.length > 0) {
      await replaceDownloadHistory(legacy).catch(() => {});
    }
    return legacy;
  },
  async persistHistory(tasks) {
    await replaceDownloadHistory(tasks);
  },
  async loadActive() {
    return getActiveDownloads<PersistedActiveDownload>();
  },
  async persistActive(downloads) {
    await replaceActiveDownloads(downloads);
  },
});

/** Reactive, singleton store shared across the app. */
export function useDownloads() {
  return sharedStore;
}