// Streaming F0 tracker: YIN (de Cheveigné & Kawahara 2002) on a signal
// decimated to ~12 kHz, re-estimated every ~4 ms from past samples only, so
// it adds no latency to the audio path.
#pragma once

#include <cmath>
#include <vector>

#include "basics.h"

namespace aurora::dsp {

class PitchTracker {
public:
    void prepare(double sr, float minHz = 65.f, float maxHz = 700.f) {
        sr_ = sr;
        dec_ = std::max(1, (int)std::lround(sr / 12000.0));
        srd_ = sr / dec_;
        // 4th-order Butterworth anti-alias at ~0.32 x the decimated rate.
        aa1_.lowpass(sr, 0.32 * srd_, 0.5412);
        aa2_.lowpass(sr, 0.32 * srd_, 1.3066);
        minLag_ = std::max(2, (int)std::floor(srd_ / maxHz));
        maxLag_ = (int)std::ceil(srd_ / minHz);
        W_ = maxLag_ + 8;
        len_ = W_ + maxLag_ + 2;
        buf_.assign(len_ * 2, 0.f);
        d_.assign(maxLag_ + 2, 0.f);
        pos_ = 0;
        decCount_ = 0;
        hop_ = std::max(1, (int)std::lround(srd_ * 0.004));
        hopCount_ = 0;
        f0_ = 0.f;
        conf_ = 0.f;
    }

    // Feed audio; returns true when a new estimate was produced.
    bool push(const float* x, int n) {
        bool updated = false;
        for (int i = 0; i < n; ++i) {
            float y = aa2_.tick(aa1_.tick(x[i]));
            if (++decCount_ < dec_) continue;
            decCount_ = 0;
            // Double-write ring so the analysis window is always contiguous.
            buf_[pos_] = y;
            buf_[pos_ + len_] = y;
            pos_ = (pos_ + 1) % len_;
            if (++hopCount_ >= hop_) {
                hopCount_ = 0;
                estimate();
                updated = true;
            }
        }
        return updated;
    }

    float f0() const { return f0_; }          // Hz, 0 when unvoiced
    float confidence() const { return conf_; } // 1 - aperiodicity

private:
    double sr_ = 48000, srd_ = 12000;
    int dec_ = 4, decCount_ = 0, minLag_ = 17, maxLag_ = 185, W_ = 193, len_ = 0, pos_ = 0;
    int hop_ = 48, hopCount_ = 0;
    Biquad aa1_, aa2_;
    std::vector<float> buf_, d_;
    float f0_ = 0.f, conf_ = 0.f;

    void estimate() {
        const float* x = &buf_[pos_];  // oldest sample of the last len_ samples
        // Energy gate: skip silence.
        float e = 0.f;
        for (int j = 0; j < W_; ++j) e += x[j] * x[j];
        if (e < 1e-6f * W_) {
            f0_ = 0.f;
            conf_ = 0.f;
            return;
        }
        // Difference function and cumulative mean normalisation.
        d_[0] = 1.f;
        float running = 0.f;
        int best = -1;
        for (int tau = 1; tau <= maxLag_; ++tau) {
            float s = 0.f;
            const float* xt = x + tau;
            for (int j = 0; j < W_; ++j) {
                float df = x[j] - xt[j];
                s += df * df;
            }
            running += s;
            d_[tau] = running > 0.f ? s * tau / running : 1.f;
        }
        const float thresh = 0.15f;
        for (int tau = minLag_; tau < maxLag_; ++tau) {
            if (d_[tau] < thresh) {
                while (tau + 1 < maxLag_ && d_[tau + 1] < d_[tau]) ++tau;
                best = tau;
                break;
            }
        }
        if (best < 0) {
            // No dip under threshold: take the global minimum only if it is clear.
            int m = minLag_;
            for (int tau = minLag_; tau < maxLag_; ++tau)
                if (d_[tau] < d_[m]) m = tau;
            if (d_[m] > 0.35f) {
                f0_ = 0.f;
                conf_ = 1.f - std::min(1.f, d_[m]);
                return;
            }
            best = m;
        }
        float lag = (float)best;
        if (best > 1 && best < maxLag_) {
            float a = d_[best - 1], b = d_[best], c = d_[best + 1];
            float den = a - 2 * b + c;
            if (std::fabs(den) > 1e-9f) lag += 0.5f * (a - c) / den;
        }
        conf_ = 1.f - std::min(1.f, d_[best]);
        f0_ = (float)(srd_ / lag);
    }
};

}  // namespace aurora::dsp
