import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  downloadDir: vi.fn(async (): Promise<string> => "/home/u/Downloads"),
  homeDir: vi.fn(async (): Promise<string> => "/home/u"),
  sep: vi.fn((): string => "/"),
}));

vi.mock("@tauri-apps/api/path", () => ({
  downloadDir: api.downloadDir,
  homeDir: api.homeDir,
  sep: api.sep,
}));

async function loadPaths() {
  vi.resetModules();
  return import("./paths");
}

beforeEach(() => {
  api.downloadDir.mockReset();
  api.downloadDir.mockResolvedValue("/home/u/Downloads");
  api.homeDir.mockReset();
  api.homeDir.mockResolvedValue("/home/u");
  api.sep.mockReset();
  api.sep.mockReturnValue("/");
});

describe("paths", () => {
  it("resolves the default download dir from the system download dir", async () => {
    const paths = await loadPaths();
    await paths.initKnownPaths();

    expect(paths.defaultDownloadPath()).toBe("/home/u/Downloads/Pulse");
  });

  it("uses the platform separator when building the default dir", async () => {
    api.downloadDir.mockResolvedValue("C:\\Users\\me\\Downloads");
    api.homeDir.mockResolvedValue("C:\\Users\\me");
    api.sep.mockReturnValue("\\");

    const paths = await loadPaths();
    await paths.initKnownPaths();

    expect(paths.defaultDownloadPath()).toBe("C:\\Users\\me\\Downloads\\Pulse");
  });

  it("keeps absolute paths untouched and expands legacy `~/...` values", async () => {
    const paths = await loadPaths();
    await paths.initKnownPaths();

    expect(paths.normalizeStoredPath("/tmp")).toBe("/tmp");
    expect(paths.normalizeStoredPath("D:\\Videos")).toBe("D:\\Videos");
    expect(paths.normalizeStoredPath("~/Downloads/Pulse/")).toBe("/home/u/Downloads/Pulse");
    expect(paths.normalizeStoredPath(undefined)).toBe("");
    expect(paths.normalizeStoredPath("   ")).toBe("");
  });

  it("collapses the old built-in default to the unset sentinel in settings", async () => {
    const paths = await loadPaths();
    await paths.initKnownPaths();

    // 旧版字面量 → 未设置态，默认目录每次实时解析。
    expect(paths.normalizeSettingPath("~/Downloads/Pulse/")).toBe("");
    expect(paths.normalizeSettingPath("~/Downloads/Pulse")).toBe("");
    // 用户自己填的 `~` 路径仍按真实主目录展开，不被吞掉。
    expect(paths.normalizeSettingPath("~/Videos")).toBe("/home/u/Videos");
    expect(paths.normalizeSettingPath("/srv/media")).toBe("/srv/media");
  });

  it("never lets a `~` path reach consumers", async () => {
    const paths = await loadPaths();
    await paths.initKnownPaths();

    expect(paths.effectiveDownloadPath("")).toBe("/home/u/Downloads/Pulse");
    expect(paths.effectiveDownloadPath("~/Downloads/Pulse/")).toBe("/home/u/Downloads/Pulse");
    expect(paths.effectiveDownloadPath("/srv/media")).toBe("/srv/media");
  });

  it("degrades to the unset state when the platform paths are unavailable", async () => {
    api.downloadDir.mockRejectedValue(new Error("no tauri"));
    api.homeDir.mockRejectedValue(new Error("no tauri"));

    const paths = await loadPaths();
    await paths.initKnownPaths();

    expect(paths.defaultDownloadPath()).toBe("");
    // 解析不到主目录时宁可判为未设置，也绝不把带 `~` 的串交给后端。
    expect(paths.normalizeStoredPath("~/Downloads/Pulse/")).toBe("");
    expect(paths.effectiveDownloadPath("~/Downloads/Pulse/")).toBe("");
  });
});
