import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

const mocks = vi.hoisted(() => {
  const controls = new Map<string, (event: { type: "started" | "progress" | "finished"; downloadedBytes?: number; totalBytes?: number; speed?: number; eta?: number; percent?: number }) => void>();
  const startDownload = vi.fn(async (options: { taskId: string }, onEvent?: (event: { type: "started" | "progress" | "finished"; downloadedBytes?: number; totalBytes?: number; speed?: number; eta?: number; percent?: number }) => void) => {
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
import { baseDownloadSettings } from "../composables/downloadSettings.fixture";

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
  const settings = reactive(baseDownloadSettings());
  return createDownloadStore({
    settings,
    loadHistory: async () => [],
    persistHistory: async () => {},
    loadActive: async () => [],
    persistActive: async () => {},
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
    expect(wrapper.get('[data-testid="stat-completed"]').text()).toContain("历史记录");
    expect(wrapper.get('[data-testid="stat-disk"]').text()).toContain("历史下载累计");
    expect(wrapper.text()).toContain("下载队列");
    expect(wrapper.text()).toContain("正在下载");
    expect(wrapper.text()).toContain("等待可用下载槽位");
    expect(wrapper.find(".grid").classes()).toContain("grid-cols-5");
  });

  it("opens and closes the new-download dialog from the dashboard", async () => {
    const wrapper = mount(DashboardView, {
      global: {
        stubs: {
          RouterLink: { template: "<a><slot /></a>" },
          Teleport: true,
          NewDownloadDialog: {
            emits: ["close"],
            template: '<button data-testid="dialog-close" @click="$emit(\'close\')">dialog</button>',
          },
        },
      },
    });

    expect(wrapper.find('[data-testid="dialog-close"]').exists()).toBe(false);
    await wrapper.get("button").trigger("click");
    expect(wrapper.find('[data-testid="dialog-close"]').exists()).toBe(true);
    await wrapper.get('[data-testid="dialog-close"]').trigger("click");
    expect(wrapper.find('[data-testid="dialog-close"]').exists()).toBe(false);
  });

  it("updates the running task speed and progress from download events", async () => {
    const downloads = downloadsMock.store as ReturnType<typeof createDownloadStore>;
    const task = await downloads.start({ ...spec, title: "live task" });
    await flushPromises();

    const wrapper = mount(DashboardView, {
      global: {
        stubs: { RouterLink: { template: "<a><slot /></a>" } },
      },
    });
    mocks.controls.get(task.id)?.({
      type: "progress",
      percent: 42,
      downloadedBytes: 42 * 1024 * 1024,
      totalBytes: 100 * 1024 * 1024,
      speed: 3 * 1024 * 1024,
      eta: 19,
    });
    await flushPromises();

    expect(wrapper.text()).toContain("42%");
    expect(wrapper.text()).toContain("3.0 MB/s");
    expect(wrapper.text()).toContain("预计 19s");
  });
});
