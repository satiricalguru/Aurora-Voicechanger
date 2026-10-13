// Low-delay spectral pitch / formant shifter.
//
// Analysis uses a long asymmetric window (N samples, mostly past signal) so
// harmonics of low voices stay resolved; synthesis uses a short window of 2M
// samples at the frame's tail, so the algorithmic delay is 2M samples, not N
// (Mauler & Martin, "A low delay, variable resolution, perfect
// reconstruction spectral analysis-synthesis system", 2011).
// N=2048, M=128, hop R=64 at 48 kHz: ~5.3 ms delay with 43 ms analysis.
//
// Pitch: peak-locked phase vocoder. Each spectral peak and its region of
// influence moves to the shifted frequency with a running phase rotation
// (Laroche & Dolson, "New phase-vocoder techniques for pitch-shifting,
// harmonizing and other exotic effects", 1999).
//
// Formants: cepstral envelope. Each moved bin is re-weighted from the source
// envelope to the target envelope, so pitch and formant shift independently
// (formant = 1 keeps the speaker's own formants).
#pragma once

#include <cmath>
#include <vector>

#include "../rt.h"
#include "basics.h"
#include "fft.h"

namespace aurora::dsp {

class SpectralShifter {
public:
    struct Config {
        int fftSize = 2048;  // analysis length N (resolves harmonics of ~90 Hz voices)
        int hop = 64;        // R
        int synthHalf = 128; // M (synthesis window = 2M, M = 2R)
    };

    void prepare(double sr) { prepare(sr, Config()); }

    void prepare(double sr, Config cfg) {
        sr_ = sr;
        // Scale the defaults for other rates so time spans stay the same.
        double k = sr / 48000.0;
        auto pow2 = [](double v) { int p = 16; while (p < v) p <<= 1; return p; };
        N_ = pow2(cfg.fftSize * k);
        R_ = pow2(cfg.hop * k * 0.999);
        M_ = 2 * R_;
        H_ = N_ / 2;
        fft_.prepare(N_);

        buildWindows();
        inBuf_.assign(N_, 0.f);
        frame_.assign(N_, 0.f);
        acc_.assign(2 * M_, 0.f);
        outFifo_.assign(R_, 0.f);
        re_.assign(H_ + 1, 0.f); im_.assign(H_ + 1, 0.f);
        mag_.assign(H_ + 1, 0.f); phase_.assign(H_ + 1, 0.f);
        prevPhase_.assign(H_ + 1, 0.f);
        prevRot_.assign(H_ + 1, 0.f); rot_.assign(H_ + 1, 0.f);
        outRe_.assign(H_ + 1, 0.f); outIm_.assign(H_ + 1, 0.f);
        logEnv_.assign(H_ + 1, 0.f);
        cep_.assign(N_, 0.f); zeros_.assign(H_ + 1, 0.f); envIm_.assign(H_ + 1, 0.f);
        peaks_.assign(H_ + 1, 0);
        hopCount_ = 0;
        // Cepstral lifter: keep quefrencies under ~1 ms (envelope, not pitch).
        lifter_ = std::max(8, (int)std::lround(sr / 1000.0));
        olaGain_ = (float)R_ / (float)M_;  // periodic Hann (2M) at hop R sums to M/R
    }

    int latency() const { return 2 * M_; }

    // Pitch ratio (2^(semitones/12)), formant factor (1 = keep), breath (0..1
    // phase randomisation, whisper at 1). Safe to call between process() calls.
    void setPitch(float ratio) { ratio_ = std::clamp(ratio, 0.25f, 4.0f); }
    void setFormant(float f) { formant_ = std::clamp(f, 0.4f, 2.5f); }
    void setBreath(float b) { breath_ = std::clamp(b, 0.f, 1.f); }
    // false: formants move with the pitch (classic chipmunk / monster).
    void setPreserveFormants(bool p) { preserve_ = p; }
    float pitch() const { return ratio_; }

    void process(const float* in, float* out, int n) {
        const int tail = N_ - R_;
        for (int i = 0; i < n; ++i) {
            inBuf_[tail + hopCount_] = in[i];
            out[i] = outFifo_[hopCount_];
            if (++hopCount_ == R_) {
                hopCount_ = 0;
                processFrame();
            }
        }
    }

private:
    double sr_ = 48000;
    int N_ = 1024, R_ = 64, M_ = 128, H_ = 512, hopCount_ = 0, lifter_ = 48;
    float ratio_ = 1.f, formant_ = 1.f, breath_ = 0.f, olaGain_ = 0.5f;
    bool preserve_ = true;
    RealFFT fft_;
    std::vector<float> wa_, ws_, inBuf_, frame_, acc_, outFifo_;
    std::vector<float> re_, im_, mag_, phase_, prevPhase_, prevRot_, rot_, outRe_, outIm_;
    std::vector<float> logEnv_, cep_, zeros_, envIm_;
    std::vector<int> peaks_;
    FastRand rng_{0x1234567u};

    static float princarg(float x) {
        return x - (float)kTwoPi * std::floor((x + (float)kPi) / (float)kTwoPi);
    }

    void buildWindows() {
        wa_.assign(N_, 0.f);
        ws_.assign(N_, 0.f);
        auto hann = [](double n, double L) { return 0.5 - 0.5 * std::cos(kTwoPi * n / L); };
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
    }

    // Smoothed log-magnitude envelope via a liftered real cepstrum.
    void computeEnvelope() {
        for (int k = 0; k <= H_; ++k) logEnv_[k] = std::log(mag_[k] + 1e-7f);
        fft_.inverse(logEnv_.data(), zeros_.data(), cep_.data());
        const int L = lifter_;
        for (int q = 1; q < N_; ++q) {
            int d = q <= H_ ? q : N_ - q;
            if (d > L) cep_[q] = 0.f;
            else if (d == L) cep_[q] *= 0.5f;
        }
        fft_.forward(cep_.data(), logEnv_.data(), envIm_.data());
    }

    inline float envAt(float bin) const {
        if (bin <= 0.f) return logEnv_[0];
        if (bin >= (float)H_) return logEnv_[H_] - 4.f;  // past Nyquist: strongly attenuate
        int i = (int)bin;
        float f = bin - i;
        return logEnv_[i] + f * (logEnv_[i + 1] - logEnv_[i]);
    }

    void processFrame() {
        // 1. Window and rotate so phases are referenced to the synthesis centre.
        const int nc = N_ - M_;
        for (int n = 0; n < N_; ++n) frame_[(n - nc + N_) % N_] = inBuf_[n] * wa_[n];
        fft_.forward(frame_.data(), re_.data(), im_.data());

        const bool identity = std::fabs(ratio_ - 1.f) < 1e-4f && std::fabs(formant_ - 1.f) < 1e-4f &&
                              breath_ < 1e-4f;
        float maxMag = 0.f;
        for (int k = 0; k <= H_; ++k) {
            mag_[k] = std::sqrt(re_[k] * re_[k] + im_[k] * im_[k]);
            phase_[k] = std::atan2(im_[k], re_[k]);
            if (mag_[k] > maxMag) maxMag = mag_[k];
        }

        if (identity || maxMag < 1e-9f) {
            if (maxMag < 1e-9f && !identity) {
                std::fill(outRe_.begin(), outRe_.end(), 0.f);
                std::fill(outIm_.begin(), outIm_.end(), 0.f);
            } else {
                outRe_ = re_;
                outIm_ = im_;
            }
            prevPhase_ = phase_;
            std::fill(prevRot_.begin(), prevRot_.end(), 0.f);
        } else {
            shiftSpectrum(maxMag);
        }

        // 2. Back to time; unrotate; synthesis window on the tail; overlap-add.
        outIm_[0] = 0.f;
        outIm_[H_] = 0.f;
        fft_.inverse(outRe_.data(), outIm_.data(), frame_.data());
        const int a = N_ - 2 * M_;
        for (int n = a; n < N_; ++n) {
            float y = frame_[(n - nc + N_) % N_];
            acc_[n - a] += y * ws_[n] * olaGain_;
        }
        for (int i = 0; i < R_; ++i) outFifo_[i] = acc_[i];
        std::memmove(acc_.data(), acc_.data() + R_, (2 * M_ - R_) * sizeof(float));
        std::fill(acc_.begin() + (2 * M_ - R_), acc_.end(), 0.f);
        std::memmove(inBuf_.data(), inBuf_.data() + R_, (N_ - R_) * sizeof(float));
    }

    void shiftSpectrum(float maxMag) {
        const float rho = ratio_, phi = formant_;
        // Envelope target: the source envelope warped by phi (preserve) or by
        // rho * phi (formants ride along with the pitch).
        const float envScale = preserve_ ? phi : rho * phi;
        const bool shapeEnv = std::fabs(envScale - rho) > 1e-4f;
        if (shapeEnv) computeEnvelope();

        // Peaks: local maxima above -70 dB of the frame maximum.
        const float floorMag = maxMag * 3e-4f;
        int np = 0;
        for (int k = 2; k < H_ - 1; ++k) {
            float m = mag_[k];
            if (m > floorMag && m > mag_[k - 1] && m >= mag_[k + 1] && m > mag_[k - 2] && m >= mag_[k + 2])
                peaks_[np++] = k;
        }

        std::fill(outRe_.begin(), outRe_.end(), 0.f);
        std::fill(outIm_.begin(), outIm_.end(), 0.f);
        std::fill(rot_.begin(), rot_.end(), 0.f);

        const float twoPiOverN = (float)kTwoPi / (float)N_;
        const float R = (float)R_;
        for (int i = 0; i < np; ++i) {
            const int p = peaks_[i];
            // Region of influence: from the minimum between neighbours.
            int lo = 0, hi = H_;
            if (i > 0) { lo = peaks_[i - 1]; for (int k = peaks_[i - 1]; k < p; ++k) if (mag_[k] < mag_[lo]) lo = k; lo += 1; }
            if (i + 1 < np) { hi = p; for (int k = p; k < peaks_[i + 1]; ++k) if (mag_[k] < mag_[hi]) hi = k; }

            // Instantaneous frequency of the peak (rad/sample).
            float omegaBin = twoPiOverN * p;
            float dphi = princarg(phase_[p] - prevPhase_[p] - omegaBin * R);
            float omega = omegaBin + dphi / R;
            float omegaNew = omega * rho;
            // Shift by the frequency change of this partial. Sidelobe peaks
            // report the partial's own frequency, so they move with it.
            int delta = (int)std::lround((omegaNew - omega) / twoPiOverN);
            float r = princarg(prevRot_[p] + (omegaNew - omega) * R);

            float cr = std::cos(r), sr = std::sin(r);
            for (int k = lo; k <= hi; ++k) {
                rot_[k] = r;
                int j = k + delta;
                if (j < 0 || j > H_) continue;
                float g = 1.f;
                if (shapeEnv) {
                    float lg = envAt((float)j / envScale) - logEnv_[k];
                    lg = std::clamp(lg, -9.f, 2.3f);  // at most ~+20 dB boost
                    g = std::exp(lg);
                }
                float xr = re_[k] * g, xi = im_[k] * g;
                outRe_[j] += xr * cr - xi * sr;
                outIm_[j] += xr * sr + xi * cr;
            }
        }

        if (breath_ > 1e-4f) {
            const float b = breath_;
            // Leave the lowest ~300 Hz alone so whispers keep some body.
            int start = (int)(300.0 / (sr_ / N_));
            for (int j = start; j <= H_; ++j) {
                float m = std::sqrt(outRe_[j] * outRe_[j] + outIm_[j] * outIm_[j]);
                float th = rng_.bipolar() * (float)kPi;
                outRe_[j] = (1.f - b) * outRe_[j] + b * m * std::cos(th);
                outIm_[j] = (1.f - b) * outIm_[j] + b * m * std::sin(th);
            }
        }

        std::swap(prevPhase_, phase_);
        std::swap(prevRot_, rot_);
    }
};

}  // namespace aurora::dsp
