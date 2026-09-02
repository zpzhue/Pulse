# Pulse

Pulse 是一款支持 macOS 和 Windows 的桌面下载管理器，使用 [yt-dlp](https://github.com/yt-dlp/yt-dlp) 解析和下载视频、音频及播放列表内容。

应用基于 Tauri v2 与 Vue 3 构建。`yt-dlp`、`ffmpeg` 和 `ffprobe` 由用户自行安装，不会打进安装包或便携版。

## 功能概览

- 解析单视频与播放列表，支持播放列表多选后逐条入队。
- 单视频可选择具体视频流；纯视频流会自动搭配最佳音频。
- 支持视频、音频、字幕和缩略图下载。
- 支持并发队列、限速、重试、HTTP 代理和 Cookie 文件。
- 实时显示下载进度、速度、ETA 和播放列表进度。
- 自动探测 `yt-dlp`、`ffmpeg` 和 `ffprobe`，也可手动指定绝对路径。
- 使用 SQLite 保存设置、活动任务和下载历史。
- 支持基于 `.part` 文件的断点续传。
- 已成功下载的同一链接不会重复入队，并显示“已下载过”。
- 支持浅色、深色模式和三组强调色。
- Windows 使用自绘标题栏，并通过单实例机制避免重复启动造成数据覆盖。

## 使用前准备

Pulse 运行时需要：

- [`yt-dlp`](https://github.com/yt-dlp/yt-dlp)
- [`ffmpeg`](https://ffmpeg.org/) 与 `ffprobe`

这些工具可以放入系统 `PATH`，也可以在 Pulse 的“设置”页面填写绝对路径。

### macOS

可以通过 `uv` 安装 `yt-dlp`：

```bash
uv tool install yt-dlp
```

常见工具路径：

```text
~/.local/bin/yt-dlp
~/.local/bin/ffmpeg
~/.local/bin/ffprobe
```

从 Finder 启动的桌面应用不一定继承终端的完整 `PATH`。如果自动探测没有找到工具，请在设置页填写绝对路径。

### Windows

请准备以下文件：

```text
yt-dlp.exe
ffmpeg.exe
ffprobe.exe
```

然后选择一种配置方式：

1. 将它们所在的目录加入用户或系统 `PATH`。
2. 在 Pulse 设置页填写工具的绝对路径，例如 `C:\tools\yt-dlp.exe`。

Windows 安装包和便携版不包含这些文件。首次启动后可通过顶部提示或设置页完成配置。

## 基本使用

1. 打开“新建下载”，粘贴视频或播放列表链接。
2. 点击解析，选择需要下载的条目和格式。
3. 加入下载队列，在主页查看实时进度、速度和剩余时间。
4. 在“历史记录”中查看结果、删除记录或重新下载。

## 下载与恢复行为

### 断点续传

断点续传默认开启，对应 yt-dlp 的 `--continue`：

- 下载被取消、应用退出或系统中断后，已写入的 `.part` 文件会保留。
- 应用下次启动时，原活动任务会转为“已中断”历史记录，不会自动启动。
- 在历史记录中点击“重新下载”，yt-dlp 会利用已有 `.part` 文件继续传输。

如果开启“清理未完成文件”，Pulse 会使用 `--no-part`，不再保留断点文件，因此无法继续之前的进度。

### 重复下载检查

新建任务前会检查本地历史：

- 同一链接已有成功记录时，不创建新任务，并显示“已下载过”。
- 分享链接中的 `si`、`feature`、`utm_*` 等跟踪参数不影响判定。
- `v`、`list`、`p`、`t` 等内容定位参数会保留，不同参数仍视为不同任务。
- 删除对应历史记录后，该链接不会再被判定为已下载。
- 历史页的“重新下载”代表明确的重下操作，不受重复检查限制。

### 取消与退出

- 取消任务会终止 yt-dlp 及其子进程树。
- Windows 使用 `taskkill /T /F`，避免 ffmpeg 等子进程残留。
- 应用异常退出后，未完成任务会转入历史记录并标记为“已中断”。

## 当前限制

Pulse 暂不提供下载过程中的“暂停/恢复”按钮。

目前可使用“取消任务 → 历史记录 → 重新下载”代替。在保留 `.part` 文件且启用断点续传时，重新下载会从已有进度继续，而不是从零开始。

真正的跨平台暂停需要同时挂起 yt-dlp 和 ffmpeg 的完整进程树；Unix 与 Windows 的进程控制机制不同，在能够可靠实现和测试之前，界面不会展示无法保证行为正确的暂停按钮。

## 数据存储

设置、下载历史和活动任务保存在 SQLite 数据库 `pulse.db` 中：

- 普通安装版使用 Tauri 的应用数据目录。
- Windows 便携版使用可执行文件所在目录。
- 数据库启用 WAL 模式。
- 下载历史默认保留最近 200 条任务。

## 开发

### 技术栈

- Tauri v2 / Rust
- Vue 3 / TypeScript / Vite
- Tailwind CSS v4
- Vue Router
- Lucide
- Bun
- SQLite（rusqlite）
- yt-dlp / ffmpeg

### 开发环境

除运行时所需的 yt-dlp 和 ffmpeg 外，还需要：

- [Bun](https://bun.sh/)
- Rust stable toolchain
- macOS：Xcode Command Line Tools
- Windows：Microsoft C++ Build Tools 与 WebView2 Runtime

安装前端依赖：

```bash
bun install
```

启动桌面开发环境：

```bash
bun run tauri dev
```

运行前端测试和构建：

```bash
bun run test
bun run build
```

运行 Rust 检查和测试：

```bash
cd src-tauri
cargo check
cargo test
```

构建桌面安装包：

```bash
bun run tauri build
```

Windows 安装版仅生成 MSI；发布工作流会另外生成不含安装器的便携版 ZIP。推送 `v*` 标签后，GitHub Actions 会在所有平台构建成功后自动创建 GitHub Release，并附上 MSI、DMG 和便携版 ZIP。

## 项目结构

```text
src/                    Vue 前端、页面、状态与服务封装
src-tauri/              Tauri/Rust 后端、yt-dlp 调用与 SQLite 存储
src-tauri/capabilities/ Tauri 权限配置
.github/workflows/      发布构建工作流
```
