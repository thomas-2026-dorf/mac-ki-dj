use stratum_dsp as _; // nur Test: Library laden
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

#[derive(Serialize)]
struct Mp3TagInfo {
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    genre: Option<String>,
    year: Option<u32>,
    comment: Option<String>,
    duration_seconds: Option<u64>,
}

#[tauri::command]
fn analyze_audio_file(path: String) -> Result<AudioAnalysisBackendResult, String> {
    println!("Analyze audio file requested: {}", path);

    use std::fs::File;
    use symphonia::core::audio::SampleBuffer;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::probe::Hint;
    use symphonia::default::{get_codecs, get_probe};

    let file =
        File::open(&path).map_err(|err| format!("Datei konnte nicht geöffnet werden: {}", err))?;

    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    hint.with_extension("mp3");

    let probed = get_probe()
        .format(&hint, mss, &Default::default(), &Default::default())
        .map_err(|err| format!("Format konnte nicht erkannt werden: {}", err))?;

    let mut format = probed.format;

    let track = format.default_track().ok_or("Kein Audio-Track gefunden")?;

    let sample_rate = track.codec_params.sample_rate.unwrap_or(44100) as f64;

    let mut decoder = get_codecs()
        .make(&track.codec_params, &Default::default())
        .map_err(|err| format!("Decoder Fehler: {}", err))?;

    let mut aubio_tempo = {
        use aubio::{OnsetMode, Tempo};

        Tempo::new(OnsetMode::default(), 1024, 512, sample_rate as u32)
            .map_err(|err| format!("Aubio Tempo Fehler: {:?}", err))?
            .with_silence(-70.0)
            .with_threshold(0.3)
    };

    let aubio_hop_size = aubio_tempo.get_hop();
    let mut aubio_input: Vec<f32> = Vec::with_capacity(aubio_hop_size);
    let mut aubio_beats: Vec<f64> = Vec::new();

    let window_size = (sample_rate * 0.05) as u64;
    let mut sample_count: u64 = 0;
    let mut packet_count: u64 = 0;
    let mut current_sum = 0.0_f64;
    let mut current_count: u64 = 0;
    let mut energies: Vec<f64> = Vec::new();
    let mut stratum_samples: Vec<f32> = Vec::new();

    loop {
        if packet_count >= 4000 {
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

        let spec = *decoded.spec();
        let channels = spec.channels.count().max(1);
        let mut sample_buffer = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
        sample_buffer.copy_interleaved_ref(decoded);

        for frame in sample_buffer.samples().chunks(channels) {
            let mono = frame.iter().map(|value| *value as f64).sum::<f64>() / channels as f64;

            current_sum += mono.abs();
            current_count += 1;
            sample_count += 1;

            stratum_samples.push(mono as f32);
            aubio_input.push(mono as f32);
            if aubio_input.len() == aubio_hop_size {
                match aubio_tempo.do_result(&aubio_input[..]) {
                    Ok(value) => {
                        if value > 0.0 {
                            aubio_beats.push(aubio_tempo.get_last_s() as f64);
                        }
                    }
                    Err(err) => {
                        println!("Aubio Analyse Warnung: {:?}", err);
                    }
                }

                aubio_input.clear();
            }

            if current_count >= window_size {
                energies.push(current_sum / current_count as f64);
                current_sum = 0.0;
                current_count = 0;
            }
        }
    }

    if current_count > 0 {
        energies.push(current_sum / current_count as f64);
    }

    let average_energy = if energies.is_empty() {
        0.0
    } else {
        energies.iter().sum::<f64>() / energies.len() as f64
    };

    let mut peak_times: Vec<f64> = Vec::new();
    let min_peak_distance_seconds = 0.28;
    let window_seconds = 0.05;

    for index in 1..energies.len().saturating_sub(1) {
        let energy = energies[index];
        let is_peak = energy > energies[index - 1]
            && energy > energies[index + 1]
            && energy > average_energy * 1.25;

        if is_peak {
            let time = index as f64 * window_seconds;

            if peak_times
                .last()
                .map(|last| time - last >= min_peak_distance_seconds)
                .unwrap_or(true)
            {
                peak_times.push(time);
            }
        }
    }

    let mut intervals: Vec<f64> = peak_times
        .windows(2)
        .map(|pair| pair[1] - pair[0])
        .filter(|interval| *interval >= 0.30 && *interval <= 1.00)
        .collect();

    intervals.sort_by(|a, b| a.partial_cmp(b).unwrap());

    let median_interval = if intervals.is_empty() {
        0.5
    } else {
        intervals[intervals.len() / 2]
    };

    let mut bpm = 60.0 / median_interval;

    // Normalize BPM into DJ range
    while bpm < 80.0 {
        bpm *= 2.0;
    }

    while bpm > 160.0 {
        bpm /= 2.0;
    }

    // Snap to typical DJ BPM ranges (reduces noise)
    let rounded = (bpm * 2.0).round() / 2.0;

    // small correction for common overshoot
    let bpm = if rounded > 132.0 && rounded < 138.0 {
        rounded - 4.0
    } else {
        rounded
    };

    let aubio_bpm = aubio_tempo.get_bpm() as f64;
    let use_aubio = aubio_bpm > 0.0 && aubio_beats.len() >= 4;

    let bpm = if use_aubio {
        (aubio_bpm * 10.0).round() / 10.0
    } else {
        bpm
    };

    let beat_interval_seconds = 60.0 / bpm;

    let grid_start_seconds = if use_aubio {
        aubio_beats.first().copied().unwrap_or(0.5)
    } else {
        peak_times.first().copied().unwrap_or(0.5)
    };

    let beats: Vec<f64> = if use_aubio {
        aubio_beats.iter().take(200).copied().collect()
    } else {
        (0..200)
            .map(|index| grid_start_seconds + (index as f64 * beat_interval_seconds))
            .collect()
    };

    // === STRATUM DSP TEST START ===
    match stratum_dsp::analyze_audio(
        &stratum_samples,
        sample_rate as u32,
        stratum_dsp::AnalysisConfig::default(),
    ) {
        Ok(result) => {
            println!(
                "Stratum Analyse: bpm={}, bpm_confidence={}, key={}, camelot={}, key_confidence={}, beats={}, downbeats={}",
                result.bpm,
                result.bpm_confidence,
                result.key.name(),
                result.key.numerical(),
                result.key_confidence,
                result.beat_grid.beats.len(),
                result.beat_grid.downbeats.len()
            );

            let beat_preview: Vec<f32> = result.beat_grid.beats.iter().take(10).copied().collect();
            let downbeat_preview: Vec<f32> = result
                .beat_grid
                .downbeats
                .iter()
                .take(10)
                .copied()
                .collect();

            println!("Stratum Beats Preview: {:?}", beat_preview);
            println!("Stratum Downbeats Preview: {:?}", downbeat_preview);
        }
        Err(err) => {
            println!("Stratum Analyse Fehler: {:?}", err);
        }
    }
    // === STRATUM DSP TEST END ===

    println!(
        "Rust Analyse: samples={}, peaks={}, bpm={}",
        sample_count,
        peak_times.len(),
        bpm
    );

    println!(
        "Aubio Analyse: beats={}, bpm={}, confidence={}",
        aubio_beats.len(),
        aubio_tempo.get_bpm(),
        aubio_tempo.get_confidence()
    );

    if !aubio_beats.is_empty() {
        let preview: Vec<f64> = aubio_beats.iter().take(10).copied().collect();
        println!("Aubio Beats Preview: {:?}", preview);
    }

    let audio_path = std::path::Path::new(&path);
    let file_name = audio_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("unknown")
        .to_string();

    if let Some(parent_dir) = audio_path.parent() {
        let analysis_json_path = parent_dir.join("tkdj-analysis.json");

        let mut root: serde_json::Value = if analysis_json_path.exists() {
            let existing =
                std::fs::read_to_string(&analysis_json_path).unwrap_or_else(|_| "{}".to_string());

            serde_json::from_str(&existing).unwrap_or_else(|_| serde_json::json!({}))
        } else {
            serde_json::json!({})
        };

        if root.get("tracks").is_none() {
            root["tracks"] = serde_json::json!({});
        }

        root["tracks"][file_name.clone()] = serde_json::json!({
            "fileName": file_name,
            "analysisVersion": "aubio-v1",
            "analyzedAt": chrono_like_now(),
            "bpm": bpm,
            "beatIntervalSeconds": beat_interval_seconds,
            "gridStartSeconds": grid_start_seconds,
            "beats": beats.clone(),
            "fileSizeBytes": std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0),
            "sampleCount": sample_count
        });

        let pretty = serde_json::to_string_pretty(&root)
            .map_err(|err| format!("Analyse JSON konnte nicht erstellt werden: {}", err))?;

        std::fs::write(&analysis_json_path, pretty)
            .map_err(|err| format!("Analyse JSON konnte nicht gespeichert werden: {}", err))?;

        println!("Analyse JSON gespeichert: {:?}", analysis_json_path);
    }

    Ok(AudioAnalysisBackendResult {
        bpm,
        beat_interval_seconds,
        beats,
        grid_start_seconds,
        file_size_bytes: std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0),
        sample_count,
    })
}

#[tauri::command]
fn read_mp3_tags(path: String) -> Result<Mp3TagInfo, String> {
    use lofty::file::{AudioFile, TaggedFileExt};
    use lofty::probe::Probe;
    use lofty::tag::{Accessor, ItemKey};

    let tagged_file = Probe::open(&path)
        .map_err(|err| format!("MP3 Tag Datei konnte nicht geöffnet werden: {}", err))?
        .read()
        .map_err(|err| format!("MP3 Tags konnten nicht gelesen werden: {}", err))?;

    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag())
        .ok_or("Keine MP3 Tags gefunden")?;

    let comment = tag
        .get_string(&ItemKey::Comment)
        .map(|value| value.to_string());

    let artist = tag
        .get_string(&ItemKey::TrackArtist)
        .map(|value| value.to_string())
        .or_else(|| tag.artist().map(|value| value.to_string()));

    Ok(Mp3TagInfo {
        title: tag.title().map(|value| value.to_string()),
        artist,
        album: tag.album().map(|value| value.to_string()),
        genre: tag.genre().map(|value| value.to_string()),
        year: tag.year(),
        comment,
        duration_seconds: Some(tagged_file.properties().duration().as_secs()),
    })
}

fn chrono_like_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);

    format!("unix-{}", seconds)
}



#[tauri::command]
fn convert_audio_to_wav(
    input_path: String,
    output_path: String,
) -> Result<String, String> {
    if let Some(parent) = std::path::Path::new(&output_path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Fehler beim Erstellen des Ausgabeordners: {}", e))?;
    }

    let output = Command::new("ffmpeg")
        .arg("-y")
        .arg("-i")
        .arg(&input_path)
        .arg("-ar")
        .arg("44100")
        .arg("-ac")
        .arg("2")
        .arg(&output_path)
        .output()
        .map_err(|e| format!("Fehler beim Starten von ffmpeg: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "ffmpeg Fehler: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(format!("WAV fertig: {}", output_path))
}



#[tauri::command]
fn tkdj_file_exists(path: String) -> Result<bool, String> {
    Ok(std::path::Path::new(&path).exists())
}

#[tauri::command]
fn tkdj_read_binary_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("Datei konnte nicht gelesen werden: {}", e))
}

#[tauri::command]
fn tkdj_read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Textdatei konnte nicht gelesen werden: {}", e))
}

#[tauri::command]
fn tkdj_write_text_file(path: String, content: String) -> Result<String, String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Ordner konnte nicht erstellt werden: {}", e))?;
    }

    std::fs::write(&path, content)
        .map_err(|e| format!("Textdatei konnte nicht geschrieben werden: {}", e))?;

    Ok(path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init()) // 🔥 MUSS DRIN SEIN
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            analyze_audio_file,
            read_mp3_tags,
            test_rubberband_stretch,
            convert_audio_to_wav,
            tkdj_file_exists,
            tkdj_read_binary_file,
            tkdj_read_text_file,
            tkdj_write_text_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

use std::process::Command;

#[tauri::command]
fn test_rubberband_stretch(
    input_path: String,
    output_path: String,
    tempo: f32,
) -> Result<String, String> {
    let tempo_arg = format!("{}", tempo);

    let output = Command::new("rubberband")
        .arg("-T")
        .arg(tempo_arg)
        .arg(&input_path)
        .arg(&output_path)
        .output()
        .map_err(|e| format!("Fehler beim Starten von Rubber Band: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "Rubber Band Fehler: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(format!("Fertig: {}", output_path))
}

