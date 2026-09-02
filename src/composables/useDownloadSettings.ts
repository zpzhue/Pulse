import { computed, reactive, ref, watch } from "vue";
import { getSetting, setSetting } from "../services/storage";
import {
  initKnownPaths,
  normalizeSettingPath,
  resolveDefaultDownloadPath,
} from "../services/paths";

export interface DownloadSettings {
  /**
   * 下载目录。**空串 = 未设置态**：实际取值由 `resolvedDefaultPath` 实时解析
   * （`<系统下载目录>/Pulse`），且不会被写进库——避免用户日后把 Downloads
   * 迁到 OneDrive/换盘/换用户名后，库里的绝对路径僵死且不再回落默认。
   * 只有用户显式浏览或输入过的、且不等于默认值的路径才会持久化。
   */
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
  // 空 = 未设置态；真实默认目录在 init 时由 `<系统下载目录>/Pulse` 实时解析，
  // 见 services/paths.ts。旧版本这里是 "~/Downloads/Pulse/" 字面量。
  downloadPath: "",
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
    downloadPath: normalizeSettingPath(saved.downloadPath),
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

/** 解析出的默认下载目录（`<系统下载目录>/Pulse`）；未解析出来时为 ""。 */
const resolvedDefaultPath = ref("");

/**
 * 下载目录输入框的双向值：未设置时显示实时解析出的默认目录，但**只在用户
 * 显式改成别的值时才落库**（等于默认目录一律折叠回 "" 哨兵）。
 * 这是"不要把解析结果冻进库"这条不变量的唯一收口点。
 */
const downloadPathInput = computed<string>({
  get: () => settings.downloadPath || resolvedDefaultPath.value,
  set: (value) => {
    const trimmed = value.trim();
    const isDefault = !trimmed || trimmed === resolvedDefaultPath.value;
    settings.downloadPath = isDefault ? "" : trimmed;
  },
});

watch(settings, (value) => {
  if (suppressPersist || !initialized) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void setSetting(STORAGE_KEY, { ...value }).catch(() => {});
  }, 150);
}, { deep: true });

/** 库里存的 downloadPath 是否已被规范化改写（需要一次性清理旧 `~/...` 值）。 */
function storedPathNeedsCleanup(saved: unknown): boolean {
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return false;
  const raw = (saved as Record<string, unknown>).downloadPath;
  if (typeof raw !== "string") return raw === undefined ? false : true;
  return normalizeSettingPath(raw) !== raw.trim();
}

async function init(): Promise<void> {
  if (initialized) return;
  // 真实目录必须先解析出来，normalizeSettingPath 才能展开老数据里的 `~/...`。
  await initKnownPaths();
  resolvedDefaultPath.value = await resolveDefaultDownloadPath();
  const saved = await getSetting<unknown>(STORAGE_KEY).catch(() => null);
  const next = saved ?? readLegacy();
  suppressPersist = true;
  Object.assign(settings, normalize(next));
  suppressPersist = false;
  initialized = true;

  // 一次性清理：首启（saved === null）落一份"未设置"态；库里存着旧版
  // `~/Downloads/Pulse/` 时同样改写为哨兵，避免它被后续每次读取再解释一遍。
  if (saved === null || storedPathNeedsCleanup(saved)) {
    await setSetting(STORAGE_KEY, { ...settings }).catch(() => {});
  }
}

export function useDownloadSettings() {
  return { settings, init, downloadPathInput, resolvedDefaultPath };
}
