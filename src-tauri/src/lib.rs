use serde::Serialize;

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
        .invoke_handler(tauri::generate_handler![app_info])
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
