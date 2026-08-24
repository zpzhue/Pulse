# Pulse

一个基于 [Tauri v2](https://tauri.app) + Vue 3 + TypeScript 的桌面下载管理应用（macOS）。

## 技术栈

- **桌面框架**：Tauri v2（Rust）
- **前端**：Vue 3 `<script setup>` + TypeScript + Vite
- **样式**：Tailwind CSS v4
- **路由**：Vue Router
- **图标**：lucide-vue-next
- **包管理**：bun

## 启动

```bash
# 开发（需先配置好 mise 环境）
bun run tauri dev
```

macOS 下 start 命令里需要把 `~/.local/bin`、`~/.cargo/bin`、`~/.local/share/mise/shims` 加到 PATH，才能正确找到 mise 管理的工具。

## 设计稿来源

UI 以 `ytdlp-gui/` 目录下的设计稿为准（各独立页面 html）。注意其中 `project-shell.html` 是**过期的共享片段**（仍带旧的 5 菜单 + 底部用户栏），实际实现以各独立页面文件为准。

## 已实现内容（阶段 1：应用外壳）

### 工程初始化
- Tauri v2 + Vue3(TS) + Vite + Tailwind v4 工程脚手架，bun 管理依赖

### 设计令牌
- `src/styles/design-tokens.css`：迁移设计稿的三套主题色阶（青色 / 紫色 / 绿色）+ 深浅色语义变量
- 映射进 Tailwind（可用 `bg-background`、`text-foreground`、`text-primary` 等语义类）

### 应用外壳
- `src/components/layout/AppSidebar.vue`：侧边栏，包含 Logo + 导航（主页 / 新建下载 / 历史记录 / 设置 共 4 项），已移除设计稿中删除的底部"本地用户"栏
- `src/components/layout/AppTopbar.vue`：顶栏，含搜索、主题色点切换（青/紫/绿）、深浅模式切换

### 路由
- 主页 / 新建下载 / 历史记录 / 设置 4 个页面（当前为占位）

### 无边框窗口（macOS）
- `src-tauri/tauri.conf.json`：`titleBarStyle: Overlay` + `hiddenTitle` + `macOSPrivateApi`
- 顶栏 / 侧边栏 Logo 区设为拖拽区，配合 `core:window:allow-start-dragging` 权限实现窗口拖动
- `src-tauri/capabilities/default.json`：补充了拖拽所需权限
- macOS 左上角红绿灯与布局的冲突已处理（侧边栏顶部预留安全区）

### 设置持久化
- 主题色 / 深浅模式通过 localStorage 持久化，重启应用后保留

## 待实现（后续阶段）
- 阶段 2：主页 Dashboard（统计卡 + 进行中下载列表）
- 新建下载、历史记录、设置等页面