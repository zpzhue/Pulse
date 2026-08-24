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

### 主页 Dashboard（阶段 2）
- `src/views/DashboardView.vue`：4 统计卡（正在下载 / 已完成 / 下载速度 / 磁盘占用）+ 进行中下载列表（进度条、速度、ETA、暂停/取消）
- 数据为前端模拟态，结构为后续接入真实下载引擎预留

### 新建下载页（阶段 3）
- `src/views/NewDownloadView.vue`：URL 输入与智能识别（单视频 / 播放列表），单视频模式（格式 / 画质 / 保存路径 / 高级选项）
- 播放列表模式：视频列表 + 全选 / 取消 + 批量操作工具栏（清晰度、格式、导出、批量下载）
- 通用快速选项（保存路径 + 字幕 / 缩略图开关）

### 历史记录页（阶段 4）
- `src/views/HistoryView.vue`：搜索 + 类型过滤（全部 / 视频 / 音频 / 字幕）、按时间排序
- 历史记录表格（名称 / 来源 / 文件信息 / 时间 / 状态 / 操作）+ 加载更多 + 统计页脚
- 数据为前端模拟态

### 设置页（阶段 5）
- `src/views/SettingsView.vue`：左侧分类导航 + 5 个面板
  - 外观：主题色（青 / 紫 / 绿）、深色模式、界面密度
  - 下载设置：默认质量 / 格式、下载路径、文件名模板、同时下载数
  - yt-dlp 配置：路径、自动更新、HTTP 代理、Cookie 配置
  - 网络：限速、断点续传、完整性校验、重试次数
  - 关于：应用 / 引擎版本信息
- 外观面板与全局 `useTheme`（主题色 / 深浅模式）双向联动并持久化

## 待实现（后续阶段）
- 阶段 6：接入真实下载引擎（yt-dlp 命令调用）
- 阶段 7：状态 / 进度持久化 + 首页联动真实数据