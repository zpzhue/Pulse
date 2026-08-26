import { reactive, watch } from "vue";

export interface DownloadSettings {
  downloadPath: string;
  quality: string;
  format: string;
  filenameTemplate: string;
  proxyEnabled: boolean;
  proxyUrl: string;
  concurrent: number;
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

function concurrentSetting(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10
    ? value
    : defaults.concurrent;
}

function load(): DownloadSettings {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return { ...defaults };
    const value = saved as Record<string, unknown>;
    const format = typeof value.format === "string" && supportedFormats.has(value.format)
      ? value.format
      : defaults.format;

    return {
      downloadPath: stringSetting(value.downloadPath, defaults.downloadPath),
      quality: normalizeQuality(value.quality),
      format,
      filenameTemplate: stringSetting(value.filenameTemplate, defaults.filenameTemplate),
      proxyEnabled: typeof value.proxyEnabled === "boolean" ? value.proxyEnabled : defaults.proxyEnabled,
      proxyUrl: stringSetting(value.proxyUrl, defaults.proxyUrl),
      concurrent: concurrentSetting(value.concurrent),
    };
  } catch {
    return { ...defaults };
  }
}

const settings = reactive<DownloadSettings>(load());

watch(settings, (value) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage failures do not prevent a download from starting.
  }
}, { deep: true });

export function useDownloadSettings() {
  return { settings };
}
