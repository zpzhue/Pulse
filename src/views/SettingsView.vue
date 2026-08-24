<script setup lang="ts">
import { ref } from "vue";
import {
  Palette,
  Download,
  Terminal,
  Wifi,
  Info,
  Check,
  ChevronDown,
  Folder,
  Zap,
  RefreshCw,
  Github,
} from "lucide-vue-next";
import { useTheme } from "../composables/useTheme";
import { checkVersion, getBinary, setManualBinary } from "../services/ytdlp";

const { isDark, accent, accents, toggleDark, setAccent } = useTheme();

type PanelKey = "appearance" | "download" | "ytdlp" | "network" | "about";

const activePanel = ref<PanelKey>("appearance");

const navItems: { key: PanelKey; icon: typeof Palette; label: string }[] = [
  { key: "appearance", icon: Palette, label: "外观" },
  { key: "download", icon: Download, label: "下载设置" },
  { key: "ytdlp", icon: Terminal, label: "yt-dlp 配置" },
  { key: "network", icon: Wifi, label: "网络" },
  { key: "about", icon: Info, label: "关于" },
];

/* ---- 外观 ---- */
const density = ref<"紧凑" | "标准" | "舒适">("标准");

/* ---- 下载设置 ---- */
const defaultQuality = ref("1080p (推荐)");
const defaultFormat = ref("MP4");
const downloadPath = ref("~/Downloads/Pulse/");
const filenameTemplate = ref("%(title)s.%(ext)s");
const concurrent = ref(3);

/* ---- yt-dlp 配置 ---- */
const ytdlpPath = ref(getBinary());
const ytdlpStatus = ref("");
const ytdlpTesting = ref(false);

async function persistAndTest() {
  if (!ytdlpPath.value.trim()) {
    ytdlpStatus.value = "路径不能为空";
    return;
  }
  setManualBinary(ytdlpPath.value.trim());
  ytdlpStatus.value = "";
  ytdlpTesting.value = true;
  try {
    const v = await checkVersion(ytdlpPath.value.trim());
    ytdlpStatus.value = `连接成功：yt-dlp ${v}`;
  } catch (e) {
    ytdlpStatus.value = `连接失败：${String(e)}`;
  } finally {
    ytdlpTesting.value = false;
  }
}

const autoUpdate = ref(false);
const proxyEnabled = ref(true);
const proxyUrl = ref("http://127.0.0.1:7890");
const cookieEnabled = ref(false);

/* ---- 网络 ---- */
const rateLimitEnabled = ref(false);
const rateLimitValue = ref(0);
const resumeEnabled = ref(true);
const verifyEnabled = ref(true);
const retryCount = ref(3);
</script>

<template>
  <div class="flex gap-4 h-full min-h-0">
    <!-- Left: settings category menu -->
    <nav class="w-[200px] shrink-0 border border-border rounded-lg bg-card p-2 flex flex-col gap-1">
      <div class="st-title">设置</div>
      <button
        v-for="item in navItems"
        :key="item.key"
        type="button"
        class="st-nav-item"
        :class="{ active: activePanel === item.key }"
        @click="activePanel = item.key"
      >
        <component :is="item.icon" class="w-4 h-4 shrink-0" />
        <span>{{ item.label }}</span>
      </button>
    </nav>

    <!-- Right: content panels -->
    <div class="flex-1 min-w-0 bg-card border border-border rounded-lg p-6 overflow-y-auto">
      <!-- ============ 外观 ============ -->
      <div v-if="activePanel === 'appearance'" class="st-panel">
        <div class="st-header">
          <h2>外观</h2>
          <p>自定义应用的主题与界面</p>
        </div>

        <div class="st-item">
          <div class="mb-4">
            <span class="st-label">主题色</span>
            <span class="st-desc">选择应用的主题强调色</span>
          </div>
          <div class="flex items-start gap-5">
            <div
              v-for="t in accents"
              :key="t.id"
              class="flex flex-col items-center gap-2"
            >
              <button
                type="button"
                class="swatch w-8 h-8 rounded-full relative"
                :class="{ active: accent === t.id, disabled: t.disabled }"
                :style="{ backgroundColor: t.color }"
                :disabled="t.disabled"
                :aria-label="t.label"
                @click="setAccent(t.id)"
              >
                <span v-if="accent === t.id" class="absolute inset-0 flex items-center justify-center">
                  <Check class="w-4 h-4 text-white" />
                </span>
              </button>
              <span class="text-[12px]" :class="accent === t.id ? 'text-foreground font-medium' : 'text-muted-foreground'">
                {{ t.label }}
              </span>
            </div>
          </div>
        </div>

        <div class="st-item flex items-center justify-between gap-4">
          <div>
            <span class="st-label">深色模式</span>
            <span class="st-desc">开启以使用暗色主题，关闭则切换至亮色模式</span>
          </div>
          <button type="button" class="st-toggle" :class="{ on: isDark }" role="switch" :aria-checked="isDark" @click="toggleDark">
            <span class="knob"></span>
          </button>
        </div>

        <div class="st-item flex items-center justify-between gap-4">
          <div>
            <span class="st-label">界面密度</span>
            <span class="st-desc">调整组件间距与紧凑程度</span>
          </div>
          <div class="segmented">
            <button
              v-for="opt in ['紧凑', '标准', '舒适']"
              :key="opt"
              type="button"
              class="px-4 py-1.5 rounded-md text-[13px]"
              :class="{ active: density === opt }"
              @click="density = opt"
            >
              {{ opt }}
            </button>
          </div>
        </div>
      </div>

      <!-- ============ 下载设置 ============ -->
      <div v-else-if="activePanel === 'download'" class="st-panel">
        <div class="st-header">
          <h2>下载设置</h2>
          <p>配置默认的下载行为与文件管理</p>
        </div>

        <div class="st-item flex items-center justify-between gap-4">
          <div>
            <span class="st-label">默认质量</span>
            <span class="st-desc">新建下载的默认视频质量</span>
          </div>
          <div class="select-wrap">
            <select v-model="defaultQuality" class="st-select">
              <option>1080p (推荐)</option>
              <option>720p</option>
              <option>480p</option>
              <option>最佳</option>
            </select>
            <span class="chev"><ChevronDown class="w-4 h-4" /></span>
          </div>
        </div>

        <div class="st-item flex items-center justify-between gap-4">
          <div>
            <span class="st-label">默认格式</span>
            <span class="st-desc">优先下载的容器格式</span>
          </div>
          <div class="select-wrap">
            <select v-model="defaultFormat" class="st-select">
              <option>MP4</option>
              <option>WebM</option>
              <option>MKV</option>
              <option>最佳</option>
            </select>
            <span class="chev"><ChevronDown class="w-4 h-4" /></span>
          </div>
        </div>

        <div class="st-item">
          <label class="st-label-above">下载路径</label>
          <div class="flex gap-2">
            <input v-model="downloadPath" type="text" class="st-input flex-1 font-mono" />
            <button type="button" class="st-btn-browse">
              <Folder class="w-3.5 h-3.5" />
              <span>浏览</span>
            </button>
          </div>
        </div>

        <div class="st-item">
          <label class="st-label-above">文件名模板</label>
          <input v-model="filenameTemplate" type="text" class="st-input w-full font-mono" />
        </div>

        <div class="st-item flex items-center justify-between gap-4">
          <div>
            <span class="st-label">同时下载数</span>
            <span class="st-desc">最大并发下载数</span>
          </div>
          <input v-model.number="concurrent" type="number" min="1" max="10" class="st-input w-20 text-center" />
        </div>
      </div>

      <!-- ============ yt-dlp 配置 ============ -->
      <div v-else-if="activePanel === 'ytdlp'" class="st-panel">
        <div class="st-header">
          <h2>yt-dlp 配置</h2>
          <p>管理 yt-dlp 核心引擎的路径与高级参数</p>
        </div>

        <div class="st-item">
          <label class="st-label-above">yt-dlp 路径</label>
          <div class="flex gap-2">
            <input v-model="ytdlpPath" type="text" class="st-input flex-1 font-mono" />
            <button type="button" class="st-btn-browse">
              <Folder class="w-3.5 h-3.5" />
              <span>浏览</span>
            </button>
          </div>
        </div>

        <div class="st-item">
          <div class="flex items-center justify-between gap-4">
            <div>
              <span class="st-label">自动更新</span>
              <span class="st-desc">启动时检查 yt-dlp 新版本</span>
            </div>
            <button type="button" class="st-toggle" :class="{ on: autoUpdate }" role="switch" :aria-checked="autoUpdate" @click="autoUpdate = !autoUpdate">
              <span class="knob"></span>
            </button>
          </div>
          <div class="mt-3">
            <button type="button" class="st-btn-secondary" disabled>
              <Zap class="w-3.5 h-3.5" />
              <span>立即检查更新</span>
            </button>
          </div>
        </div>

        <div class="st-item">
          <div class="flex items-center justify-between gap-4">
            <div>
              <span class="st-label">HTTP 代理</span>
              <span class="st-desc">通过代理服务器访问视频网站</span>
            </div>
            <button type="button" class="st-toggle" :class="{ on: proxyEnabled }" role="switch" :aria-checked="proxyEnabled" @click="proxyEnabled = !proxyEnabled">
              <span class="knob"></span>
            </button>
          </div>
          <div class="mt-3">
            <input v-model="proxyUrl" type="text" placeholder="http://127.0.0.1:7890" class="st-input w-full font-mono" :disabled="!proxyEnabled" />
          </div>
        </div>

        <div class="st-item">
          <div class="flex items-center justify-between gap-4">
            <div>
              <span class="st-label">Cookie 配置</span>
              <span class="st-desc">使用浏览器 Cookie 访问受限内容</span>
            </div>
            <button type="button" class="st-toggle" :class="{ on: cookieEnabled }" role="switch" :aria-checked="cookieEnabled" @click="cookieEnabled = !cookieEnabled">
              <span class="knob"></span>
            </button>
          </div>
          <div class="mt-3">
            <div class="flex gap-2">
              <input type="text" placeholder="选择 cookie.txt" class="st-input flex-1 font-mono" :disabled="!cookieEnabled" />
              <button type="button" class="st-btn-browse" :disabled="!cookieEnabled">
                <Folder class="w-3.5 h-3.5" />
                <span>浏览</span>
              </button>
            </div>
          </div>
        </div>

        <div class="st-item flex justify-end">
          <button type="button" class="st-btn-secondary" :disabled="ytdlpTesting" @click="persistAndTest">
            <Zap class="w-3.5 h-3.5" />
            <span>{{ ytdlpTesting ? "测试中…" : "测试连接" }}</span>
          </button>
        </div>

        <p v-if="ytdlpStatus" class="text-[13px] mt-2" :class="ytdlpStatus.includes('失败') ? 'text-[var(--state-error)]' : 'text-[var(--state-success)]'">
          {{ ytdlpStatus }}
        </p>
      </div>

      <!-- ============ 网络 ============ -->
      <div v-else-if="activePanel === 'network'" class="st-panel">
        <div class="st-header">
          <h2>网络</h2>
          <p>调整下载的网络行为与传输策略</p>
        </div>

        <div class="st-item flex items-center justify-between gap-4">
          <div>
            <span class="st-label">限速下载</span>
            <span class="st-desc">限制下载带宽，0 为不限速</span>
          </div>
          <div class="flex items-center gap-3">
            <button type="button" class="st-toggle" :class="{ on: rateLimitEnabled }" role="switch" :aria-checked="rateLimitEnabled" @click="rateLimitEnabled = !rateLimitEnabled">
              <span class="knob"></span>
            </button>
            <div class="flex items-center gap-2">
              <input v-model.number="rateLimitValue" type="number" class="st-input w-20 text-center" :disabled="!rateLimitEnabled" />
              <span class="text-[13px] text-muted-foreground whitespace-nowrap">KB/s</span>
            </div>
          </div>
        </div>

        <div class="st-item flex items-center justify-between gap-4">
          <div>
            <span class="st-label">断点续传</span>
            <span class="st-desc">支持中断后继续下载</span>
          </div>
          <button type="button" class="st-toggle" :class="{ on: resumeEnabled }" role="switch" :aria-checked="resumeEnabled" @click="resumeEnabled = !resumeEnabled">
            <span class="knob"></span>
          </button>
        </div>

        <div class="st-item flex items-center justify-between gap-4">
          <div>
            <span class="st-label">校验文件完整性</span>
            <span class="st-desc">下载完成后验证文件哈希</span>
          </div>
          <button type="button" class="st-toggle" :class="{ on: verifyEnabled }" role="switch" :aria-checked="verifyEnabled" @click="verifyEnabled = !verifyEnabled">
            <span class="knob"></span>
          </button>
        </div>

        <div class="st-item flex items-center justify-between gap-4">
          <div>
            <span class="st-label">重试次数</span>
            <span class="st-desc">下载失败后自动重试次数</span>
          </div>
          <input v-model.number="retryCount" type="number" min="0" max="10" class="st-input w-20 text-center" />
        </div>
      </div>

      <!-- ============ 关于 ============ -->
      <div v-else class="st-panel">
        <div class="st-header">
          <h2>关于</h2>
          <p>应用版本与相关信息</p>
        </div>

        <div class="st-item">
          <div class="bg-muted rounded-lg p-4 flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <span class="text-[13px] text-muted-foreground">应用名</span>
              <span class="text-[14px] text-foreground font-medium">Pulse</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-[13px] text-muted-foreground">版本</span>
              <span class="text-[14px] text-foreground font-medium font-mono">v2025.08</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-[13px] text-muted-foreground">引擎</span>
              <span class="text-[14px] text-foreground font-medium font-mono">yt-dlp 2025.08</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-[13px] text-muted-foreground">平台</span>
              <span class="text-[14px] text-foreground font-medium">Windows / macOS</span>
            </div>
          </div>
        </div>

        <div class="st-item flex items-center gap-3">
          <button type="button" class="st-btn-secondary">
            <RefreshCw class="w-3.5 h-3.5" />
            <span>检查更新</span>
          </button>
          <button type="button" class="st-btn-secondary">
            <Github class="w-3.5 h-3.5" />
            <span>开源仓库</span>
          </button>
        </div>

        <div class="st-item">
          <span class="text-[11px] text-muted-foreground">© 2025 Pulse</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.st-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ydl-muted-foreground);
  padding: 8px 12px;
}
.st-nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--ydl-muted-foreground);
  background: transparent;
  border: none;
  width: 100%;
  text-align: left;
  cursor: pointer;
  position: relative;
  transition: background 160ms, color 160ms;
}
.st-nav-item:hover {
  background: var(--ydl-muted);
  color: var(--ydl-foreground);
}
.st-nav-item.active {
  background: var(--ydl-muted);
  color: var(--ydl-primary);
  font-weight: 500;
}
.st-nav-item.active::before {
  content: "";
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 2px;
  height: 60%;
  background: var(--ydl-primary);
  border-radius: 2px;
}

.st-panel {
  max-width: 720px;
}
.st-header {
  margin-bottom: 24px;
}
.st-header h2 {
  font-size: 18px;
  font-weight: 600;
  color: var(--ydl-foreground);
  margin: 0 0 4px;
}
.st-header p {
  font-size: 13px;
  color: var(--ydl-muted-foreground);
  margin: 0;
}
.st-item {
  padding: 16px 0;
  border-bottom: 1px solid var(--ydl-border);
}
.st-item:last-child {
  border-bottom: none;
}
.st-label {
  display: block;
  font-size: 14px;
  color: var(--ydl-foreground);
}
.st-desc {
  display: block;
  font-size: 13px;
  color: var(--ydl-muted-foreground);
  line-height: 1.5;
  margin-top: 4px;
}
.st-label-above {
  display: block;
  font-size: 13px;
  color: var(--ydl-muted-foreground);
  margin-bottom: 8px;
}

.st-input {
  background: var(--ydl-background);
  border: 1px solid var(--ydl-border);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 14px;
  color: var(--ydl-foreground);
  font-family: var(--font-sans);
  min-width: 0;
}
.st-input:focus {
  outline: none;
  border-color: var(--ydl-primary);
}
.st-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.st-input::placeholder {
  color: var(--ydl-muted-foreground);
}

.select-wrap {
  position: relative;
  display: inline-block;
}
.st-select {
  appearance: none;
  -webkit-appearance: none;
  background: var(--ydl-background);
  border: 1px solid var(--ydl-border);
  border-radius: 8px;
  padding: 10px 34px 10px 12px;
  font-size: 14px;
  color: var(--ydl-foreground);
  cursor: pointer;
  font-family: var(--font-sans);
}
.st-select:focus {
  outline: none;
  border-color: var(--ydl-primary);
}
.select-wrap .chev {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  pointer-events: none;
  color: var(--ydl-muted-foreground);
  display: inline-flex;
  align-items: center;
}

.st-toggle {
  position: relative;
  width: 44px;
  height: 24px;
  border-radius: 999px;
  border: none;
  padding: 0;
  cursor: pointer;
  transition: background 160ms;
  flex-shrink: 0;
}
.st-toggle.off {
  background: var(--ydl-muted);
}
.st-toggle.on {
  background: var(--ydl-primary);
}
.st-toggle .knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: #fff;
  transition: transform 160ms;
}
.st-toggle.on .knob {
  transform: translateX(20px);
}

.swatch {
  border: none;
  cursor: pointer;
  transition: transform 160ms;
  padding: 0;
}
.swatch:not(:disabled):hover {
  transform: scale(1.12);
}
.swatch.active {
  box-shadow: 0 0 0 2px var(--ydl-card), 0 0 0 4px var(--ydl-primary);
}
.swatch.disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.segmented {
  display: inline-flex;
  background: var(--ydl-muted);
  border-radius: 8px;
  padding: 3px;
  gap: 2px;
}
.segmented button {
  padding: 6px 16px;
  border: none;
  background: transparent;
  border-radius: 6px;
  font-size: 13px;
  color: var(--ydl-muted-foreground);
  cursor: pointer;
  transition: background 160ms, color 160ms;
  font-family: var(--font-sans);
}
.segmented button.active {
  background: var(--ydl-card);
  color: var(--ydl-foreground);
  font-weight: 500;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}
.segmented button:not(.active):hover {
  color: var(--ydl-foreground);
}

.st-btn-secondary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: 1px solid var(--ydl-border);
  border-radius: 8px;
  background: transparent;
  color: var(--ydl-foreground);
  font-size: 13px;
  cursor: pointer;
  transition: background 160ms;
  font-family: var(--font-sans);
}
.st-btn-secondary:hover {
  background: var(--ydl-muted);
}
.st-btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.st-btn-browse {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border: 1px solid var(--ydl-border);
  border-radius: 8px;
  background: var(--ydl-muted);
  color: var(--ydl-foreground);
  font-size: 13px;
  cursor: pointer;
  transition: background 160ms;
  font-family: var(--font-sans);
  white-space: nowrap;
}
.st-btn-browse:hover {
  background: var(--ydl-surface-3);
}
.st-btn-browse:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>