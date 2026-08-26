import { invoke, Channel } from "@tauri-apps/api/core";

/** Resolved URL metadata returned by the Rust `resolve_url` command. */
export interface ResolveResult {
  kind: "video" | "playlist";
  id: string;
  title: string;
  uploader: string;
  count: number;
  entries: PlaylistEntry[];
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
}

/** Streamed progress event pushed from Rust during a download. */
export interface ProgressEvent {
  type: "started" | "progress" | "finished" | "cancelled" | "error";
  taskId?: string;
  url?: string;
  percent?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  speed?: number;
  eta?: number;
  message?: string;
}

const BINARY_KEY = "pulse.ytdlp.binary";

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

/** Resolve a URL to metadata / playlist entries. */
export function resolveUrl(url: string): Promise<ResolveResult> {
  return invoke<ResolveResult>("resolve_url", { req: { url, binary: getBinary() } });
}

/** Check the configured yt-dlp binary is reachable and return its version. */
export function checkVersion(binary?: string): Promise<string> {
  return invoke<string>("ytdlp_version", { binary: binary ?? getBinary() });
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
      binary: getBinary(),
    },
    onEvent: channel,
  });
}