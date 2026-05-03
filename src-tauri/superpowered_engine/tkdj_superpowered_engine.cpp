#include "tkdj_superpowered_engine.h"
#include "../vendor/superpowered/Superpowered/SuperpoweredAdvancedAudioPlayer.h"

#include <cstdio>
#include <cstring>

// ── Stub-State ────────────────────────────────────────────────────────────────
// Kein echtes Audio-I/O. Struktur ist bereit für echten Superpowered-Player.

static char  s_path[4096] = {0};
static bool  s_playing    = false;
static double s_position  = 0.0;
static double s_duration  = 0.0;

// ── Public API ────────────────────────────────────────────────────────────────

extern "C" {

void tkdj_engine_init() {
    s_playing  = false;
    s_position = 0.0;
    s_duration = 0.0;
    s_path[0]  = '\0';
    printf("[TKDJEngine] init\n");
}

void tkdj_engine_load_track(const char* path) {
    if (!path) return;
    strncpy(s_path, path, sizeof(s_path) - 1);
    s_path[sizeof(s_path) - 1] = '\0';
    s_playing  = false;
    s_position = 0.0;
    s_duration = 0.0;
    printf("[TKDJEngine] load_track: %s\n", s_path);
}

void tkdj_engine_play() {
    if (!s_playing) {
        s_playing = true;
        printf("[TKDJEngine] play\n");
    }
}

void tkdj_engine_pause() {
    if (s_playing) {
        s_playing = false;
        printf("[TKDJEngine] pause\n");
    }
}

void tkdj_engine_stop() {
    s_playing  = false;
    s_position = 0.0;
    printf("[TKDJEngine] stop\n");
}

double tkdj_engine_get_position_seconds() {
    return s_position;
}

double tkdj_engine_get_duration_seconds() {
    return s_duration;
}

} // extern "C"
