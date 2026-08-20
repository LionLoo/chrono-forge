use serde::Serialize;
use tauri::Manager;

mod persistence;

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
    tauri::Builder::default()
        .setup(|app| {
            let app_local_data = app.path().app_local_data_dir()?;
            app.manage(persistence::PersistenceState::open_app_local_data(
                &app_local_data,
            )?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            persistence::list_save_slots,
            persistence::load_save_slot_candidates,
            persistence::commit_save_slot,
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
    use super::{AppInfo, app_info};

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
}
