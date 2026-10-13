// Effect nodes. Parameter names match the Python presets
// (python/voices/presets.py) so every existing voice runs natively.
#pragma once

#include <array>
#include <memory>
#include <cmath>
#include <vector>

#include "dsp/basics.h"
#include "dsp/pitch_detect.h"
#include "dsp/spectral.h"
#include "graph.h"
#include "rt.h"

namespace aurora::nodes {

using namespace aurora::dsp;

inline float semis(float s) { return std::pow(2.f, s / 12.f); }

// ── Pitch + formant ───────────────────────────────────────────────────────────
class Pitch : public Node {
public:
    float semitones = 0, formant = 1;
    bool preserve = true;
    int fftSize = 0;  // 0 = default
    void prepare(double sr, int maxBlock) override {
        SpectralShifter::Config c;
        if (fftSize > 0) c.fftSize = fftSize;
        sh_.prepare(sr, c);
        tmp_.assign(maxBlock, 0.f);
        apply();
    }
    void process(float* x, int n) override {
        std::copy(x, x + n, tmp_.begin());
        sh_.process(tmp_.data(), x, n);
    }
    int latency() const override { return sh_.latency(); }
    bool setParam(const std::string& k, double v) override {
        if (k == "semitones") semitones = (float)v;
        else if (k == "formant") formant = (float)v;
        else return false;
        apply();
        return true;
    }

private:
    SpectralShifter sh_;
    std::vector<float> tmp_;
    void apply() {
        sh_.setPitch(semis(semitones));
        sh_.setFormant(formant);
        sh_.setPreserveFormants(preserve);
    }
};

// ── Autotune: snap F0 to a scale ──────────────────────────────────────────────
class Autotune : public Node {
public:
    std::string key = "C_major";
    float speed = 0.05f;  // 0..1, fraction of the remaining correction per 4 ms
    void prepare(double sr, int maxBlock) override {
        tracker_.prepare(sr, 70.f, 900.f);
        sh_.prepare(sr);
        tmp_.assign(maxBlock, 0.f);
        setScale(key);
    }
    void process(float* x, int n) override {
        if (tracker_.push(x, n)) {
            float f0 = tracker_.f0();
            if (f0 > 0) {
                float midi = 69.f + 12.f * std::log2(f0 / 440.f);
                float pc = std::fmod(midi, 12.f);
                float best = 0, bestAbs = 99;
                for (int s = 0; s < 12; ++s) {
                    if (!(scaleMask_ >> s & 1)) continue;
                    float d = std::fmod((float)s - pc + 18.f, 12.f) - 6.f;
                    if (std::fabs(d) < bestAbs) { bestAbs = std::fabs(d); best = d; }
                }
                target_ = best;
            }
            float a = std::clamp(speed <= 0 ? 1.f : (1.f - speed) * 0.9f + 0.1f, 0.01f, 1.f);
            shift_ += a * (target_ - shift_);
            sh_.setPitch(semis(shift_));
        }
        std::copy(x, x + n, tmp_.begin());
        sh_.process(tmp_.data(), x, n);
    }
    int latency() const override { return sh_.latency(); }
    bool setParam(const std::string& k, double v) override {
        if (k == "speed") { speed = (float)v; return true; }
        return false;
    }
    void setScale(const std::string& k) {
        static const int major[] = {0, 2, 4, 5, 7, 9, 11}, minor[] = {0, 2, 3, 5, 7, 8, 10};
        static const char* names[] = {"C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"};
        key = k;
        scaleMask_ = 0;
        if (k == "chromatic") { scaleMask_ = 0xFFF; return; }
        std::string root = k.substr(0, k.find('_'));
        bool isMinor = k.find("minor") != std::string::npos;
        int r = 0;
        for (int i = 0; i < 12; ++i) if (root == names[i]) r = i;
        for (int s : (isMinor ? minor : major)) scaleMask_ |= 1 << ((s + r) % 12);
    }

private:
    PitchTracker tracker_;
    SpectralShifter sh_;
    std::vector<float> tmp_;
    int scaleMask_ = 0xAB5;
    float target_ = 0, shift_ = 0;
};

// ── Harmony: pitch-shifted copies mixed with the (latency-aligned) dry ───────
class Harmony : public Node {
public:
    std::vector<float> intervals{4, 7};
    float detuneCents = 0, wet = 0.4f;
    void prepare(double sr, int maxBlock) override {
        voices_.clear();
        for (size_t i = 0; i < intervals.size(); ++i) {
            auto v = std::make_unique<SpectralShifter>();
            v->prepare(sr);
            float c = detuneCents * (i % 2 ? -1.f : 1.f);
            v->setPitch(semis(intervals[i] + c / 100.f));
            voices_.push_back(std::move(v));
        }
        lat_ = voices_.empty() ? 0 : voices_[0]->latency();
        dry_.prepare(lat_ + 4);
        tmp_.assign(maxBlock, 0.f);
        sum_.assign(maxBlock, 0.f);
    }
    void process(float* x, int n) override {
        if (voices_.empty()) return;
        std::fill(sum_.begin(), sum_.begin() + n, 0.f);
        for (auto& v : voices_) {
            v->process(x, tmp_.data(), n);
            for (int i = 0; i < n; ++i) sum_[i] += tmp_[i];
        }
        float g = 1.f / voices_.size();
        for (int i = 0; i < n; ++i) {
            dry_.push(x[i]);
            float d = dry_.readInt(lat_ + 1);
            x[i] = d * (1.f - wet) + sum_[i] * g * wet;
        }
    }
    int latency() const override { return lat_; }
    bool setParam(const std::string& k, double v) override {
        if (k == "wet") { wet = (float)v; return true; }
        return false;
    }

private:
    std::vector<std::unique_ptr<SpectralShifter>> voices_;
    DelayLine dry_;
    std::vector<float> tmp_, sum_;
    int lat_ = 0;
};

// ── Whisper: phase randomisation in the spectral shifter ─────────────────────
class Whisper : public Node {
public:
    float breathiness = 0.7f;
    void prepare(double sr, int maxBlock) override {
        sh_.prepare(sr);
        sh_.setBreath(breathiness);
        tmp_.assign(maxBlock, 0.f);
    }
    void process(float* x, int n) override {
        std::copy(x, x + n, tmp_.begin());
        sh_.process(tmp_.data(), x, n);
    }
    int latency() const override { return sh_.latency(); }
    bool setParam(const std::string& k, double v) override {
        if (k != "breathiness") return false;
        breathiness = (float)v;
        sh_.setBreath(breathiness);
        return true;
    }

private:
    SpectralShifter sh_;
    std::vector<float> tmp_;
};

// ── Character persona: pitch moved toward a target voice, keeping intonation ──
// Instead of flattening every syllable onto one target note, track the
// speaker's long-term mean log-F0 and shift by the ratio of means. Intonation
// survives, so the result sounds like a different speaker, not a robot.
class Persona : public Node {
public:
    float targetF0 = 200, formant = 1, breathiness = 0, roughness = 0, brightness = 0;
    float vibRate = 0, vibDepthCents = 0;
    void prepare(double sr, int maxBlock) override {
        sr_ = sr;
        tracker_.prepare(sr);
        sh_.prepare(sr);
        sh_.setFormant(formant);
        sh_.setBreath(breathiness * 0.6f);
        shelf_.highShelf(sr, 2000, brightness * 6.0);
        vib_.setRate(sr, vibRate);
        jitterLp_.lowpass(sr, 60.0, 0.7);
        tmp_.assign(maxBlock, 0.f);
        meanLog_ = std::log(150.f);
        voicedSeen_ = 0;
        shiftSmooth_.setTime(sr, 40.0);
        shiftSmooth_.snap(0.f);
    }
    void process(float* x, int n) override {
        if (tracker_.push(x, n)) {
            float f0 = tracker_.f0();
            if (f0 > 0 && tracker_.confidence() > 0.6f) {
                float lf = std::log(f0);
                // Fast start (first ~0.3 s voiced), then a ~2 s time constant.
                float a = voicedSeen_ < 75 ? 1.f / (voicedSeen_ + 1) : 0.002f;
                meanLog_ += a * (lf - meanLog_);
                ++voicedSeen_;
            }
            float st = 12.f * (std::log(targetF0) - meanLog_) / std::log(2.f);
            shiftSmooth_.target = std::clamp(st, -24.f, 24.f);
        }
        // Vibrato and smoothing advance once per block (pitch is per-frame anyway).
        float s = 0;
        for (int i = 0; i < n; ++i) s = shiftSmooth_.next();
        float vib = 0;
        if (vibRate > 0 && vibDepthCents > 0) {
            for (int i = 0; i < n; ++i) vib = vib_.next();
            vib *= vibDepthCents / 100.f;
        }
        sh_.setPitch(semis(s + vib));
        std::copy(x, x + n, tmp_.begin());
        sh_.process(tmp_.data(), x, n);

        for (int i = 0; i < n; ++i) {
            float y = x[i];
            if (roughness > 0.01f) y *= 1.f + jitterLp_.tick(rng_.gauss()) * roughness * 2.5f;
            if (std::fabs(brightness) > 0.01f) y = shelf_.tick(y);
            x[i] = y;
        }
    }
    int latency() const override { return sh_.latency(); }
    bool setParam(const std::string& k, double v) override {
        if (k == "target_f0_mean") targetF0 = (float)v;
        else if (k == "resonance_shift" || k == "formant") { formant = (float)v; sh_.setFormant(formant); }
        else if (k == "breathiness") { breathiness = (float)v; sh_.setBreath(breathiness * 0.6f); }
        else if (k == "roughness") roughness = (float)v;
        else return false;
        return true;
    }

private:
    double sr_ = 48000;
    PitchTracker tracker_;
    SpectralShifter sh_;
    Biquad shelf_, jitterLp_;
    SineLfo vib_;
    Smoother shiftSmooth_;
    FastRand rng_{0xC0FFEEu};
    std::vector<float> tmp_;
    float meanLog_ = 5.0f;
    int voicedSeen_ = 0;
};

// ── Robot: 16-band channel vocoder with a band-limited saw carrier ───────────
class Robot : public Node {
public:
    float carrierFreq = 120, depth = 0.8f;
    static constexpr int kBands = 16;
    void prepare(double sr, int) override {
        sr_ = sr;
        for (int b = 0; b < kBands; ++b) {
            double lo = 80.0 * std::pow(100.0, (double)b / kBands);
            double hi = 80.0 * std::pow(100.0, (double)(b + 1) / kBands);
            double fc = std::sqrt(lo * hi), q = fc / (hi - lo);
            for (int s = 0; s < 2; ++s) {
                an_[b][s].bandpass(sr, fc, q);
                sy_[b][s].bandpass(sr, fc, q);
            }
            env_[b].setup(sr, 5.0, 50.0);
        }
        phase_ = 0;
    }
    void process(float* x, int n) override {
        double inc = carrierFreq / sr_;
        for (int i = 0; i < n; ++i) {
            // PolyBLEP saw.
            double t = phase_;
            float saw = (float)(2.0 * t - 1.0);
            if (t < inc) { double u = t / inc; saw -= (float)(u + u - u * u - 1.0); }
            else if (t > 1.0 - inc) { double u = (t - 1.0) / inc; saw -= (float)(u * u + u + u + 1.0); }
            phase_ += inc;
            if (phase_ >= 1.0) phase_ -= 1.0;

            float in = x[i], out = 0.f;
            for (int b = 0; b < kBands; ++b) {
                float e = env_[b].tick(an_[b][1].tick(an_[b][0].tick(in)));
                out += sy_[b][1].tick(sy_[b][0].tick(saw * e));
            }
            x[i] = in * (1.f - depth) + out * depth * 18.f;
        }
    }
    bool setParam(const std::string& k, double v) override {
        if (k == "carrier_freq") carrierFreq = (float)v;
        else if (k == "depth") depth = (float)v;
        else return false;
        return true;
    }

private:
    double sr_ = 48000, phase_ = 0;
    Biquad an_[kBands][2], sy_[kBands][2];
    EnvFollower env_[kBands];
};

// ── Reverb: Freeverb topology (8 damped combs + 4 allpasses), mono ───────────
class Reverb : public Node {
public:
    float room = 0.4f, damping = 0.6f, wet = 0.25f, preDelayMs = 5.f;
    void prepare(double sr, int) override {
        static const int combT[8] = {1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617};
        static const int apT[4] = {556, 441, 341, 225};
        double k = sr / 44100.0;
        for (int i = 0; i < 8; ++i) { combs_[i].prepare((int)(combT[i] * k)); combLen_[i] = (int)(combT[i] * k); combLp_[i] = 0; }
        for (int i = 0; i < 4; ++i) { aps_[i].prepare((int)(apT[i] * k)); apLen_[i] = (int)(apT[i] * k); }
        pre_.prepare((int)(0.2 * sr));
        sr_ = sr;
    }
    void process(float* x, int n) override {
        float fb = 0.7f + room * 0.28f, damp = damping * 0.4f;
        int pd = std::max(1, (int)(preDelayMs * 0.001 * sr_));
        for (int i = 0; i < n; ++i) {
            pre_.push(x[i]);
            float in = pre_.readInt(pd) * 0.015f * 2.f, acc = 0.f;
            for (int c = 0; c < 8; ++c) {
                float y = combs_[c].readInt(combLen_[c]);
                combLp_[c] = y * (1.f - damp) + combLp_[c] * damp;
                combs_[c].push(in + combLp_[c] * fb);
                acc += y;
            }
            for (int a = 0; a < 4; ++a) {
                float b = aps_[a].readInt(apLen_[a]);
                aps_[a].push(acc + b * 0.5f);
                acc = b - acc;
            }
            x[i] = x[i] * (1.f - wet) + acc * wet;
        }
    }
    bool setParam(const std::string& k, double v) override {
        if (k == "room") room = (float)v;
        else if (k == "wet") wet = (float)v;
        else if (k == "damping") damping = (float)v;
        else if (k == "pre_delay_ms") preDelayMs = (float)std::clamp(v, 0.0, 190.0);
        else return false;
        return true;
    }

private:
    DelayLine combs_[8], aps_[4], pre_;
    int combLen_[8]{}, apLen_[4]{};
    float combLp_[8]{};
    double sr_ = 48000;
};

// ── Chorus (multi-voice), Vibrato, Delay, Wah ─────────────────────────────────
class Chorus : public Node {
public:
    float rate = 1.5f, depthMs = 10.f, feedback = 0.2f, wet = 0.5f;
    int voices = 2;
    void prepare(double sr, int) override {
        sr_ = sr;
        line_.prepare((int)(0.06 * sr));
        voices = std::clamp(voices, 1, 4);
        for (int v = 0; v < 4; ++v) { lfo_[v].setRate(sr, rate); lfo_[v].phase = (double)v / voices; }
    }
    void process(float* x, int n) override {
        float depth = depthMs * 0.001f * (float)sr_, base = 0.005f * (float)sr_;
        float fb = std::min(feedback, 0.9f / voices);
        for (int i = 0; i < n; ++i) {
            float sum = 0.f;
            for (int v = 0; v < voices; ++v) sum += line_.read(base + depth * 0.5f * (1.f + lfo_[v].next()));
            sum /= voices;
            line_.push(x[i] + sum * fb);
            x[i] = x[i] * (1.f - wet) + sum * wet;
        }
    }
    bool setParam(const std::string& k, double v) override {
        if (k == "rate") { rate = (float)v; for (auto& l : lfo_) l.setRate(sr_, rate); }
        else if (k == "depth") depthMs = (float)std::clamp(v, 0.0, 50.0);
        else if (k == "wet") wet = (float)v;
        else return false;
        return true;
    }

private:
    double sr_ = 48000;
    DelayLine line_;
    SineLfo lfo_[4];
};

class Vibrato : public Node {
public:
    float rate = 5.f, depth = 0.3f;  // depth 1.0 = 5 ms sweep (Python semantics)
    void prepare(double sr, int) override { sr_ = sr; line_.prepare((int)(0.04 * sr)); lfo_.setRate(sr, rate); }
    void process(float* x, int n) override {
        float d = depth * 5.f * 0.001f * (float)sr_;
        for (int i = 0; i < n; ++i) {
            line_.push(x[i]);
            x[i] = line_.read(2.f + d * 0.5f * (1.f + lfo_.next()));
        }
    }
    bool setParam(const std::string& k, double v) override {
        if (k == "rate") { rate = (float)v; lfo_.setRate(sr_, rate); }
        else if (k == "depth") depth = (float)std::clamp(v, 0.0, 5.0);
        else return false;
        return true;
    }

private:
    double sr_ = 48000;
    DelayLine line_;
    SineLfo lfo_;
};

class Delay : public Node {
public:
    float delayMs = 250, feedback = 0.3f, wet = 0.4f;
    void prepare(double sr, int) override { sr_ = sr; line_.prepare((int)(2.0 * sr)); }
    void process(float* x, int n) override {
        int d = std::clamp((int)(delayMs * 0.001 * sr_), 1, line_.size() - 8);
        float fb = std::min(feedback, 0.95f);
        for (int i = 0; i < n; ++i) {
            float y = line_.readInt(d);
            line_.push(x[i] + y * fb);
            x[i] = x[i] * (1.f - wet) + y * wet;
        }
    }
    bool setParam(const std::string& k, double v) override {
        if (k == "delay_ms") delayMs = (float)std::clamp(v, 1.0, 1990.0);
        else if (k == "feedback") feedback = (float)v;
        else if (k == "wet") wet = (float)v;
        else return false;
        return true;
    }

private:
    double sr_ = 48000;
    DelayLine line_;
};

class Wah : public Node {
public:
    float rate = 2.f, depth = 0.7f;
    void prepare(double sr, int) override { sr_ = sr; lfo_.setRate(sr, rate); }
    void process(float* x, int n) override {
        for (int i = 0; i < n; ++i) {
            float l = 0.5f * (1.f + lfo_.next());
            if ((i & 15) == 0) bp_.bandpass(sr_, 300.0 + l * depth * 2700.0, 3.0);
            x[i] = x[i] * (1.f - depth) + bp_.tick(x[i]) * depth * 1.5f;
        }
    }
    bool setParam(const std::string& k, double v) override {
        if (k == "rate") { rate = (float)v; lfo_.setRate(sr_, rate); }
        else if (k == "depth") depth = (float)v;
        else return false;
        return true;
    }

private:
    double sr_ = 48000;
    SineLfo lfo_;
    Biquad bp_;
};

// ── Distortion / bitcrusher / decimator ───────────────────────────────────────
class Distortion : public Node {
public:
    float drive = 3.f;
    int bits = 16, downsample = 1;
    void prepare(double, int) override { hold_ = 0; cnt_ = 0; }
    void process(float* x, int n) override {
        float norm = 1.f / std::tanh(std::min(drive, 20.f));
        float levels = std::pow(2.f, (float)bits - 1.f);
        for (int i = 0; i < n; ++i) {
            float v = x[i];
            if (downsample > 1) {
                if (cnt_ == 0) hold_ = v;
                v = hold_;
                if (++cnt_ >= downsample) cnt_ = 0;
            }
            v = std::tanh(v * drive) * norm;
            if (bits < 16) v = std::round(v * levels) / levels;
            x[i] = v;
        }
    }
    bool setParam(const std::string& k, double v) override {
        if (k == "drive") drive = (float)std::max(0.1, v);
        else if (k == "bits") bits = std::clamp((int)v, 2, 16);
        else if (k == "downsample") downsample = std::clamp((int)v, 1, 32);
        else return false;
        return true;
    }

private:
    float hold_ = 0;
    int cnt_ = 0;
};

// ── 3-band EQ ─────────────────────────────────────────────────────────────────
class EQ : public Node {
public:
    float low = 0, mid = 0, high = 0, lowFreq = 200, midFreq = 1000, highFreq = 4000, midQ = 0.7f;
    void prepare(double sr, int) override { sr_ = sr; rebuild(); }
    void process(float* x, int n) override {
        for (int i = 0; i < n; ++i) x[i] = h_.tick(m_.tick(l_.tick(x[i])));
    }
    bool setParam(const std::string& k, double v) override {
        if (k == "low") low = (float)v;
        else if (k == "mid") mid = (float)v;
        else if (k == "high") high = (float)v;
        else if (k == "low_freq") lowFreq = (float)v;
        else if (k == "mid_freq") midFreq = (float)v;
        else if (k == "high_freq") highFreq = (float)v;
        else return false;
        rebuild();
        return true;
    }

private:
    double sr_ = 48000;
    Biquad l_, m_, h_;
    // Coefficients only; filter state is kept so live tweaks don't click.
    void rebuild() {
        l_.lowShelf(sr_, lowFreq, low);
        m_.peak(sr_, midFreq, midQ, mid);
        h_.highShelf(sr_, highFreq, high);
    }
};

// ── Coloured noise injection (radio, walkie-talkie) ───────────────────────────
class NoiseInject : public Node {
public:
    int color = 0;  // 0 white, 1 pink, 2 brown
    float level = 0.03f;
    void prepare(double, int) override { b0_ = b1_ = b2_ = brown_ = 0; }
    void process(float* x, int n) override {
        for (int i = 0; i < n; ++i) {
            float w = rng_.gauss(), v;
            if (color == 0) v = w * level;
            else if (color == 1) {  // Paul Kellet's economy pink filter
                b0_ = 0.99765f * b0_ + w * 0.0990460f;
                b1_ = 0.96300f * b1_ + w * 0.2965164f;
                b2_ = 0.57000f * b2_ + w * 1.0526913f;
                v = (b0_ + b1_ + b2_ + w * 0.1848f) * 0.25f * level;
            } else {
                brown_ = std::clamp(brown_ + w * 0.02f, -1.f, 1.f) * 0.998f;
                v = brown_ * level * 2.f;
            }
            x[i] += v;
        }
    }
    bool setParam(const std::string& k, double v) override {
        if (k == "level") { level = (float)v; return true; }
        return false;
    }

private:
    FastRand rng_{0xBADC0DEu};
    float b0_ = 0, b1_ = 0, b2_ = 0, brown_ = 0;
};

// ── Engine-level dynamics ─────────────────────────────────────────────────────

// Noise gate: peak envelope with hysteresis and hold; smooth gain ramps.
class Gate {
public:
    float thresholdDb = -44.f;
    void prepare(double sr) {
        sr_ = sr;
        det_.setup(sr, 0.5, 30.0);
        attack_ = (float)(1.0 - std::exp(-1.0 / (sr * 0.0015)));
        release_ = (float)(1.0 - std::exp(-1.0 / (sr * 0.12)));
        holdMax_ = (int)(0.08 * sr);
    }
    void process(float* x, int n) {
        const float open = dbToLin(thresholdDb), close = dbToLin(thresholdDb - 6.f);
        for (int i = 0; i < n; ++i) {
            float e = det_.tick(x[i]);
            if (e > open) { isOpen_ = true; hold_ = holdMax_; }
            else if (e < close && isOpen_ && --hold_ <= 0) isOpen_ = false;
            float t = isOpen_ ? 1.f : 0.f;
            gain_ += (t > gain_ ? attack_ : release_) * (t - gain_);
            x[i] *= gain_;
        }
    }

private:
    double sr_ = 48000;
    EnvFollower det_;
    float attack_ = 0, release_ = 0, gain_ = 0;
    int hold_ = 0, holdMax_ = 0;
    bool isOpen_ = false;
};

// Output safety: fast-attack peak limiter at -1 dBFS plus a soft clip.
class Limiter {
public:
    void prepare(double sr) {
        rel_ = (float)(1.0 - std::exp(-1.0 / (sr * 0.08)));
        gain_ = 1.f;
    }
    void process(float* x, int n) {
        const float ceil = 0.891f;  // -1 dBFS
        for (int i = 0; i < n; ++i) {
            float a = std::fabs(x[i]);
            if (!(a == a)) { x[i] = 0.f; continue; }  // NaN guard
            float need = a > ceil ? ceil / a : 1.f;
            if (need < gain_) gain_ = need;
            else gain_ += rel_ * (1.f - gain_);
            float y = x[i] * gain_;
            x[i] = y > 0.95f ? 0.95f + 0.05f * std::tanh((y - 0.95f) * 20.f)
                 : y < -0.95f ? -0.95f + 0.05f * std::tanh((y + 0.95f) * 20.f) : y;
        }
    }
    float gainReductionDb() const { return linToDb(gain_); }

private:
    float rel_ = 0, gain_ = 1.f;
};

}  // namespace aurora::nodes
