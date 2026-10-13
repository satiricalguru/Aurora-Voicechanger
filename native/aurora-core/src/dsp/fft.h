// Real FFT on Accelerate (vDSP DFT). Sizes f * 2^n, f in {1,3,5,15}.
// forward() returns the true DFT (bins 0..N/2); inverse() is its exact inverse.
#pragma once

#include <Accelerate/Accelerate.h>

#include <stdexcept>
#include <vector>

namespace aurora::dsp {

class RealFFT {
public:
    RealFFT() = default;
    RealFFT(const RealFFT&) = delete;
    RealFFT& operator=(const RealFFT&) = delete;
    ~RealFFT() { destroy(); }

    void prepare(int n) {
        destroy();
        n_ = n;
        h_ = n / 2;
        fwd_ = vDSP_DFT_zrop_CreateSetup(nullptr, (vDSP_Length)n, vDSP_DFT_FORWARD);
        inv_ = vDSP_DFT_zrop_CreateSetup(fwd_, (vDSP_Length)n, vDSP_DFT_INVERSE);
        if (!fwd_ || !inv_) throw std::runtime_error("unsupported FFT size");
        ar_.assign(h_, 0.f); ai_.assign(h_, 0.f);
        br_.assign(h_, 0.f); bi_.assign(h_, 0.f);
        // vDSP's packed real DFT scales forward by 2; inverse(forward(x)) = 2N x.
        fwdScale_ = 0.5f;
        invScale_ = 1.0f / (float)n_;
    }

    int size() const { return n_; }

    // x: N real samples. re/im: N/2+1 bins.
    void forward(const float* x, float* re, float* im) {
        DSPSplitComplex in{ar_.data(), ai_.data()};
        vDSP_ctoz(reinterpret_cast<const DSPComplex*>(x), 2, &in, 1, (vDSP_Length)h_);
        vDSP_DFT_Execute(fwd_, ar_.data(), ai_.data(), br_.data(), bi_.data());
        re[0] = br_[0] * fwdScale_;
        im[0] = 0.f;
        re[h_] = bi_[0] * fwdScale_;
        im[h_] = 0.f;
        for (int k = 1; k < h_; ++k) {
            re[k] = br_[k] * fwdScale_;
            im[k] = bi_[k] * fwdScale_;
        }
    }

    // re/im: N/2+1 bins (im[0], im[N/2] ignored). x: N real samples.
    void inverse(const float* re, const float* im, float* x) {
        ar_[0] = re[0];
        ai_[0] = re[h_];
        for (int k = 1; k < h_; ++k) {
            ar_[k] = re[k];
            ai_[k] = im[k];
        }
        vDSP_DFT_Execute(inv_, ar_.data(), ai_.data(), br_.data(), bi_.data());
        DSPSplitComplex out{br_.data(), bi_.data()};
        vDSP_ztoc(&out, 1, reinterpret_cast<DSPComplex*>(x), 2, (vDSP_Length)h_);
        vDSP_vsmul(x, 1, &invScale_, x, 1, (vDSP_Length)n_);
    }

private:
    void destroy() {
        if (inv_) vDSP_DFT_DestroySetup(inv_);
        if (fwd_) vDSP_DFT_DestroySetup(fwd_);
        inv_ = fwd_ = nullptr;
    }
    int n_ = 0, h_ = 0;
    float fwdScale_ = 0.5f, invScale_ = 1.f;
    vDSP_DFT_Setup fwd_ = nullptr, inv_ = nullptr;
    std::vector<float> ar_, ai_, br_, bi_;
};

}  // namespace aurora::dsp
