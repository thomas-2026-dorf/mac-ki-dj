// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use serde::Serialize;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[derive(Serialize)]
struct AudioAnalysisBackendResult {
    bpm: f64,
    beat_interval_seconds: f64,
    beats: Vec<f64>,
    grid_start_seconds: f64,
    file_size_bytes: u64,
    sample_count: u64,
}

#[tauri::command]
fn analyze_audio_file(path: String) -> Result<AudioAnalysisBackendResult, String> {
    println!("Analyze audio file requested: {}", path);

    use std::fs::File;
    use symphonia::core::audio::{AudioBufferRef, Signal};
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::probe::Hint;
    use symphonia::default::{get_codecs, get_probe};

    let file = File::open(&path)
        .map_err(|err| format!("Datei konnte nicht geöffnet werden: {}", err))?;

    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    hint.with_extension("mp3");

    let probed = get_probe()
        .format(&hint, mss, &Default::default(), &Default::default())
        .map_err(|err| format!("Format konnte nicht erkannt werden: {}", err))?;

    let mut format = probed.format;

    let track = format
        .default_track()
        .ok_or("Kein Audio-Track gefunden")?;

    let mut decoder = get_codecs()
        .make(&track.codec_params, &Default::default())
        .map_err(|err| format!("Decoder Fehler: {}", err))?;

    let mut sample_count: u64 = 0;
    let mut packet_count: u64 = 0;

    loop {
        if packet_count >= 200 {
            break;
        }
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(_) => break,
        };

        packet_count += 1;

        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(_) => continue,
        };

        match decoded {
            AudioBufferRef::F32(buf) => sample_count += buf.frames() as u64,
            AudioBufferRef::S16(buf) => sample_count += buf.frames() as u64,
            AudioBufferRef::U8(buf) => sample_count += buf.frames() as u64,
            _ => {}
        }
    }

    println!("Sample Count: {}", sample_count);

    let bpm = 120.0;
    let grid_start_seconds = 0.5;
    let beat_interval_seconds = 60.0 / bpm;

    let beats: Vec<f64> = (0..200)
        .map(|index| grid_start_seconds + (index as f64 * beat_interval_seconds))
        .collect();

    Ok(AudioAnalysisBackendResult {
        bpm,
        beat_interval_seconds,
        beats,
        grid_start_seconds,
        file_size_bytes: std::fs::metadata(&path)
            .map(|m| m.len())
            .unwrap_or(0),
        sample_count,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init()) // 🔥 MUSS DRIN SEIN
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![greet, analyze_audio_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
