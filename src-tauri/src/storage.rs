use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::path::Path;

pub struct AppStorage {
    connection: Mutex<Connection>,
}

impl AppStorage {
    pub fn open(path: &Path) -> Result<Self, String> {
        let connection = Connection::open(path)
            .map_err(|error| format!("无法打开 Pulse 数据库（{}）：{error}", path.display()))?;
        connection
            .execute_batch(
                "
                PRAGMA journal_mode = WAL;
                PRAGMA foreign_keys = ON;

                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY NOT NULL,
                    value TEXT NOT NULL,
                    updated_at INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS download_history (
                    id TEXT PRIMARY KEY NOT NULL,
                    task_json TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    finished_at INTEGER,
                    status TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_download_history_created_at
                    ON download_history(created_at DESC);

                CREATE TABLE IF NOT EXISTS active_downloads (
                    id TEXT PRIMARY KEY NOT NULL,
                    task_json TEXT NOT NULL,
                    spec_json TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    status TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_active_downloads_created_at
                    ON active_downloads(created_at ASC);
                ", 
            )
            .map_err(|error| format!("无法初始化 Pulse 数据库：{error}"))?;

        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<Value>, String> {
        let connection = self.connection.lock();
        let raw: Option<String> = connection
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| row.get(0))
            .optional()
            .map_err(|error| format!("无法读取设置：{error}"))?;
        raw.map(|value| serde_json::from_str(&value).map_err(|error| format!("设置数据损坏：{error}")))
            .transpose()
    }

    pub fn set_setting(&self, key: &str, value: &Value) -> Result<(), String> {
        let serialized = serde_json::to_string(value).map_err(|error| format!("无法序列化设置：{error}"))?;
        let connection = self.connection.lock();
        connection
            .execute(
                "
                INSERT INTO settings (key, value, updated_at)
                VALUES (?1, ?2, unixepoch() * 1000)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = excluded.updated_at
                ",
                params![key, serialized],
            )
            .map_err(|error| format!("无法保存设置：{error}"))?;
        Ok(())
    }

    pub fn delete_setting(&self, key: &str) -> Result<(), String> {
        let connection = self.connection.lock();
        connection
            .execute("DELETE FROM settings WHERE key = ?1", [key])
            .map_err(|error| format!("无法删除设置：{error}"))?;
        Ok(())
    }

    pub fn list_history(&self) -> Result<Vec<Value>, String> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare("SELECT task_json FROM download_history ORDER BY created_at ASC, rowid ASC")
            .map_err(|error| format!("无法读取下载历史：{error}"))?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| format!("无法读取下载历史：{error}"))?;

        let mut history = Vec::new();
        for row in rows {
            let raw = row.map_err(|error| format!("无法读取下载历史：{error}"))?;
            let task = serde_json::from_str(&raw).map_err(|error| format!("下载历史数据损坏：{error}"))?;
            history.push(task);
        }
        Ok(history)
    }

    pub fn list_active_downloads(&self) -> Result<Vec<Value>, String> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare("SELECT task_json, spec_json FROM active_downloads ORDER BY created_at ASC, rowid ASC")
            .map_err(|error| format!("无法读取活动下载：{error}"))?;
        let rows = statement
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map_err(|error| format!("无法读取活动下载：{error}"))?;

        let mut downloads = Vec::new();
        for row in rows {
            let (task_json, spec_json) = row.map_err(|error| format!("无法读取活动下载：{error}"))?;
            downloads.push(serde_json::json!({
                "task": serde_json::from_str::<Value>(&task_json)
                    .map_err(|error| format!("活动下载任务数据损坏：{error}"))?,
                "spec": serde_json::from_str::<Value>(&spec_json)
                    .map_err(|error| format!("活动下载配置数据损坏：{error}"))?,
            }));
        }
        Ok(downloads)
    }

    pub fn replace_active_downloads(&self, downloads: &[Value]) -> Result<(), String> {
        let mut connection = self.connection.lock();
        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始活动下载事务：{error}"))?;
        transaction
            .execute("DELETE FROM active_downloads", [])
            .map_err(|error| format!("无法清理活动下载：{error}"))?;

        let mut insert = transaction
            .prepare(
                "
                INSERT INTO active_downloads (id, task_json, spec_json, created_at, status)
                VALUES (?1, ?2, ?3, ?4, ?5)
                ",
            )
            .map_err(|error| format!("无法准备活动下载写入：{error}"))?;

        for download in downloads {
            let object = download
                .as_object()
                .ok_or_else(|| "活动下载记录必须是对象".to_string())?;
            let task = object
                .get("task")
                .ok_or_else(|| "活动下载记录缺少 task".to_string())?;
            let spec = object
                .get("spec")
                .ok_or_else(|| "活动下载记录缺少 spec".to_string())?;
            let task_object = task
                .as_object()
                .ok_or_else(|| "活动下载 task 必须是对象".to_string())?;
            let id = task_object
                .get("id")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| "活动下载 task 缺少 id".to_string())?;
            let created_at = task_object
                .get("createdAt")
                .and_then(Value::as_i64)
                .ok_or_else(|| format!("活动下载任务 {id} 缺少 createdAt"))?;
            let status = task_object
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("pending");
            let task_json = serde_json::to_string(task)
                .map_err(|error| format!("无法序列化活动下载任务：{error}"))?;
            let spec_json = serde_json::to_string(spec)
                .map_err(|error| format!("无法序列化活动下载配置：{error}"))?;
            insert
                .execute(params![id, task_json, spec_json, created_at, status])
                .map_err(|error| format!("无法保存活动下载：{error}"))?;
        }

        drop(insert);
        transaction
            .commit()
            .map_err(|error| format!("无法提交活动下载：{error}"))?;
        Ok(())
    }

    pub fn replace_history(&self, tasks: &[Value]) -> Result<(), String> {
        let mut connection = self.connection.lock();
        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始下载历史事务：{error}"))?;
        transaction
            .execute("DELETE FROM download_history", [])
            .map_err(|error| format!("无法清理下载历史：{error}"))?;

        let mut insert = transaction
            .prepare(
                "
                INSERT INTO download_history (id, task_json, created_at, finished_at, status)
                VALUES (?1, ?2, ?3, ?4, ?5)
                ",
            )
            .map_err(|error| format!("无法准备下载历史写入：{error}"))?;

        for task in tasks {
            let object = task
                .as_object()
                .ok_or_else(|| "下载历史记录必须是对象".to_string())?;
            let id = object
                .get("id")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| "下载历史记录缺少 id".to_string())?;
            let created_at = object
                .get("createdAt")
                .and_then(Value::as_i64)
                .ok_or_else(|| format!("下载历史记录 {id} 缺少 createdAt"))?;
            let finished_at = object.get("finishedAt").and_then(Value::as_i64);
            let status = object
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("completed");
            let serialized = serde_json::to_string(task)
                .map_err(|error| format!("无法序列化下载历史：{error}"))?;
            insert
                .execute(params![id, serialized, created_at, finished_at, status])
                .map_err(|error| format!("无法保存下载历史：{error}"))?;
        }

        drop(insert);
        transaction
            .commit()
            .map_err(|error| format!("无法提交下载历史：{error}"))?;
        Ok(())
    }
}
