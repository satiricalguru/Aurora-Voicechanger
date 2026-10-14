// Recorder and instant replay.
//
// Every capture source (the voice the call hears, Mac audio) writes into a
// History: a ~87 s mono ring with a 64-bit sample counter. The audio thread
// only copies samples in; everything else happens on other threads:
//   - instant replay copies the last N seconds out to a WAV file;
//   - the recorder thread drains the ring every 40 ms into a WAV file, so a
//     recording can run far longer than the ring.
// Readers stay at least kGuard samples behind the oldest data, so they never
// read a slot the writer is filling.
#pragma once

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <string>
#include <thread>
#include <vector>

namespace aurora {

class History {
public:
    static constexpr uint64_t kSize = 1u << 22;  // 87 s at 48 kHz
    static constexpr uint64_t kMask = kSize - 1;
    static constexpr uint64_t kGuard = 1u << 16;  // 1.4 s the writer may run ahead during a copy

    History() : buf_(kSize, 0.f) {}

    // Control thread, while nothing is pushing. A new rate starts a new epoch:
    // recordings in progress end and replay forgets older audio.
    void setRate(double sr) {
        if (sr == rate_.load()) return;
        epoch_.fetch_add(1);
        written_.store(0);
        rate_.store(sr);
    }
    double rate() const { return rate_.load(); }
    uint32_t epoch() const { return epoch_.load(); }

    // Audio thread.
    void push(const float* x, int n) {
        uint64_t w = written_.load(std::memory_order_relaxed);
        float pk = 0.f;
        for (int i = 0; i < n; ++i) {
            buf_[(w + i) & kMask] = x[i];
            pk = std::max(pk, std::fabs(x[i]));
        }
        written_.store(w + n, std::memory_order_release);
        if (pk > peak_.load(std::memory_order_relaxed)) peak_.store(pk, std::memory_order_relaxed);
    }

    uint64_t written() const { return written_.load(std::memory_order_acquire); }
    // Oldest sample index still safe to read.
    uint64_t oldest() const {
        uint64_t w = written();
        return w > kSize - kGuard ? w - (kSize - kGuard) : 0;
    }
    double seconds() const { return (written() - oldest()) / rate(); }
    // Peak since the last call, for meters.
    float takePeak() { return peak_.exchange(0.f, std::memory_order_relaxed); }

    void copy(uint64_t from, uint64_t to, float* out) const {
        for (uint64_t i = from; i < to; ++i) *out++ = buf_[i & kMask];
    }

private:
    std::vector<float> buf_;
    std::atomic<uint64_t> written_{0};
    std::atomic<double> rate_{48000};
    std::atomic<uint32_t> epoch_{0};
    std::atomic<float> peak_{0};
};

// 16-bit PCM mono WAV: what other apps (and the soundboard) read everywhere.
class WavWriter {
public:
    ~WavWriter() { close(); }
    bool open(const std::string& path, int rate) {
        f_ = std::fopen(path.c_str(), "wb");
        if (!f_) return false;
        rate_ = rate;
        frames_ = 0;
        header(0);
        return true;
    }
    void write(const float* x, size_t n) {
        tmp_.resize(n);
        for (size_t i = 0; i < n; ++i) {
            float v = std::clamp(x[i], -1.f, 1.f) * 32767.f;
            tmp_[i] = (int16_t)std::lrint(v);
        }
        std::fwrite(tmp_.data(), 2, n, f_);
        frames_ += n;
    }
    size_t frames() const { return frames_; }
    bool close() {
        if (!f_) return false;
        std::fseek(f_, 0, SEEK_SET);
        header((uint32_t)frames_);
        bool ok = std::fclose(f_) == 0;
        f_ = nullptr;
        return ok;
    }

private:
    void header(uint32_t frames) {
        auto u32 = [&](uint32_t v) { std::fwrite(&v, 4, 1, f_); };
        auto u16 = [&](uint16_t v) { std::fwrite(&v, 2, 1, f_); };
        const uint32_t bytes = frames * 2;
        std::fwrite("RIFF", 1, 4, f_); u32(36 + bytes); std::fwrite("WAVEfmt ", 1, 8, f_);
        u32(16); u16(1); u16(1); u32((uint32_t)rate_); u32((uint32_t)rate_ * 2); u16(2); u16(16);
        std::fwrite("data", 1, 4, f_); u32(bytes);
    }
    std::FILE* f_ = nullptr;
    int rate_ = 48000;
    size_t frames_ = 0;
    std::vector<int16_t> tmp_;
};

// Last `seconds` of `h` to a WAV file. Returns the seconds written, -1 on error.
inline double saveReplay(const History& h, double seconds, const std::string& path, std::string& err) {
    const double sr = h.rate();
    const uint64_t to = h.written();
    const uint64_t want = (uint64_t)std::max(0.0, seconds * sr);
    const uint64_t from = std::max(h.oldest(), to > want ? to - want : 0);
    if (to - from < (uint64_t)(0.1 * sr)) { err = "nothing to replay yet"; return -1; }
    std::vector<float> tmp(to - from);
    h.copy(from, to, tmp.data());
    WavWriter w;
    if (!w.open(path, (int)std::lround(sr))) { err = "cannot write " + path; return -1; }
    w.write(tmp.data(), tmp.size());
    if (!w.close()) { err = "cannot write " + path; return -1; }
    return tmp.size() / sr;
}

// Streams one History into a WAV file on its own thread. The thread closes
// the file itself, so a recording that ends on its own (time limit, source
// restarted at another rate) is complete on disk; stop() collects it.
class Recorder {
public:
    ~Recorder() { stop(); }

    int start(History* h, int source, const std::string& path, double maxSeconds, std::string& err) {
        stop();
        if (!w_.open(path, (int)std::lround(h->rate()))) { err = "cannot write " + path; return -1; }
        h_ = h;
        source_ = source;
        rate_ = h->rate();
        epoch_ = h->epoch();
        pos_ = h->written();
        maxFrames_ = (uint64_t)(maxSeconds * rate_);
        frames_.store(0);
        lost_.store(0);
        run_.store(true);
        active_.store(true);
        th_ = std::thread([this] { loop(); });
        return 0;
    }

    // Seconds recorded (also after the recording ended on its own); -1 if idle.
    double stop() {
        run_.store(false);
        if (th_.joinable()) th_.join();
        if (!h_) return -1;
        h_ = nullptr;
        return frames_.load() / rate_;
    }

    bool active() const { return active_.load(); }        // still capturing
    bool pending() const { return h_ && !active_.load(); }  // ended on its own, not collected
    int source() const { return source_; }
    double seconds() const { return frames_.load() / rate_; }
    uint64_t lost() const { return lost_.load(); }

private:
    void loop() {
        std::vector<float> tmp;
        while (true) {
            const bool last = !run_.load();
            if (h_->epoch() != epoch_) break;  // source restarted at another rate
            uint64_t w = h_->written(), oldest = h_->oldest();
            if (pos_ < oldest) { lost_.fetch_add(oldest - pos_); pos_ = oldest; }  // fell a ring behind
            uint64_t n = std::min<uint64_t>(w - pos_, maxFrames_ - frames_.load());
            if (n) {
                tmp.resize(n);
                h_->copy(pos_, pos_ + n, tmp.data());
                w_.write(tmp.data(), n);
                pos_ += n;
                frames_.fetch_add(n);
            }
            if (last || frames_.load() >= maxFrames_) break;
            std::this_thread::sleep_for(std::chrono::milliseconds(40));
        }
        w_.close();
        active_.store(false);
    }

    History* h_ = nullptr;
    WavWriter w_;
    std::thread th_;
    std::atomic<bool> run_{false}, active_{false};
    std::atomic<uint64_t> frames_{0}, lost_{0};
    uint64_t pos_ = 0, maxFrames_ = 0;
    double rate_ = 48000;
    uint32_t epoch_ = 0;
    int source_ = 0;
};

}  // namespace aurora
