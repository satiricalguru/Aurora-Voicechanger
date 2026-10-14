// Offline tests + benchmarks for Aurora Core. No audio devices required.
//   aurora_bench                  core DSP tests
//   aurora_bench presets.jsonl    also render and time every voice preset
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <string>
#include <thread>
#include <unistd.h>
#include <vector>

#include "aurora_core.h"
#include "capture.h"
#include "dsp/fft.h"
#include "dsp/pitch_detect.h"
#include "dsp/resampler.h"
#include "dsp/spectral.h"

using namespace aurora::dsp;

static int failures = 0;
#define CHECK(cond, ...)                                  \
    do {                                                  \
        if (cond) { std::printf("  ok    "); }            \
        else { std::printf("  FAIL  "); ++failures; }     \
        std::printf(__VA_ARGS__);                         \
        std::printf("\n");                                \
    } while (0)

static const double SR = 48000;

static std::vector<float> sine(double f, int n, float a = 0.5f) {
    std::vector<float> x(n);
    for (int i = 0; i < n; ++i) x[i] = a * (float)std::sin(2 * M_PI * f * i / SR);
    return x;
}

// Glottal-ish pulse train through two formant resonators: a crude vowel.
static std::vector<float> vowel(double f0, int n) {
    std::vector<float> x(n);
    double ph = 0;
    for (int i = 0; i < n; ++i) {
        ph += f0 / SR;
        if (ph >= 1) ph -= 1;
        x[i] = (float)(ph < 0.1 ? std::sin(M_PI * ph / 0.1) : 0.0);
    }
    Biquad f1, f2;
    f1.bandpass(SR, 700, 6);
    f2.bandpass(SR, 1200, 8);
    for (int i = 0; i < n; ++i) x[i] = 0.6f * (f1.tick(x[i]) + 0.6f * f2.tick(x[i]));
    return x;
}

static double trackedF0(const std::vector<float>& x, int from) {
    PitchTracker t;
    t.prepare(SR);
    std::vector<double> est;
    for (int i = from; i + 128 <= (int)x.size(); i += 128)
        if (t.push(&x[i], 128) && t.f0() > 0) est.push_back(t.f0());
    if (est.empty()) return 0;
    std::sort(est.begin(), est.end());
    return est[est.size() / 2];
}

static void testFFT() {
    std::printf("FFT\n");
    RealFFT f;
    f.prepare(1024);
    auto x = sine(1000, 1024);
    std::vector<float> re(513), im(513), y(1024);
    f.forward(x.data(), re.data(), im.data());
    f.inverse(re.data(), im.data(), y.data());
    double err = 0;
    for (int i = 0; i < 1024; ++i) err = std::max(err, (double)std::fabs(x[i] - y[i]));
    CHECK(err < 1e-5, "round trip max error %.2e", err);
    // Bin of a sine at an exact bin frequency carries N/2 * A.
    auto s = sine(SR / 1024 * 32, 1024, 1.f);
    f.forward(s.data(), re.data(), im.data());
    double m = std::hypot(re[32], im[32]);
    CHECK(std::fabs(m - 512) < 1, "true-DFT scaling |X[32]| = %.2f (want 512)", m);
}

static void testIdentity() {
    std::printf("Spectral shifter: perfect reconstruction\n");
    SpectralShifter sh;
    sh.prepare(SR);
    int n = 48000;
    std::vector<float> x(n), y(n);
    uint32_t s = 1;
    for (int i = 0; i < n; ++i) { s = s * 1664525u + 1013904223u; x[i] = ((int32_t)s / 2147483648.f) * 0.3f; }
    for (int i = 0; i < n; i += 128) sh.process(&x[i], &y[i], std::min(128, n - i));
    int L = sh.latency();
    double err = 0, ref = 0;
    for (int i = L + 2048; i < n; ++i) { err += std::pow(y[i] - x[i - L], 2); ref += x[i - L] * x[i - L]; }
    double snr = 10 * std::log10(ref / (err + 1e-20));
    CHECK(snr > 60, "latency %d samples (%.2f ms), reconstruction SNR %.1f dB", L, L * 1000 / SR, snr);
}

static void testPitch() {
    std::printf("Spectral shifter: pitch accuracy\n");
    int n = 48000;
    for (double st : {-12.0, -5.0, 3.0, 7.0, 12.0}) {
        auto x = vowel(140, n);
        std::vector<float> y(n);
        SpectralShifter sh;
        sh.prepare(SR);
        sh.setPitch((float)std::pow(2.0, st / 12));
        for (int i = 0; i < n; i += 128) sh.process(&x[i], &y[i], 128);
        double want = 140 * std::pow(2.0, st / 12), got = trackedF0(y, 9600);
        double cents = 1200 * std::log2(got / want);
        CHECK(std::fabs(cents) < 15, "%+5.1f st: f0 %.1f Hz (want %.1f, %+.1f cents)", st, got, want, cents);
    }
}

static void testFormant() {
    std::printf("Spectral shifter: formant preservation\n");
    // Spectral centroid should stay put when pitch moves with formant=1,
    // and rise when formant > 1.
    auto centroid = [](const std::vector<float>& y) {
        RealFFT f;
        f.prepare(4096);
        std::vector<float> re(2049), im(2049), w(4096);
        double num = 0, den = 0;
        for (int off = 12000; off + 4096 <= (int)y.size(); off += 4096) {
            for (int i = 0; i < 4096; ++i) w[i] = y[off + i] * (float)(0.5 - 0.5 * std::cos(2 * M_PI * i / 4096));
            f.forward(w.data(), re.data(), im.data());
            for (int k = 1; k < 2049; ++k) {
                double m = std::hypot(re[k], im[k]), hz = k * SR / 4096;
                if (hz < 4000) { num += m * hz; den += m; }
            }
        }
        return num / den;
    };
    int n = 48000;
    auto x = vowel(120, n);
    auto run = [&](float ratio, float formant) {
        std::vector<float> y(n);
        SpectralShifter sh;
        sh.prepare(SR);
        sh.setPitch(ratio);
        sh.setFormant(formant);
        for (int i = 0; i < n; i += 128) sh.process(&x[i], &y[i], 128);
        return centroid(y);
    };
    double c0 = run(1, 1), cUp = run(1.5f, 1), cF = run(1, 1.3f);
    CHECK(std::fabs(cUp / c0 - 1) < 0.12, "pitch x1.5 keeps formants: centroid %.0f -> %.0f Hz", c0, cUp);
    CHECK(cF / c0 > 1.12, "formant x1.3 raises centroid: %.0f -> %.0f Hz", c0, cF);
}

static void testTracker() {
    std::printf("Pitch tracker\n");
    for (double f : {90.0, 150.0, 240.0, 400.0}) {
        auto x = vowel(f, 24000);
        double got = trackedF0(x, 0);
        CHECK(std::fabs(1200 * std::log2(got / f)) < 10, "%.0f Hz -> %.1f Hz", f, got);
    }
}

static void testResampler() {
    std::printf("Resampler 48k -> 16k -> 48k\n");
    Resampler down, up;
    down.prepare(48000, 16000);
    up.prepare(16000, 48000);
    int n = 48000;
    auto x = sine(1000, n, 0.5f);
    std::vector<float> mid(down.maxOut(n)), y(up.maxOut((int)mid.size()) + 64);
    int m = 0, k = 0;
    for (int i = 0; i < n; i += 64) {
        std::vector<float> tmp(down.maxOut(64)), tmp2(up.maxOut((int)tmp.size()));
        int a = down.process(&x[i], 64, tmp.data(), (int)tmp.size());
        int b = up.process(tmp.data(), a, tmp2.data(), (int)tmp2.size());
        std::copy(tmp.begin(), tmp.begin() + a, mid.begin() + m);
        std::copy(tmp2.begin(), tmp2.begin() + b, y.begin() + k);
        m += a; k += b;
    }
    // Output j is the input at j*step: sequences align with no offset. The
    // delay is in *when* outputs appear (the kernel needs future input), so
    // the last few outputs are still pending at the end.
    double delay = down.latencyOut() * 3 + up.latencyOut();
    double err = 0, ref = 0;
    for (int i = 4800; i < k; ++i) { err += std::pow(y[i] - x[i], 2); ref += x[i] * x[i]; }
    double snr = 10 * std::log10(ref / (err + 1e-20));
    CHECK(16000 - m <= (int)std::ceil(down.latencyOut()) + 1 && 48000 - k <= (int)std::ceil(delay) + 3,
          "sample counts %d / %d (pending at end: %d / %d)", m, k, 16000 - m, 48000 - k);
    CHECK(snr > 60, "round trip emission delay %.2f ms, SNR %.1f dB", delay / 48.0, snr);
    // Alias rejection: 10 kHz tone must vanish below 16k Nyquist.
    Resampler d2;
    d2.prepare(48000, 16000);
    auto hi = sine(10000, n, 0.5f);
    std::vector<float> o(d2.maxOut(n));
    int c = d2.process(hi.data(), n, o.data(), (int)o.size());
    double e = 0;
    for (int i = 1000; i < c; ++i) e += o[i] * o[i];
    double db = 10 * std::log10(e / (c - 1000) / 0.125 + 1e-20);
    CHECK(db < -50, "10 kHz tone after 48k->16k: %.1f dB", db);
}

static void testDenoise() {
    std::printf("Denoiser (RNNoise)\n");
    // Vowel bursts in steady pink-ish noise at ~5 dB SNR.
    int n = 48000 * 4;
    auto v = vowel(150, n);
    std::vector<float> clean(n), noisy(n), out(n);
    uint32_t s = 7;
    float lp = 0;
    for (int i = 0; i < n; ++i) {
        clean[i] = ((i / 12000) % 2 ? 0.6f : 0.f) * v[i];
        s = s * 1664525u + 1013904223u;
        lp = 0.9f * lp + 0.1f * ((int32_t)s / 2147483648.f);
        noisy[i] = clean[i] + lp * 0.25f;
    }
    for (int mode : {1, 2, 3}) {
        std::string cfg = "{\"chain\":[{\"effect\":\"denoise\",\"mode\":" + std::to_string(mode) + "}]}";
        int lat = ac_render_offline(cfg.c_str(), noisy.data(), out.data(), n, SR, 64);
        // Noise left in the gaps (second half, after adaptation), aligned by latency.
        double before = 0, after = 0, speechKept = 0, speechIn = 0;
        for (int i = n / 2; i + lat < n; ++i) {
            bool gap = clean[i] == 0.f && (i % 12000) > 2400 && (i % 12000) < 9600;
            double a = noisy[i], b = out[i + lat];
            if (gap) { before += a * a; after += b * b; }
            else if (clean[i] != 0.f) { speechIn += clean[i] * clean[i]; speechKept += b * b; }
        }
        double cut = 10 * std::log10(before / (after + 1e-20));
        double kept = 10 * std::log10(speechKept / (speechIn + 1e-20));
        const char* names[] = {"", "low latency", "balanced", "quality"};
        CHECK(lat >= 0 && cut > 8 && kept > -6, "%-11s latency %5.2f ms, noise in gaps -%.1f dB, speech level %+.1f dB",
              names[mode], lat * 1000 / SR, cut, kept);
    }
}

static void benchPresets(const char* path) {
    std::printf("Presets (%s)\n", path);
    std::ifstream in(path);
    std::string line;
    int n = (int)SR * 4;
    auto x = vowel(130, n);
    for (int i = 0; i < n; ++i) x[i] *= (i / 24000) % 2 ? 1.f : 0.3f;  // level changes
    std::vector<float> y(n);
    double worst = 0;
    while (std::getline(in, line)) {
        if (line.empty()) continue;
        size_t tab = line.find('\t');
        std::string id = line.substr(0, tab), cfg = line.substr(tab + 1);
        auto t0 = std::chrono::steady_clock::now();
        int lat = ac_render_offline(cfg.c_str(), x.data(), y.data(), n, SR, 128);
        double sec = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
        bool finite = true;
        double peak = 0, rms = 0;
        for (float v : y) { finite &= std::isfinite(v); peak = std::max(peak, (double)std::fabs(v)); rms += v * v; }
        rms = std::sqrt(rms / n);
        double cpu = sec / (n / SR) * 100;
        worst = std::max(worst, cpu);
        bool ok = lat >= 0 && finite && peak < 4 && rms > 1e-4;
        if (!ok) ++failures;
        std::printf("  %s  %-16s latency %5.2f ms  cpu %5.2f%%  peak %.2f  rms %.3f\n", ok ? "ok  " : "FAIL",
                    id.c_str(), lat * 1000 / SR, cpu, peak, rms);
    }
    std::printf("  worst-case single-core CPU: %.2f%%\n", worst);
}


// 16-bit mono WAV written by capture.h -> floats (checks the header on the way).
static std::vector<float> readWav16(const std::string& path, int* rate) {
    std::vector<float> out;
    std::ifstream f(path, std::ios::binary);
    std::vector<char> b((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
    if (b.size() < 44 || std::string(b.data(), 4) != "RIFF" || std::string(b.data() + 8, 8) != "WAVEfmt ") return out;
    auto u32 = [&](size_t o) { uint32_t v; std::memcpy(&v, b.data() + o, 4); return v; };
    auto u16 = [&](size_t o) { uint16_t v; std::memcpy(&v, b.data() + o, 2); return v; };
    if (u16(20) != 1 || u16(22) != 1 || u16(34) != 16 || u32(4) != b.size() - 8 || u32(40) != b.size() - 44) return out;
    *rate = (int)u32(24);
    for (size_t o = 44; o + 1 < b.size(); o += 2) out.push_back((int16_t)u16(o) / 32767.f);
    return out;
}

static void testCapture() {
    std::printf("\nRecorder and instant replay\n");
    using aurora::History;
    using aurora::Recorder;
    const std::string dir = "/tmp/aurora_capture_test_" + std::to_string(getpid());
    std::system(("mkdir -p " + dir).c_str());
    auto signal = [](uint64_t i) { return 0.5f * (float)std::sin(2 * M_PI * 440 * i / SR) + 0.2f * (float)std::sin(i * 0.37); };
    History h;
    h.setRate(SR);
    uint64_t pushed = 0;
    auto feed = [&](double seconds) {
        std::vector<float> blk(128);
        for (uint64_t end = pushed + (uint64_t)(seconds * SR); pushed < end; pushed += 128) {
            for (int i = 0; i < 128; ++i) blk[i] = signal(pushed + i);
            h.push(blk.data(), 128);
        }
    };
    auto maxErr = [&](const std::vector<float>& got, uint64_t start) {
        double e = 0;
        for (size_t i = 0; i < got.size(); ++i) e = std::max(e, (double)std::fabs(got[i] - signal(start + i)));
        return e;
    };
    std::string err;
    int rate = 0;

    feed(3.0);
    double s = aurora::saveReplay(h, 1.0, dir + "/replay.wav", err);
    auto r = readWav16(dir + "/replay.wav", &rate);
    CHECK(s == 1.0 && rate == 48000 && r.size() == 48000 && maxErr(r, pushed - 48000) < 1.5 / 32767,
          "replay: last 1.00 s of 3 s, sample-exact (%.2f s, %d Hz, %zu frames)", s, rate, r.size());
    s = aurora::saveReplay(h, 30.0, dir + "/replay30.wav", err);
    CHECK(std::fabs(s - 3.0) < 1e-9, "replay asks for 30 s, gets the 3.00 s there are (%.2f s)", s);

    {   // Recording while audio keeps arriving in real-time-sized blocks.
        Recorder rec;
        const uint64_t start = pushed;
        CHECK(rec.start(&h, 0, dir + "/rec.wav", 600, err) == 0, "recorder starts");
        for (int k = 0; k < 20; ++k) { feed(0.1); std::this_thread::sleep_for(std::chrono::milliseconds(5)); }
        double secs = rec.stop();
        r = readWav16(dir + "/rec.wav", &rate);
        CHECK(r.size() == pushed - start && std::fabs(secs - r.size() / SR) < 1e-9 && maxErr(r, start) < 1.5 / 32767,
              "recording: every sample pushed (%.3f s), sample-exact, valid WAV header", secs);
    }
    {   // Time limit ends the recording by itself, file complete.
        Recorder rec;
        rec.start(&h, 0, dir + "/limit.wav", 0.5, err);
        feed(1.5);
        for (int k = 0; k < 50 && rec.active(); ++k) std::this_thread::sleep_for(std::chrono::milliseconds(10));
        bool pend = rec.pending();
        double secs = rec.stop();
        r = readWav16(dir + "/limit.wav", &rate);
        CHECK(pend && std::fabs(secs - 0.5) < 1e-9 && r.size() == 24000, "time limit stops at %.2f s and keeps the file", secs);
    }
    {   // Source restarts at another rate: recording ends, history starts over.
        Recorder rec;
        rec.start(&h, 0, dir + "/epoch.wav", 600, err);
        feed(0.2);
        std::this_thread::sleep_for(std::chrono::milliseconds(80));
        h.setRate(44100);
        for (int k = 0; k < 50 && rec.active(); ++k) std::this_thread::sleep_for(std::chrono::milliseconds(10));
        double secs = rec.stop();
        r = readWav16(dir + "/epoch.wav", &rate);
        CHECK(!rec.active() && secs > 0.1 && secs <= 0.2 + 1e-9 && rate == 48000 && h.written() == 0,
              "rate change ends the recording (%.2f s kept) and resets replay", secs);
        h.setRate(SR);
    }
    {   // A ring's worth of audio more than the oldest safe sample: replay keeps the newest ~85 s.
        History big;
        big.setRate(SR);
        std::vector<float> blk(4096, 0.1f);
        for (int k = 0; k < 1300; ++k) big.push(blk.data(), 4096);  // ~111 s
        double avail = big.seconds();
        CHECK(avail > 80 && avail < 88, "history holds the last %.1f s", avail);
    }
    std::system(("rm -rf " + dir).c_str());
}

int main(int argc, char** argv) {
    std::printf("aurora_core %s\n", ac_version());
    testFFT();
    testIdentity();
    testPitch();
    testFormant();
    testTracker();
    testResampler();
    testDenoise();
    testCapture();
    if (argc > 1) benchPresets(argv[1]);
    std::printf(failures ? "\n%d FAILED\n" : "\nall passed\n", failures);
    return failures ? 1 : 0;
}
