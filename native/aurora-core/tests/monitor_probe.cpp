// Device test for the soundboard preview (sounds-only monitor), recorded
// with a raw CoreAudio IOProc. Needs BlackHole 2ch and a second output.
//   aurora_monitor_probe <mic uid> <voice-out uid> <monitor uid (BlackHole)>
#include <CoreAudio/CoreAudio.h>

#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <thread>
#include <vector>

#include "aurora_core.h"

static std::vector<float> rec(48000 * 3);
static std::atomic<size_t> recPos{0};

static AudioObjectID byUid(const char* uid) {
    AudioObjectPropertyAddress a{kAudioHardwarePropertyDevices, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain};
    UInt32 size = 0;
    AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &a, 0, nullptr, &size);
    std::vector<AudioObjectID> ids(size / sizeof(AudioObjectID));
    AudioObjectGetPropertyData(kAudioObjectSystemObject, &a, 0, nullptr, &size, ids.data());
    for (auto id : ids) {
        CFStringRef s = nullptr;
        UInt32 sz = sizeof s;
        AudioObjectPropertyAddress u{kAudioDevicePropertyDeviceUID, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain};
        if (AudioObjectGetPropertyData(id, &u, 0, nullptr, &sz, &s) == noErr && s) {
            char b[256];
            CFStringGetCString(s, b, sizeof b, kCFStringEncodingUTF8);
            CFRelease(s);
            if (!strcmp(b, uid)) return id;
        }
    }
    return kAudioObjectUnknown;
}

static OSStatus capture(AudioObjectID, const AudioTimeStamp*, const AudioBufferList* in, const AudioTimeStamp*,
                        AudioBufferList*, const AudioTimeStamp*, void*) {
    if (!in || !in->mNumberBuffers) return noErr;
    const AudioBuffer& b = in->mBuffers[0];
    const float* s = static_cast<const float*>(b.mData);
    const int ch = (int)b.mNumberChannels, fr = (int)(b.mDataByteSize / (4 * ch));
    size_t p = recPos.load();
    for (int f = 0; f < fr && p < rec.size(); ++f) rec[p++] = s[f * ch];
    recPos.store(p);
    return noErr;
}

static double rms(size_t a, size_t b) {
    double e = 0;
    for (size_t i = a; i < b; ++i) e += rec[i] * rec[i];
    return std::sqrt(e / std::max<size_t>(1, b - a));
}

// Energy at `hz` relative to total (Goertzel), over [a, b).
static double toneShare(size_t a, size_t b, double hz) {
    double w = 2 * M_PI * hz / 48000.0, c = 2 * std::cos(w), s1 = 0, s2 = 0, tot = 0;
    for (size_t i = a; i < b; ++i) { double s = rec[i] + c * s1 - s2; s2 = s1; s1 = s; tot += rec[i] * rec[i]; }
    double p = s1 * s1 + s2 * s2 - c * s1 * s2;
    return p / (tot * (b - a) / 2 + 1e-20);
}

int main(int argc, char** argv) {
    if (argc < 4) { std::printf("usage: %s <mic uid> <voice-out uid> <monitor uid>\n", argv[0]); return 2; }
    int fails = 0;
    if (ac_start(argv[1], argv[2], 64, 48000) != 0) { std::printf("start failed: %s\n", ac_last_error()); return 1; }
    ac_set_setting("monitor_voice", 0);
    if (ac_start_monitor(argv[3]) != 0) { std::printf("monitor failed: %s\n", ac_last_error()); return 1; }

    AudioObjectID mon = byUid(argv[3]);
    AudioDeviceIOProcID proc = nullptr;
    AudioDeviceCreateIOProcID(mon, capture, nullptr, &proc);
    AudioDeviceStart(mon, proc);
    std::this_thread::sleep_for(std::chrono::milliseconds(400));
    size_t quietEnd = recPos.load();

    // 880 Hz pad, 1 s.
    std::vector<float> pad(48000);
    for (int i = 0; i < 48000; ++i) pad[i] = 0.5f * std::sin(2 * M_PI * 880 * i / 48000.0) * std::exp(-i / 48000.0);
    ac_play_sound(pad.data(), (int)pad.size(), 48000);
    std::this_thread::sleep_for(std::chrono::milliseconds(900));
    size_t padEnd = recPos.load();

    // Hear-myself mode carries the (silent) voice path instead of pads only:
    // the pad still plays, mixed into the voice.
    AudioDeviceStop(mon, proc);
    AudioDeviceDestroyIOProcID(mon, proc);
    ac_stop();

    double q = rms(0, quietEnd), p = rms(quietEnd + 4800, padEnd), share = toneShare(quietEnd + 4800, padEnd, 880);
    std::printf("monitor before pad: rms %.5f\n", q);
    std::printf("monitor during pad: rms %.4f, 880 Hz share %.2f\n", p, share);
    if (!(p > 0.05 && share > 0.8)) { std::printf("FAIL pad not heard on the monitor device\n"); ++fails; }
    if (!(q < 0.01)) { std::printf("FAIL monitor not quiet before the pad (voice leaking into sounds-only preview?)\n"); ++fails; }
    std::printf(fails ? "%d FAILED\n" : "all passed\n", fails);
    return fails ? 1 : 0;
}
