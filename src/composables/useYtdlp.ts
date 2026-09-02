import { ref, readonly } from "vue";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  detectYtdlp,
  checkVersion,
  getBinarySource,
  getBinary,
  setBinary,
  setManualBinary,
  clearBinaryOverride,
  initYtdlpSettings,
} from "../services/ytdlp";

export type YtDlpStatus = "checking" | "installed" | "missing" | "invalid";

const status = ref<YtDlpStatus>("checking");
const path = ref(getBinary());
const version = ref("");
let initialized = false;

/** Re-run detection / validation, respecting any manual override. */
async function runDetection() {
  status.value = "checking";

  if (getBinarySource() === "manual") {
    path.value = getBinary();
    try {
      version.value = await checkVersion(path.value);
      status.value = "installed";
    } catch {
      status.value = "invalid";
    }
    return;
  }

  try {
    const d = await detectYtdlp();
    if (d) {
      path.value = d.path;
      version.value = d.version;
      setBinary(d.path); // persist so downstream commands use it (source stays "auto")
      status.value = "installed";
    } else {
      path.value = getBinary();
      status.value = "missing";
    }
  } catch {
    path.value = getBinary();
    status.value = "missing";
  }
}

/** Side-effect free init — call once from a component onMounted. */
async function init() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  await initYtdlpSettings();
  path.value = getBinary();
  await runDetection();
}

/** Apply a user-supplied custom binary path (marks it as manual). */
async function setManual(p: string): Promise<boolean> {
  setManualBinary(p);
  path.value = p;
  status.value = "checking";
  try {
    version.value = await checkVersion(p);
    status.value = "installed";
    return true;
  } catch {
    status.value = "invalid";
    return false;
  }
}

/** Fall back to automatic detection on next launch. */
async function useAutoDetect() {
  clearBinaryOverride();
  await runDetection();
}

/** Open the yt-dlp download page in the system browser. */
function downloadYtdlp() {
  void openUrl("https://github.com/yt-dlp/yt-dlp/releases/latest").catch(() => {});
}

/** Reactive yt-dlp presence state shared across the app. */
export function useYtdlp() {
  return {
    status: readonly(status),
    path: readonly(path),
    version: readonly(version),
    init,
    setManual,
    useAutoDetect,
    downloadYtdlp,
  };
}