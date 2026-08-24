import { createApp } from "vue";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App.vue";
import router from "./router";
import "./styles/main.css";

createApp(App).use(router).mount("#app");

// Enable window dragging from elements marked with `data-tauri-drag-region`.
// Tauri files a `tauri://drag-region` event when the pointer goes down on such
// an element; we forward it to the native window drag.
listen("tauri://drag-region", () => {
  void getCurrentWindow().startDragging();
});