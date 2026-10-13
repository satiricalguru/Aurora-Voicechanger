// DSP building blocks: biquads, delay lines, LFOs, smoothers, envelope
// followers. All allocation happens in prepare()/constructors.
#pragma once

#include <cmath>
#include <vector>

#include "../rt.h"

namespace aurora::dsp {

constexpr double kPi = 3.14159265358979323846;
constexpr double kTwoPi = 2.0 * kPi;

// RBJ cookbook biquad, transposed direct form II, double state.
struct Biquad {
    double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
    double z1 = 0, z2 = 0;

    inline float tick(float xf) {
        double x = xf;
        double y = b0 * x + z1;
        z1 = b1 * x - a1 * y + z2;
        z2 = b2 * x - a2 * y;
        return (float)y;
    }
    void process(float* x, int n) {
        for (int i = 0; i < n; ++i) x[i] = tick(x[i]);
    }
    void reset() { z1 = z2 = 0; }

    void set(double nb0, double nb1, double nb2, double a0, double na1, double na2) {
        b0 = nb0 / a0; b1 = nb1 / a0; b2 = nb2 / a0;
        a1 = na1 / a0; a2 = na2 / a0;
    }

    void lowpass(double sr, double f, double q = 0.7071) {
        double w = kTwoPi * clampF(f, sr) / sr, c = std::cos(w), al = std::sin(w) / (2 * q);
        set((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al);
    }
    void highpass(double sr, double f, double q = 0.7071) {
        double w = kTwoPi * clampF(f, sr) / sr, c = std::cos(w), al = std::sin(w) / (2 * q);
        set((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al);
    }
    // Constant 0 dB peak gain bandpass.
    void bandpass(double sr, double f, double q) {
        double w = kTwoPi * clampF(f, sr) / sr, c = std::cos(w), al = std::sin(w) / (2 * q);
        set(al, 0, -al, 1 + al, -2 * c, 1 - al);
    }
    void peak(double sr, double f, double q, double gainDb) {
        double A = std::pow(10.0, gainDb / 40.0);
        double w = kTwoPi * clampF(f, sr) / sr, c = std::cos(w), al = std::sin(w) / (2 * q);
        set(1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A);
    }
    void lowShelf(double sr, double f, double gainDb) {
        double A = std::pow(10.0, gainDb / 40.0);
        double w = kTwoPi * clampF(f, sr) / sr, c = std::cos(w), s = std::sin(w);
        double al = s / 2 * std::sqrt(2.0), sA = 2 * std::sqrt(A) * al;
        set(A * ((A + 1) - (A - 1) * c + sA), 2 * A * ((A - 1) - (A + 1) * c),
            A * ((A + 1) - (A - 1) * c - sA), (A + 1) + (A - 1) * c + sA,
            -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - sA);
    }
    void highShelf(double sr, double f, double gainDb) {
        double A = std::pow(10.0, gainDb / 40.0);
        double w = kTwoPi * clampF(f, sr) / sr, c = std::cos(w), s = std::sin(w);
        double al = s / 2 * std::sqrt(2.0), sA = 2 * std::sqrt(A) * al;
        set(A * ((A + 1) + (A - 1) * c + sA), -2 * A * ((A - 1) + (A + 1) * c),
            A * ((A + 1) + (A - 1) * c - sA), (A + 1) - (A - 1) * c + sA,
            2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - sA);
    }

private:
    static double clampF(double f, double sr) {
        double hi = sr * 0.49;
        return f < 10 ? 10 : (f > hi ? hi : f);
    }
};

// One-pole smoother for parameters (avoids zipper noise).
struct Smoother {
    float cur = 0, target = 0, coef = 0.001f;
    void setTime(double sr, double ms) { coef = (float)(1.0 - std::exp(-1.0 / (sr * ms * 0.001))); }
    void snap(float v) { cur = target = v; }
    inline float next() { return cur += coef * (target - cur); }
};

// Circular delay line with fractional (cubic Hermite) reads.
class DelayLine {
public:
    void prepare(int maxSamples) {
        size_ = (int)nextPow2((uint32_t)maxSamples + 4);
        mask_ = size_ - 1;
        buf_.assign(size_, 0.f);
        w_ = 0;
    }
    void reset() { std::fill(buf_.begin(), buf_.end(), 0.f); }
    inline void push(float x) {
        buf_[w_] = x;
        w_ = (w_ + 1) & mask_;
    }
    // Delay in samples relative to the most recent push (1 = last sample).
    inline float readInt(int d) const { return buf_[(w_ - d) & mask_]; }
    inline float read(float d) const {
        if (d < 1.f) d = 1.f;
        int i = (int)d;
        float f = d - i;
        float xm1 = readInt(i - 1 < 1 ? 1 : i - 1), x0 = readInt(i), x1 = readInt(i + 1), x2 = readInt(i + 2);
        float c1 = 0.5f * (x1 - xm1);
        float c2 = xm1 - 2.5f * x0 + 2.f * x1 - 0.5f * x2;
        float c3 = 0.5f * (x2 - xm1) + 1.5f * (x0 - x1);
        return ((c3 * f + c2) * f + c1) * f + x0;
    }
    int size() const { return size_; }

private:
    std::vector<float> buf_;
    int size_ = 0, mask_ = 0, w_ = 0;
};

struct SineLfo {
    double phase = 0, inc = 0;
    void setRate(double sr, double hz) { inc = hz / sr; }
    inline float next() {
        float v = (float)std::sin(kTwoPi * phase);
        phase += inc;
        if (phase >= 1.0) phase -= 1.0;
        return v;
    }
};

// Peak envelope follower with separate attack and release.
struct EnvFollower {
    float env = 0, att = 0, rel = 0;
    void setup(double sr, double attackMs, double releaseMs) {
        att = (float)(1.0 - std::exp(-1.0 / (sr * attackMs * 0.001)));
        rel = (float)(1.0 - std::exp(-1.0 / (sr * releaseMs * 0.001)));
    }
    inline float tick(float x) {
        float a = std::fabs(x);
        env += (a > env ? att : rel) * (a - env);
        return env;
    }
};

// Cubic Hermite interpolation over 4 consecutive samples, f in [0,1).
inline float hermite(float xm1, float x0, float x1, float x2, float f) {
    float c1 = 0.5f * (x1 - xm1);
    float c2 = xm1 - 2.5f * x0 + 2.f * x1 - 0.5f * x2;
    float c3 = 0.5f * (x2 - xm1) + 1.5f * (x0 - x1);
    return ((c3 * f + c2) * f + c1) * f + x0;
}

}  // namespace aurora::dsp
