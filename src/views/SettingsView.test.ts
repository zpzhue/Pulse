import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { reactive } from "vue";

const settings = reactive({
  downloadPath: "/tmp",
  quality: "1080p",
  format: "MP4",
  filenameTemplate: "%(title)s.%(ext)s",
  proxyEnabled: false,
  proxyUrl: "",
  concurrent: 3,
  rateLimitEnabled: false,
  rateLimitKiB: 0,
  resumeEnabled: true,
  retryCount: 3,
  cookieEnabled: false,
  cookiePath: "",
  removePartialFiles: false,
  ffmpegPath: "",
});

vi.mock("../composables/useDownloadSettings", () => ({
  useDownloadSettings: () => ({ settings }),
}));

vi.mock("../composables/useTheme", () => ({
  useTheme: () => ({
    isDark: false,
    accent: "cyan",
    accents: [],
    toggleDark: vi.fn(),
    setAccent: vi.fn(),
  }),
}));

vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "0.1.0") }));
vi.mock("../services/ytdlp", () => ({
  checkVersion: vi.fn(async () => "2026.08.19"),
  chooseDirectory: vi.fn(),
  chooseFile: vi.fn(),
  checkFfmpeg: vi.fn(),
  detectFfmpeg: vi.fn(),
  getBinary: vi.fn(() => "yt-dlp"),
  setManualBinary: vi.fn(),
  updateYtdlp: vi.fn(),
}));

import SettingsView from "./SettingsView.vue";

afterEach(() => {
  settings.proxyEnabled = false;
  settings.proxyUrl = "";
});

describe("SettingsView", () => {
  it("shows a working proxy toggle in the network panel", async () => {
    const wrapper = mount(SettingsView);

    await wrapper.get('[data-testid="settings-nav-network"]').trigger("click");
    expect(wrapper.get('[data-testid="network-proxy-settings"]').text()).toContain("代理");
    expect(wrapper.get('[data-testid="proxy-toggle"]').attributes("aria-checked")).toBe("false");
    expect(wrapper.get('[data-testid="network-proxy-settings"]').text()).toContain("已关闭");

    await wrapper.get('[data-testid="proxy-toggle"]').trigger("click");
    expect(settings.proxyEnabled).toBe(true);
    expect(wrapper.get('[data-testid="proxy-toggle"]').attributes("aria-checked")).toBe("true");
    expect(wrapper.get('[data-testid="network-proxy-settings"]').text()).toContain("已开启");
    expect(wrapper.get('input[placeholder="http://127.0.0.1:7890"]').attributes("disabled")).toBeUndefined();
  });
});
