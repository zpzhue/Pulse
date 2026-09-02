import { invoke } from "@tauri-apps/api/core";

export async function getSetting<T>(key: string): Promise<T | null> {
  return invoke<T | null>("get_setting", { key });
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  await invoke<void>("set_setting", { key, value });
}

export async function deleteSetting(key: string): Promise<void> {
  await invoke<void>("delete_setting", { key });
}

export async function getDownloadHistory<T>(): Promise<T[]> {
  return invoke<T[]>("get_download_history");
}

export async function replaceDownloadHistory<T>(tasks: T[]): Promise<void> {
  await invoke<void>("replace_download_history", { tasks });
}

export async function getActiveDownloads<T>(): Promise<T[]> {
  return invoke<T[]>("get_active_downloads");
}

export async function replaceActiveDownloads<T>(downloads: T[]): Promise<void> {
  await invoke<void>("replace_active_downloads", { downloads });
}
