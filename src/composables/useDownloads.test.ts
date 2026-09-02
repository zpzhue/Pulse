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

import { createDownloadStore, normalizedPercent, canonicalDownloadUrl, type StartSpec } from "./useDownloads";
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
    loadHistory: async () => [],
    persistHistory: async () => {},
    loadActive: async () => [],
    persistActive: async () => {},
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

  it("moves unfinished recovered tasks into interrupted history", async () => {
    const settings = reactive(baseDownloadSettings());
    const recovered = {
      task: {
        id: "interrupted-task",
        title: "interrupted",
        url: "https://example.test/interrupted",
        kind: "video" as const,
        format: "mp4",
        status: "downloading" as const,
        percent: 42,
        downloadedBytes: 1024,
        totalBytes: 2048,
        speed: 100,
        eta: 10,
        createdAt: 1,
      },
      spec,
    };
    const persistActive = vi.fn(async () => {});
    const downloads = createDownloadStore({
      settings,
      loadHistory: async () => [],
      persistHistory: async () => {},
      loadActive: async () => [recovered],
      persistActive,
    });
    stores.push(downloads);

    await downloads.init();

    expect(downloads.active.value).toHaveLength(0);
    expect(downloads.history.value).toHaveLength(1);
    expect(downloads.history.value[0]).toMatchObject({
      id: "interrupted-task",
      status: "interrupted",
      error: "应用上次退出时下载未完成",
    });
    expect(persistActive).toHaveBeenCalledWith([]);
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

  it("forwards an absolute download dir to the backend untouched", async () => {
    const { store: downloads } = createStore();
    await downloads.start({ ...spec, downloadPath: "/srv/media" });
    await flushQueue();

    expect(mocks.startDownload).toHaveBeenCalledTimes(1);
    expect(mocks.startDownload.mock.calls[0]?.[0]).toMatchObject({ downloadPath: "/srv/media" });
  });

  it("fails the task instead of sending a `~` path to the backend", async () => {
    const { store: downloads } = createStore();
    const task = await downloads.start({ ...spec, downloadPath: "~/Downloads/Pulse/" });
    await flushQueue();

    // 非 Tauri 环境解析不到真实目录时，宁可显式失败，也不能把 `~/...` 交给
    // yt-dlp 的 expand_path（Windows 上会落到幽灵目录且 UI 仍显示"已完成"）。
    expect(mocks.startDownload).not.toHaveBeenCalled();
    expect(task.status).toBe("failed");
    expect(task.downloadPath).toBe("");
    expect(task.error).toContain("下载目录");
  });
});

describe("duplicate detection", () => {
  it("normalizes tracking noise but keeps content-identifying params", () => {
    expect(canonicalDownloadUrl("https://youtu.be/dQw4w9WgXcQ?si=abc123&t=42")).toBe(
      canonicalDownloadUrl("https://youtu.be/dQw4w9WgXcQ?t=42"),
    );
    expect(
      canonicalDownloadUrl("https://youtube.com/watch?v=abc&utm_source=share&feature=share#frag"),
    ).toBe(
      canonicalDownloadUrl("https://youtube.com/watch?v=abc"),
    );
    // ?p / ?list 参与内容定位，绝不能被折叠掉
    expect(canonicalDownloadUrl("https://b23.tv/x?p=2")).not.toBe(
      canonicalDownloadUrl("https://b23.tv/x?p=3"),
    );
  });

  it("skips a second download of an already-completed URL", async () => {
    const settings = reactive(baseDownloadSettings());
    const done = {
      id: "hist-1",
      title: "already",
      url: "https://example.test/video",
      kind: "video" as const,
      format: "mp4",
      status: "completed" as const,
      percent: 100,
      downloadedBytes: 10,
      totalBytes: 10,
      speed: null,
      eta: null,
      createdAt: 1,
    };
    const downloads = createDownloadStore({
      settings,
      loadHistory: async () => [done],
      persistHistory: async () => {},
      loadActive: async () => [],
      persistActive: async () => {},
    });
    stores.push(downloads);
    await downloads.init();

    const returned = await downloads.start({ ...spec, title: "again" });
    await flushQueue();

    // 不新建任务、不触发后端；返回的就是那条已完成的历史记录
    expect(returned.id).toBe("hist-1");
    expect(mocks.startDownload).not.toHaveBeenCalled();
    expect(downloads.active.value).toHaveLength(0);
    expect(downloads.findDuplicate("https://example.test/video?si=junk")).toEqual(expect.objectContaining({ id: "hist-1" }));
  });

  it("re-download from history still bypasses the dedupe", async () => {
    const settings = reactive(baseDownloadSettings());
    const done = {
      id: "hist-2",
      title: "rerun",
      url: "https://example.test/again",
      kind: "video" as const,
      format: "mp4",
      status: "completed" as const,
      percent: 100,
      downloadedBytes: 1,
      totalBytes: 1,
      speed: null,
      eta: null,
      createdAt: 1,
    };
    const downloads = createDownloadStore({
      settings,
      loadHistory: async () => [done],
      persistHistory: async () => {},
      loadActive: async () => [],
      persistActive: async () => {},
    });
    stores.push(downloads);
    await downloads.init();

    const task = await downloads.restartFromHistory("hist-2");
    await flushQueue();

    expect(task?.status).toBe("downloading");
    expect(mocks.startDownload).toHaveBeenCalledTimes(1);
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
