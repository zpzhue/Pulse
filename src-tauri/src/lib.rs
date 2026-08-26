// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod ytdlp;

use parking_lot::Mutex;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::ipc::Channel;

type ManagedChild = Arc<Mutex<std::process::Child>>;

struct ManagedTask {
    child: ManagedChild,
    cancel_requested: bool,
}

type DownloadTasks = Arc<Mutex<HashMap<String, ManagedTask>>>;

struct DownloadManager {
    tasks: DownloadTasks,
}

impl DownloadManager {
    fn new() -> Self {
        Self {
            tasks: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Resolve a URL to metadata (title / playlist entries).
#[tauri::command]
fn resolve_url(req: ytdlp::ResolveRequest) -> Result<ytdlp::ResolveResult, String> {
    ytdlp::resolve(req)
}

/// Start a download, streaming progress events back over the channel.
#[tauri::command]
fn start_download(
    req: ytdlp::DownloadOptions,
    on_event: Channel<Value>,
    manager: tauri::State<'_, DownloadManager>,
) -> Result<String, String> {
    ytdlp::start_download(req, on_event, &manager)
}

/// Stop a managed yt-dlp process. The frontend records cancellation in history.
#[tauri::command]
fn cancel_download(
    task_id: String,
    manager: tauri::State<'_, DownloadManager>,
) -> Result<(), String> {
    ytdlp::cancel_download(&task_id, &manager)
}

/// Return the configured yt-dlp version.
#[tauri::command]
fn ytdlp_version(binary: Option<String>) -> Result<String, String> {
    ytdlp::version(binary)
}

/// Probe common locations / PATH for a working yt-dlp.
#[tauri::command]
fn detect_ytdlp() -> Result<Option<ytdlp::Detection>, String> {
    Ok(ytdlp::detect())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DownloadManager::new())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            resolve_url,
            start_download,
            cancel_download,
            ytdlp_version,
            detect_ytdlp
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}