// Offline tests + benchmarks for Aurora Core. No audio devices required.
//   aurora_bench                  core DSP tests
//   aurora_bench presets.jsonl    also render and time every voice preset
#include <chrono>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <string>
#include <vector>

#include "aurora_core.h"
#include "dsp/fft.h"
#include "dsp/pitch_detect.h"
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

int main(int argc, char** argv) {
    std::printf("aurora_core %s\n", ac_version());
    testFFT();
    testIdentity();
    testPitch();
    testFormant();
    testTracker();
    if (argc > 1) benchPresets(argv[1]);
    std::printf(failures ? "\n%d FAILED\n" : "\nall passed\n", failures);
    return failures ? 1 : 0;
}
