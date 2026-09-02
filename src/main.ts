import { createApp } from "vue";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App.vue";
import router from "./router";
import { isWindowsPlatform } from "./services/paths";
import "./styles/main.css";

createApp(App).use(router).mount("#app");

// Enable window dragging from elements marked with `data-tauri-drag-region`.
// Tauri files a `tauri://drag-region` event when the pointer goes down on such
// an element; we forward it to the native window drag.
listen("tauri://drag-region", () => {
  void getCurrentWindow().startDragging();
});

// macOS 用 Overlay 标题栏把红绿灯融进自绘顶栏；Windows 没有 titleBarStyle
// 语义（该键被静默忽略），留着原生标题栏就会和自绘顶栏叠成两条。这里在
// Windows 上关掉原生装饰，改由 AppTopbar 右侧的自绘窗口按钮接管。
if (isWindowsPlatform()) {
  void getCurrentWindow()
    .setDecorations(false)
    .catch(() => {});
}