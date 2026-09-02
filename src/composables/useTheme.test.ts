import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";

const STORAGE_KEY = "pulse.theme";

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

async function loadTheme(saved?: unknown) {
  vi.resetModules();
  storage.values.clear();
  storage.getSetting.mockClear();
  storage.setSetting.mockClear();
  if (saved !== undefined) storage.values.set(STORAGE_KEY, saved);
  return import("./useTheme");
}

async function flushPersistence() {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 125));
}

afterEach(() => {
  storage.values.clear();
  vi.resetModules();
});

describe("useTheme", () => {
  it("loads valid theme preferences from SQLite", async () => {
    const { useTheme } = await loadTheme({ dark: false, accent: "green" });
    const theme = useTheme();

    await theme.init();

    expect(theme.isDark.value).toBe(false);
    expect(theme.accent.value).toBe("green");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.getAttribute("data-accent")).toBe("green");
  });

  it("persists theme changes through SQLite storage", async () => {
    const { useTheme } = await loadTheme();
    const theme = useTheme();
    await theme.init();

    theme.toggleDark();
    theme.setAccent("purple");
    await flushPersistence();

    expect(storage.setSetting).toHaveBeenLastCalledWith(STORAGE_KEY, {
      dark: false,
      accent: "purple",
    });
  });
});
