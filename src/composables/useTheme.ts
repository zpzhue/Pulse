import { ref, watch } from "vue";
import { getSetting, setSetting } from "../services/storage";

export type Accent = "cyan" | "purple" | "green";

const STORAGE_KEY = "pulse.theme";

/** Currently supported accents. Orange/pink are "coming soon" in the design. */
const ACCENTS: { id: Accent | "orange" | "pink"; color: string; label: string; disabled?: boolean }[] = [
  { id: "cyan", color: "#00C9E0", label: "青色" },
  { id: "purple", color: "#9B6DDA", label: "紫色" },
  { id: "green", color: "#2EBE85", label: "绿色" },
  { id: "orange", color: "#F08C2E", label: "橙色", disabled: true },
  { id: "pink", color: "#E84D8A", label: "粉色", disabled: true },
];

interface ThemePrefs {
  dark: boolean;
  accent: Accent;
}

function normalize(value: unknown): ThemePrefs {
  const prefs: ThemePrefs = { dark: true, accent: "cyan" };
  if (!value || typeof value !== "object" || Array.isArray(value)) return prefs;
  const saved = value as Record<string, unknown>;
  if (typeof saved.dark === "boolean") prefs.dark = saved.dark;
  if (saved.accent === "cyan" || saved.accent === "purple" || saved.accent === "green") prefs.accent = saved.accent;
  return prefs;
}

function readLegacy(): unknown {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

const isDark = ref(true);
const accent = ref<Accent>("cyan");
let initialized = false;
let suppressPersist = false;
let persistTimer: ReturnType<typeof setTimeout> | undefined;

function apply() {
  const root = document.documentElement;
  root.classList.toggle("dark", isDark.value);
  root.setAttribute("data-accent", accent.value);
}

function persist() {
  if (!initialized || suppressPersist) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void setSetting(STORAGE_KEY, { dark: isDark.value, accent: accent.value }).catch(() => {});
  }, 100);
}

watch(isDark, () => {
  apply();
  persist();
});
watch(accent, () => {
  apply();
  persist();
});

apply();

async function init(): Promise<void> {
  if (initialized) return;
  const saved = await getSetting<unknown>(STORAGE_KEY).catch(() => null);
  const prefs = normalize(saved ?? readLegacy());
  suppressPersist = true;
  isDark.value = prefs.dark;
  accent.value = prefs.accent;
  apply();
  suppressPersist = false;
  initialized = true;

  if (saved === null) {
    await setSetting(STORAGE_KEY, prefs).catch(() => {});
  }
}

export function useTheme() {
  return {
    isDark,
    accent,
    accents: ACCENTS,
    init,
    toggleDark() {
      isDark.value = !isDark.value;
    },
    setAccent(a: Accent | "orange" | "pink") {
      if (ACCENTS.find((x) => x.id === a)?.disabled) return;
      if (a === "cyan" || a === "purple" || a === "green") accent.value = a;
    },
  };
}
