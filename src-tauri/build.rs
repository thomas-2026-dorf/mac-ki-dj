fn main() {
    tauri_build::build();

    cc::Build::new()
        .cpp(true)
        .file("superpowered_test/superpowered_test.cpp")
        .include("vendor/superpowered/Superpowered")
        .flag_if_supported("-std=c++17")
        .compile("superpowered_test");
}
