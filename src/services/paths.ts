import { downloadDir, homeDir, sep } from "@tauri-apps/api/path";

/** 默认下载目录在系统下载目录下使用的子目录名。 */
const PULSE_FOLDER = "Pulse";

/**
 * 早期版本内置的默认下载目录字面量（小写、无结尾分隔符，用于比对）。
 * `~` 在 Windows 上没有 shell 展开语义，只有 yt-dlp 自己会对输出模板调用
 * expand_path → compat_expanduser，而后者在 nt 平台优先读 `%HOME%`
 * （见 yt-dlp compat/__init__.py），所以同一条字面量在不同机器上会落到
 * 第二 Downloads / 幽灵目录等不同位置。前端不再持有这条字面量。
 */
const LEGACY_DEFAULT_SETTING = "~/downloads/pulse";

function separator(): string {
  try {
    return sep();
  } catch {
    // 非 Tauri 环境（vitest/jsdom）下退回 POSIX 分隔符。
    return "/";
  }
}

function trimSeparators(value: string): string {
  return value.replace(/^[\\/]+/, "").replace(/[\\/]+$/, "");
}

function joinPath(base: string, part: string): string {
  const head = base.replace(/[\\/]+$/, "");
  const tail = trimSeparators(part);
  if (!tail) return head;
  return head ? `${head}${separator()}${tail}` : `${separator()}${tail}`;
}

function isTildePath(value: string): boolean {
  return value === "~" || value.startsWith("~/") || value.startsWith("~\\");
}

let homePromise: Promise<string> | null = null;
let defaultPromise: Promise<string> | null = null;
let cachedHome = "";
let cachedDefault = "";

/** 解析（并缓存）用户主目录；失败返回空串。 */
export function resolveHomeDir(): Promise<string> {
  homePromise ??= homeDir()
    .then((value) => {
      cachedHome = value;
      return value;
    })
    .catch(() => "");
  return homePromise;
}

/** 解析（并缓存）默认下载目录：`<系统下载目录>/Pulse`。 */
export function resolveDefaultDownloadPath(): Promise<string> {
  defaultPromise ??= downloadDir()
    .then((dir) => {
      cachedDefault = dir ? joinPath(dir, PULSE_FOLDER) : "";
      return cachedDefault;
    })
    .catch(() => "");
  return defaultPromise;
}

/**
 * 预热一次真实路径。所有"库里可能存有 `~/...` 老值"的读取点都应先 await
 * 本函数（内部有缓存，重复调用只走一次 IPC），这样随后的同步规范化才能
 * 拿到真实主目录/下载目录。
 */
export async function initKnownPaths(): Promise<void> {
  await Promise.all([resolveHomeDir(), resolveDefaultDownloadPath()]);
}

/** 缓存的默认下载目录；尚未解析出来时为 ""（此时不应发起下载）。 */
export function defaultDownloadPath(): string {
  return cachedDefault;
}

/**
 * 规范化"从库里读出来的路径"：
 * - 空值 / 纯 `~` → ""（未设置态，由消费点回落到默认目录）
 * - `~/...`（旧版默认值或用户当年手填）→ 用真实主目录展开，与当初
 *   yt-dlp expanduser 的落盘位置保持一致，保证「打开所在文件夹」可用
 * - 其余（已是绝对路径）→ 原样返回
 * 非 Tauri 环境解析不到主目录时，`~/...` 一律降级为空（=未设置），
 * 绝不会把带 `~` 的串继续往后端传。
 */
export function normalizeStoredPath(value: unknown): string {
  if (typeof value !== "string") return "";
  const path = value.trim();
  if (!path || path === "~") return "";
  if (isTildePath(path)) {
    const rest = trimSeparators(path.slice(1));
    return cachedHome && rest ? joinPath(cachedHome, rest) : "";
  }
  return path;
}

/**
 * 设置项专用规范化：除了上面的规则外，把旧版内置默认字面量折叠成
 * "未设置"态（""），使默认目录始终跟随当前系统的下载目录（OneDrive
 * 重定向、改名、换机后都不会僵死）。用户显式选过的路径不受影响。
 */
export function normalizeSettingPath(value: unknown): string {
  const raw = typeof value === "string" ? value.trim().toLowerCase().replace(/[\\/]+$/, "") : "";
  if (raw === LEGACY_DEFAULT_SETTING) return "";
  return normalizeStoredPath(value);
}

/** 消费点（入队、重新下载）实时取值：用户显式值优先，否则默认目录。 */
export function effectiveDownloadPath(value?: string | null): string {
  return normalizeStoredPath(value) || cachedDefault;
}
