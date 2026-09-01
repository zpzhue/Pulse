import { invoke, Channel } from "@tauri-apps/api/core";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { readText as clipboardReadText } from "@tauri-apps/plugin-clipboard-manager";
import { openPath } from "@tauri-apps/plugin-opener";

/** Resolved URL metadata returned by the Rust `resolve_url` command. */
export interface ResolveResult {
  kind: "video" | "playlist";
  id: string;
  title: string;
  uploader: string;
  count: number;
  /**
   * Present for playlists. Rust omits the key entirely when the list is
   * empty (serde skip_serializing_if on an empty Vec), so callers must
   * treat this as optional and default to [].
   */
  entries?: PlaylistEntry[];
}

export interface PlaylistEntry {
  id: string;
  title: string;
  duration: number | null;
}

/** Options describing a single download task (maps to Rust `DownloadOptions`). */
export interface DownloadOptions {
  taskId: string;
  url: string;
  downloadPath: string;
  format: string;
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
  /** User-configured ffmpeg binary path or directory; overrides detection. */
  ffmpegPath?: string;
}

/** Streamed progress event pushed from Rust during a download. */
export interface ProgressEvent {
  type: "started" | "progress" | "item" | "finished" | "cancelled" | "error";
  taskId?: string;
  url?: string;
  percent?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  speed?: number;
  eta?: number;
  /** Playlist progress: 1-based index of the item now downloading. */
  playlistIndex?: number;
  playlistTotal?: number;
  message?: string;
}

const BINARY_KEY = "pulse.ytdlp.binary";

/** Ask the user to pick a directory; resolves null when cancelled. */
export async function chooseDirectory(startPath?: string): Promise<string | null> {
  const selection = await dialogOpen({
    directory: true,
    multiple: false,
    defaultPath: startPath || undefined,
  });
  return typeof selection === "string" ? selection : null;
}

/** Ask the user to pick a file; resolves null when cancelled. */
export async function chooseFile(
  filters?: { name: string; extensions: string[] }[],
): Promise<string | null> {
  const selection = await dialogOpen({ multiple: false, filters });
  return typeof selection === "string" ? selection : null;
}

/** Open a folder in the system file manager (Finder on macOS). */
export async function openFolder(path: string): Promise<void> {
  await openPath(path);
}

/** Read text from the system clipboard; resolves null when unavailable. */
export async function readClipboardText(): Promise<string | null> {
  try {
    const text = await clipboardReadText();
    return text || null;
  } catch {
    return null;
  }
}

/** Current yt-dlp binary path (mirrors the settings page, persisted). */
export function getBinary(): string {
  try {
    return localStorage.getItem(BINARY_KEY) || "yt-dlp";
  } catch {
    return "yt-dlp";
  }
}

export function setBinary(path: string): void {
  try {
    localStorage.setItem(BINARY_KEY, path || "yt-dlp");
  } catch {
    /* ignore */
  }
}

const BINARY_SOURCE_KEY = "pulse.ytdlp.source";

export type BinarySource = "auto" | "manual";

/** Whether the current binary was auto-detected or set manually by the user. */
export function getBinarySource(): BinarySource {
  try {
    return localStorage.getItem(BINARY_SOURCE_KEY) === "manual" ? "manual" : "auto";
  } catch {
    return "auto";
  }
}

/** Persist a user-supplied manual binary path (marks it as manual). */
export function setManualBinary(path: string): void {
  setBinary(path);
  try {
    localStorage.setItem(BINARY_SOURCE_KEY, "manual");
  } catch {
    /* ignore */
  }
}

/** Clears any manual override so detection is used again on next launch. */
export function clearBinaryOverride(): void {
  try {
    localStorage.removeItem(BINARY_KEY);
    localStorage.removeItem(BINARY_SOURCE_KEY);
  } catch {
    /* ignore */
  }
}

/** Probe common locations / PATH for a working yt-dlp. */
export function detectYtdlp(): Promise<{ path: string; version: string } | null> {
  return invoke<{ path: string; version: string } | null>("detect_ytdlp");
}

/** Probe common locations / PATH for a working ffmpeg (+ ffprobe). */
export function detectFfmpeg(): Promise<{ path: string; version: string } | null> {
  return invoke<{ path: string; version: string } | null>("detect_ffmpeg");
}

/** Verify a user-configured ffmpeg location (binary or directory). */
export function checkFfmpeg(path?: string): Promise<string> {
  return invoke<string>("check_ffmpeg", { path: path?.trim() || null });
}

/** Resolve a URL to metadata / playlist entries (proxy/cookie mirror downloads). */
export function resolveUrl(
  url: string,
  options?: { proxy?: string; cookiePath?: string },
): Promise<ResolveResult> {
  return invoke<ResolveResult>("resolve_url", {
    req: {
      url,
      binary: getBinary(),
      proxy: options?.proxy || undefined,
      cookiePath: options?.cookiePath || undefined,
    },
  });
}

/** Check the configured yt-dlp binary is reachable and return its version. */
export function checkVersion(binary?: string): Promise<string> {
  return invoke<string>("ytdlp_version", { binary: binary ?? getBinary() });
}

/** Update the current standalone yt-dlp executable after user confirmation. */
export function updateYtdlp(binary: string): Promise<string> {
  return invoke<string>("update_ytdlp", { binary });
}

/** Stop a running download task managed by the Rust backend. */
export function cancelDownload(taskId: string): Promise<void> {
  return invoke<void>("cancel_download", { taskId });
}

/** Start a download and resolve after the managed process is spawned. */
export async function startDownload(
  options: DownloadOptions,
  onEvent?: (ev: ProgressEvent) => void,
): Promise<void> {
  const channel = new Channel<ProgressEvent>();
  if (onEvent) {
    channel.onmessage = onEvent;
  }
  await invoke<string>("start_download", {
    req: {
      taskId: options.taskId,
      url: options.url,
      downloadPath: options.downloadPath,
      format: options.format,
      quality: options.quality,
      filenameTemplate: options.filenameTemplate,
      subtitles: options.subtitles,
      thumbnail: options.thumbnail,
      keepOriginalFormat: options.keepOriginalFormat ?? false,
      proxy: options.proxy ?? undefined,
      playlistItems: options.playlistItems ?? undefined,
      rateLimitKiB: options.rateLimitKiB ?? undefined,
      resume: options.resume ?? true,
      removePartialFiles: options.removePartialFiles ?? false,
      retries: options.retries ?? 3,
      cookiePath: options.cookiePath ?? undefined,
      ffmpegLocation: options.ffmpegPath?.trim() || undefined,
      binary: getBinary(),
    },
    onEvent: channel,
  });
}