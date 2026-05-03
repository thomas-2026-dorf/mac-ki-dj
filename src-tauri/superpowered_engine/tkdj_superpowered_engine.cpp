#include "tkdj_superpowered_engine.h"
#include "../vendor/superpowered/Superpowered/Superpowered.h"
#include "../vendor/superpowered/Superpowered/SuperpoweredAdvancedAudioPlayer.h"
#include "../vendor/superpowered/Superpowered/SuperpoweredDecoder.h"

#include <AudioUnit/AudioUnit.h>
#include <AudioToolbox/AudioToolbox.h>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cmath>
#include <vector>
#include <atomic>

// ── Constants ─────────────────────────────────────────────────────────────────

static const unsigned int kSampleRate   = 44100;
static const unsigned int kMaxFrames    = 4096; // covers any CoreAudio buffer size

// ── State ─────────────────────────────────────────────────────────────────────

static std::atomic<bool> s_initialized { false };

static Superpowered::AdvancedAudioPlayer *s_player    = nullptr;
static AudioUnit                          s_audioUnit  = nullptr;
// processStereo requires buffer to be numberOfFrames*8 + 64 bytes
static float s_audioBuffer[kMaxFrames * 2 + 16]; // +16 floats = +64 bytes

// ── CoreAudio Render Callback ─────────────────────────────────────────────────

static OSStatus audioRenderCallback(
    void                       *inRefCon,
    AudioUnitRenderActionFlags *ioActionFlags,
    const AudioTimeStamp       *inTimeStamp,
    UInt32                      inBusNumber,
    UInt32                      inNumberFrames,
    AudioBufferList            *ioData
) {
    (void)inRefCon; (void)ioActionFlags; (void)inTimeStamp; (void)inBusNumber;

    float *output = (float *)ioData->mBuffers[0].mData;

    if (!s_player || inNumberFrames > kMaxFrames) {
        memset(output, 0, ioData->mBuffers[0].mDataByteSize);
        return noErr;
    }

    bool hasAudio = s_player->processStereo(s_audioBuffer, false, inNumberFrames, 1.0f);

    if (hasAudio) {
        memcpy(output, s_audioBuffer, inNumberFrames * 2 * sizeof(float));
    } else {
        memset(output, 0, ioData->mBuffers[0].mDataByteSize);
    }

    return noErr;
}

// ── CoreAudio Setup ───────────────────────────────────────────────────────────

static bool setupCoreAudio() {
    AudioComponentDescription desc = {};
    desc.componentType         = kAudioUnitType_Output;
    desc.componentSubType      = kAudioUnitSubType_DefaultOutput;
    desc.componentManufacturer = kAudioUnitManufacturer_Apple;

    AudioComponent component = AudioComponentFindNext(nullptr, &desc);
    if (!component) {
        printf("[TKDJEngine] No default audio output component found\n");
        return false;
    }

    OSStatus status = AudioComponentInstanceNew(component, &s_audioUnit);
    if (status != noErr) {
        printf("[TKDJEngine] AudioComponentInstanceNew failed: %d\n", (int)status);
        return false;
    }

    // Interleaved stereo float32 at kSampleRate
    AudioStreamBasicDescription fmt = {};
    fmt.mSampleRate       = kSampleRate;
    fmt.mFormatID         = kAudioFormatLinearPCM;
    fmt.mFormatFlags      = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked;
    fmt.mFramesPerPacket  = 1;
    fmt.mChannelsPerFrame = 2;
    fmt.mBitsPerChannel   = 32;
    fmt.mBytesPerFrame    = 2 * sizeof(float);
    fmt.mBytesPerPacket   = 2 * sizeof(float);

    status = AudioUnitSetProperty(
        s_audioUnit,
        kAudioUnitProperty_StreamFormat,
        kAudioUnitScope_Input,
        0,
        &fmt,
        sizeof(fmt)
    );
    if (status != noErr) {
        printf("[TKDJEngine] SetStreamFormat failed: %d\n", (int)status);
        return false;
    }

    AURenderCallbackStruct cb = {};
    cb.inputProc       = audioRenderCallback;
    cb.inputProcRefCon = nullptr;

    status = AudioUnitSetProperty(
        s_audioUnit,
        kAudioUnitProperty_SetRenderCallback,
        kAudioUnitScope_Input,
        0,
        &cb,
        sizeof(cb)
    );
    if (status != noErr) {
        printf("[TKDJEngine] SetRenderCallback failed: %d\n", (int)status);
        return false;
    }

    status = AudioUnitInitialize(s_audioUnit);
    if (status != noErr) {
        printf("[TKDJEngine] AudioUnitInitialize failed: %d\n", (int)status);
        return false;
    }

    status = AudioOutputUnitStart(s_audioUnit);
    if (status != noErr) {
        printf("[TKDJEngine] AudioOutputUnitStart failed: %d\n", (int)status);
        return false;
    }

    printf("[TKDJEngine] CoreAudio output running at %u Hz\n", kSampleRate);
    return true;
}

// ── Superpowered Initialisierung (einmalig, thread-safe) ──────────────────────

static void ensureSuperpoweredInitialized() {
    if (s_initialized.exchange(true)) return;
    // Lizenzschlüssel von superpowered.com/dev eintragen; "" = Entwicklungsmodus
    Superpowered::Initialize("");
}

// ── Public API ────────────────────────────────────────────────────────────────

extern "C" {

void tkdj_engine_init() {
    if (s_player) return; // already initialized

    ensureSuperpoweredInitialized();

    s_player = new Superpowered::AdvancedAudioPlayer(kSampleRate, 4);

    if (!setupCoreAudio()) {
        printf("[TKDJEngine] WARNING: CoreAudio setup failed — no audio output\n");
    }

    printf("[TKDJEngine] init complete\n");
}

void tkdj_engine_load_track(const char *path) {
    if (!path || !s_player) return;
    s_player->open(path);
    printf("[TKDJEngine] load_track: %s\n", path);
}

void tkdj_engine_play() {
    if (!s_player) return;
    s_player->play();
    printf("[TKDJEngine] play\n");
}

void tkdj_engine_pause() {
    if (!s_player) return;
    s_player->pause();
    printf("[TKDJEngine] pause\n");
}

void tkdj_engine_stop() {
    if (!s_player) return;
    s_player->setPosition(0.0, true, false);
    printf("[TKDJEngine] stop\n");
}

double tkdj_engine_get_position_seconds() {
    if (!s_player) return 0.0;
    return s_player->getDisplayPositionMs() / 1000.0;
}

double tkdj_engine_get_duration_seconds() {
    if (!s_player) return 0.0;
    double ms = s_player->getDurationMs();
    return ms > 0.0 ? ms / 1000.0 : 0.0;
}

// ── Waveform Peak Extraction ──────────────────────────────────────────────────

float* tkdj_generate_waveform(const char* path, int* outLength) {
    if (!path || !outLength) return nullptr;
    *outLength = 0;

    ensureSuperpoweredInitialized();

    Superpowered::Decoder decoder;
    if (decoder.open(path) != Superpowered::Decoder::OpenSuccess) {
        return nullptr;
    }

    // Decoder always outputs stereo int16 interleaved.
    // Buffer requirement: numberOfFrames * 4 + 16384 bytes.
    static const unsigned int kDecodeFrames = 4096;
    static const int kStep = 10; // emit one peak per kStep buffers

    const int kBufBytes = kDecodeFrames * 4 + 16384;
    short int* pcm = (short int*)malloc(kBufBytes);
    if (!pcm) return nullptr;

    std::vector<float> peaks;
    int bufferCount = 0;

    while (true) {
        int framesDecoded = decoder.decodeAudio(pcm, kDecodeFrames);
        if (framesDecoded <= 0) break; // EOF or error

        bufferCount++;
        if (bufferCount % kStep != 0) continue;

        // Stereo int16 → mono float, find peak in window
        float peak = 0.0f;
        for (int i = 0; i < framesDecoded; i++) {
            float l = fabsf((float)pcm[i * 2]     / 32768.0f);
            float r = fabsf((float)pcm[i * 2 + 1] / 32768.0f);
            float m = (l + r) * 0.5f;
            if (m > peak) peak = m;
        }
        peaks.push_back(peak);
    }

    free(pcm);

    if (peaks.empty()) return nullptr;

    float* result = (float*)malloc(sizeof(float) * peaks.size());
    if (!result) return nullptr;
    memcpy(result, peaks.data(), sizeof(float) * peaks.size());
    *outLength = (int)peaks.size();
    return result;
}

void tkdj_free_waveform(float* data) {
    free(data);
}

} // extern "C"
