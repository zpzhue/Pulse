import { createRouter, createWebHashHistory } from "vue-router";

const routes = [
  {
    path: "/",
    redirect: "/dashboard",
  },
  {
    path: "/dashboard",
    name: "dashboard",
    component: () => import("./views/DashboardView.vue"),
    meta: { title: "主页", navKey: "dashboard" },
  },
  {
    path: "/new-download",
    name: "new-download",
    component: () => import("./views/NewDownloadView.vue"),
    meta: { title: "新建下载", navKey: "new-download" },
  },
  {
    path: "/history",
    name: "history",
    component: () => import("./views/HistoryView.vue"),
    meta: { title: "历史记录", navKey: "history" },
  },
  {
    path: "/settings",
    name: "settings",
    component: () => import("./views/SettingsView.vue"),
    meta: { title: "设置", navKey: "settings" },
  },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

router.afterEach((to) => {
  const title = (to.meta.title as string) ?? "Pulse";
  document.title = `${title} · Pulse`;
});

export default router;