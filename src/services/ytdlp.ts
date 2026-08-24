import { invoke } from "@tauri-apps/api/core";
import type { Channel } from "@tauri-apps/api/core";

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
  url: string;
  downloadPath: string;
  format: string;
  quality: string;
  filenameTemplate: string;
  subtitles: boolean;
  thumbnail: boolean;
  proxy?: string;
}

/** Streamed progress event pushed from Rust during a download. */
export interface ProgressEvent {
  type: "started" | "progress" | "finished" | "error";
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

/**
 * Start a download and receive progress events.
 * Returns a promise that resolves when the process finishes (or rejects on error).
 */
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
      url: options.url,
      downloadPath: options.downloadPath,
      format: options.format,
      quality: options.quality,
      filenameTemplate: options.filenameTemplate,
      subtitles: options.subtitles,
      thumbnail: options.thumbnail,
      proxy: options.proxy ?? undefined,
      binary: getBinary(),
    },
    onEvent: channel,
  });
}