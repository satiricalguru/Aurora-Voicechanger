// Neural voice conversion node.
//
// Audio thread:  in (engine rate) -> resample to model rate -> inRing
//                outRing -> resample back -> fifo -> out
// Worker thread: whenever inRing holds a chunk, run one model step
//                ([context | chunk] -> chunk) and append to outRing.
//
// outRing starts with a fixed lead of silence covering one chunk plus the
// measured compute time and a safety margin, so the latency is constant and
// a late model step shows up as a counted underrun, never as drift. The
// worker is a Mach time-constraint (real-time) thread woken by a semaphore,
// which the audio thread may signal without blocking.
#pragma once

#include <mach/mach.h>
#include <mach/semaphore.h>
#include <mach/thread_policy.h>
#include <mach/mach_time.h>
#include <pthread.h>

#include <atomic>
#include <chrono>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "../dsp/resampler.h"
#include "../graph.h"
#include "../rt.h"
#include "ort_model.h"

namespace aurora::neural {

// Set on the thread building a chain for offline rendering: model steps
// then run inline in process() instead of on a worker.
inline bool& offlineMode() {
    static thread_local bool v = false;
    return v;
}

class NeuralVC : public Node {
public:
    std::string modelPath;
    float safetyMs = 3.f;  // margin for worker wake-up beyond measured compute time

    ~NeuralVC() override { stopWorker(); }

    void prepare(double sr, int maxBlock) override {
        stopWorker();
        std::string err;
        model_ = std::make_unique<StreamingModel>();
        if (!model_->load(modelPath, err)) throw std::string("neural model: " + err);
        sr_ = sr;
        msr_ = model_->sampleRate();
        chunk_ = model_->chunk();
        ctx_ = model_->context();

        down_.prepare(sr, msr_);
        up_.prepare(msr_, sr);
        inRing_ = std::make_unique<FloatRing>(1 << 15);
        outRing_ = std::make_unique<FloatRing>(1 << 15);
        fifo_ = std::make_unique<FloatRing>(1 << 15);
        tmpIn_.assign(down_.maxOut(maxBlock) + 8, 0.f);
        tmpOut_.assign(tmpIn_.size(), 0.f);
        tmpUp_.assign(up_.maxOut((int)tmpIn_.size()) + 8, 0.f);
        history_.assign(ctx_, 0.f);

        // Warm up and measure a model step (first runs are slow).
        double worst = 0;
        for (int i = 0; i < 12; ++i) {
            auto t0 = std::chrono::steady_clock::now();
            model_->run();
            double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
            if (i >= 4) worst = std::max(worst, ms);
        }
        model_->resetState();
        stepMs_ = (float)worst;
        stepAvgMs_.store(0.f);

        // Lead: one chunk + compute (x1.5) + margin + one I/O block, at the model rate.
        const int block = std::min(maxBlock, std::max(16, blockHint()));
        double leadMs = 1000.0 * chunk_ / msr_ + worst * 1.5 + safetyMs + 1000.0 * block / sr;
        lead_ = (int)std::ceil(leadMs * msr_ / 1000.0);
        std::vector<float> zeros(std::max(lead_, 64), 0.f);
        outRing_->push(zeros.data(), (uint32_t)lead_);
        // Small fifo pad absorbs the up-sampler's fractional output count.
        fifoPad_ = (int)std::ceil(sr / msr_) + 2;
        fifo_->push(zeros.data(), (uint32_t)fifoPad_);

        underruns_.store(0);
        offline_ = offlineMode();
        if (!offline_) startWorker();
    }

    void process(float* x, int n) override {
        int k = down_.process(x, n, tmpIn_.data(), (int)tmpIn_.size());
        inRing_->push(tmpIn_.data(), (uint32_t)k);
        if (offline_) {
            while (inRing_->size() >= (uint32_t)chunk_) step();
        } else if (inRing_->size() >= (uint32_t)chunk_) {
            semaphore_signal(sem_);
        }
        int got = (int)outRing_->pop(tmpOut_.data(), (uint32_t)k);
        if (got < k) {
            std::fill(tmpOut_.begin() + got, tmpOut_.begin() + k, 0.f);
            underruns_.fetch_add(1, std::memory_order_relaxed);
        }
        int m = up_.process(tmpOut_.data(), k, tmpUp_.data(), (int)tmpUp_.size());
        fifo_->push(tmpUp_.data(), (uint32_t)m);
        int have = (int)fifo_->pop(x, (uint32_t)n);
        if (have < n) std::fill(x + have, x + n, 0.f);
    }

    int latency() const override {
        double samples = (lead_ + model_->lookahead()) * sr_ / msr_ + down_.latencyOut() * sr_ / msr_ +
                         up_.latencyOut() + fifoPad_;
        return (int)std::lround(samples);
    }

    bool setParam(const std::string&, double) override { return false; }

    uint32_t dropouts() const override { return underruns_.load(std::memory_order_relaxed); }
    float workerStepMs() const override { return stepAvgMs_.load(std::memory_order_relaxed); }
    float workerLoad() const override {
        return stepAvgMs_.load(std::memory_order_relaxed) / (1000.f * chunk_ / msr_);
    }

private:
    double sr_ = 48000;
    int msr_ = 16000, chunk_ = 208, ctx_ = 32, lead_ = 0, fifoPad_ = 4;
    float stepMs_ = 0;
    bool offline_ = false;
    std::unique_ptr<StreamingModel> model_;
    dsp::Resampler down_, up_;
    std::unique_ptr<FloatRing> inRing_, outRing_, fifo_;
    std::vector<float> tmpIn_, tmpOut_, tmpUp_, history_;
    std::atomic<uint32_t> underruns_{0};
    std::atomic<float> stepAvgMs_{0.f};

    semaphore_t sem_ = MACH_PORT_NULL;
    std::thread worker_;
    std::atomic<bool> quit_{false};

    // One model step: [last ctx samples | next chunk] -> chunk out.
    void step() {
        float* in = model_->audioIn();
        std::copy(history_.begin(), history_.end(), in);
        inRing_->pop(in + ctx_, (uint32_t)chunk_);
        if (ctx_ > 0) std::copy(in + chunk_, in + chunk_ + ctx_, history_.begin());
        auto t0 = std::chrono::steady_clock::now();
        const bool ok = model_->run();
        float ms = std::chrono::duration<float, std::milli>(std::chrono::steady_clock::now() - t0).count();
        float avg = stepAvgMs_.load(std::memory_order_relaxed);
        stepAvgMs_.store(avg == 0.f ? ms : avg + 0.05f * (ms - avg), std::memory_order_relaxed);
        if (!ok) {
            std::vector<float> silence(chunk_, 0.f);  // only on a failed step
            outRing_->push(silence.data(), (uint32_t)chunk_);
            return;
        }
        outRing_->push(model_->audioOut(), (uint32_t)chunk_);
    }

    void startWorker() {
        semaphore_create(mach_task_self(), &sem_, SYNC_POLICY_FIFO, 0);
        quit_.store(false);
        const double period = (double)chunk_ / msr_;
        const double compute = std::min(period * 0.8, std::max(0.002, stepMs_ * 1.5 / 1000.0));
        worker_ = std::thread([this, period, compute] {
            pthread_setname_np("aurora.neural");
            makeRealtime(period, compute);
            while (!quit_.load(std::memory_order_acquire)) {
                semaphore_wait(sem_);
                while (!quit_.load(std::memory_order_relaxed) && inRing_->size() >= (uint32_t)chunk_) step();
            }
        });
    }

    void stopWorker() {
        if (worker_.joinable()) {
            quit_.store(true, std::memory_order_release);
            semaphore_signal(sem_);
            worker_.join();
        }
        if (sem_ != MACH_PORT_NULL) {
            semaphore_destroy(mach_task_self(), sem_);
            sem_ = MACH_PORT_NULL;
        }
    }

    static void makeRealtime(double periodSec, double computeSec) {
        mach_timebase_info_data_t tb;
        mach_timebase_info(&tb);
        auto ticks = [&](double s) { return (uint32_t)(s * 1e9 * tb.denom / tb.numer); };
        thread_time_constraint_policy_data_t p;
        p.period = ticks(periodSec);
        p.computation = ticks(computeSec);
        p.constraint = ticks(periodSec);
        p.preemptible = 1;
        thread_policy_set(pthread_mach_thread_np(pthread_self()), THREAD_TIME_CONSTRAINT_POLICY,
                          (thread_policy_t)&p, THREAD_TIME_CONSTRAINT_POLICY_COUNT);
    }
};

}  // namespace aurora::neural
