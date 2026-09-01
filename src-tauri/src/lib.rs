// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod ytdlp;

use parking_lot::Mutex;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::Manager;

type ManagedChild = Arc<Mutex<std::process::Child>>;

struct ManagedTask {
    child: ManagedChild,
    // Unix cancellation is detected via the SIGKILL signal death of the
    // process group (atomic); other platforms need an explicit flag.
    #[cfg(not(unix))]
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

    /// Terminate every managed yt-dlp process tree. Called on app exit so
    /// closing the window does not orphan running downloads (and their
    /// ffmpeg children).
    fn kill_all(&self) {
        let tasks = self.tasks.lock();
        for task in tasks.values() {
            // A locked child means the runner is reaping an already-exited
            // process — nothing to kill.
            if let Some(mut guard) = task.child.try_lock() {
                ytdlp::kill_process_tree(&mut guard);
            }
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

/// Probe common locations / PATH for a working ffmpeg (+ ffprobe).
#[tauri::command]
fn detect_ffmpeg() -> Result<Option<ytdlp::Detection>, String> {
    Ok(ytdlp::detect_ffmpeg())
}

/// Verify a user-configured ffmpeg location (binary or directory), falling
/// back to auto-detection; returns the version banner.
#[tauri::command]
fn check_ffmpeg(path: Option<String>) -> Result<String, String> {
    ytdlp::check_ffmpeg(path)
}

/// Update a standalone yt-dlp executable after explicit user confirmation.
#[tauri::command]
fn update_ytdlp(binary: Option<String>) -> Result<String, String> {
    ytdlp::update(binary)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DownloadManager::new())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            resolve_url,
            start_download,
            cancel_download,
            ytdlp_version,
            detect_ytdlp,
            detect_ffmpeg,
            check_ffmpeg,
            update_ytdlp
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<DownloadManager>().kill_all();
            }
        });
}