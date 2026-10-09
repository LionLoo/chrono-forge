use std::{
    ffi::OsStr,
    path::{Path, PathBuf},
};

use serde::Serialize;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

mod persistence;

const PROFILE_ENVIRONMENT_VARIABLE: &str = "CHRONO_FORGE_PROFILE";
const PERSISTENCE_BROKER_LABEL: &str = "persistence-broker";

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
            WebviewWindowBuilder::new(
                app,
                PERSISTENCE_BROKER_LABEL,
                WebviewUrl::App("index.html?persistence-broker=1".into()),
            )
            .title("Chrono Forge persistence validator")
            .visible(false)
            .skip_taskbar(true)
            .build()?;
            // Keep the player-facing window last so desktop automation and accessibility tools
            // attach to the game rather than the deliberately hidden validation compartment.
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
            if window.label() == "main"
                && matches!(
                    event,
                    tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
                )
            {
                window.app_handle().exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
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

    use super::{AppInfo, app_info, persistence_directory};

    #[test]
    fn app_info_reports_local_first_identity() {
        assert_eq!(
            app_info(),
            AppInfo {
                name: "Chrono Forge",
                version: "0.1.0",
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
}
