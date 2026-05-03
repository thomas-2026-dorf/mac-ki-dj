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

#ifdef __cplusplus
}
#endif
