import { ref, computed, readonly, reactive, watch, effectScope } from "vue";
import {
  cancelDownload,
  startDownload,
  resolveUrl,
  type DownloadOptions,
} from "../services/ytdlp";
import { useDownloadSettings, type DownloadSettings } from "./useDownloadSettings";

export type TaskStatus = "pending" | "downloading" | "cancelling" | "completed" | "failed" | "cancelled";

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
  keepOriginalFormat?: boolean;
  proxy?: string;
  playlistItems?: number[];
  rateLimitKiB?: number;
  resume?: boolean;
  removePartialFiles?: boolean;
  retries?: number;
  cookiePath?: string;
  ffmpegPath?: string;
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

interface DownloadStoreDependencies {
  settings: DownloadSettings;
  loadHistory: () => DownloadTask[];
  persistHistory: (tasks: DownloadTask[]) => void;
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
  const history = ref<DownloadTask[]>(dependencies.loadHistory());
  const pendingSpecs = new Map<string, StartSpec>();
  const scope = effectScope();
  let drainingQueue = false;

  scope.run(() => {
    // Persist history (deep) whenever it changes.
    watch(history, (h) => {
      dependencies.persistHistory(h.slice(-HISTORY_LIMIT));
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
    keepOriginalFormat: spec.keepOriginalFormat,
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
    downloadPath: record.downloadPath || settings.downloadPath,
    quality: settings.quality,
    filenameTemplate: settings.filenameTemplate,
    // Reproduce the original task's choices; legacy records without the
    // fields restart bare (previous behaviour).
    subtitles: record.subtitles ?? false,
    thumbnail: record.thumbnail ?? false,
  });
}

/**
 * Enqueue a real download. Resolves the title via yt-dlp when none is given.
 * Returns the task so callers can follow its status.
 */
async function start(spec: StartSpec): Promise<DownloadTask> {
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
    downloadPath: spec.downloadPath,
    subtitles: spec.subtitles,
    thumbnail: spec.thumbnail,
    playlistIndex: null,
    playlistTotal: null,
    createdAt: Date.now(),
  });
  active.value.push(task);
  pendingSpecs.set(task.id, spec);
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
    start,
    restartFromHistory,
    removeHistory,
    cancel,
    dispose: () => scope.stop(),
  };
}

const { settings: downloadSettings } = useDownloadSettings();
const sharedStore = createDownloadStore({
  settings: downloadSettings,
  loadHistory,
  persistHistory(tasks) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(tasks));
    } catch {
      /* ignore quota errors */
    }
  },
});

/** Reactive, singleton store shared across the app. */
export function useDownloads() {
  return sharedStore;
}