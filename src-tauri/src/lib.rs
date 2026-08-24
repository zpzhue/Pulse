// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod ytdlp;

use serde_json::Value;
use tauri::ipc::Channel;

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
) -> Result<String, String> {
    ytdlp::start_download(req, on_event)
}

/// Return the configured yt-dlp version.
#[tauri::command]
fn ytdlp_version(binary: Option<String>) -> Result<String, String> {
    ytdlp::version(binary)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            resolve_url,
            start_download,
            ytdlp_version
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}