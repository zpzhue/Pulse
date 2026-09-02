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
