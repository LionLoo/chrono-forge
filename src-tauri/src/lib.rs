use std::{
    ffi::OsStr,
    path::{Path, PathBuf},
};

use serde::Serialize;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

mod persistence;

const PROFILE_ENVIRONMENT_VARIABLE: &str = "CHRONO_FORGE_PROFILE";
const PERSISTENCE_BROKER_LABEL: &str = "persistence-broker";
const PERSISTENCE_BROKER_RETIRED_EVENT: &str = "chrono-forge://persistence-retired";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistenceBrokerRetiredEnvelope {
    request_id: String,
    value: (),
}

fn create_persistence_broker<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    if app.get_webview_window(PERSISTENCE_BROKER_LABEL).is_some() {
        return Ok(());
    }
    WebviewWindowBuilder::new(
        app,
        PERSISTENCE_BROKER_LABEL,
        WebviewUrl::App("index.html?persistence-broker=1".into()),
    )
    .title("Chrono Forge persistence validator")
    .visible(false)
    .skip_taskbar(true)
    .build()
    .map(|_| ())
    .map_err(|error| error.to_string())
}

fn validate_persistence_broker_requester(label: &str) -> Result<(), String> {
    if label == "main" {
        Ok(())
    } else {
        Err("only the player window may request the isolated persistence validator".to_owned())
    }
}

fn validate_persistence_broker_retirement_requester(label: &str) -> Result<(), String> {
    if label == PERSISTENCE_BROKER_LABEL {
        Ok(())
    } else {
        Err("only the isolated persistence validator may retire itself".to_owned())
    }
}

fn validate_persistence_broker_request_id(request_id: &str) -> Result<(), String> {
    if !request_id.is_empty()
        && request_id.len() <= 64
        && request_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        Ok(())
    } else {
        Err("persistence validator request IDs must be bounded UUID-like text".to_owned())
    }
}

#[tauri::command]
async fn ensure_persistence_broker(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<(), String> {
    validate_persistence_broker_requester(window.label())?;
    create_persistence_broker(&app)
}

#[tauri::command]
async fn retire_persistence_broker(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    request_id: String,
) -> Result<(), String> {
    validate_persistence_broker_retirement_requester(window.label())?;
    validate_persistence_broker_request_id(&request_id)?;
    window.destroy().map_err(|error| error.to_string())?;
    app.emit_to(
        "main",
        PERSISTENCE_BROKER_RETIRED_EVENT,
        PersistenceBrokerRetiredEnvelope {
            request_id,
            value: (),
        },
    )
    .map_err(|error| error.to_string())
}

fn persistence_directory(base: &Path, profile: Option<&OsStr>) -> Result<PathBuf, String> {
    let Some(profile) = profile else {
        return Ok(base.to_path_buf());
    };
    let profile = profile
        .to_str()
        .ok_or_else(|| "Chrono Forge profile names must be valid UTF-8.".to_owned())?;
    if profile.is_empty()
        || profile.len() > 64
        || !profile
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(
            "Chrono Forge profile names must contain 1-64 ASCII letters, digits, hyphens, or underscores."
                .to_owned(),
        );
    }
    Ok(base.join("profiles").join(profile))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WindowLifecycleEvent {
    CloseRequested,
    Destroyed,
    Other,
}

impl From<&tauri::WindowEvent> for WindowLifecycleEvent {
    fn from(event: &tauri::WindowEvent) -> Self {
        match event {
            tauri::WindowEvent::CloseRequested { .. } => Self::CloseRequested,
            tauri::WindowEvent::Destroyed => Self::Destroyed,
            _ => Self::Other,
        }
    }
}

fn should_exit_after_window_event(window_label: &str, event: WindowLifecycleEvent) -> bool {
    window_label == "main"
        && matches!(
            event,
            WindowLifecycleEvent::CloseRequested | WindowLifecycleEvent::Destroyed
        )
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    name: &'static str,
    version: &'static str,
    local_first: bool,
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        name: "Chrono Forge",
        version: env!("CARGO_PKG_VERSION"),
        local_first: true,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_notification::init());

    #[cfg(feature = "desktop-e2e")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .setup(|app| {
            let base_app_local_data = app.path().app_local_data_dir()?;
            let profile = std::env::var_os(PROFILE_ENVIRONMENT_VARIABLE);
            let app_local_data = persistence_directory(&base_app_local_data, profile.as_deref())
                .map_err(|message| {
                    std::io::Error::new(std::io::ErrorKind::InvalidInput, message)
                })?;
            app.manage(persistence::PersistenceState::open_app_local_data(
                &app_local_data,
            )?);
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Chrono Forge")
                .inner_size(1440.0, 900.0)
                .min_inner_size(1024.0, 720.0)
                .center()
                .resizable(true)
                .build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if should_exit_after_window_event(window.label(), event.into()) {
                window.app_handle().exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            ensure_persistence_broker,
            retire_persistence_broker,
            persistence::list_save_slots,
            persistence::load_save_slot_candidates,
            persistence::load_save_slot_fallback_candidates,
            persistence::commit_save_slot,
            persistence::commit_focus_checkpoint,
            persistence::confirm_semantically_valid_save_generation,
            persistence::delete_save_slot,
            persistence::export_save_generation,
            persistence::import_save_slot,
            persistence::record_focus_session,
            persistence::list_focus_sessions,
            persistence::load_settings,
            persistence::save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Chrono Forge");
}

#[cfg(test)]
mod tests {
    use std::{ffi::OsStr, path::Path};

    use super::{
        AppInfo, WindowLifecycleEvent, app_info, persistence_directory,
        should_exit_after_window_event, validate_persistence_broker_request_id,
        validate_persistence_broker_requester, validate_persistence_broker_retirement_requester,
    };

    #[test]
    fn app_info_reports_local_first_identity() {
        assert_eq!(
            app_info(),
            AppInfo {
                name: "Chrono Forge",
                version: "1.0.0",
                local_first: true,
            }
        );
    }

    #[test]
    fn persistence_directory_defaults_to_the_app_local_data_root() {
        let base = Path::new("root").join("com.lionloo.chronoforge");

        assert_eq!(persistence_directory(&base, None), Ok(base));
    }

    #[test]
    fn persistence_directory_scopes_a_valid_profile_below_the_app_root() {
        let base = Path::new("root").join("com.lionloo.chronoforge");

        assert_eq!(
            persistence_directory(&base, Some(OsStr::new("installed-review_759026b"))),
            Ok(base.join("profiles").join("installed-review_759026b")),
        );
    }

    #[test]
    fn persistence_directory_rejects_paths_and_unbounded_profile_names() {
        let base = Path::new("root").join("com.lionloo.chronoforge");

        for invalid in [
            "",
            ".",
            "..",
            "review/profile",
            "review\\profile",
            "review profile",
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ] {
            assert!(
                persistence_directory(&base, Some(OsStr::new(invalid))).is_err(),
                "profile {invalid:?} must be rejected",
            );
        }
    }

    #[test]
    fn only_player_window_close_or_destruction_exits_the_process() {
        assert!(should_exit_after_window_event(
            "main",
            WindowLifecycleEvent::CloseRequested,
        ));
        assert!(should_exit_after_window_event(
            "main",
            WindowLifecycleEvent::Destroyed,
        ));
        assert!(!should_exit_after_window_event(
            "persistence-broker",
            WindowLifecycleEvent::CloseRequested,
        ));
        assert!(!should_exit_after_window_event(
            "persistence-broker",
            WindowLifecycleEvent::Destroyed,
        ));
        assert!(!should_exit_after_window_event(
            "main",
            WindowLifecycleEvent::Other,
        ));
    }

    #[test]
    fn only_player_window_can_request_the_isolated_persistence_validator() {
        assert!(validate_persistence_broker_requester("main").is_ok());
        assert!(validate_persistence_broker_requester("persistence-broker").is_err());
        assert!(validate_persistence_broker_requester("other").is_err());
    }

    #[test]
    fn only_isolated_validator_can_retire_its_window() {
        assert!(validate_persistence_broker_retirement_requester("persistence-broker").is_ok());
        assert!(validate_persistence_broker_retirement_requester("main").is_err());
        assert!(validate_persistence_broker_retirement_requester("other").is_err());
    }

    #[test]
    fn persistence_validator_request_ids_are_bounded_uuid_like_text() {
        assert!(
            validate_persistence_broker_request_id("123e4567-e89b-12d3-a456-426614174000").is_ok()
        );
        for invalid in ["", "request id", "../request", &"a".repeat(65)] {
            assert!(validate_persistence_broker_request_id(invalid).is_err());
        }
    }

    #[test]
    fn tauri_window_events_map_to_the_lifecycle_boundary() {
        assert_eq!(
            WindowLifecycleEvent::from(&tauri::WindowEvent::Destroyed),
            WindowLifecycleEvent::Destroyed,
        );
        assert_eq!(
            WindowLifecycleEvent::from(&tauri::WindowEvent::Focused(false)),
            WindowLifecycleEvent::Other,
        );
    }
}
