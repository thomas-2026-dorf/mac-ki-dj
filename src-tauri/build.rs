fn main() {
    tauri_build::build();

    // Link the Superpowered static library (macOS universal binary)
    println!("cargo:rustc-link-search=native=vendor/superpowered/Superpowered/libSuperpoweredAudio.xcframework/macos-arm64_x86_64");
    println!("cargo:rustc-link-lib=static=SuperpoweredAudioOSX");

    // macOS system frameworks required by Superpowered and CoreAudio output
    println!("cargo:rustc-link-lib=framework=AudioToolbox");
    println!("cargo:rustc-link-lib=framework=AVFoundation");
    println!("cargo:rustc-link-lib=framework=CoreAudio");
    println!("cargo:rustc-link-lib=framework=CoreMedia");

    cc::Build::new()
        .cpp(true)
        .file("superpowered_test/superpowered_test.cpp")
        .include("vendor/superpowered/Superpowered")
        .flag_if_supported("-std=c++17")
        .compile("superpowered_test");

    cc::Build::new()
        .cpp(true)
        .file("superpowered_engine/tkdj_superpowered_engine.cpp")
        .include("vendor/superpowered/Superpowered")
        .flag_if_supported("-std=c++17")
        .compile("superpowered_engine");
}
