// Streaming band-limited resampler (windowed sinc, Smith's bandlimited
// interpolation) for arbitrary rate pairs, e.g. 48 kHz <-> 16 kHz around a
// neural model. Short kernel (8 zero crossings each side of the lower rate)
// keeps the delay under ~0.5 ms per direction at 16 kHz.
#pragma once

#include <cmath>
#include <vector>

#include "basics.h"

namespace aurora::dsp {

class Resampler {
public:
    void prepare(double inRate, double outRate, int zeroCrossings = 8) {
        step_ = inRate / outRate;  // input samples per output sample
        // Cutoff relative to the input Nyquist; a little under the lower Nyquist.
        fc_ = std::min(1.0, outRate / inRate) * 0.92;
        Z_ = zeroCrossings;
        half_ = (int)std::ceil(Z_ / fc_);  // kernel half-width in input samples
        // Kernel table over u in [0, half_], kPhases points per input sample.
        table_.assign((size_t)half_ * kPhases + 2, 0.f);
        for (size_t i = 0; i < table_.size(); ++i) {
            double u = (double)i / kPhases;
            double x = u * fc_;
            double sinc = x < 1e-9 ? 1.0 : std::sin(kPi * x) / (kPi * x);
            double w = u >= half_ ? 0.0 : kaiser(u / half_, 8.0);
            table_[i] = (float)(fc_ * sinc * w);
        }
        histLen_ = 2 * half_ + 8;
        hist_.assign((size_t)histLen_ * 2, 0.f);
        w_ = 0;
        count_ = 0;
        t_ = 0;
    }

    // Delay in output samples.
    double latencyOut() const { return half_ / step_; }

    // Consumes all `n` inputs; appends outputs to `out` (returns how many).
    int process(const float* in, int n, float* out, int outCap) {
        int produced = 0;
        for (int i = 0; i < n; ++i) {
            // Double-written ring keeps every kernel window contiguous.
            hist_[w_] = in[i];
            hist_[w_ + histLen_] = in[i];
            w_ = (w_ + 1) % histLen_;
            ++count_;
            // Output positions are measured in input samples since start,
            // delayed by half_ so the whole kernel is available.
            while (t_ + half_ + 1 <= (double)count_ && produced < outCap) {
                out[produced++] = evaluate(t_);
                t_ += step_;
            }
        }
        // Keep t_ and count_ small to protect precision.
        if (count_ > (1 << 20)) {
            double shift = std::floor(t_);
            t_ -= shift;
            count_ -= (long)shift;
        }
        return produced;
    }

    // Upper bound of outputs for n inputs.
    int maxOut(int n) const { return (int)std::ceil(n / step_) + 2; }

private:
    static constexpr int kPhases = 256;
    double step_ = 1, fc_ = 0.92, t_ = 0;
    int Z_ = 8, half_ = 9, histLen_ = 0, w_ = 0;
    long count_ = 0;
    std::vector<float> table_, hist_;

    static double bessel0(double x) {
        double s = 1, t = 1;
        for (int k = 1; k < 25; ++k) { t *= (x / (2 * k)) * (x / (2 * k)); s += t; }
        return s;
    }
    static double kaiser(double r, double beta) {
        return r >= 1 ? 0.0 : bessel0(beta * std::sqrt(1 - r * r)) / bessel0(beta);
    }
    inline float kernel(double u) const {
        u = std::fabs(u) * kPhases;
        size_t i = (size_t)u;
        if (i + 1 >= table_.size()) return 0.f;
        float f = (float)(u - i);
        return table_[i] + f * (table_[i + 1] - table_[i]);
    }

    // Output at input-time position t (input samples since start), using the
    // inputs within half_ either side. process() only calls this once t+half_
    // has arrived, which is where the resampler's delay comes from.
    float evaluate(double t) const {
        const long newest = count_ - 1;
        const long first = std::max(0L, (long)std::floor(t) - half_ + 1);
        const long last = std::min(newest, (long)std::floor(t) + half_);
        float acc = 0.f;
        for (long k = first; k <= last; ++k) {
            long back = newest - k;
            if (back >= histLen_) continue;
            int idx = (w_ - 1 - (int)back + histLen_) % histLen_;
            acc += hist_[idx] * kernel(t - (double)k);
        }
        return acc;
    }
};

}  // namespace aurora::dsp
