// Real-time primitives: lock-free SPSC queues, denormal control, atomics.
// Nothing here allocates or locks after construction.
#pragma once

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <cstring>
#include <memory>
#include <cmath>

namespace aurora {

// Flush denormals to zero on the calling thread. IIR tails decaying into the
// denormal range cost 100x on some cores; audio threads call this per cycle.
inline void enableFlushToZero() {
#if defined(__aarch64__)
    uint64_t fpcr;
    asm volatile("mrs %0, fpcr" : "=r"(fpcr));
    asm volatile("msr fpcr, %0" ::"r"(fpcr | (1ull << 24)));
#elif defined(__x86_64__)
    uint32_t csr;
    asm volatile("stmxcsr %0" : "=m"(csr));
    csr |= 0x8040;  // FTZ | DAZ
    asm volatile("ldmxcsr %0" ::"m"(csr));
#endif
}

inline uint32_t nextPow2(uint32_t v) {
    uint32_t p = 1;
    while (p < v) p <<= 1;
    return p;
}

// Single-producer single-consumer ring of floats.
class FloatRing {
public:
    explicit FloatRing(uint32_t capacity = 1 << 16)
        : cap_(nextPow2(capacity)), mask_(cap_ - 1), buf_(new float[cap_]()) {}

    uint32_t capacity() const { return cap_; }
    uint32_t size() const {
        return w_.load(std::memory_order_acquire) - r_.load(std::memory_order_acquire);
    }
    uint32_t space() const { return cap_ - size(); }

    // Producer. Writes up to n, returns count written.
    uint32_t push(const float* src, uint32_t n) {
        uint32_t w = w_.load(std::memory_order_relaxed);
        uint32_t r = r_.load(std::memory_order_acquire);
        uint32_t room = cap_ - (w - r);
        if (n > room) n = room;
        uint32_t i = w & mask_;
        uint32_t first = std::min(n, cap_ - i);
        std::memcpy(buf_.get() + i, src, first * sizeof(float));
        std::memcpy(buf_.get(), src + first, (n - first) * sizeof(float));
        w_.store(w + n, std::memory_order_release);
        return n;
    }

    // Consumer. Reads up to n, returns count read.
    uint32_t pop(float* dst, uint32_t n) {
        uint32_t r = r_.load(std::memory_order_relaxed);
        uint32_t w = w_.load(std::memory_order_acquire);
        uint32_t avail = w - r;
        if (n > avail) n = avail;
        uint32_t i = r & mask_;
        uint32_t first = std::min(n, cap_ - i);
        std::memcpy(dst, buf_.get() + i, first * sizeof(float));
        std::memcpy(dst + first, buf_.get(), (n - first) * sizeof(float));
        r_.store(r + n, std::memory_order_release);
        return n;
    }

    // Consumer. Drops up to n samples.
    uint32_t skip(uint32_t n) {
        uint32_t r = r_.load(std::memory_order_relaxed);
        uint32_t w = w_.load(std::memory_order_acquire);
        if (n > w - r) n = w - r;
        r_.store(r + n, std::memory_order_release);
        return n;
    }

    // Only safe while neither side is running.
    void reset() {
        r_.store(0);
        w_.store(0);
    }

private:
    uint32_t cap_, mask_;
    std::unique_ptr<float[]> buf_;
    alignas(64) std::atomic<uint32_t> w_{0};
    alignas(64) std::atomic<uint32_t> r_{0};
};

// Single-producer single-consumer queue of small POD messages.
template <typename T, uint32_t N>
class SpscQueue {
    static_assert((N & (N - 1)) == 0, "N must be a power of two");

public:
    bool push(const T& v) {
        uint32_t w = w_.load(std::memory_order_relaxed);
        if (w - r_.load(std::memory_order_acquire) >= N) return false;
        items_[w & (N - 1)] = v;
        w_.store(w + 1, std::memory_order_release);
        return true;
    }
    bool pop(T& out) {
        uint32_t r = r_.load(std::memory_order_relaxed);
        if (r == w_.load(std::memory_order_acquire)) return false;
        out = items_[r & (N - 1)];
        r_.store(r + 1, std::memory_order_release);
        return true;
    }

private:
    T items_[N];
    alignas(64) std::atomic<uint32_t> w_{0};
    alignas(64) std::atomic<uint32_t> r_{0};
};

// Float published by one thread, read by others. Relaxed is enough for meters.
struct AtomicFloat {
    std::atomic<float> v{0.f};
    void set(float x) { v.store(x, std::memory_order_relaxed); }
    float get() const { return v.load(std::memory_order_relaxed); }
};

inline float dbToLin(float db) { return std::pow(10.f, db / 20.f); }
inline float linToDb(float x) { return 20.f * std::log10(x + 1e-9f); }

// Cheap xorshift noise for audio threads (std::random engines are slow and
// some distributions allocate).
struct FastRand {
    uint32_t s = 0x9E3779B9u;
    explicit FastRand(uint32_t seed = 0x9E3779B9u) : s(seed ? seed : 1) {}
    inline uint32_t next() {
        s ^= s << 13;
        s ^= s >> 17;
        s ^= s << 5;
        return s;
    }
    // Uniform in [-1, 1).
    inline float bipolar() { return (int32_t)next() * (1.0f / 2147483648.0f); }
    // Uniform in [0, 1).
    inline float unipolar() { return (next() >> 8) * (1.0f / 16777216.0f); }
    // Approximate standard normal (sum of 4 uniforms, scaled).
    inline float gauss() {
        return (bipolar() + bipolar() + bipolar() + bipolar()) * 0.8660254f;
    }
};

}  // namespace aurora
