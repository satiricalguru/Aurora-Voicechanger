// Background-noise removal on the mic input, built on Xiph's RNNoise 0.2.
//
// Modes (measured on LibriSpeech + hiss/fan/keyboard at 5-10 dB SNR):
//  - Quality (30 ms, +6.0 dB SI-SDR): RNNoise end to end (band gains + pitch
//    comb filter), exactly as upstream. RNNoise looks one 10 ms frame ahead
//    and resynthesises with 50 % overlap, so with block buffering it adds 30 ms.
//  - Low latency (5.3 ms, +3.5 dB): RNNoise's network only predicts band
//    gains; they are applied through a low-delay STFT (N=1024 analysis, 2x128
//    synthesis). The gains arrive later than the audio they describe, so two
//    RNNoise instances run staggered by 5 ms to halve their update interval.
//  - Balanced (15.3 ms, +5.2 dB): the low-latency path with the audio held
//    back 10 ms so the gains line up with it.
// `strength` sets a floor on attenuation (6..40 dB), so a late gain can never
// fully swallow the start of a word.
// The network always runs at 48 kHz (RNNoise's rate); other engine rates get
// a resampled copy for analysis only.
#pragma once

extern "C" {
#include "rnnoise.h"
}

#include <cmath>
#include <memory>
#include <vector>

#include "dsp/basics.h"
#include "dsp/fft.h"
#include "dsp/resampler.h"
#include "graph.h"

namespace aurora::nodes {

class Denoise : public Node {
public:
    enum Mode { Off = 0, LowLatency = 1, Balanced = 2, Quality = 3 };
    int mode = LowLatency;
    float strength = 0.85f;  // 0..1: maximum attenuation 6 dB .. 40 dB
    // Low-latency tuning: gain release per STFT hop, staggered network
    // instances (1 or 2), and optional audio delay to line gains up better.
    float release = 0.7f;
    int instances = 2;
    float alignMs = -1.f;  // -1: per mode (0 low latency, 10 balanced)

    ~Denoise() override { destroy(); }

    void prepare(double sr, int maxBlock) override {
        destroy();
        sr_ = sr;
        nb_ = rnnoise_band_count();
        edges_ = rnnoise_band_edges();
        for (auto& s : st_) s = rnnoise_create(nullptr);
        q_ = rnnoise_create(nullptr);
        gains_.assign(nb_, 1.f);
        prepareLowDelay();
        // 48 kHz analysis stream for the network.
        resample_ = std::fabs(sr - 48000.0) > 1;
        if (resample_) to48_.prepare(sr, 48000.0);
        a48_.assign(960, 0.f);
        tmp48_.assign(to48_.maxOut(maxBlock) + 8, 0.f);
        count48_ = 0;
        // Quality path (48 kHz engine only).
        qIn_.assign(480, 0.f);
        qOut_.assign(480, 0.f);
        qFill_ = 0;
        qOutPos_ = 0;
        dry_.prepare(4096);
        alignMax_ = (int)std::lround(0.040 * sr);
        alignLine_.prepare(alignMax_ + 8);
        lastMode_ = -1;
    }

    int latency() const override {
        const int m = effectiveMode();
        if (m == LowLatency || m == Balanced) return 2 * M_ + alignFor(m);
        if (m == Quality) return kQualityDelay;
        return 0;
    }

    bool setParam(const std::string& k, double v) override {
        if (k == "mode") mode = std::clamp((int)v, 0, 3);
        else if (k == "strength") strength = (float)std::clamp(v, 0.0, 1.0);
        else return false;
        return true;
    }

    float vad() const { return vad_; }

    void process(float* x, int n) override {
        const int m = effectiveMode();
        if (m != lastMode_) reset(m);
        if (m == Off) return;
        if (m == Quality) processQuality(x, n);
        else processLowLatency(x, n, alignFor(m));
    }

private:
    static constexpr int kQualityDelay = 1440;  // 480 buffering + 2 frames inside RNNoise
    double sr_ = 48000;
    int nb_ = 32, lastMode_ = -1;
    const int* edges_ = nullptr;
    DenoiseState* st_[2] = {nullptr, nullptr};
    DenoiseState* q_ = nullptr;
    std::vector<float> gains_;
    float vad_ = 0;

    // 48 kHz analysis feed.
    bool resample_ = false;
    dsp::Resampler to48_;
    std::vector<float> a48_, tmp48_;  // a48_: last 960 samples, oldest first
    long count48_ = 0;

    // Low-delay STFT.
    int N_ = 1024, R_ = 64, M_ = 128, H_ = 512, hop_ = 0;
    dsp::RealFFT fft_;
    std::vector<float> wa_, ws_, in_, frame_, acc_, out_, re_, im_, binGain_, cur_;
    std::vector<int> binBand_;
    std::vector<float> binFrac_;

    // Quality path.
    std::vector<float> qIn_, qOut_;
    int qFill_ = 0, qOutPos_ = 0;
    dsp::DelayLine dry_, alignLine_;
    int alignMax_ = 0;

    // Quality runs RNNoise's own 48 kHz synthesis; at other rates use Balanced.
    int effectiveMode() const { return (mode == Quality && resample_) ? Balanced : mode; }
    int alignFor(int m) const {
        float ms = alignMs >= 0.f ? alignMs : (m == Balanced ? 10.f : 0.f);
        return std::min(alignMax_, (int)std::lround(ms * 0.001 * sr_));
    }

    float floorGain() const { return std::pow(10.f, -(6.f + 34.f * strength) / 20.f); }

    void destroy() {
        for (auto& s : st_) if (s) { rnnoise_destroy(s); s = nullptr; }
        if (q_) { rnnoise_destroy(q_); q_ = nullptr; }
    }

    void reset(int m) {
        lastMode_ = m;
        std::fill(gains_.begin(), gains_.end(), 1.f);
        std::fill(cur_.begin(), cur_.end(), 1.f);
        std::fill(in_.begin(), in_.end(), 0.f);
        std::fill(acc_.begin(), acc_.end(), 0.f);
        std::fill(out_.begin(), out_.end(), 0.f);
        std::fill(qIn_.begin(), qIn_.end(), 0.f);
        std::fill(qOut_.begin(), qOut_.end(), 0.f);
        hop_ = 0;
        qFill_ = 0;
        qOutPos_ = 0;
    }

    // ── Network feed: staggered instances, one every 240 samples (5 ms) ──
    void feedNetwork(const float* x, int n) {
        const float* src = x;
        if (resample_) {
            n = to48_.process(x, n, tmp48_.data(), (int)tmp48_.size());
            src = tmp48_.data();
        }
        for (int i = 0; i < n; ++i) {
            // Shift-in one sample (960 floats; cheap next to the FFTs).
            a48_[count48_ % 960] = src[i] * 32768.f;  // RNNoise works on 16-bit scale
            ++count48_;
            const int hopN = instances >= 2 ? 240 : 480;
            if (count48_ >= 480 && count48_ % hopN == 0) {
                float frame[480];
                for (int k = 0; k < 480; ++k) frame[k] = a48_[(count48_ - 480 + k) % 960];
                float g[64];
                vad_ = rnnoise_compute_gains(st_[instances >= 2 ? (count48_ / 240) & 1 : 0], g, frame);
                for (int b = 0; b < nb_; ++b) gains_[b] = g[b];
            }
        }
    }

    // ── Low-latency path ──
    void prepareLowDelay() {
        double k = sr_ / 48000.0;
        auto pow2 = [](double v) { int p = 16; while (p < v) p <<= 1; return p; };
        N_ = pow2(1024 * k);
        R_ = pow2(64 * k * 0.999);
        M_ = 2 * R_;
        H_ = N_ / 2;
        fft_.prepare(N_);
        wa_.assign(N_, 0.f);
        ws_.assign(N_, 0.f);
        auto hann = [](double n, double L) { return 0.5 - 0.5 * std::cos(dsp::kTwoPi * n / L); };
        const int a = N_ - 2 * M_, b = N_ - M_;
        for (int n = 0; n < N_; ++n) {
            double w_a, w_s;
            if (n < b) {
                w_a = std::sqrt(hann(n, 2.0 * (N_ - M_)));
                w_s = n < a ? 0.0 : hann(n - a, 2.0 * M_) / std::max(w_a, 1e-9);
            } else {
                w_a = std::sqrt(hann(n - a, 2.0 * M_));
                w_s = w_a;
            }
            wa_[n] = (float)w_a;
            ws_[n] = (float)w_s;
        }
        in_.assign(N_, 0.f);
        frame_.assign(N_, 0.f);
        acc_.assign(2 * M_, 0.f);
        out_.assign(R_, 0.f);
        re_.assign(H_ + 1, 0.f);
        im_.assign(H_ + 1, 0.f);
        cur_.assign(H_ + 1, 1.f);
        binGain_.assign(H_ + 1, 1.f);
        // Map each bin to RNNoise's band interpolation (960-pt FFT, 50 Hz bins).
        binBand_.assign(H_ + 1, 0);
        binFrac_.assign(H_ + 1, 0.f);
        for (int kb = 0; kb <= H_; ++kb) {
            double p = kb * sr_ / N_ / 50.0;
            int band = -1;
            float frac = 0.f;
            if (p < edges_[1]) band = -1;  // below first anchor: gain 0
            else if (p >= edges_[nb_]) band = nb_;  // above last anchor: gain nb-1
            else {
                for (int i = 1; i < nb_; ++i)
                    if (p >= edges_[i] && p < edges_[i + 1]) {
                        band = i;
                        frac = (float)((p - edges_[i]) / (edges_[i + 1] - edges_[i]));
                        break;
                    }
            }
            binBand_[kb] = band;
            binFrac_[kb] = frac;
        }
        hop_ = 0;
    }

    void processLowLatency(float* x, int n, int align) {
        feedNetwork(x, n);
        const int tail = N_ - R_;
        for (int i = 0; i < n; ++i) {
            float v = x[i];
            if (align > 0) { alignLine_.push(v); v = alignLine_.readInt(align + 1); }
            in_[tail + hop_] = v;
            x[i] = out_[hop_];
            if (++hop_ == R_) {
                hop_ = 0;
                stftFrame();
            }
        }
    }

    void stftFrame() {
        const int nc = N_ - M_;
        for (int n = 0; n < N_; ++n) frame_[(n - nc + N_) % N_] = in_[n] * wa_[n];
        fft_.forward(frame_.data(), re_.data(), im_.data());
        const float fl = floorGain();
        for (int k = 0; k <= H_; ++k) {
            int b = binBand_[k];
            float g = b < 0 ? gains_[0] : b >= nb_ ? gains_[nb_ - 1]
                                                  : (1.f - binFrac_[k]) * gains_[b - 1] + binFrac_[k] * gains_[b];
            g = std::max(g, fl);
            // Open instantly, close with a ~4 ms time constant: late gains can't chop onsets,
            // and noise between words still drops quickly.
            float& c = cur_[k];
            c = g > c ? g : c + release * (g - c);
            re_[k] *= c;
            im_[k] *= c;
        }
        im_[0] = im_[H_] = 0.f;
        fft_.inverse(re_.data(), im_.data(), frame_.data());
        const int a = N_ - 2 * M_;
        const float ola = (float)R_ / (float)M_;
        for (int n = a; n < N_; ++n) acc_[n - a] += frame_[(n - nc + N_) % N_] * ws_[n] * ola;
        std::copy(acc_.begin(), acc_.begin() + R_, out_.begin());
        std::memmove(acc_.data(), acc_.data() + R_, (2 * M_ - R_) * sizeof(float));
        std::fill(acc_.begin() + (2 * M_ - R_), acc_.end(), 0.f);
        std::memmove(in_.data(), in_.data() + R_, (N_ - R_) * sizeof(float));
    }

    // ── Quality path: plain RNNoise in 480-sample frames ──
    void processQuality(float* x, int n) {
        const float fl = floorGain();
        for (int i = 0; i < n; ++i) {
            dry_.push(x[i]);
            qIn_[qFill_++] = x[i] * 32768.f;
            float y = qOut_[qOutPos_++] * (1.f / 32768.f);
            if (qFill_ == 480) {
                vad_ = rnnoise_process_frame(q_, qOut_.data(), qIn_.data());
                qFill_ = 0;
                qOutPos_ = 0;
            }
            // Strength: blend back a little of the (aligned) original.
            x[i] = y + fl * (dry_.readInt(kQualityDelay + 1) - y);  // readInt(1) is x[i]
        }
    }
};

}  // namespace aurora::nodes
