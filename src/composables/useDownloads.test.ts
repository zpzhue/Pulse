import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";

const mocks = vi.hoisted(() => {
  const controls = new Map<string, (event: { type: "started" | "finished" | "cancelled" | "error"; message?: string }) => void>();
  const startDownload = vi.fn(async (options: { taskId: string }, onEvent?: (event: { type: "started" | "finished" | "cancelled" | "error"; message?: string }) => void) => {
    if (onEvent) controls.set(options.taskId, onEvent);
  });
  return { controls, startDownload, cancelDownload: vi.fn(async () => {}) };
});

vi.mock("../services/ytdlp", () => ({
  startDownload: mocks.startDownload,
  cancelDownload: mocks.cancelDownload,
  resolveUrl: vi.fn(async () => ({ title: "resolved" })),
}));

import { createDownloadStore, normalizedPercent, type StartSpec } from "./useDownloads";
import { reactive } from "vue";
import { baseDownloadSettings } from "./downloadSettings.fixture";

const stores: ReturnType<typeof createDownloadStore>[] = [];

const spec: StartSpec = {
  url: "https://example.test/video",
  title: "video",
  kind: "video",
  format: "mp4",
  downloadPath: "/tmp",
  quality: "1080p",
  filenameTemplate: "%(title)s.%(ext)s",
  subtitles: false,
  thumbnail: false,
};

async function flushQueue() {
  await Promise.resolve();
  await Promise.resolve();
  await nextTick();
}

function createStore() {
  const settings = reactive(baseDownloadSettings());
  const store = createDownloadStore({
    settings,
    loadHistory: () => [],
    persistHistory: () => {},
  });
  stores.push(store);
  return { settings, store };
}

beforeEach(() => {
  mocks.controls.clear();
  mocks.startDownload.mockClear();
  mocks.cancelDownload.mockClear();
});

afterEach(() => {
  while (stores.length > 0) stores.pop()?.dispose();
  localStorage.clear();
});

describe("useDownloads", () => {
  it("limits concurrent tasks and starts the next task after completion", async () => {
    const { store: downloads } = createStore();
    const first = await downloads.start({ ...spec, title: "first" });
    const second = await downloads.start({ ...spec, title: "second" });
    await flushQueue();

    expect(mocks.startDownload).toHaveBeenCalledTimes(1);
    expect(downloads.activeCount.value).toBe(1);
    expect(downloads.queuedCount.value).toBe(1);
    expect(second.status).toBe("pending");

    mocks.controls.get(first.id)?.({ type: "finished" });
    await flushQueue();

    expect(mocks.startDownload).toHaveBeenCalledTimes(2);
    expect(downloads.activeCount.value).toBe(1);
    expect(downloads.queuedCount.value).toBe(0);
    expect(downloads.history.value).toHaveLength(1);
  });

  it("removes a queued task when cancelled without calling yt-dlp", async () => {
    const { store: downloads } = createStore();
    await downloads.start({ ...spec, title: "first" });
    const queued = await downloads.start({ ...spec, title: "queued" });
    await flushQueue();

    await downloads.cancel(queued.id);

    expect(mocks.cancelDownload).not.toHaveBeenCalled();
    expect(downloads.queuedCount.value).toBe(0);
    expect(downloads.history.value[downloads.history.value.length - 1]?.status).toBe("cancelled");
  });

  it("drains queued tasks when the concurrency limit increases", async () => {
    const { store: downloads, settings } = createStore();
    await downloads.start({ ...spec, title: "first" });
    await downloads.start({ ...spec, title: "second" });
    await flushQueue();

    settings.concurrent = 2;
    await flushQueue();

    expect(mocks.startDownload).toHaveBeenCalledTimes(2);
    expect(downloads.activeCount.value).toBe(2);
    expect(downloads.queuedCount.value).toBe(0);
  });

  it("stops reacting to concurrency changes after disposal", async () => {
    const { store: downloads, settings } = createStore();
    await downloads.start({ ...spec, title: "first" });
    await downloads.start({ ...spec, title: "second" });
    await flushQueue();

    downloads.dispose();
    settings.concurrent = 2;
    await flushQueue();

    expect(mocks.startDownload).toHaveBeenCalledTimes(1);
    expect(downloads.activeCount.value).toBe(1);
    expect(downloads.queuedCount.value).toBe(1);
  });
});

describe("normalizedPercent", () => {
  it("aggregates progress across playlist items", () => {
    expect(normalizedPercent({ percent: 0, playlistIndex: 1, playlistTotal: 4 })).toBe(0);
    expect(normalizedPercent({ percent: 50, playlistIndex: 2, playlistTotal: 4 })).toBe(38);
    expect(normalizedPercent({ percent: 100, playlistIndex: 4, playlistTotal: 4 })).toBe(100);
  });

  it("falls back to the raw percent without playlist metadata", () => {
    expect(normalizedPercent({ percent: 42 })).toBe(42);
    expect(normalizedPercent({ percent: 42, playlistIndex: null, playlistTotal: null })).toBe(42);
    expect(normalizedPercent({ percent: 42, playlistIndex: 1, playlistTotal: 1 })).toBe(42);
  });
});
