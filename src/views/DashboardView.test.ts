import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

const mocks = vi.hoisted(() => {
  const controls = new Map<string, (event: { type: "started" | "finished" }) => void>();
  const startDownload = vi.fn(async (options: { taskId: string }, onEvent?: (event: { type: "started" | "finished" }) => void) => {
    if (onEvent) controls.set(options.taskId, onEvent);
  });
  return { controls, startDownload };
});

vi.mock("../services/ytdlp", () => ({
  startDownload: mocks.startDownload,
  cancelDownload: vi.fn(async () => {}),
  resolveUrl: vi.fn(async () => ({ title: "resolved" })),
}));

const downloadsMock = vi.hoisted(() => ({ store: undefined as unknown }));

vi.mock("../composables/useDownloads", async () => {
  const actual = await vi.importActual<typeof import("../composables/useDownloads")>("../composables/useDownloads");
  return { ...actual, useDownloads: () => downloadsMock.store };
});

import DashboardView from "./DashboardView.vue";
import { createDownloadStore, type StartSpec } from "../composables/useDownloads";
import { reactive } from "vue";

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

function createStore() {
  const settings = reactive({ concurrent: 1 });
  return createDownloadStore({
    settings,
    loadHistory: () => [],
    persistHistory: () => {},
  });
}

beforeEach(() => {
  mocks.controls.clear();
  mocks.startDownload.mockClear();
  downloadsMock.store = createStore();
});

afterEach(() => {
  (downloadsMock.store as ReturnType<typeof createDownloadStore> | undefined)?.dispose();
  downloadsMock.store = undefined;
  localStorage.clear();
});

describe("DashboardView", () => {
  it("renders separate running and queued task counts", async () => {
    const downloads = downloadsMock.store as ReturnType<typeof createDownloadStore>;
    await downloads.start({ ...spec, title: "first" });
    await downloads.start({ ...spec, title: "second" });
    await flushPromises();

    const wrapper = mount(DashboardView, {
      global: {
        stubs: { RouterLink: { template: "<a><slot /></a>" } },
      },
    });

    expect(wrapper.get('[data-testid="stat-active"]').text()).toContain("正在下载");
    expect(wrapper.get('[data-testid="stat-active"]').text()).toContain("1");
    expect(wrapper.get('[data-testid="stat-queued"]').text()).toContain("等待中");
    expect(wrapper.get('[data-testid="stat-queued"]').text()).toContain("1");
    expect(wrapper.find(".grid").classes()).toContain("grid-cols-5");
  });
});
