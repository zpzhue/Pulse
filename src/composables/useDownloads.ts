import { ref, computed, readonly, reactive, watch } from "vue";
import {
  cancelDownload,
  startDownload,
  resolveUrl,
  type DownloadOptions,
} from "../services/ytdlp";
import { useDownloadSettings } from "./useDownloadSettings";

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
}

const HISTORY_KEY = "pulse.history";
const HISTORY_LIMIT = 200;

/* ------------------------------------------------------------------ */
/*  Util helpers                                                        */
/* ------------------------------------------------------------------ */

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
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

const active = ref<DownloadTask[]>([]);
const history = ref<DownloadTask[]>(loadHistory());
const pendingSpecs = new Map<string, StartSpec>();
const { settings: downloadSettings } = useDownloadSettings();
let drainingQueue = false;

// Persist history (deep) whenever it changes.
watch(history, (h) => {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-HISTORY_LIMIT)));
  } catch {
    /* ignore quota errors */
  }
}, { deep: true });

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
      const meta = await resolveUrl(spec.url);
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
      } else if (ev.type === "finished") {
        task.status = "completed";
        task.percent = 100;
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
    while (active.value.filter((task) => task.status === "downloading" || task.status === "cancelling").length < downloadSettings.concurrent) {
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
    createdAt: Date.now(),
  });
  active.value.push(task);
  pendingSpecs.set(task.id, spec);
  void drainQueue();
  return task;
}

watch(() => downloadSettings.concurrent, () => {
  void drainQueue();
});

/* ------------------------------------------------------------------ */
/*  Dashboard aggregates                                                */
/* ------------------------------------------------------------------ */

const activeCount = computed(() => active.value.length);
const completedCount = computed(() => history.value.length);
const totalSpeed = computed(() => active.value.reduce((sum, t) => sum + (t.speed || 0), 0));
const diskUsage = computed(() =>
  history.value.reduce((sum, t) => sum + (t.downloadedBytes || 0), 0),
);

/** Reactive, singleton store shared across the app. */
export function useDownloads() {
  return {
    active: readonly(active),
    history: readonly(history),
    activeCount,
    completedCount,
    totalSpeed,
    diskUsage,
    start,
    removeHistory,
    cancel,
  };
}