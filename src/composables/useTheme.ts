import { ref, watch } from "vue";

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

function loadPrefs(): { dark: boolean; accent: Accent } {
  let dark = true; // design is dark-primary
  let accent: Accent = "cyan";
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.dark === "boolean") dark = parsed.dark;
      if (["cyan", "purple", "green"].includes(parsed.accent)) accent = parsed.accent;
    }
  } catch {
    /* ignore corrupt prefs */
  }
  return { dark, accent };
}

const prefs = loadPrefs();
const isDark = ref(prefs.dark);
const accent = ref<Accent>(prefs.accent);

function apply() {
  const root = document.documentElement;
  root.classList.toggle("dark", isDark.value);
  root.setAttribute("data-accent", accent.value);
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ dark: isDark.value, accent: accent.value }));
  } catch {
    /* ignore */
  }
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

export function useTheme() {
  return {
    isDark,
    accent,
    accents: ACCENTS,
    toggleDark() {
      isDark.value = !isDark.value;
    },
    setAccent(a: Accent | "orange" | "pink") {
      if (ACCENTS.find((x) => x.id === a)?.disabled) return;
      if (a === "cyan" || a === "purple" || a === "green") accent.value = a;
    },
  };
}