import { invoke, Channel } from "@tauri-apps/api/core";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { readText as clipboardReadText } from "@tauri-apps/plugin-clipboard-manager";
import { openPath } from "@tauri-apps/plugin-opener";
import { deleteSetting, getSetting, setSetting } from "./storage";

/** Resolved URL metadata returned by the Rust `resolve_url` command. */
export interface ResolveResult {
  kind: "video" | "playlist";
  id: string;
  title: string;
  uploader: string;
  count: number;
  entries?: PlaylistEntry[];
  duration?: number | null;
  formats?: VideoFormatOption[];
}

export interface PlaylistEntry {
  id: string;
  title: string;
  duration: number | null;
  url?: string;
}

export interface VideoFormatOption {
  formatId: string;
  ext: string;
  width: number | null;
  height: number | null;
  filesize: number | null;
  videoOnly: boolean;
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
  formatId?: string;
  videoOnly?: boolean;
  proxy?: string;
  playlistItems?: number[];
  rateLimitKiB?: number;
  resume?: boolean;
  removePartialFiles?: boolean;
  retries?: number;
  cookiePath?: string;
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
  playlistIndex?: number;
  playlistTotal?: number;
  message?: string;
}

const BINARY_KEY = "pulse.ytdlp.binary";
const BINARY_SOURCE_KEY = "pulse.ytdlp.source";

export type BinarySource = "auto" | "manual";

let binary = "yt-dlp";
let binarySource: BinarySource = "auto";
let initialized = false;

function readLegacy(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function initYtdlpSettings(): Promise<void> {
  if (initialized) return;
  const [savedBinary, savedSource] = await Promise.all([
    getSetting<string>(BINARY_KEY).catch(() => null),
    getSetting<BinarySource>(BINARY_SOURCE_KEY).catch(() => null),
  ]);
  binary = savedBinary || readLegacy(BINARY_KEY) || "yt-dlp";
  binarySource = savedSource === "manual" || readLegacy(BINARY_SOURCE_KEY) === "manual" ? "manual" : "auto";
  initialized = true;

  if (savedBinary === null && binary !== "yt-dlp") void setSetting(BINARY_KEY, binary).catch(() => {});
  if (savedSource === null && binarySource === "manual") void setSetting(BINARY_SOURCE_KEY, binarySource).catch(() => {});
}

/** Ask the user to pick a directory; resolves null when cancelled. */
export async function chooseDirectory(startPath?: string): Promise<string | null> {
  const selection = await dialogOpen({ directory: true, multiple: false, defaultPath: startPath || undefined });
  return typeof selection === "string" ? selection : null;
}

/** Ask the user to pick a file; resolves null when cancelled. */
export async function chooseFile(filters?: { name: string; extensions: string[] }[]): Promise<string | null> {
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

export function getBinary(): string {
  return binary;
}

export function setBinary(path: string): void {
  binary = path || "yt-dlp";
  void setSetting(BINARY_KEY, binary).catch(() => {});
}

export function getBinarySource(): BinarySource {
  return binarySource;
}

export function setManualBinary(path: string): void {
  setBinary(path);
  binarySource = "manual";
  void setSetting(BINARY_SOURCE_KEY, binarySource).catch(() => {});
}

export function clearBinaryOverride(): void {
  binary = "yt-dlp";
  binarySource = "auto";
  void Promise.all([deleteSetting(BINARY_KEY), deleteSetting(BINARY_SOURCE_KEY)]).catch(() => {});
}

export function detectYtdlp(): Promise<{ path: string; version: string } | null> {
  return invoke<{ path: string; version: string } | null>("detect_ytdlp");
}

export function detectFfmpeg(): Promise<{ path: string; version: string } | null> {
  return invoke<{ path: string; version: string } | null>("detect_ffmpeg");
}

export function checkFfmpeg(path?: string): Promise<string> {
  return invoke<string>("check_ffmpeg", { path: path?.trim() || null });
}

export function resolveUrl(url: string, options?: { proxy?: string; cookiePath?: string }): Promise<ResolveResult> {
  return invoke<ResolveResult>("resolve_url", {
    req: { url, binary: getBinary(), proxy: options?.proxy || undefined, cookiePath: options?.cookiePath || undefined },
  });
}

export function checkVersion(binaryPath?: string): Promise<string> {
  return invoke<string>("ytdlp_version", { binary: binaryPath ?? getBinary() });
}

export function updateYtdlp(binaryPath: string): Promise<string> {
  return invoke<string>("update_ytdlp", { binary: binaryPath });
}

export function cancelDownload(taskId: string): Promise<void> {
  return invoke<void>("cancel_download", { taskId });
}

export async function startDownload(options: DownloadOptions, onEvent?: (ev: ProgressEvent) => void): Promise<void> {
  const channel = new Channel<ProgressEvent>();
  if (onEvent) channel.onmessage = onEvent;
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
      formatId: options.formatId ?? undefined,
      videoOnly: options.videoOnly ?? undefined,
      proxy: options.proxy ?? undefined,
      playlistItems: options.playlistItems ?? undefined,
      rateLimitKiB: options.rateLimitKiB ?? undefined,
      resume: options.resume ?? true,
      removePartialFiles: options.removePartialFiles ?? false,
      retries: options.retries ?? 3,
      cookiePath: options.cookiePath ?? undefined,
      ffmpegLocation: options.ffmpegPath ?? undefined,
      binary: getBinary(),
    },
    onEvent: channel,
  });
}
