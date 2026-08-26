import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";

const STORAGE_KEY = "pulse.download-settings";

async function loadSettings(saved?: unknown) {
  vi.resetModules();
  localStorage.clear();
  if (saved !== undefined) localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  return import("./useDownloadSettings");
}

afterEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe("useDownloadSettings", () => {
  it("uses safe defaults when storage is empty", async () => {
    const { useDownloadSettings } = await loadSettings();
    const { settings } = useDownloadSettings();

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
    const { settings } = useDownloadSettings();

    expect(settings.quality).toBe("best");
    expect(settings.format).toBe("MP4");
    expect(settings.concurrent).toBe(3);
    expect(settings.rateLimitKiB).toBe(0);
    expect(settings.retryCount).toBe(3);
    expect(settings.resumeEnabled).toBe(true);
  });

  it("persists updated settings", async () => {
    const { useDownloadSettings } = await loadSettings();
    const { settings } = useDownloadSettings();

    settings.concurrent = 2;
    settings.rateLimitEnabled = true;
    settings.rateLimitKiB = 512;
    await nextTick();

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")).toMatchObject({
      concurrent: 2,
      rateLimitEnabled: true,
      rateLimitKiB: 512,
    });
  });
});
