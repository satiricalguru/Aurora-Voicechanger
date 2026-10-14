// Device test for the recorder and instant replay, on real audio devices.
//   aurora_capture_probe <mic uid> <voice-out uid> [--system]
// Voice source: a soundboard tone through the live engine must show up in
// instant replay and in a recording. With --system it also taps Mac audio
// while `afplay` plays a quiet tone on the default output (needs System Audio
// Recording permission for the app that runs it).
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <string>
#include <thread>
#include <vector>
#include <unistd.h>

#include "aurora_core.h"

static int fails = 0;
#define CHECK(cond, ...) do { const bool ok_ = (cond); std::printf(ok_ ? "  ok    " : "  FAIL  "); if (!ok_) ++fails; std::printf(__VA_ARGS__); std::printf("\n"); } while (0)

static std::vector<float> readWav16(const std::string& path, int* rate) {
    std::vector<float> out;
    std::ifstream f(path, std::ios::binary);
    std::vector<char> b((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
    if (b.size() < 44) return out;
    uint32_t r; std::memcpy(&r, b.data() + 24, 4);
    *rate = (int)r;
    for (size_t o = 44; o + 1 < b.size(); o += 2) { int16_t v; std::memcpy(&v, b.data() + o, 2); out.push_back(v / 32767.f); }
    return out;
}

static void writeWav16(const std::string& path, const std::vector<float>& x, int rate) {
    std::ofstream f(path, std::ios::binary);
    auto u32 = [&](uint32_t v) { f.write((const char*)&v, 4); };
    auto u16 = [&](uint16_t v) { f.write((const char*)&v, 2); };
    uint32_t bytes = (uint32_t)x.size() * 2;
    f.write("RIFF", 4); u32(36 + bytes); f.write("WAVEfmt ", 8); u32(16); u16(1); u16(1); u32(rate); u32(rate * 2); u16(2); u16(16);
    f.write("data", 4); u32(bytes);
    for (float v : x) { int16_t q = (int16_t)std::lrint(v * 32767); f.write((const char*)&q, 2); }
}

// RMS and the share of energy at `hz` (Goertzel) over the loudest 0.5 s.
static void analyse(const std::vector<float>& x, int rate, double hz, double* rms, double* share) {
    size_t win = rate / 2, best = 0;
    double bestE = -1;
    for (size_t s = 0; s + win <= x.size(); s += win / 4) {
        double e = 0;
        for (size_t i = s; i < s + win; ++i) e += x[i] * x[i];
        if (e > bestE) { bestE = e; best = s; }
    }
    *rms = *share = 0;
    if (bestE <= 0) return;
    double w = 2 * M_PI * hz / rate, c = 2 * std::cos(w), s1 = 0, s2 = 0;
    for (size_t i = best; i < best + win; ++i) { double s = x[i] + c * s1 - s2; s2 = s1; s1 = s; }
    *rms = std::sqrt(bestE / win);
    *share = (s1 * s1 + s2 * s2 - c * s1 * s2) / (bestE * win / 2);
}

static std::vector<float> tone(double hz, double secs, int rate, float a) {
    std::vector<float> t((size_t)(secs * rate));
    for (size_t i = 0; i < t.size(); ++i) t[i] = a * (float)std::sin(2 * M_PI * hz * i / rate);
    return t;
}

int main(int argc, char** argv) {
    if (argc < 3) { std::printf("usage: %s <mic uid> <voice-out uid> [--system]\n", argv[0]); return 2; }
    const bool system = argc > 3 && !std::strcmp(argv[3], "--system");
    const std::string dir = "/tmp/aurora_capture_probe_" + std::to_string(getpid());
    std::system(("mkdir -p " + dir).c_str());
    if (ac_start(argv[1], argv[2], 64, 48000) != 0) { std::printf("start failed: %s\n", ac_last_error()); return 1; }
    ac_set_setting("vol_mic", 0);  // only the test tone, not the room
    int rate = 0;
    double rms, share;

    std::printf("Voice source (what the call hears)\n");
    auto t = tone(660, 1.0, 48000, 0.4f);
    std::this_thread::sleep_for(std::chrono::milliseconds(1000));  // > 2 s of history by the save
    ac_play_sound(t.data(), (int)t.size(), 48000);
    std::this_thread::sleep_for(std::chrono::milliseconds(1300));
    double s = ac_replay_save(0, 2.0, (dir + "/replay.wav").c_str());
    auto r = readWav16(dir + "/replay.wav", &rate);
    analyse(r, rate, 660, &rms, &share);
    CHECK(std::fabs(s - 2.0) < 0.01 && r.size() == (size_t)std::lround(s * rate), "instant replay saved %.2f s at %d Hz", s, rate);
    CHECK(rms > 0.2 && share > 0.9, "replay holds the pad: rms %.3f, %.0f%% at 660 Hz", rms, share * 100);

    CHECK(ac_record_start(0, (dir + "/rec.wav").c_str()) == 0, "recording starts");
    CHECK(ac_record_start(0, (dir + "/rec2.wav").c_str()) != 0, "second recording refused (%s)", ac_last_error());
    std::this_thread::sleep_for(std::chrono::milliseconds(200));
    ac_play_sound(t.data(), (int)t.size(), 48000);
    std::this_thread::sleep_for(std::chrono::milliseconds(1300));
    s = ac_record_stop();
    r = readWav16(dir + "/rec.wav", &rate);
    analyse(r, rate, 660, &rms, &share);
    CHECK(std::fabs(s - 1.5) < 0.1 && r.size() == (size_t)std::lround(s * rate), "recorded %.2f s", s);
    CHECK(rms > 0.2 && share > 0.9, "recording holds the pad: rms %.3f, %.0f%% at 660 Hz", rms, share * 100);
    CHECK(ac_record_stop() < 0, "stop when idle returns -1");

    if (system) {
        std::printf("Mac audio source (process tap)\n");
        if (ac_capture_system(1) != 0) {
            const std::string e = ac_last_error();
            if (e.find("permission") != std::string::npos) std::printf("  skip  Mac audio: %s (grant System Audio Recording to the app running this test)\n", e.c_str());
            else CHECK(false, "tap failed: %s", e.c_str());
        } else {
            // A quiet 1 kHz tone on the default output, played by another process.
            auto beep = tone(1000, 1.2, 48000, 0.08f);
            writeWav16(dir + "/beep.wav", beep, 48000);
            CHECK(ac_record_start(1, (dir + "/sys.wav").c_str()) == 0, "Mac audio recording starts");
            std::system(("afplay " + dir + "/beep.wav").c_str());
            std::this_thread::sleep_for(std::chrono::milliseconds(300));
            s = ac_record_stop();
            r = readWav16(dir + "/sys.wav", &rate);
            analyse(r, rate, 1000, &rms, &share);
            CHECK(s > 1.2, "recorded %.2f s of Mac audio at %d Hz", s, rate);
            CHECK(rms > 0.01 && share > 0.8, "afplay's tone captured: rms %.4f, %.0f%% at 1 kHz%s", rms, share * 100,
                  rms > 0.01 ? "" : " (silent: System Audio Recording permission missing?)");
            double rs = ac_replay_save(1, 5.0, (dir + "/sysreplay.wav").c_str());
            CHECK(rs > 1.2, "Mac audio instant replay saved %.2f s", rs);
            CHECK(ac_capture_system(0) == 0, "tap stops");
            CHECK(ac_record_start(1, (dir + "/x.wav").c_str()) != 0, "Mac audio recording refused when the tap is off");
        }
    }
    ac_stop();
    std::system(("rm -rf " + dir).c_str());
    std::printf(fails ? "%d FAILED\n" : "all passed\n", fails);
    return fails ? 1 : 0;
}
