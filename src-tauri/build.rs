fn main() {
    println!("cargo:rerun-if-changed=capabilities");

    #[cfg(feature = "desktop-e2e")]
    let capability_pattern = "./capabilities/**/*.json";
    #[cfg(not(feature = "desktop-e2e"))]
    let capability_pattern = "./capabilities/default.json";

    tauri_build::try_build(
        tauri_build::Attributes::new().capabilities_path_pattern(capability_pattern),
    )
    .expect("failed to build Tauri application metadata");
}
