import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";

const STORAGE_KEY = "pulse.download-settings";

const storage = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  getSetting: vi.fn(async (key: string) => storage.values.get(key) ?? null),
  setSetting: vi.fn(async (key: string, value: unknown) => {
    storage.values.set(key, value);
  }),
}));

vi.mock("../services/storage", () => ({
  getSetting: storage.getSetting,
  setSetting: storage.setSetting,
}));

const platform = vi.hoisted(() => ({
  downloadDir: vi.fn(async (): Promise<string> => "/home/u/Downloads"),
  homeDir: vi.fn(async (): Promise<string> => "/home/u"),
  sep: vi.fn((): string => "/"),
}));

vi.mock("@tauri-apps/api/path", () => ({
  downloadDir: platform.downloadDir,
  homeDir: platform.homeDir,
  sep: platform.sep,
}));

async function loadSettings(saved?: unknown) {
  vi.resetModules();
  storage.values.clear();
  storage.getSetting.mockClear();
  storage.setSetting.mockClear();
  if (saved !== undefined) storage.values.set(STORAGE_KEY, saved);
  return import("./useDownloadSettings");
}

async function flushPersistence() {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 175));
}

afterEach(() => {
  storage.values.clear();
  vi.resetModules();
});

describe("useDownloadSettings", () => {
  it("uses safe defaults when storage is empty", async () => {
    const { useDownloadSettings } = await loadSettings();
    const { settings, init } = useDownloadSettings();
    await init();

    expect(settings.concurrent).toBe(3);
    expect(settings.resumeEnabled).toBe(true);
    expect(settings.removePartialFiles).toBe(false);
    expect(settings.retryCount).toBe(3);
  });

  it("normalizes legacy and invalid persisted values", async () => {
    const { useDownloadSettings } = await loadSettings({
      quality: "最佳",
      format: "AVI",
      concurrent: 99,
      rateLimitKiB: -1,
      retryCount: 101,
      resumeEnabled: "yes",
    });
    const { settings, init } = useDownloadSettings();
    await init();

    expect(settings.quality).toBe("best");
    expect(settings.format).toBe("MP4");
    expect(settings.concurrent).toBe(3);
    expect(settings.rateLimitKiB).toBe(0);
    expect(settings.retryCount).toBe(3);
    expect(settings.resumeEnabled).toBe(true);
  });

  it("collapses the legacy `~` default to the unset sentinel and rewrites it once", async () => {
    const { useDownloadSettings } = await loadSettings({
      downloadPath: "~/Downloads/Pulse/",
      quality: "1080p",
      format: "MP4",
      concurrent: 3,
    });
    const { settings, init, downloadPathInput } = useDownloadSettings();
    await init();

    // 库里不再保留 `~/...` 字面量；显示值走实时解析的真实目录。
    expect(settings.downloadPath).toBe("");
    expect(downloadPathInput.value).toBe("/home/u/Downloads/Pulse");
    expect(storage.setSetting).toHaveBeenLastCalledWith(
      STORAGE_KEY,
      expect.objectContaining({ downloadPath: "" }),
    );
  });

  it("never persists a download path that equals the resolved default", async () => {
    const { useDownloadSettings } = await loadSettings();
    const { settings, init, downloadPathInput } = useDownloadSettings();
    await init();

    downloadPathInput.value = "/home/u/Downloads/Pulse";
    expect(settings.downloadPath).toBe("");

    downloadPathInput.value = "  D:\\Media\\Pulse  ";
    expect(settings.downloadPath).toBe("D:\\Media\\Pulse");
    await flushPersistence();
    expect(storage.setSetting).toHaveBeenLastCalledWith(
      STORAGE_KEY,
      expect.objectContaining({ downloadPath: "D:\\Media\\Pulse" }),
    );

    // 清空输入 = 回到未设置态（实时默认目录），而不是空字符串被当成路径。
    downloadPathInput.value = "";
    expect(settings.downloadPath).toBe("");
  });

  it("persists updated settings through SQLite storage", async () => {
    const { useDownloadSettings } = await loadSettings();
    const { settings, init } = useDownloadSettings();
    await init();

    settings.concurrent = 2;
    settings.rateLimitEnabled = true;
    settings.rateLimitKiB = 512;
    await flushPersistence();

    expect(storage.setSetting).toHaveBeenLastCalledWith(STORAGE_KEY, expect.objectContaining({
      concurrent: 2,
      rateLimitEnabled: true,
      rateLimitKiB: 512,
    }));
  });
});
