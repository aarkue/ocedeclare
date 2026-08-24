// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Desktop target: runs OCPQ inside a tauri app, mirroring the axum/wasm commands plus a few
//! desktop-only ones (file dialogs, OS file associations, HPC session).

ocpq_core::use_mimalloc!();

use std::str::FromStr;
use std::sync::{Arc, Mutex, RwLock};

use serde::Serialize;
use serde_json::Value;
use tauri::{Emitter, Manager, State};

use backend_shared::process_mining::bindings::RegistryItemKind;
use backend_shared::{Backend, ExtendedAppState};
use ocpq_native::hpc_backend::{
    get_job_status, job_is_over, login_on_hpc, start_port_forwarding, submit_hpc_job, Client,
    ConnectionConfig, JobForwards, JobStatus, OCPQJobOptions,
};

// Force-link app-bindings so its registry entries survive an optimising build: `extern crate`
// alone can get dropped, so `#[used]` pins a real symbol reference.
extern crate app_bindings;
#[used]
static _FORCE_LINK_APP_BINDINGS: fn() -> String = app_bindings::app_ping;

struct TauriBackend {
    state: ExtendedAppState,
    app: tauri::AppHandle,
    hpc_client: RwLock<Option<Client>>,
    hpc_jobs: JobForwards,
    /// Paths the app was launched with via an OS file association or CLI args. Drained on first
    /// read, so a relaunch does not re-import them.
    initial_files: Mutex<Option<Vec<String>>>,
}

impl Backend for TauriBackend {
    fn get_state(&self) -> &ExtendedAppState {
        &self.state
    }
    fn emit<S: Serialize + Clone>(&self, name: &str, data: S) -> Result<(), String> {
        self.app.emit(name, data).map_err(|e| e.to_string())
    }
}

type Ctx<'a> = State<'a, Arc<TauriBackend>>;

/// The one command every binding is reached through; runs on the blocking pool since bindings do
/// synchronous CPU work and would otherwise stall the async runtime.
#[tauri::command(async)]
async fn execute_binding(
    backend: Ctx<'_>,
    id: String,
    args: Value,
    output_name: Option<String>,
) -> Result<Vec<u8>, String> {
    let backend = Arc::clone(&backend);
    tauri::async_runtime::spawn_blocking(move || {
        backend_shared::execute_binding(&*backend, &id, &args, output_name.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn list_functions() -> Vec<backend_shared::process_mining::bindings::BindingMeta> {
    backend_shared::list_functions()
}

#[tauri::command]
fn get_all_item_kinds() -> Result<Vec<backend_shared::RegistryItemInfo>, String> {
    backend_shared::get_all_item_kinds()
}

#[tauri::command]
fn get_all_objects_with_type(backend: Ctx<'_>) -> Result<Vec<backend_shared::ObjectInfo>, String> {
    backend_shared::get_objects_with_type(&**backend)
}

#[tauri::command]
fn set_object_label(backend: Ctx<'_>, id: String, label: Option<String>) -> Result<(), String> {
    backend_shared::set_object_label(&**backend, id, label)
}

#[tauri::command]
fn rename_object(backend: Ctx<'_>, from: String, to: String) -> Result<(), String> {
    backend_shared::rename_object(&**backend, &from, &to)
}

#[tauri::command]
fn unload_object(backend: Ctx<'_>, name: String) -> Result<(), String> {
    backend_shared::unload_object(&**backend, name)
}

#[tauri::command(async)]
async fn load_item_bytes(
    backend: Ctx<'_>,
    id: String,
    kind: String,
    data: Vec<u8>,
    format: String,
) -> Result<(), String> {
    let kind = RegistryItemKind::from_str(&kind).map_err(|_| format!("Unknown item kind: {kind}"))?;
    let backend = Arc::clone(&backend);
    tauri::async_runtime::spawn_blocking(move || {
        backend_shared::load_item_bytes(&*backend, id, &kind, &data, &format)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Desktop-only: read straight from a path, keeping a large log out of the IPC boundary.
#[tauri::command(async)]
async fn load_item_path(
    backend: Ctx<'_>,
    id: String,
    kind: String,
    path: String,
) -> Result<(), String> {
    let kind = RegistryItemKind::from_str(&kind).map_err(|_| format!("Unknown item kind: {kind}"))?;
    let backend = Arc::clone(&backend);
    tauri::async_runtime::spawn_blocking(move || {
        backend_shared::load_item_path(&*backend, id, &kind, &path)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Base64-encodes an export so it crosses IPC as one string; Tauri's default `Vec<u8>` -> JSON
/// array encoding balloons a real log to hundreds of megabytes and fails outright.
fn to_base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b1 = chunk.get(1).copied().unwrap_or(0);
        let b2 = chunk.get(2).copied().unwrap_or(0);
        let n = (u32::from(chunk[0]) << 16) | (u32::from(b1) << 8) | u32::from(b2);
        let sextet = |shift: u32| ALPHABET[(n >> shift & 63) as usize] as char;
        out.push(sextet(18));
        out.push(sextet(12));
        out.push(if chunk.len() > 1 { sextet(6) } else { '=' });
        out.push(if chunk.len() > 2 { sextet(0) } else { '=' });
    }
    out
}

#[tauri::command(async)]
async fn export_object(backend: Ctx<'_>, name: String, format: String) -> Result<String, String> {
    let backend = Arc::clone(&backend);
    tauri::async_runtime::spawn_blocking(move || {
        backend_shared::export_object(&*backend, &name, &format).map(|b| to_base64(&b))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Exports the situations of one evaluation node's binding table to CSV/XLSX.
#[tauri::command(async)]
async fn export_bindings_table(
    backend: Ctx<'_>,
    ocel_id: String,
    eval_id: String,
    node_index: usize,
    options: ocpq_core::table_export::TableExportOptions,
) -> Result<String, String> {
    let backend = Arc::clone(&backend);
    tauri::async_runtime::spawn_blocking(move || {
        backend_shared::export_bindings_table_file(&*backend, &ocel_id, &eval_id, node_index, &options)
            .map(|b| to_base64(&b))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Desktop-only: write the export straight to `path`, for the same reason `load_item_path` exists.
#[tauri::command(async)]
async fn export_object_to_path(
    backend: Ctx<'_>,
    name: String,
    format: String,
    path: String,
) -> Result<(), String> {
    let backend = Arc::clone(&backend);
    tauri::async_runtime::spawn_blocking(move || {
        backend_shared::export_object_to_path(&*backend, &name, &format, &path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn load_artifact_bytes(
    backend: Ctx<'_>,
    id: String,
    kind: String,
    data: Vec<u8>,
    format: String,
) -> Result<(), String> {
    backend_shared::load_artifact_bytes(&**backend, id, &kind, &data, &format)
}

#[tauri::command]
fn load_artifact_path(
    backend: Ctx<'_>,
    id: String,
    kind: String,
    path: String,
) -> Result<(), String> {
    backend_shared::load_artifact_path(&**backend, id, &kind, &path)
}

#[tauri::command]
fn list_artifacts(backend: Ctx<'_>) -> Result<Vec<backend_shared::ObjectInfo>, String> {
    backend_shared::list_artifacts(&**backend)
}

#[tauri::command]
fn get_artifact(backend: Ctx<'_>, id: String) -> Result<Value, String> {
    backend_shared::get_artifact(&**backend, &id)
}

#[tauri::command]
fn unload_artifact(backend: Ctx<'_>, id: String) -> Result<(), String> {
    backend_shared::unload_artifact(&**backend, id)
}

#[tauri::command]
fn export_artifact(backend: Ctx<'_>, id: String, format: String) -> Result<String, String> {
    backend_shared::export_artifact(&**backend, &id, &format).map(|b| to_base64(&b))
}

/// Paths the app was launched with via an OS file association ("Open with OCPQ") or CLI args.
#[tauri::command]
fn get_initial_files(backend: Ctx<'_>) -> Result<Vec<String>, String> {
    Ok(backend
        .initial_files
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .unwrap_or_default())
}

#[tauri::command(async)]
async fn hpc_login(backend: Ctx<'_>, config: ConnectionConfig) -> Result<(), String> {
    let client = login_on_hpc(&config).await.map_err(|e| e.to_string())?;
    *backend.hpc_client.write().map_err(|e| e.to_string())? = Some(client);
    Ok(())
}

#[tauri::command(async)]
async fn hpc_start(backend: Ctx<'_>, options: OCPQJobOptions) -> Result<String, String> {
    let client = backend
        .hpc_client
        .read()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "Not logged in to HPC".to_string())?;
    let port: u16 = options.port.parse().map_err(|e: std::num::ParseIntError| e.to_string())?;
    let client = Arc::new(client);
    let (_folder_id, job_id) = submit_hpc_job(Arc::clone(&client), options)
        .await
        .map_err(|e| e.to_string())?;
    let forward = start_port_forwarding(
        client,
        &format!("127.0.0.1:{port}"),
        &format!("127.0.0.1:{port}"),
    )
    .await
    .map_err(|e| e.to_string())?;
    backend.hpc_jobs.insert(job_id.clone(), port, forward);
    Ok(job_id)
}

#[tauri::command(async)]
async fn hpc_job_status(backend: Ctx<'_>, job_id: String) -> Result<JobStatus, String> {
    let client = backend
        .hpc_client
        .read()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "Not logged in to HPC".to_string())?;
    let status = get_job_status(Arc::new(client), job_id.clone())
        .await
        .map_err(|e| e.to_string())?;
    // Polling this is the only signal either target gets that a job is done, so it is where the
    // forward is closed; otherwise the task keeps holding its local port for the process lifetime.
    if job_is_over(&status) {
        backend.hpc_jobs.release(&job_id);
    }
    Ok(status)
}

#[cfg(test)]
mod base64_tests {
    use super::to_base64;

    /// RFC 4648 section 10, which is what the webview's `atob` implements.
    #[test]
    fn matches_the_reference_vectors_at_every_padding_length() {
        for (input, expected) in [
            ("", ""),
            ("f", "Zg=="),
            ("fo", "Zm8="),
            ("foo", "Zm9v"),
            ("foob", "Zm9vYg=="),
            ("fooba", "Zm9vYmE="),
            ("foobar", "Zm9vYmFy"),
        ] {
            assert_eq!(to_base64(input.as_bytes()), expected, "input {input:?}");
        }
    }

    /// An export is arbitrary bytes -- gzip and sqlite are not text -- so the high bits and the
    /// last two alphabet entries have to survive.
    #[test]
    fn encodes_bytes_that_are_not_valid_utf8() {
        assert_eq!(to_base64(&[0xff, 0xfe, 0xfd]), "//79");
        assert_eq!(to_base64(&[0x00]), "AA==");
        assert_eq!(to_base64(&[0x00, 0xff]), "AP8=");
        assert_eq!(to_base64(&[0xfb, 0xef, 0xbe]), "++++");
    }

    #[test]
    fn output_is_four_characters_per_three_input_bytes() {
        for len in 0..64usize {
            let encoded = to_base64(&vec![0xa5; len]);
            assert_eq!(encoded.len(), len.div_ceil(3) * 4, "length {len}");
        }
    }
}

fn main() {
    // The wdio plugins install a `log` logger of their own, so they have to come after
    // `tauri_plugin_log`, which panics if anything claimed the global logger first.
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init());
    #[cfg(feature = "wdio")]
    {
        builder = builder
            .plugin(tauri_plugin_wdio::init())
            .plugin(tauri_plugin_wdio_webdriver::init());
    }
    builder
        .setup(
            #[allow(unused_variables)]
            // `initial_files` is only populated on the platforms that pass them as CLI args.
            |app| {
                let mut files: Vec<String> = Vec::new();
                #[cfg(any(windows, target_os = "linux"))]
                {
                    // NOTICE: `args` may include a URL protocol (`your-app-protocol://`) or flags
                    // (`--`) if the app supports them; paths may also arrive as `file://`.
                    for maybe_file in std::env::args().skip(1) {
                        if maybe_file.starts_with('-') {
                            continue;
                        }
                        match url::Url::parse(&maybe_file).ok().and_then(|u| u.to_file_path().ok()) {
                            Some(path) => files.push(path.to_string_lossy().to_string()),
                            None => files.push(maybe_file),
                        }
                    }
                }
                app.manage(Arc::new(TauriBackend {
                    state: ExtendedAppState::default(),
                    app: app.handle().clone(),
                    hpc_client: RwLock::new(None),
                    hpc_jobs: JobForwards::default(),
                    initial_files: Mutex::new(Some(files)),
                }));
                Ok(())
            },
        )
        .invoke_handler(tauri::generate_handler![
            execute_binding,
            list_functions,
            get_all_item_kinds,
            get_all_objects_with_type,
            set_object_label,
            rename_object,
            unload_object,
            load_item_bytes,
            load_item_path,
            export_object,
            export_object_to_path,
            export_bindings_table,
            load_artifact_bytes,
            load_artifact_path,
            list_artifacts,
            get_artifact,
            unload_artifact,
            export_artifact,
            get_initial_files,
            hpc_login,
            hpc_start,
            hpc_job_status,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(
            #[allow(unused_variables)]
            |app, event| {
                #[cfg(any(target_os = "macos", target_os = "ios"))]
                if let tauri::RunEvent::Opened { urls } = event {
                    let backend = app.state::<Arc<TauriBackend>>();
                    let files: Vec<String> = urls
                        .into_iter()
                        .filter_map(|u| u.to_file_path().ok())
                        .map(|p| p.to_string_lossy().to_string())
                        .collect();
                    if let Ok(mut guard) = backend.initial_files.lock() {
                        guard.get_or_insert_with(Vec::new).extend(files);
                    }
                    let _ = backend.emit("initial-files-changed", ());
                }
            },
        );
}
