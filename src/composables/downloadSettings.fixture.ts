import type { DownloadSettings } from "./useDownloadSettings";

/** Shared minimal settings for store/view tests. */
export function baseDownloadSettings(): DownloadSettings {
  return {
    downloadPath: "/tmp",
    quality: "1080p",
    format: "MP4",
    filenameTemplate: "%(title)s.%(ext)s",
    proxyEnabled: false,
    proxyUrl: "",
    concurrent: 1,
    rateLimitEnabled: false,
    rateLimitKiB: 0,
    resumeEnabled: true,
    retryCount: 3,
    cookieEnabled: false,
    cookiePath: "",
    removePartialFiles: false,
    ffmpegPath: "",
  };
}
