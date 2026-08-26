//! yt-dlp download engine integration.
//!
//! Wraps the `yt-dlp` CLI as a child process and exposes it to the frontend
//! through Tauri commands. Progress is streamed back over a `Channel`.

use serde::{Deserialize, Serialize};
use serde_json::json;
use crate::{DownloadManager, DownloadTasks, ManagedTask};
use std::io::BufRead;
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::thread;
use tauri::ipc::Channel;

const DEFAULT_BINARY: &str = "yt-dlp";

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
}

#[derive(Serialize)]
pub struct ResolveResult {
    pub kind: String,
    pub id: String,
    pub title: String,
    pub uploader: String,
    pub count: usize,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub entries: Vec<PlaylistEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveRequest {
    pub url: String,
    pub binary: Option<String>,
}

/// Fetch metadata (title / playlist entries) without downloading.
pub fn resolve(req: ResolveRequest) -> Result<ResolveResult, String> {
    let binary = binary_of(&req.binary);
    let output = Command::new(binary)
        .arg("--dump-single-json")
        .arg("--no-warnings")
        .arg("--flat-playlist")
        .arg(&req.url)
        .output()
        .map_err(|e| format!("无法启动 yt-dlp（{}）: {e}", binary))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim_end().to_string());
    }

    let meta: serde_json::Value =
        serde_json::from_slice(&output.stdout).map_err(|e| format!("解析元数据失败: {e}"))?;
    let kind = meta.get("_type").and_then(|v| v.as_str()).unwrap_or("video").to_string();
    let id = meta.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let title = meta.get("title").and_then(|v| v.as_str()).unwrap_or("未命名").to_string();
    let uploader = meta.get("uploader").and_then(|v| v.as_str()).unwrap_or("").to_string();

    let mut entries = Vec::new();
    if let Some(list) = meta.get("entries").and_then(|v| v.as_array()) {
        for e in list {
            entries.push(PlaylistEntry {
                id: e.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                title: e.get("title").and_then(|v| v.as_str()).unwrap_or("未命名").to_string(),
                duration: e.get("duration").and_then(|v| v.as_f64()),
            });
        }
    }

    Ok(ResolveResult {
        kind,
        id,
        title,
        uploader,
        count: entries.len(),
        entries,
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
    pub proxy: Option<String>,
    pub playlist_items: Option<Vec<usize>>,
    pub rate_limit_ki_b: Option<u64>,
    pub resume: bool,
    pub remove_partial_files: bool,
    pub retries: u32,
    pub cookie_path: Option<String>,
    pub binary: Option<String>,
}

/// Build the yt-dlp argument vector for a single download task.
fn build_args(o: &DownloadOptions) -> Vec<String> {
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
    }

    // Output template: <path>/<filename template>
    let mut template = o.download_path.clone();
    if !template.ends_with('/') {
        template.push('/');
    }
    template.push_str(if o.filename_template.is_empty() { "%(title)s.%(ext)s" } else { &o.filename_template });
    args.push("-o".into());
    args.push(template);

    // Format / quality selection.
    let fmt = o.format.to_lowercase();
    if fmt == "mp3" {
        args.push("-x".into());
        args.push("--audio-format".into());
        args.push("mp3".into());
    } else if !o.keep_original_format {
        args.push("-f".into());
        args.push(format_selector(&o.quality));
        args.push("--merge-output-format".into());
        args.push(match fmt.as_str() {
            "webm" => "webm",
            "mkv" => "mkv",
            _ => "mp4",
        }.into());
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

    // Machine-readable one-line progress reports on stderr.
    args.push("--progress-template".into());
    args.push(
        "download:%(progress._percent_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.speed)s|%(progress.eta)s"
            .into(),
    );

    args.push(o.url.clone());
    args
}

/// Map a user-facing quality label to a yt-dlp format selector.
fn format_selector(quality: &str) -> String {
    match quality.to_lowercase().as_str() {
        "best" | "最佳" => "bestvideo+bestaudio/best".to_string(),
        "4k" | "2160p" => "bestvideo[height<=2160]+bestaudio/best".to_string(),
        "1080p" => "bestvideo[height<=1080]+bestaudio/best".to_string(),
        "720p" => "bestvideo[height<=720]+bestaudio/best".to_string(),
        "480p" => "best[height<=480]/bestvideo[height<=480]+bestaudio/best".to_string(),
        _ => "bestvideo[height<=1080]+bestaudio/best".to_string(),
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

/// Parse a single `download:` progress line into a JSON event.
fn parse_progress(line: &str) -> Option<serde_json::Value> {
    let payload = line.strip_prefix("download:")?;
    let parts: Vec<&str> = payload.split('|').collect();
    if parts.len() < 5 {
        return None;
    }

    let to_f64 = |s: &str| s.trim().trim_end_matches('%').trim().parse::<f64>().ok();

    let percent = to_f64(parts[0]).map(|p| (p * 10.0).round() / 10.0);
    let downloaded = parts[1].trim().parse::<u64>().ok();
    let total = parts[2].trim().parse::<u64>().ok();
    let speed = parse_speed(parts[3]);
    let eta = parts[4].trim().trim_end_matches("NA").trim().parse::<f64>().ok();

    Some(json!({
        "type": "progress",
        "percent": percent,
        "downloadedBytes": downloaded,
        "totalBytes": total,
        "speed": speed,
        "eta": eta,
    }))
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
    let args = build_args(&o);
    let (child, stderr) = {
        // Keep duplicate detection, process spawn, and registration atomic.
        let mut tasks = manager.tasks.lock();
        if tasks.contains_key(&task_id) {
            return Err(format!("下载任务已存在：{task_id}"));
        }

        let mut process = Command::new(binary)
            .args(&args)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("无法启动 yt-dlp（{}）: {e}", binary))?;
        let stderr = process
            .stderr
            .take()
            .ok_or_else(|| "无法读取 yt-dlp 进度输出".to_string())?;
        let child = Arc::new(parking_lot::Mutex::new(process));
        tasks.insert(
            task_id.clone(),
            ManagedTask {
                child: Arc::clone(&child),
                cancel_requested: false,
            },
        );
        (child, stderr)
    };

    let _ = on_event.send(json!({ "type": "started", "taskId": task_id, "url": o.url }));
    let tasks = Arc::clone(&manager.tasks);
    thread::spawn(move || run_download(task_id, child, stderr, on_event, tasks));

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

fn run_download(
    task_id: String,
    child: Arc<parking_lot::Mutex<Child>>,
    stderr: std::process::ChildStderr,
    on_event: Channel<serde_json::Value>,
    tasks: DownloadTasks,
) {
    let mut reader = std::io::BufReader::new(stderr);
    let mut line = String::new();

    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {
                if let Some(event) = parse_progress(line.trim_end()) {
                    let _ = on_event.send(event);
                }
            }
            Err(error) => {
                let cleanup_error = stop_and_reap(&child).err();
                tasks.lock().remove(&task_id);
                let message = match cleanup_error {
                    Some(cleanup_error) => format!("读取进度失败: {error}；{cleanup_error}"),
                    None => format!("读取进度失败: {error}"),
                };
                let _ = on_event.send(json!({ "type": "error", "message": message }));
                return;
            }
        }
    }

    let status = child.lock().wait();
    let cancelled = tasks
        .lock()
        .remove(&task_id)
        .map(|task| task.cancel_requested)
        .unwrap_or(false);
    if cancelled {
        let _ = on_event.send(json!({ "type": "cancelled" }));
        return;
    }

    match status {
        Ok(status) if status.success() => {
            let _ = on_event.send(json!({ "type": "finished" }));
        }
        Ok(status) => {
            let _ = on_event.send(json!({ "type": "error", "message": format!("下载失败，退出码 {:?}", status.code()) }));
        }
        Err(e) => {
            let _ = on_event.send(json!({ "type": "error", "message": format!("等待 yt-dlp 失败: {e}") }));
        }
    }
}

/// Request cancellation. The runner reaps the process and emits `cancelled`.
pub fn cancel_download(task_id: &str, manager: &DownloadManager) -> Result<(), String> {
    let child = {
        let mut tasks = manager.tasks.lock();
        let task = tasks
            .get_mut(task_id)
            .ok_or_else(|| format!("未找到运行中的下载任务：{task_id}"))?;
        task.cancel_requested = true;
        Arc::clone(&task.child)
    };

    let result = match child.lock().kill() {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::InvalidInput => Ok(()),
        Err(error) => Err(format!("取消下载失败: {error}")),
    };
    result
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
            proxy: Some("http://127.0.0.1:7890".into()),
            playlist_items: Some(vec![1, 3, 0, 7]),
            rate_limit_ki_b: Some(512),
            resume: true,
            remove_partial_files: true,
            retries: 4,
            cookie_path: Some("/tmp/cookies.txt".into()),
            binary: None,
        };
        let args = build_args(&options);
        let proxy_index = args.iter().position(|arg| arg == "--proxy").expect("proxy flag");
        assert_eq!(args[proxy_index + 1], "http://127.0.0.1:7890");
        let playlist_index = args.iter().position(|arg| arg == "--playlist-items").expect("playlist flag");
        assert_eq!(args[playlist_index + 1], "1,3,7");
        let rate_index = args.iter().position(|arg| arg == "--limit-rate").expect("rate limit flag");
        assert_eq!(args[rate_index + 1], "512K");
        let cookies_index = args.iter().position(|arg| arg == "--cookies").expect("cookies flag");
        assert_eq!(args[cookies_index + 1], "/tmp/cookies.txt");
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
            proxy: None,
            playlist_items: None,
            rate_limit_ki_b: None,
            resume: false,
            remove_partial_files: false,
            retries: 0,
            cookie_path: None,
            binary: None,
        };
        let args = build_args(&options);
        assert!(!args.iter().any(|arg| arg == "-f"));
        assert!(!args.iter().any(|arg| arg == "--merge-output-format"));
        assert!(args.iter().any(|arg| arg == "--no-continue"));
        assert!(!args.iter().any(|arg| arg == "--no-part"));
        assert!(!args.iter().any(|arg| arg == "--no-overwrites"));
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
            "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo '2026.08.24-test'; exit 0; fi\nif [ \"$1\" = \"--update\" ]; then echo 'update failed' >&2; exit 1; fi\necho 'unexpected command' >&2; exit 2\n",
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
    fn selects_expected_format_for_quality_tokens() {
        assert_eq!(format_selector("best"), "bestvideo+bestaudio/best");
        assert_eq!(format_selector("1080p"), "bestvideo[height<=1080]+bestaudio/best");
        assert_eq!(format_selector("720p"), "bestvideo[height<=720]+bestaudio/best");
        assert_eq!(format_selector("480p"), "best[height<=480]/bestvideo[height<=480]+bestaudio/best");
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
    fn parses_machine_readable_progress() {
        let event = parse_progress("download: 42.5% | 1048576 | 2097152 | 2MiB/s | 4 ")
            .expect("valid progress event");
        assert_eq!(event["percent"], 42.5);
        assert_eq!(event["downloadedBytes"], 1_048_576);
        assert_eq!(event["totalBytes"], 2_097_152);
        assert_eq!(event["speed"], 2_097_152.0);
        assert_eq!(event["eta"], 4.0);
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