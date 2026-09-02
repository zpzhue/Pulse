import { reactive, watch } from "vue";
import { getSetting, setSetting } from "../services/storage";

export interface DownloadSettings {
  downloadPath: string;
  quality: string;
  format: string;
  filenameTemplate: string;
  proxyEnabled: boolean;
  proxyUrl: string;
  concurrent: number;
  rateLimitEnabled: boolean;
  rateLimitKiB: number;
  resumeEnabled: boolean;
  retryCount: number;
  cookieEnabled: boolean;
  cookiePath: string;
  removePartialFiles: boolean;
  /** ffmpeg binary path or directory; empty = auto-detect per app run. */
  ffmpegPath: string;
}

const STORAGE_KEY = "pulse.download-settings";

const defaults: DownloadSettings = {
  downloadPath: "~/Downloads/Pulse/",
  quality: "1080p",
  format: "MP4",
  filenameTemplate: "%(title)s.%(ext)s",
  proxyEnabled: false,
  proxyUrl: "",
  concurrent: 3,
  rateLimitEnabled: false,
  rateLimitKiB: 0,
  resumeEnabled: true,
  retryCount: 3,
  cookieEnabled: false,
  cookiePath: "",
  removePartialFiles: false,
  ffmpegPath: "",
};

const legacyQuality: Record<string, DownloadSettings["quality"]> = {
  "1080p (推荐)": "1080p",
  "最佳": "best",
};
const supportedQualities = new Set(["best", "4k", "1080p", "720p", "480p"]);
const supportedFormats = new Set(["MP4", "WebM", "MKV"]);

function normalizeQuality(value: unknown): DownloadSettings["quality"] {
  if (typeof value !== "string") return defaults.quality;
  const normalized = legacyQuality[value] ?? value;
  return supportedQualities.has(normalized) ? normalized : defaults.quality;
}

function stringSetting(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function integerSetting(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback;
}

function concurrentSetting(value: unknown): number {
  return integerSetting(value, defaults.concurrent, 1, 10);
}

function normalize(value: unknown): DownloadSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...defaults };
  const saved = value as Record<string, unknown>;
  const format = typeof saved.format === "string" && supportedFormats.has(saved.format)
    ? saved.format
    : defaults.format;

  return {
    downloadPath: stringSetting(saved.downloadPath, defaults.downloadPath),
    quality: normalizeQuality(saved.quality),
    format,
    filenameTemplate: stringSetting(saved.filenameTemplate, defaults.filenameTemplate),
    proxyEnabled: typeof saved.proxyEnabled === "boolean" ? saved.proxyEnabled : defaults.proxyEnabled,
    proxyUrl: stringSetting(saved.proxyUrl, defaults.proxyUrl),
    concurrent: concurrentSetting(saved.concurrent),
    rateLimitEnabled: typeof saved.rateLimitEnabled === "boolean" ? saved.rateLimitEnabled : defaults.rateLimitEnabled,
    rateLimitKiB: integerSetting(saved.rateLimitKiB, defaults.rateLimitKiB, 0, 10_000_000),
    resumeEnabled: typeof saved.resumeEnabled === "boolean" ? saved.resumeEnabled : defaults.resumeEnabled,
    retryCount: integerSetting(saved.retryCount, defaults.retryCount, 0, 100),
    cookieEnabled: typeof saved.cookieEnabled === "boolean" ? saved.cookieEnabled : defaults.cookieEnabled,
    cookiePath: stringSetting(saved.cookiePath, defaults.cookiePath),
    removePartialFiles: typeof saved.removePartialFiles === "boolean" ? saved.removePartialFiles : defaults.removePartialFiles,
    ffmpegPath: stringSetting(saved.ffmpegPath, defaults.ffmpegPath),
  };
}

function readLegacy(): unknown {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

const settings = reactive<DownloadSettings>({ ...defaults });
let initialized = false;
let suppressPersist = false;
let persistTimer: ReturnType<typeof setTimeout> | undefined;

watch(settings, (value) => {
  if (suppressPersist || !initialized) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void setSetting(STORAGE_KEY, { ...value }).catch(() => {});
  }, 150);
}, { deep: true });

async function init(): Promise<void> {
  if (initialized) return;
  const saved = await getSetting<unknown>(STORAGE_KEY).catch(() => null);
  const next = saved ?? readLegacy();
  suppressPersist = true;
  Object.assign(settings, normalize(next));
  suppressPersist = false;
  initialized = true;

  if (saved === null) {
    await setSetting(STORAGE_KEY, { ...settings }).catch(() => {});
  }
}

export function useDownloadSettings() {
  return { settings, init };
}
