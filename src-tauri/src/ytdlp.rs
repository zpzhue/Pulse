//! yt-dlp download engine integration.
//!
//! Wraps the `yt-dlp` CLI as a child process and exposes it to the frontend
//! through Tauri commands. Progress is streamed back over a `Channel`.

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::io::BufRead;
use std::process::{Command, Stdio};
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
    pub url: String,
    pub download_path: String,
    pub format: String,
    pub quality: String,
    pub filename_template: String,
    pub subtitles: bool,
    pub thumbnail: bool,
    pub proxy: Option<String>,
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
    } else {
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

/// Parse a single `download:` progress line into a JSON event.
fn parse_progress(line: &str) -> Option<serde_json::Value> {
    let payload = line.strip_prefix("download:")?;
    let parts: Vec<&str> = payload.split('|').collect();
    if parts.len() < 5 {
        return None;
    }

    let to_f64 = |s: &str| s.trim().trim_end_matches('%').trim().parse::<f64>().ok();
    // Speed arrives as e.g. "12.5MiB" or "NA" — take the leading numeric portion.
    let speed_leading = |s: &str| {
        s.trim()
            .chars()
            .take_while(|c| c.is_ascii_digit() || *c == '.')
            .collect::<String>()
            .parse::<f64>()
            .ok()
    };

    let percent = to_f64(parts[0]).map(|p| (p * 10.0).round() / 10.0);
    let downloaded = parts[1].trim().parse::<u64>().ok();
    let total = parts[2].trim().parse::<u64>().ok();
    let speed = speed_leading(parts[3]);
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

/// Start a download and stream progress / completion events over `channel`.
pub fn start_download(
    o: DownloadOptions,
    on_event: Channel<serde_json::Value>,
) -> Result<String, String> {
    let binary = binary_of(&o.binary);
    let args = build_args(&o);

    let mut child = Command::new(binary)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("无法启动 yt-dlp（{}）: {e}", binary))?;

    let _ = on_event.send(json!({ "type": "started", "url": o.url }));

    let stderr = child.stderr.take().expect("stderr pipe available");
    let mut reader = std::io::BufReader::new(stderr);
    let mut line = String::new();

    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break, // EOF
            Ok(_) => {
                let trimmed = line.trim_end();
                if let Some(event) = parse_progress(trimmed) {
                    let _ = on_event.send(event);
                }
            }
            Err(e) => {
                let _ = on_event.send(json!({ "type": "error", "message": format!("读取进度失败: {e}") }));
                return Err(format!("读取进度失败: {e}"));
            }
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("等待 yt-dlp 失败: {e}"))?;

    if status.success() {
        let _ = on_event.send(json!({ "type": "finished" }));
        Ok("finished".to_string())
    } else {
        let _ = on_event.send(json!({ "type": "error", "message": format!("下载失败，退出码 {:?}", status.code()) }));
        Err(format!("下载失败，退出码 {:?}", status.code()))
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