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
- 阶段 7：状态 / 进度持久化 + 首页联动真实数据

## 阶段 6：接入真实下载引擎（yt-dlp）
### 后端（Rust / Tauri Command）
- `src-tauri/src/ytdlp.rs`：yt-dlp 引擎封装，通过子进程调用 CLI
  - `resolve_url`：`--dump-single-json --flat-playlist` 拉取元数据（标题 / 播放列表条目 / 作者），识别单视频或播放列表
  - `start_download`：按格式 / 画质 / 路径 / 字幕 / 缩略图 / 代理构造参数，`--progress-template` 输出机器可读进度，经 `Channel` 实时推送事件（started / progress / finished / error）
  - `ytdlp_version`：校验二进制可达性并返回版本（供设置页“测试连接”）
- `src-tauri/src/lib.rs`：注册以上 `#[tauri::command]`

### 前端
- `src/services/ytdlp.ts`：封装 `invoke` 调用 + `Channel` 事件解析，持久化 yt-dlp 二进制路径（localStorage）
- `NewDownloadView.vue`：接入真实解析（URL → 元数据填充播放列表 / 单视频），“开始下载 / 批量下载”触发真实下载任务并展示状态
- `SettingsView.vue`：yt-dlp 面板“测试连接”校验路径并持久化

### 说明
- 进度流式上报 → 首页 Dashboard 联动真实数据属于阶段 7
- 需要系统已安装 `yt-dlp`（默认 `yt-dlp`，可在设置页配置路径）

## 阶段 8：yt-dlp 自动探测 + 缺失引导
- 启动时自动探测 yt-dlp（PATH + 常见安装目录：Homebrew、`~/.local/bin`、`~/bin` 等）
- 检测到 → 自动使用可执行路径并持久化（`pulse.ytdlp.binary`）
- 未检测到 / 路径无效 → 顶部警告横幅，提供「下载 yt-dlp」（打开官方 release 页）与「设置路径」（弹窗手动指定，标记为手动来源）两种引导
- 用户手动设置的路径（顶部横幅或设置页）以 `pulse.ytdlp.source = manual` 标记，后续启动优先校验该路径，而非重新探测

## 阶段 7：状态 / 进度持久化 + 首页联动真实数据
### 全局下载状态（Store）
- `src/composables/useDownloads.ts`：单例组合式状态，统一管理下载任务生命周期与真实子进程
  - `start()`：入队真实下载，标题自动解析，进度/速度/ETA 实时写入任务
  - `active`：进行中任务（内存态，随真实进度更新）
  - `history`：已完成 / 失败任务（深度 `watch` 自动持久化到 localStorage，保留最近 200 条）
  - 聚合统计：`activeCount` / `completedCount` / `totalSpeed` / `diskUsage` 及格式化工具

### 页面联动
- `DashboardView.vue`：去掉模拟数据，改为渲染真实 `active` 任务列表 + 动态统计卡（进行中数 / 完成数 / 实时总速度 / 磁盘占用），空态引导新建下载
- `HistoryView.vue`：改为读取持久化的 `history`，展示完成 / 失败记录，支持搜索、类型过滤、删除
- `NewDownloadView.vue`：下载按钮改走 Store 入队，反馈“已加入下载队列”，任务在后台异步下载，首页实时可见