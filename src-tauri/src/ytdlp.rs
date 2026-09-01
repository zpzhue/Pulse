//! yt-dlp download engine integration.
//!
//! Wraps the `yt-dlp` CLI as a child process and exposes it to the frontend
//! through Tauri commands. Progress is streamed back over a `Channel`.

use serde::{Deserialize, Serialize};
use serde_json::json;
use crate::{DownloadManager, DownloadTasks, ManagedTask};
use parking_lot::Mutex;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, OnceLock};
use std::thread;
use tauri::ipc::Channel;

const DEFAULT_BINARY: &str = "yt-dlp";
/// Literal tag emitted by the download progress template (stripped when parsing),
/// so progress lines are distinguishable from ordinary yt-dlp stdout chatter.
const PROGRESS_MARKER: &str = "PULSE|";

fn binary_of(value: &Option<String>) -> &str {
    value.as_deref().filter(|s| !s.is_empty()).unwrap_or(DEFAULT_BINARY)
}

/* ------------------------------------------------------------------ */
/*  Resolve                                                             */
/* ------------------------------------------------------------------ */

#[derive(Serialize)]
pub struct PlaylistEntry {
    pub id: String,
    pub title: String,
    /// Duration in seconds; `null` when unknown (flat playlist mode).
    pub duration: Option<f64>,
    /// Watch URL of this entry so each row can be downloaded individually
    /// instead of via the playlist URL + --playlist-items.
    pub url: String,
}

/// One downloadable video stream of a resolved single video. Audio-only
/// streams are filtered out during parsing; `video_only` marks streams
/// that need `+bestaudio` appended at download time.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoFormat {
    pub format_id: String,
    /// Container/extension reported by yt-dlp (mp4, webm, ...).
    pub ext: String,
    pub width: Option<u64>,
    pub height: Option<u64>,
    /// Exact size when known, else approximate; `null` when unknown.
    pub filesize: Option<u64>,
    /// True when the stream carries no audio track.
    pub video_only: bool,
}

#[derive(Serialize)]
pub struct ResolveResult {
    pub kind: String,
    pub id: String,
    pub title: String,
    pub uploader: String,
    pub count: usize,
    /// Total duration in seconds for single videos; `null` otherwise.
    pub duration: Option<f64>,
    /// Playlist entries; always serialized (possibly empty) so the frontend
    /// can rely on a stable array contract.
    pub entries: Vec<PlaylistEntry>,
    /// Selectable video streams of a single video; empty for playlists.
    pub formats: Vec<VideoFormat>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveRequest {
    pub url: String,
    pub binary: Option<String>,
    /// HTTP proxy applied to metadata resolution (downloads already apply it).
    pub proxy: Option<String>,
    /// Cookie file applied to metadata resolution (age/member-gated content).
    pub cookie_path: Option<String>,
}

/// Fetch metadata (title / playlist entries / single-video formats) without downloading.
pub fn resolve(req: ResolveRequest) -> Result<ResolveResult, String> {
    let binary = binary_of(&req.binary);
    let cookie_path = validated_cookie_path(req.cookie_path)?;
    let mut command = Command::new(binary);
    command
        .arg("--dump-single-json")
        .arg("--no-warnings")
        .arg("--flat-playlist");
    if let Some(proxy) = req.proxy.as_deref().filter(|value| !value.trim().is_empty()) {
        command.arg("--proxy").arg(proxy);
    }
    if let Some(cookie) = &cookie_path {
        command.arg("--cookies").arg(cookie);
    }
    let output = command
        .arg(&req.url)
        .output()
        .map_err(|e| format!("无法启动 yt-dlp（{}）: {e}", binary))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim_end().to_string());
    }

    parse_resolve_json(&output.stdout)
}

/// Parse `yt-dlp --dump-single-json` output into the frontend contract.
///
/// Single videos carry the full metadata (including the formats list);
/// `--flat-playlist` entries only expose id/title/duration plus their watch
/// URL, so `formats` stays empty for playlists.
fn parse_resolve_json(stdout: &[u8]) -> Result<ResolveResult, String> {
    let meta: serde_json::Value =
        serde_json::from_slice(stdout).map_err(|e| format!("解析元数据失败: {e}"))?;
    let kind = meta.get("_type").and_then(|v| v.as_str()).unwrap_or("video").to_string();
    let id = meta.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let title = meta.get("title").and_then(|v| v.as_str()).unwrap_or("未命名").to_string();
    let uploader = meta.get("uploader").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let duration = meta.get("duration").and_then(|v| v.as_f64());

    let mut entries = Vec::new();
    if let Some(list) = meta.get("entries").and_then(|v| v.as_array()) {
        for e in list {
            let url = e
                .get("url")
                .and_then(|v| v.as_str())
                .or_else(|| e.get("webpage_url").and_then(|v| v.as_str()))
                .unwrap_or("")
                .to_string();
            entries.push(PlaylistEntry {
                id: e.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                title: e.get("title").and_then(|v| v.as_str()).unwrap_or("未命名").to_string(),
                duration: e.get("duration").and_then(|v| v.as_f64()),
                url,
            });
        }
    }

    let mut formats = Vec::new();
    if kind != "playlist" {
        if let Some(list) = meta.get("formats").and_then(|v| v.as_array()) {
            for f in list {
                // Some HLS extractors (for example AcFun) omit codec fields
                // entirely. Only an explicit `vcodec: "none"` means audio-only.
                if matches!(f.get("vcodec").and_then(|v| v.as_str()), Some("none") | Some("")) {
                    continue; // audio-only stream: not a selectable video row
                }
                let ext = f.get("ext").and_then(|v| v.as_str()).unwrap_or("").to_string();
                if ext == "mhtml" {
                    continue; // storyboard previews are not real downloadable streams
                }
                let filesize = f
                    .get("filesize")
                    .and_then(|v| v.as_f64())
                    .or_else(|| f.get("filesize_approx").and_then(|v| v.as_f64()))
                    .map(|v| v as u64);
                let video_only = f
                    .get("acodec")
                    .and_then(|v| v.as_str())
                    .map(|acodec| acodec == "none" || acodec.is_empty())
                    .unwrap_or(false);
                formats.push(VideoFormat {
                    format_id: f.get("format_id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    ext,
                    width: f.get("width").and_then(|v| v.as_f64()).map(|v| v as u64),
                    height: f.get("height").and_then(|v| v.as_f64()).map(|v| v as u64),
                    filesize,
                    video_only,
                });
            }
        }
        // Highest resolution first; on ties prefer the larger stream.
        formats.sort_by(|a, b| {
            b.height
                .unwrap_or(0)
                .cmp(&a.height.unwrap_or(0))
                .then(b.filesize.unwrap_or(0).cmp(&a.filesize.unwrap_or(0)))
        });
    }

    Ok(ResolveResult {
        kind,
        id,
        title,
        uploader,
        count: entries.len(),
        duration,
        entries,
        formats,
    })
}

/* ------------------------------------------------------------------ */
/*  Download                                                           */
/* ------------------------------------------------------------------ */

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadOptions {
    pub task_id: String,
    pub url: String,
    pub download_path: String,
    pub format: String,
    pub quality: String,
    pub filename_template: String,
    pub subtitles: bool,
    pub thumbnail: bool,
    pub keep_original_format: bool,
    /// Row-selected yt-dlp format id (from the resolve metadata's format
    /// list); when absent yt-dlp applies its own default format selection.
    pub format_id: Option<String>,
    /// Whether the selected format carries no audio track (needs
    /// `+bestaudio` appended at download time).
    pub video_only: Option<bool>,
    pub proxy: Option<String>,
    pub playlist_items: Option<Vec<usize>>,
    pub rate_limit_ki_b: Option<u64>,
    pub resume: bool,
    pub remove_partial_files: bool,
    pub retries: u32,
    pub cookie_path: Option<String>,
    /// User-configured ffmpeg binary path or containing directory; takes
    /// precedence over auto-detection. Empty/None falls back to detection.
    pub ffmpeg_location: Option<String>,
    pub binary: Option<String>,
}

/// Build the yt-dlp argument vector for a single download task.
fn build_args(o: &DownloadOptions, ffmpeg_location: Option<&str>) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "--newline".into(),
        "--no-warnings".into(),
        "--no-colors".into(),
        "--console-title".into(),
    ];

    if let Some(p) = o.proxy.as_deref().filter(|s| !s.is_empty()) {
        args.push("--proxy".into());
        args.push(p.into());
    }
    if let Some(rate_limit) = o.rate_limit_ki_b.filter(|limit| *limit > 0) {
        args.push("--limit-rate".into());
        args.push(format!("{rate_limit}K"));
    }
    if let Some(cookie_path) = o.cookie_path.as_deref().filter(|path| !path.trim().is_empty()) {
        args.push("--cookies".into());
        args.push(cookie_path.into());
    }
    args.push("--retries".into());
    args.push(o.retries.to_string());
    if o.resume {
        args.push("--continue".into());
    } else {
        args.push("--no-continue".into());
    }
    if o.remove_partial_files {
        args.push("--no-part".into());
    }

    if let Some(items) = o.playlist_items.as_ref().filter(|items| !items.is_empty()) {
        let selected = items
            .iter()
            .copied()
            .filter(|item| *item > 0)
            .map(|item| item.to_string())
            .collect::<Vec<_>>();
        if !selected.is_empty() {
            args.push("--playlist-items".into());
            args.push(selected.join(","));
        }
    } else {
        // Single-video task: never let a `list=` URL expand into a playlist.
        args.push("--no-playlist".into());
    }

    // Output template: <path>/<filename template>
    let mut template = o.download_path.clone();
    if !template.ends_with('/') {
        template.push('/');
    }
    template.push_str(if o.filename_template.is_empty() { "%(title)s.%(ext)s" } else { &o.filename_template });
    args.push("-o".into());
    args.push(template);

    // Format selection: an explicitly chosen format id (row-level stream
    // picker in the UI) wins; without one yt-dlp applies its own defaults.
    if let Some(selector) = format_selector_for(o) {
        args.push("-f".into());
        args.push(selector);
    }

    if o.subtitles {
        args.push("--write-subs".into());
        args.push("--sub-langs".into());
        args.push("all".into());
        args.push("--write-auto-subs".into());
    }
    if o.thumbnail {
        args.push("--write-thumbnail".into());
    }

    // Pin ffmpeg/ffprobe when they live outside PATH: GUI processes inherit a
    // minimal PATH and yt-dlp would otherwise fail to locate them at all.
    if let Some(location) = ffmpeg_location {
        args.push("--ffmpeg-location".into());
        args.push(location.into());
    }

    // Machine-readable one-line progress reports on stdout (yt-dlp prints the
    // template output there; stderr only carries warnings/errors).
    args.push("--progress-template".into());
    args.push(format!(
        "download:{PROGRESS_MARKER}%(progress._percent_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.speed)s|%(progress.eta)s"
    ));

    args.push(o.url.clone());
    args
}

/// Build the `-f` selector from a row-picked format id. Video-only streams
/// are combined with bestaudio (with a `/best` fallback); anything without
/// a usable id yields None → yt-dlp's own default selection.
fn format_selector_for(o: &DownloadOptions) -> Option<String> {
    let raw = o.format_id.as_deref()?.trim();
    let usable = !raw.is_empty()
        && raw
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '+' | '/'));
    if !usable {
        return None;
    }
    if o.video_only.unwrap_or(false) {
        Some(format!("{raw}+bestaudio/best"))
    } else {
        Some(raw.to_string())
    }
}

/// Parse a yt-dlp speed value such as `12.5MiB/s` into bytes per second.
fn parse_speed(value: &str) -> Option<f64> {
    let normalized = value.trim().replace(' ', "");
    if normalized.is_empty() || normalized.eq_ignore_ascii_case("na") {
        return None;
    }

    let number_end = normalized
        .char_indices()
        .take_while(|(_, c)| c.is_ascii_digit() || *c == '.')
        .map(|(index, c)| index + c.len_utf8())
        .last()?;
    let amount = normalized[..number_end].parse::<f64>().ok()?;
    let unit = normalized[number_end..]
        .trim_end_matches("/s")
        .trim_end_matches("ps")
        .to_ascii_lowercase();
    let multiplier = match unit.as_str() {
        "" | "b" => 1.0,
        "kb" => 1_000.0,
        "mb" => 1_000_000.0,
        "gb" => 1_000_000_000.0,
        "tb" => 1_000_000_000_000.0,
        "kib" => 1024.0,
        "mib" => 1024.0 * 1024.0,
        "gib" => 1024.0 * 1024.0 * 1024.0,
        "tib" => 1024.0 * 1024.0 * 1024.0 * 1024.0,
        _ => return None,
    };
    Some(amount * multiplier)
}

/// Parse a playlist item marker: `[download] Downloading item 3 of 12`.
fn parse_playlist_item(line: &str) -> Option<(u64, u64)> {
    let rest = line.strip_prefix("[download] Downloading item ")?;
    let mut parts = rest.splitn(2, " of ");
    let index: u64 = parts.next()?.trim().parse().ok()?;
    let total: u64 = parts.next()?.trim().parse().ok()?;
    (total > 0 && index >= 1 && index <= total).then_some((index, total))
}

/// Parse a single tagged progress line into a JSON event.
/// One parsed progress line: the tagged yt-dlp fields, typed.
pub(crate) struct ProgressData {
    percent: f64,
    downloaded: Option<u64>,
    total: Option<u64>,
    speed: Option<f64>,
    eta: Option<f64>,
}

/// Serialize a progress sample into the JSON event the frontend expects.
pub(crate) fn progress_event(data: &ProgressData) -> serde_json::Value {
    json!({
        "type": "progress",
        "percent": data.percent,
        "downloadedBytes": data.downloaded,
        "totalBytes": data.total,
        "speed": data.speed,
        "eta": data.eta,
    })
}

fn parse_progress(line: &str) -> Option<ProgressData> {
    let payload = line.strip_prefix(PROGRESS_MARKER)?;
    let parts: Vec<&str> = payload.split('|').collect();
    if parts.len() < 5 {
        return None;
    }

    let to_f64 = |s: &str| s.trim().trim_end_matches('%').trim().parse::<f64>().ok();

    let percent = to_f64(parts[0]).map(|p| (p * 10.0).round() / 10.0)?;
    let downloaded = parts[1].trim().parse::<u64>().ok();
    let total = parts[2].trim().parse::<u64>().ok();
    let speed = parse_speed(parts[3]);
    let eta = parts[4].trim().trim_end_matches("NA").trim().parse::<f64>().ok();

    Some(ProgressData { percent, downloaded, total, speed, eta })
}

/// Start a managed download and return immediately after the child is spawned.
fn validated_cookie_path(path: Option<String>) -> Result<Option<String>, String> {
    let Some(path) = path.filter(|value| !value.trim().is_empty()) else {
        return Ok(None);
    };
    let canonical = std::fs::canonicalize(&path)
        .map_err(|error| format!("Cookie 文件不可访问（{path}）：{error}"))?;
    let metadata = std::fs::metadata(&canonical)
        .map_err(|error| format!("无法读取 Cookie 文件（{}）：{error}", canonical.display()))?;
    if !metadata.is_file() {
        return Err(format!("Cookie 路径必须是文件：{}", canonical.display()));
    }
    Ok(Some(canonical.to_string_lossy().into_owned()))
}

pub fn start_download(
    mut o: DownloadOptions,
    on_event: Channel<serde_json::Value>,
    manager: &DownloadManager,
) -> Result<String, String> {
    if o.task_id.trim().is_empty() {
        return Err("下载任务缺少 taskId".to_string());
    }
    o.cookie_path = validated_cookie_path(o.cookie_path)?;

    let task_id = o.task_id.clone();
    let binary = binary_of(&o.binary);
    // User-configured ffmpeg location wins over auto-detection.
    let ffmpeg = o
        .ffmpeg_location
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(ffmpeg_location);
    let args = build_args(&o, ffmpeg.as_deref());

    // Diagnostic aid: dump the exact invocation as JSON to the console
    // (visible in `tauri dev` output) so a failing download can be replayed
    // / debugged from the command line.
    println!(
        "[pulse-download-args] {}",
        serde_json::json!({
            "taskId": task_id,
            "url": o.url,
            "binary": binary,
            "ffmpegLocation": ffmpeg,
            "mergeFormat": o.format,
            "quality": o.quality,
            "args": args,
        })
    );

    let (child, stdout, stderr) = {
        // Keep duplicate detection, process spawn, and registration atomic.
        let mut tasks = manager.tasks.lock();
        if tasks.contains_key(&task_id) {
            return Err(format!("下载任务已存在：{task_id}"));
        }

        let mut command = Command::new(binary);
        command
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // New process group on Unix so cancellation can take down the whole
        // yt-dlp process tree (ffmpeg children included).
        #[cfg(unix)]
        use std::os::unix::process::CommandExt;
        #[cfg(unix)]
        command.process_group(0);

        let mut process = command
            .spawn()
            .map_err(|e| format!("无法启动 yt-dlp（{}）: {e}", binary))?;
        let stdout = process
            .stdout
            .take()
            .ok_or_else(|| "无法读取 yt-dlp 进度输出".to_string())?;
        let stderr = process
            .stderr
            .take()
            .ok_or_else(|| "无法读取 yt-dlp 诊断输出".to_string())?;
        let child = Arc::new(parking_lot::Mutex::new(process));
        tasks.insert(
            task_id.clone(),
            ManagedTask {
                child: Arc::clone(&child),
                #[cfg(not(unix))]
                cancel_requested: false,
            },
        );
        (child, stdout, stderr)
    };

    let _ = on_event.send(json!({ "type": "started", "taskId": task_id, "url": o.url }));
    let tasks = Arc::clone(&manager.tasks);
    thread::spawn(move || run_download(task_id, child, stdout, stderr, on_event, tasks));

    Ok("started".to_string())
}

fn stop_and_reap(child: &Arc<parking_lot::Mutex<Child>>) -> Result<(), String> {
    let mut process = child.lock();
    match process.kill() {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::InvalidInput => {}
        Err(error) => return Err(format!("终止 yt-dlp 失败: {error}")),
    }
    process
        .wait()
        .map(|_| ())
        .map_err(|error| format!("回收 yt-dlp 进程失败: {error}"))
}

/// Upper bound for the buffered yt-dlp stderr tail used in failure messages.
const DIAGNOSTIC_TAIL_LIMIT: usize = 4_000;

/// Append a diagnostic line, keeping only the tail of the buffer.
fn append_diagnostic(buffer: &Mutex<String>, line: &str) {
    if line.is_empty() {
        return;
    }
    let mut buffer = buffer.lock();
    if !buffer.is_empty() {
        buffer.push('\n');
    }
    buffer.push_str(line);
    if buffer.len() > DIAGNOSTIC_TAIL_LIMIT {
        let excess = buffer.len() - DIAGNOSTIC_TAIL_LIMIT;
        let start = (excess..)
            .find(|index| buffer.is_char_boundary(*index))
            .unwrap_or(buffer.len());
        buffer.drain(..start);
    }
}

fn run_download(
    task_id: String,
    child: Arc<parking_lot::Mutex<Child>>,
    stdout: std::process::ChildStdout,
    stderr: std::process::ChildStderr,
    on_event: Channel<serde_json::Value>,
    tasks: DownloadTasks,
) {
    // stderr carries warnings and the actual error text; drain it on a helper
    // thread and keep the tail so failures report the real cause.
    let diagnostics = Arc::new(Mutex::new(String::new()));
    let stderr_reader = {
        let diagnostics = Arc::clone(&diagnostics);
        thread::spawn(move || {
            let mut reader = BufReader::new(stderr);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) => break,
                    Ok(_) => append_diagnostic(&diagnostics, line.trim_end()),
                    Err(_) => break,
                }
            }
        })
    };

    // Progress template output arrives on stdout, one tagged line per update.
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    let mut last_downloaded: Option<u64> = None;
    let mut last_total: Option<u64> = None;

    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {
                let trimmed = line.trim_end();
                if let Some(data) = parse_progress(trimmed) {
                    if let Some(dl) = data.downloaded {
                        last_downloaded = Some(dl);
                    }
                    if let Some(tb) = data.total {
                        last_total = Some(tb);
                    }
                    let _ = on_event.send(progress_event(&data));
                } else if let Some((index, total)) = parse_playlist_item(trimmed) {
                    let _ = on_event.send(json!({
                        "type": "item",
                        "playlistIndex": index,
                        "playlistTotal": total,
                    }));
                }
            }
            Err(error) => {
                let cleanup_error = stop_and_reap(&child).err();
                tasks.lock().remove(&task_id);
                let _ = stderr_reader.join();
                let tail = diagnostics.lock().clone();
                let mut message = format!("读取进度失败: {error}");
                if !tail.is_empty() {
                    message.push_str(&format!("；yt-dlp 输出：{tail}"));
                }
                if let Some(cleanup_error) = cleanup_error {
                    message.push_str(&format!("；{cleanup_error}"));
                }
                let _ = on_event.send(json!({ "type": "error", "message": message }));
                return;
            }
        }
    }

    let status = child.lock().wait();
    let _ = stderr_reader.join();
    let removed = tasks.lock().remove(&task_id);
    // On Unix the process group leader was spawned with process_group(0); a
    // SIGKILL signal death means *we* killed it — this is the atomic
    // cancellation signal (a process that exits on its own, even a zombie
    // reaped late, carries no signal). This removes the cancel race entirely.
    #[cfg(unix)]
    use std::os::unix::process::ExitStatusExt;
    #[cfg(unix)]
    let cancelled = matches!(&status, Ok(s) if s.signal() == Some(libc::SIGKILL));
    #[cfg(unix)]
    drop(removed);
    #[cfg(not(unix))]
    let cancelled = removed.map(|task| task.cancel_requested).unwrap_or(false);
    if cancelled {
        let _ = on_event.send(json!({ "type": "cancelled" }));
        return;
    }

    match status {
        Ok(status) if status.success() => {
            // Carry the last known sizes so the frontend can reconcile the
            // record (merged downloads rarely end with bytes == total).
            let _ = on_event.send(json!({
                "type": "finished",
                "downloadedBytes": last_downloaded,
                "totalBytes": last_total,
            }));
        }
        Ok(status) => {
            let tail = diagnostics.lock().clone();
            let detail = if tail.is_empty() {
                format!("退出码 {:?}", status.code())
            } else {
                format!("退出码 {:?}；yt-dlp 输出：{}", status.code(), tail)
            };
            let _ = on_event.send(json!({ "type": "error", "message": format!("下载失败，{detail}") }));
        }
        Err(e) => {
            let _ = on_event.send(json!({ "type": "error", "message": format!("等待 yt-dlp 失败: {e}") }));
        }
    }
}

/// Request cancellation. The runner reaps the process and emits `cancelled`.
pub fn cancel_download(task_id: &str, manager: &DownloadManager) -> Result<(), String> {
    let child = {
        let tasks = manager.tasks.lock();
        let task = tasks
            .get(task_id)
            .ok_or_else(|| format!("未找到运行中的下载任务：{task_id}"))?;
        Arc::clone(&task.child)
    };

    let mut guard = child.lock();
    // An already-exited process must not be killed: the runner is about to
    // report the real (successful / failed) outcome.
    if let Ok(Some(_)) = guard.try_wait() {
        return Err("下载任务已结束，无需取消".to_string());
    }

    #[cfg(not(unix))]
    {
        // No process groups: flag + kill, and the runner reads the flag.
        if let Some(task) = manager.tasks.lock().get_mut(task_id) {
            task.cancel_requested = true;
        }
    }
    kill_process_tree(&mut guard);
    Ok(())
}

/// Kill the whole process group of a spawned yt-dlp child (ffmpeg children
/// included). Falls back to the direct child when the group is gone.
pub(crate) fn kill_process_tree(child: &mut Child) {
    #[cfg(unix)]
    unsafe {
        let _ = libc::killpg(child.id() as libc::pid_t, libc::SIGKILL);
    }
    #[cfg(not(unix))]
    {
        let _ = child.kill();
    }
}

/* ------------------------------------------------------------------ */
/*  Version                                                            */
/* ------------------------------------------------------------------ */

/// Return the yt-dlp version string (used by the settings "测试连接" flow).
pub fn version(binary: Option<String>) -> Result<String, String> {
    let binary = binary_of(&binary);
    let output = Command::new(binary)
        .arg("--version")
        .output()
        .map_err(|e| format!("无法启动 yt-dlp（{}）: {e}", binary))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim_end().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim_end().to_string())
}

fn is_stable_version(version: &str) -> bool {
    let mut parts = version.trim().split('.');
    let Some(year) = parts.next() else { return false; };
    let Some(month) = parts.next() else { return false; };
    let Some(day) = parts.next() else { return false; };
    parts.next().is_none()
        && year.len() == 4
        && month.len() == 2
        && day.len() == 2
        && year.chars().all(|character| character.is_ascii_digit())
        && month.chars().all(|character| character.is_ascii_digit())
        && day.chars().all(|character| character.is_ascii_digit())
}

fn verified_update_binary(binary: Option<String>) -> Result<String, String> {
    let binary = binary_of(&binary);
    let path = std::path::Path::new(binary);
    if !path.is_absolute() {
        return Err("仅可更新已配置为绝对路径的 yt-dlp 可执行文件；PATH 或包管理器安装请通过其原渠道更新".to_string());
    }
    if !path.is_file() {
        return Err(format!("yt-dlp 路径不是可更新的文件：{binary}"));
    }

    let detected_version = version(Some(binary.to_string()))?;
    if !is_stable_version(&detected_version) {
        return Err(format!("路径不是稳定版 yt-dlp 可执行文件：{binary}"));
    }
    Ok(binary.to_string())
}

/// Run yt-dlp's built-in update command after explicit user confirmation.
pub fn update(binary: Option<String>) -> Result<String, String> {
    let binary = verified_update_binary(binary)?;
    let output = Command::new(&binary)
        .arg("--update")
        .output()
        .map_err(|e| format!("无法启动 yt-dlp 更新（{}）: {e}", binary))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("yt-dlp 更新失败，退出码 {:?}", output.status.code())
        } else {
            stderr
        });
    }

    version(Some(binary))
}

/* ------------------------------------------------------------------ */
/*  Detection                                                          */
/* ------------------------------------------------------------------ */

#[derive(Serialize)]
pub struct Detection {
    pub path: String,
    pub version: String,
}

fn home_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(std::path::PathBuf::from))
}

/// Candidate yt-dlp locations to probe, in priority order.
fn candidates(home: Option<&std::path::Path>) -> Vec<String> {
    #[allow(unused_mut)]
    let mut v = vec![DEFAULT_BINARY.to_string()]; // PATH resolution

    #[cfg(target_os = "macos")]
    {
        v.push("/opt/homebrew/bin/yt-dlp".into()); // Apple Silicon Homebrew
        v.push("/usr/local/bin/yt-dlp".into()); // Intel Homebrew
    }

    #[cfg(target_os = "windows")]
    {
        v.push("yt-dlp.exe".into());
        if let Some(home) = home {
            v.push(format!("{}\\AppData\\Local\\yt-dlp\\yt-dlp.exe", home.display()));
        }
    }

    if let Some(home) = home {
        let h = home.display().to_string();
        v.push(format!("{h}/.local/bin/yt-dlp"));
        v.push(format!("{h}/bin/yt-dlp"));
    }

    v.dedup();
    v
}

/// Probe common locations and PATH for a working yt-dlp.
pub fn detect() -> Option<Detection> {
    candidates(home_dir().as_deref())
        .into_iter()
        .find_map(|c| version(Some(c.clone())).ok().map(|version| Detection { path: c, version }))
}

/* ------------------------------------------------------------------ */
/*  ffmpeg                                                              */
/* ------------------------------------------------------------------ */

const FFMPEG_BINARY: &str = "ffmpeg";

/// Cached `--ffmpeg-location` value; outer None = probe not run yet this run.
type FfmpegCache = Mutex<Option<Option<String>>>;

fn ffmpeg_cache() -> &'static FfmpegCache {
    static CACHE: OnceLock<FfmpegCache> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

/// yt-dlp locates ffprobe next to ffmpeg, so hand it the containing directory.
/// Directory containing the ffmpeg binary (yt-dlp also finds ffprobe there).
fn ffmpeg_directory(path: &str) -> String {
    std::path::Path::new(path)
        .parent()
        .map(|dir| dir.to_string_lossy().into_owned())
        .filter(|dir| !dir.is_empty())
        .unwrap_or_else(|| path.to_string())
}

/// Candidate ffmpeg locations to probe, in priority order.
fn ffmpeg_candidates(home: Option<&std::path::Path>) -> Vec<String> {
    let mut v = vec![FFMPEG_BINARY.to_string()]; // PATH resolution

    #[cfg(target_os = "macos")]
    {
        v.push("/usr/local/bin/ffmpeg".into()); // Intel Homebrew
        v.push("/opt/homebrew/bin/ffmpeg".into()); // Apple Silicon Homebrew
    }

    #[cfg(target_os = "windows")]
    {
        v.push("ffmpeg.exe".into());
    }

    if let Some(home) = home {
        let h = home.display().to_string();
        v.push(format!("{h}/.local/bin/ffmpeg"));
        v.push(format!("{h}/bin/ffmpeg"));
    }

    v.dedup();
    v
}

fn ffmpeg_version(binary: &str) -> Result<String, String> {
    let output = Command::new(binary)
        .arg("-version")
        .output()
        .map_err(|e| format!("无法启动 ffmpeg（{binary}）: {e}"))?;
    if !output.status.success() {
        return Err(format!("ffmpeg 运行异常，退出码 {:?}", output.status.code()));
    }
    let first_line = String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    if first_line.is_empty() {
        return Err("ffmpeg 未返回版本信息".to_string());
    }
    Ok(first_line)
}

/// Probe common locations and PATH for a working ffmpeg. Returns the binary
/// path (bare name when resolved via PATH) plus its version banner.
pub fn detect_ffmpeg() -> Option<Detection> {
    ffmpeg_candidates(home_dir().as_deref()).into_iter().find_map(|candidate| {
        let version = ffmpeg_version(&candidate).ok()?;
        Some(Detection { path: candidate, version })
    })
}

/// Cached `--ffmpeg-location` value passed to every download.
/// `None` = no absolute ffmpeg found; yt-dlp then falls back to its own
/// PATH lookup. Probed once per app run (restart to re-detect).
pub fn ffmpeg_location() -> Option<String> {
    let mut cache = ffmpeg_cache().lock();
    if cache.is_none() {
        let resolved = detect_ffmpeg().and_then(|detection| {
            if std::path::Path::new(&detection.path).is_absolute() {
                Some(ffmpeg_directory(&detection.path))
            } else {
                None // bare "ffmpeg" on PATH; yt-dlp will find it itself
            }
        });
        *cache = Some(resolved);
    }
    cache.clone().flatten()
}

/// Validate a user-configured ffmpeg location (binary path or directory) and
/// return its version banner. Empty/None probes the auto-detected location.
pub fn check_ffmpeg(path: Option<String>) -> Result<String, String> {
    let trimmed = path.filter(|value| !value.trim().is_empty());
    let binary = match trimmed {
        Some(value) => {
            let meta = std::fs::metadata(&value)
                .map_err(|error| format!("ffmpeg 路径不可访问（{value}）：{error}"))?;
            if meta.is_dir() {
                format!("{}/ffmpeg", value.trim_end_matches('/'))
            } else {
                value
            }
        }
        None => ffmpeg_location().ok_or_else(|| "未检测到 ffmpeg（自动探测失败）".to_string())?,
    };
    ffmpeg_version(&binary)
}

#[cfg(test)]
mod tests {
    //! End-to-end sanity tests for the detection logic. A fake `yt-dlp`
    //! executable is injected onto PATH to exercise the real discovery path.
    use super::*;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;

    fn temp_dir(suffix: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pulse_detect_{suffix}_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_executable(dir: &PathBuf, name: &str, script: &str) -> PathBuf {
        let bin = dir.join(name);
        fs::write(&bin, script).unwrap();
        let mut perm = fs::metadata(&bin).unwrap().permissions();
        perm.set_mode(0o755);
        fs::set_permissions(&bin, perm).unwrap();
        bin
    }

    fn write_fake_ytdlp(dir: &PathBuf) -> PathBuf {
        write_executable(dir, "yt-dlp", "#!/bin/sh\nprintf '2026.08.24-test'\n")
    }

    fn set_env(vars: &[(&str, &str)]) {
        for (k, v) in vars {
            unsafe { std::env::set_var(k, v) };
        }
    }

    #[test]
    fn builds_selected_playlist_and_proxy_args() {
        let options = DownloadOptions {
            task_id: "test-task".into(),
            url: "https://example.test/playlist".into(),
            download_path: "/tmp/pulse".into(),
            format: "mp4".into(),
            quality: "1080p".into(),
            filename_template: "%(title)s.%(ext)s".into(),
            subtitles: false,
            thumbnail: false,
            keep_original_format: false,
            format_id: None,
            video_only: None,
            proxy: Some("http://127.0.0.1:7890".into()),
            playlist_items: Some(vec![1, 3, 0, 7]),
            rate_limit_ki_b: Some(512),
            resume: true,
            remove_partial_files: true,
            retries: 4,
            cookie_path: Some("/tmp/cookies.txt".into()),
            ffmpeg_location: None,
            binary: None,
        };
        let args = build_args(&options, Some("/Users/tester/.local/bin"));
        let proxy_index = args.iter().position(|arg| arg == "--proxy").expect("proxy flag");
        assert_eq!(args[proxy_index + 1], "http://127.0.0.1:7890");
        let playlist_index = args.iter().position(|arg| arg == "--playlist-items").expect("playlist flag");
        assert_eq!(args[playlist_index + 1], "1,3,7");
        assert!(!args.iter().any(|arg| arg == "--no-playlist"));
        let rate_index = args.iter().position(|arg| arg == "--limit-rate").expect("rate limit flag");
        assert_eq!(args[rate_index + 1], "512K");
        let cookies_index = args.iter().position(|arg| arg == "--cookies").expect("cookies flag");
        assert_eq!(args[cookies_index + 1], "/tmp/cookies.txt");
        let ffmpeg_index = args.iter().position(|arg| arg == "--ffmpeg-location").expect("ffmpeg flag");
        assert_eq!(args[ffmpeg_index + 1], "/Users/tester/.local/bin");
        let progress_index = args.iter().position(|arg| arg == "--progress-template").expect("progress template flag");
        assert!(args[progress_index + 1].starts_with("download:PULSE|"));
        let retries_index = args.iter().position(|arg| arg == "--retries").expect("retries flag");
        assert_eq!(args[retries_index + 1], "4");
        assert!(args.iter().any(|arg| arg == "--continue"));
        assert!(args.iter().any(|arg| arg == "--no-part"));
        assert!(!args.iter().any(|arg| arg == "--no-overwrites"));
    }

    #[test]
    fn keeps_source_format_when_requested() {
        let options = DownloadOptions {
            task_id: "keep-original".into(),
            url: "https://example.test/video".into(),
            download_path: "/tmp/pulse".into(),
            format: "mp4".into(),
            quality: "1080p".into(),
            filename_template: "%(title)s.%(ext)s".into(),
            subtitles: false,
            thumbnail: false,
            keep_original_format: true,
            format_id: None,
            video_only: None,
            proxy: None,
            playlist_items: None,
            rate_limit_ki_b: None,
            resume: false,
            remove_partial_files: false,
            retries: 0,
            cookie_path: None,
            ffmpeg_location: None,
            binary: None,
        };
        let args = build_args(&options, None);
        assert!(!args.iter().any(|arg| arg == "-f"));
        assert!(!args.iter().any(|arg| arg == "--merge-output-format"));
        assert!(!args.iter().any(|arg| arg == "--ffmpeg-location"));
        assert!(args.iter().any(|arg| arg == "--no-continue"));
        assert!(!args.iter().any(|arg| arg == "--no-part"));
        assert!(!args.iter().any(|arg| arg == "--no-overwrites"));
    }

    #[test]
    fn combines_video_only_format_with_bestaudio() {
        let options = DownloadOptions {
            task_id: "fmt-video-only".into(),
            url: "https://example.test/video".into(),
            download_path: "/tmp/pulse".into(),
            format: "mp4".into(),
            quality: "1080p".into(),
            filename_template: "%(title)s.%(ext)s".into(),
            subtitles: false,
            thumbnail: false,
            keep_original_format: false,
            format_id: Some("137".into()),
            video_only: Some(true),
            proxy: None,
            playlist_items: None,
            rate_limit_ki_b: None,
            resume: true,
            remove_partial_files: false,
            retries: 3,
            cookie_path: None,
            ffmpeg_location: None,
            binary: None,
        };
        let args = build_args(&options, None);
        let index = args.iter().position(|arg| arg == "-f").expect("format flag");
        assert_eq!(args[index + 1], "137+bestaudio/best");
        assert!(!args.iter().any(|arg| arg == "--merge-output-format"));
    }

    #[test]
    fn uses_inclusive_format_id_directly() {
        let options = DownloadOptions {
            task_id: "fmt-inclusive".into(),
            url: "https://example.test/video".into(),
            download_path: "/tmp/pulse".into(),
            format: "mp4".into(),
            quality: "1080p".into(),
            filename_template: "%(title)s.%(ext)s".into(),
            subtitles: false,
            thumbnail: false,
            keep_original_format: false,
            format_id: Some("18".into()),
            video_only: Some(false),
            proxy: None,
            playlist_items: None,
            rate_limit_ki_b: None,
            resume: true,
            remove_partial_files: false,
            retries: 3,
            cookie_path: None,
            ffmpeg_location: None,
            binary: None,
        };
        let args = build_args(&options, None);
        let index = args.iter().position(|arg| arg == "-f").expect("format flag");
        assert_eq!(args[index + 1], "18");
        assert!(!args.iter().any(|arg| arg == "--merge-output-format"));
    }

    #[test]
    fn ignores_unusable_format_id() {
        let options = DownloadOptions {
            task_id: "fmt-bad".into(),
            url: "https://example.test/video".into(),
            download_path: "/tmp/pulse".into(),
            format: "mp4".into(),
            quality: "1080p".into(),
            filename_template: "%(title)s.%(ext)s".into(),
            subtitles: false,
            thumbnail: false,
            keep_original_format: false,
            format_id: Some("best video]; rm -rf /".into()),
            video_only: Some(true),
            proxy: None,
            playlist_items: None,
            rate_limit_ki_b: None,
            resume: true,
            remove_partial_files: false,
            retries: 3,
            cookie_path: None,
            ffmpeg_location: None,
            binary: None,
        };
        let args = build_args(&options, None);
        assert!(!args.iter().any(|arg| arg == "-f"));
    }

    #[test]
    fn parses_resolve_json_with_formats_and_entry_urls() {
        let single = serde_json::json!({
            "_type": "video",
            "id": "abc123",
            "title": "Sample",
            "uploader": "Chan",
            "duration": 91.4,
            "formats": [
                { "format_id": "140", "ext": "m4a", "vcodec": "none", "acodec": "mp4a.40.2", "filesize": 1000 },
                { "format_id": "sb2", "ext": "mhtml", "vcodec": "unknown", "acodec": "none", "height": 1080 },
                { "format_id": "137", "ext": "mp4", "vcodec": "avc1.640028", "acodec": "none", "width": 1920, "height": 1080, "filesize_approx": 104857600.0 },
                { "format_id": "248", "ext": "webm", "vcodec": "vp9", "acodec": "none", "width": 1920, "height": 1080, "filesize": 94371840 },
                { "format_id": "18", "ext": "mp4", "vcodec": "avc1.42001E", "acodec": "mp4a.40.2", "width": 640, "height": 360, "filesize": 20971520 }
            ]
        });
        let parsed = parse_resolve_json(&serde_json::to_vec(&single).unwrap()).unwrap();
        assert_eq!(parsed.kind, "video");
        assert_eq!(parsed.duration, Some(91.4));
        // Audio-only (140) and storyboard (sb2) streams are filtered out.
        assert_eq!(parsed.formats.len(), 3);
        // Highest resolution first; ties broken by the larger stream.
        assert_eq!(parsed.formats[0].format_id, "137");
        assert_eq!(parsed.formats[1].format_id, "248");
        assert_eq!(parsed.formats[2].format_id, "18");
        assert!(parsed.formats[0].video_only);
        assert!(!parsed.formats[2].video_only);
        // filesize falls back to filesize_approx.
        assert_eq!(parsed.formats[0].filesize, Some(104_857_600));
        assert_eq!(parsed.formats[1].filesize, Some(94_371_840));
        assert_eq!(parsed.formats[0].ext, "mp4");
        assert_eq!(parsed.formats[0].width, Some(1920));

        // AcFun HLS formats omit codec fields, but remain selectable video
        // streams and each variant contains both audio and video.
        let acfun = serde_json::json!({
            "_type": "video",
            "id": "ac48805366",
            "title": "AcFun HLS",
            "formats": [
                { "format_id": "0", "ext": "mp4", "width": 360, "height": 640, "filesize_approx": 4_738_668.0 },
                { "format_id": "3", "ext": "mp4", "width": 1080, "height": 1920, "filesize_approx": 25_241_366.0 }
            ]
        });
        let parsed = parse_resolve_json(&serde_json::to_vec(&acfun).unwrap()).unwrap();
        assert_eq!(parsed.formats.len(), 2);
        assert_eq!(parsed.formats[0].format_id, "3");
        assert_eq!(parsed.formats[0].height, Some(1920));
        assert!(!parsed.formats[0].video_only);
        assert_eq!(parsed.formats[1].format_id, "0");
        assert!(!parsed.formats[1].video_only);

        let playlist = serde_json::json!({
            "_type": "playlist",
            "id": "pl1",
            "title": "List",
            "uploader": "Chan",
            "entries": [
                { "id": "e1", "title": "One", "duration": 10.0, "url": "https://youtu.be/e1" },
                { "id": "e2", "title": "Two", "duration": null, "webpage_url": "https://example.test/e2" }
            ]
        });
        let parsed = parse_resolve_json(&serde_json::to_vec(&playlist).unwrap()).unwrap();
        assert_eq!(parsed.kind, "playlist");
        assert!(parsed.formats.is_empty());
        assert_eq!(parsed.entries.len(), 2);
        assert_eq!(parsed.entries[0].url, "https://youtu.be/e1");
        assert_eq!(parsed.entries[1].url, "https://example.test/e2");
        assert_eq!(parsed.entries[1].duration, None);
    }

    #[test]
    fn refuses_non_absolute_or_non_file_update_targets() {
        let relative = update(Some("yt-dlp".into())).expect_err("relative path must be refused");
        assert!(relative.contains("绝对路径"));

        let directory = temp_dir("update-directory");
        let invalid = update(Some(directory.to_string_lossy().into_owned()))
            .expect_err("directory must be refused");
        assert!(invalid.contains("不是可更新的文件"));
    }

    #[test]
    fn accepts_only_stable_release_versions() {
        assert!(is_stable_version("2025.06.25"));
        assert!(!is_stable_version("2025.6.25"));
        assert!(!is_stable_version("2025.06.25.1"));
        assert!(!is_stable_version("2025.06.25-nightly"));
        assert!(!is_stable_version("v2025.06.25"));
    }

    #[test]
    fn rejects_non_ytdlp_update_target_before_running_update() {
        let dir = temp_dir("not-ytdlp");
        let binary = write_executable(&dir, "tool", "#!/bin/sh\necho 'not a version'; exit 0\n");

        let error = update(Some(binary.to_string_lossy().into_owned()))
            .expect_err("non-yt-dlp target must be refused");
        assert!(error.contains("不是稳定版 yt-dlp"));
    }

    #[test]
    fn reports_update_failure_after_verifying_binary() {
        let dir = temp_dir("update-failure");
        let binary = write_executable(
            &dir,
            "yt-dlp",
            "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo '2026.08.24'; exit 0; fi\nif [ \"$1\" = \"--update\" ]; then echo 'update failed' >&2; exit 1; fi\necho 'unexpected command' >&2; exit 2\n",
        );

        let error = update(Some(binary.to_string_lossy().into_owned()))
            .expect_err("failing update should be returned");
        assert_eq!(error, "update failed");
    }

    #[test]
    fn validates_cookie_file_paths() {
        let dir = temp_dir("cookies");
        let file = dir.join("cookies.txt");
        fs::write(&file, "# Netscape HTTP Cookie File\n").unwrap();

        let validated = validated_cookie_path(Some(file.to_string_lossy().into_owned()))
            .expect("cookie file should validate");
        assert_eq!(validated, Some(fs::canonicalize(&file).unwrap().to_string_lossy().into_owned()));
        assert!(validated_cookie_path(None).unwrap().is_none());
        assert!(validated_cookie_path(Some(dir.to_string_lossy().into_owned())).is_err());
        assert!(validated_cookie_path(Some(dir.join("missing.txt").to_string_lossy().into_owned())).is_err());
    }

    #[test]
    fn marks_single_video_tasks_with_no_playlist() {
        let mut options = DownloadOptions {
            task_id: "test-task".into(),
            url: "https://example.test/watch?v=x&list=y".into(),
            download_path: "/tmp/pulse".into(),
            format: "mp4".into(),
            quality: "best".into(),
            filename_template: "%(title)s.%(ext)s".into(),
            subtitles: false,
            thumbnail: false,
            keep_original_format: false,
            format_id: None,
            video_only: None,
            proxy: None,
            playlist_items: None,
            rate_limit_ki_b: None,
            resume: true,
            remove_partial_files: false,
            retries: 3,
            cookie_path: None,
            ffmpeg_location: None,
            binary: None,
        };
        let args = build_args(&options, None);
        assert!(args.iter().any(|arg| arg == "--no-playlist"));
        // Without a row-picked format id yt-dlp applies its own selection.
        assert!(!args.iter().any(|arg| arg == "-f"));

        options.playlist_items = Some(vec![2, 5]);
        let args = build_args(&options, None);
        assert!(!args.iter().any(|arg| arg == "--no-playlist"));
        assert!(args.iter().any(|arg| arg == "--playlist-items"));
    }

    #[test]
    fn parses_progress_speed_as_bytes_per_second() {
        assert_eq!(parse_speed("12.5MiB/s"), Some(13_107_200.0));
        assert_eq!(parse_speed("1.5 MB/s"), Some(1_500_000.0));
        assert_eq!(parse_speed("824KiB/s"), Some(843_776.0));
        assert_eq!(parse_speed("NA"), None);
        assert_eq!(parse_speed("12widgets/s"), None);
    }

    #[test]
    fn parses_playlist_item_markers() {
        assert_eq!(parse_playlist_item("[download] Downloading item 3 of 12"), Some((3, 12)));
        assert_eq!(parse_playlist_item("[download] Downloading item 1 of 1"), Some((1, 1)));
        assert_eq!(parse_playlist_item("[download] Downloading item 13 of 12"), None);
        assert_eq!(parse_playlist_item("[download] Destination: x"), None);
        assert!(parse_progress("[download] Downloading item 3 of 12").is_none());
    }

    #[test]
    #[cfg(unix)]
    fn signals_sigkill_death_as_cancelled() {
        use std::os::unix::process::CommandExt;
        use std::os::unix::process::ExitStatusExt;

        // A process-group SIGKILL death carries the signal — the atomic
        // cancellation discriminator used by run_download.
        let mut command = Command::new("/bin/sleep");
        command.arg("30").process_group(0);
        let mut child = command.spawn().expect("spawn sleep");
        unsafe { libc::killpg(child.id() as libc::pid_t, libc::SIGKILL) };
        let status = child.wait().expect("wait sleep");
        assert_eq!(status.signal(), Some(libc::SIGKILL));

        // A normal exit carries no signal, so it can never read as cancelled.
        let mut child = Command::new("/usr/bin/true").spawn().expect("spawn true");
        let status = child.wait().expect("wait true");
        assert!(status.signal().is_none());
    }

    #[test]
    fn parses_machine_readable_progress() {
        let data = parse_progress("PULSE| 42.5%|1048576|2097152|2MiB/s|4 ")
            .expect("valid progress event");
        assert_eq!(data.percent, 42.5);
        assert_eq!(data.downloaded, Some(1_048_576));
        assert_eq!(data.total, Some(2_097_152));
        assert_eq!(data.speed, Some(2_097_152.0));
        assert_eq!(data.eta, Some(4.0));
        // Untagged lines (yt-dlp chatter, legacy template output) are ignored.
        assert!(parse_progress("[download] Destination: /tmp/x").is_none());
        assert!(parse_progress("download: 42.5%|1|2|1MiB/s|4").is_none());
        assert!(parse_progress("PULSE|only|three").is_none());
    }

    #[test]
    fn serializes_progress_data_to_frontend_event() {
        let data = parse_progress("PULSE|  0.0%|1024|3000000|NA|NA").expect("parsed");
        let event = progress_event(&data);
        assert_eq!(event["type"], "progress");
        assert_eq!(event["percent"], 0.0);
        assert_eq!(event["downloadedBytes"], 1024);
        assert_eq!(event["totalBytes"], 3_000_000);
        assert_eq!(event["speed"], serde_json::Value::Null);
        assert_eq!(event["eta"], serde_json::Value::Null);
    }

    #[test]
    fn detects_path_then_reports_missing() {
        let found_dir = temp_dir("found");
        let empty_dir = temp_dir("empty");
        let home = temp_dir("home");
        write_fake_ytdlp(&found_dir);
        let old_path = std::env::var_os("PATH");
        let old_home = std::env::var_os("HOME");
        set_env(&[
            ("PATH", &format!("{}:{}", found_dir.to_string_lossy(), old_path.as_deref().unwrap_or_default().to_string_lossy())),
            ("HOME", &home.to_string_lossy()),
        ]);

        let found = detect().expect("should locate the fake yt-dlp on PATH");
        assert_eq!(found.version, "2026.08.24-test");

        set_env(&[
            ("PATH", empty_dir.to_string_lossy().as_ref()),
            ("HOME", home.to_string_lossy().as_ref()),
        ]);
        assert!(detect().is_none());

        unsafe {
            match old_path {
                Some(value) => std::env::set_var("PATH", value),
                None => std::env::remove_var("PATH"),
            }
            match old_home {
                Some(value) => std::env::set_var("HOME", value),
                None => std::env::remove_var("HOME"),
            }
        }
    }
}