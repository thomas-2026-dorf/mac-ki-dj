#pragma once

#ifdef __cplusplus
extern "C" {
#endif

void   tkdj_engine_init();
void   tkdj_engine_load_track(const char* path);
void   tkdj_engine_play();
void   tkdj_engine_pause();
void   tkdj_engine_stop();
double tkdj_engine_get_position_seconds();
double tkdj_engine_get_duration_seconds();

// Waveform peak extraction (offline, does not affect playback engine).
// Returns a malloc'd float array of peak values [0.0, 1.0].
// Caller must free with tkdj_free_waveform().
float* tkdj_generate_waveform(const char* path, int* outLength);
void   tkdj_free_waveform(float* data);

#ifdef __cplusplus
}
#endif
