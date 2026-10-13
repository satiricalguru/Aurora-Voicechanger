// Aurora Core engine: CoreAudio HAL I/O, real-time voice path, C API.
//
// Threads:
//   input IOProc  (mic device, real-time)   -> runs the whole voice chain
//   output IOProc (virtual mic, real-time)  -> drift-corrected read from ring
//   monitor IOProc (headphones, real-time)  -> same, from a second ring
//   control (any caller of the C API)       -> builds chains, reads stats
// When mic and output are the same device a single duplex IOProc does all of
// it with no ring at all.

#include <CoreAudio/CoreAudio.h>
#include <mach/mach_time.h>

#include <atomic>
#include <chrono>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "../include/aurora_core.h"
#include "dsp/fft.h"
#include "graph.h"
#include "json.h"
#include "nodes.h"
#include "denoise.h"
#ifdef AURORA_NEURAL
#include "neural/neural_vc.h"
#include "neural/ort_model.h"
#endif
#include "rt.h"

using namespace aurora;

namespace {

// ── CoreAudio property helpers ────────────────────────────────────────────────

AudioObjectPropertyAddress addr(AudioObjectPropertySelector sel,
                                AudioObjectPropertyScope scope = kAudioObjectPropertyScopeGlobal) {
    return {sel, scope, kAudioObjectPropertyElementMain};
}

template <typename T>
bool getProp(AudioObjectID obj, AudioObjectPropertySelector sel, T& out,
             AudioObjectPropertyScope scope = kAudioObjectPropertyScopeGlobal) {
    auto a = addr(sel, scope);
    UInt32 size = sizeof(T);
    return AudioObjectGetPropertyData(obj, &a, 0, nullptr, &size, &out) == noErr;
}

template <typename T>
bool setProp(AudioObjectID obj, AudioObjectPropertySelector sel, const T& v,
             AudioObjectPropertyScope scope = kAudioObjectPropertyScopeGlobal) {
    auto a = addr(sel, scope);
    return AudioObjectSetPropertyData(obj, &a, 0, nullptr, sizeof(T), &v) == noErr;
}

std::string cfToString(CFStringRef s) {
    if (!s) return "";
    char buf[512];
    if (CFStringGetCString(s, buf, sizeof buf, kCFStringEncodingUTF8)) return buf;
    return "";
}

std::string stringProp(AudioObjectID obj, AudioObjectPropertySelector sel) {
    CFStringRef s = nullptr;
    auto a = addr(sel);
    UInt32 size = sizeof(s);
    if (AudioObjectGetPropertyData(obj, &a, 0, nullptr, &size, &s) != noErr || !s) return "";
    std::string r = cfToString(s);
    CFRelease(s);
    return r;
}

int channelCount(AudioObjectID dev, AudioObjectPropertyScope scope) {
    auto a = addr(kAudioDevicePropertyStreamConfiguration, scope);
    UInt32 size = 0;
    if (AudioObjectGetPropertyDataSize(dev, &a, 0, nullptr, &size) != noErr || size == 0) return 0;
    std::vector<uint8_t> mem(size);
    auto* abl = reinterpret_cast<AudioBufferList*>(mem.data());
    if (AudioObjectGetPropertyData(dev, &a, 0, nullptr, &size, abl) != noErr) return 0;
    int ch = 0;
    for (UInt32 i = 0; i < abl->mNumberBuffers; ++i) ch += (int)abl->mBuffers[i].mNumberChannels;
    return ch;
}

double nominalRate(AudioObjectID dev) {
    Float64 sr = 0;
    getProp(dev, kAudioDevicePropertyNominalSampleRate, sr);
    return sr;
}

std::vector<AudioObjectID> allDevices() {
    auto a = addr(kAudioHardwarePropertyDevices);
    UInt32 size = 0;
    if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &a, 0, nullptr, &size) != noErr) return {};
    std::vector<AudioObjectID> ids(size / sizeof(AudioObjectID));
    if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &a, 0, nullptr, &size, ids.data()) != noErr) return {};
    return ids;
}

AudioObjectID deviceByUID(const std::string& uid) {
    for (auto id : allDevices())
        if (stringProp(id, kAudioDevicePropertyDeviceUID) == uid) return id;
    return kAudioObjectUnknown;
}

// Sum of the HAL-reported latencies for one side of a device, in frames.
struct SideLatency {
    UInt32 device = 0, safety = 0, stream = 0, buffer = 0;
    UInt32 total() const { return device + safety + stream + buffer; }
};

SideLatency sideLatency(AudioObjectID dev, AudioObjectPropertyScope scope) {
    SideLatency l;
    getProp(dev, kAudioDevicePropertyLatency, l.device, scope);
    getProp(dev, kAudioDevicePropertySafetyOffset, l.safety, scope);
    getProp(dev, kAudioDevicePropertyBufferFrameSize, l.buffer);
    auto a = addr(kAudioDevicePropertyStreams, scope);
    UInt32 size = 0;
    if (AudioObjectGetPropertyDataSize(dev, &a, 0, nullptr, &size) == noErr && size >= sizeof(AudioStreamID)) {
        std::vector<AudioStreamID> streams(size / sizeof(AudioStreamID));
        if (AudioObjectGetPropertyData(dev, &a, 0, nullptr, &size, streams.data()) == noErr)
            getProp(streams[0], kAudioStreamPropertyLatency, l.stream);
    }
    return l;
}

// Wireless sources deliver audio in bursts and need jitter slack.
bool isWireless(AudioObjectID dev) {
    UInt32 t = 0;
    getProp(dev, kAudioDevicePropertyTransportType, t);
    return t == kAudioDeviceTransportTypeBluetooth || t == kAudioDeviceTransportTypeBluetoothLE ||
           t == kAudioDeviceTransportTypeAirPlay || t == kAudioDeviceTransportTypeContinuityCaptureWireless ||
           t == kAudioDeviceTransportTypeContinuityCaptureWired;
}

bool trySetRate(AudioObjectID dev, double want) {
    if (std::fabs(nominalRate(dev) - want) < 1) return true;
    auto a = addr(kAudioDevicePropertyAvailableNominalSampleRates);
    UInt32 size = 0;
    if (AudioObjectGetPropertyDataSize(dev, &a, 0, nullptr, &size) != noErr) return false;
    std::vector<AudioValueRange> ranges(size / sizeof(AudioValueRange));
    AudioObjectGetPropertyData(dev, &a, 0, nullptr, &size, ranges.data());
    bool ok = false;
    for (auto& r : ranges) ok |= (want >= r.mMinimum - 1 && want <= r.mMaximum + 1);
    if (!ok) return false;
    Float64 sr = want;
    if (!setProp(dev, kAudioDevicePropertyNominalSampleRate, sr)) return false;
    // The change is asynchronous; wait for it to land.
    for (int i = 0; i < 50; ++i) {
        if (std::fabs(nominalRate(dev) - want) < 1) return true;
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
    return false;
}

UInt32 setBufferFrames(AudioObjectID dev, UInt32 want) {
    AudioValueRange r{};
    if (getProp(dev, kAudioDevicePropertyBufferFrameSizeRange, r))
        want = (UInt32)std::clamp<double>(want, r.mMinimum, r.mMaximum);
    setProp(dev, kAudioDevicePropertyBufferFrameSize, want);
    UInt32 got = want;
    getProp(dev, kAudioDevicePropertyBufferFrameSize, got);
    return got;
}

double hostToSeconds(uint64_t t) {
    static mach_timebase_info_data_t tb = [] { mach_timebase_info_data_t x; mach_timebase_info(&x); return x; }();
    return (double)t * tb.numer / tb.denom * 1e-9;
}

// ── Drift-corrected ring reader ───────────────────────────────────────────────
// Bridges two devices with independent clocks (and different rates). The
// fill level, sampled at each output cycle, steers a cubic resampler by at
// most ±0.2 % (inaudible). Underruns raise the target; long clean stretches
// lower it again, so the queue settles at the smallest stable size.
class DriftReader {
public:
    FloatRing* ring = nullptr;
    // jitter: extra frames (input rate) for bursty sources such as Bluetooth.
    void prepare(FloatRing* r, double inRate, double outRate, int inBuf, int outBuf, double jitter = 0) {
        ring = r;
        ratio0_ = inRate / outRate;
        growStep_ = std::max(32.0, inBuf * 0.5);
        minTarget_ = outBuf * ratio0_ + inBuf * 0.5 + 16 + jitter;
        target_ = minTarget_ + 32;
        fillEma_ = target_;
        frac_ = 0;
        xm1_ = x0_ = x1_ = x2_ = 0;
        tmp_.assign(16384, 0.f);
        underruns.store(0);
        primed_ = false;
        cleanCycles_ = 0;
        cyclesPerSec_ = std::max(1.0, outRate / std::max(1, outBuf));
        // Devices (Bluetooth especially) stutter while they start: don't
        // learn from the first 1.5 s.
        warmup_ = (long)(cyclesPerSec_ * 1.5);
    }

    void read(float* out, int n) {
        const double fill = ring->size();
        const bool warming = warmup_ > 0;
        if (warming) --warmup_;
        if (primed_ && fill < 1.0 && fillEma_ < target_ * 0.25) {
            // Input stopped altogether (device switching profile, stalled
            // app): one dropout, then wait silently for the queue to refill.
            primed_ = false;
            if (!warming) underruns.fetch_add(1, std::memory_order_relaxed);
        }
        if (!primed_) {
            // Wait until the queue reaches the target, then drop any excess.
            if (fill < target_) {
                for (int i = 0; i < n; ++i) { x2_ *= 0.9f; out[i] = x2_; }  // decay, no click
                fillEma_ = fill;
                return;
            }
            ring->skip((uint32_t)(fill - target_));
            fillEma_ = target_;
            primed_ = true;
        } else if (fill > target_ + 4096) {
            ring->skip((uint32_t)(fill - target_));  // hard resync after a stall
        }
        fillEma_ += 0.02 * (fill - fillEma_);
        double corr = std::clamp((fillEma_ - target_) * 2e-5, -0.002, 0.002);
        double ratio = ratio0_ * (1.0 + corr);
        ratio_.store((float)ratio, std::memory_order_relaxed);

        int need = (int)std::floor(frac_ + n * ratio);
        need = std::min(need, (int)tmp_.size());
        int got = (int)ring->pop(tmp_.data(), (uint32_t)need);
        int idx = 0;
        for (int i = 0; i < n; ++i) {
            out[i] = dsp::hermite(xm1_, x0_, x1_, x2_, (float)frac_);
            frac_ += ratio;
            while (frac_ >= 1.0) {
                frac_ -= 1.0;
                float next = idx < got ? tmp_[idx] : x2_ * 0.95f;  // underrun: decay, don't click
                ++idx;
                xm1_ = x0_; x0_ = x1_; x1_ = x2_; x2_ = next;
            }
        }
        if (got < need) {
            if (!warming) {
                underruns.fetch_add(1, std::memory_order_relaxed);
                target_ = std::min(target_ + growStep_, minTarget_ + 4096.0);
            }
            cleanCycles_ = 0;
        } else if (++cleanCycles_ > cyclesPerSec_ * 5 && target_ > minTarget_) {
            // 5 s clean: give back a quarter of the slack.
            target_ = std::max(minTarget_, target_ - std::max(8.0, 0.25 * (target_ - minTarget_)));
            cleanCycles_ = 0;
        }
        fillPublished_.store((float)fillEma_, std::memory_order_relaxed);
        targetPublished_.store((float)target_, std::memory_order_relaxed);
    }

    float queued() const { return fillPublished_.load(std::memory_order_relaxed); }
    float target() const { return targetPublished_.load(std::memory_order_relaxed); }
    float ratio() const { return ratio_.load(std::memory_order_relaxed); }
    std::atomic<uint32_t> underruns{0};

private:
    double ratio0_ = 1, frac_ = 0, target_ = 256, minTarget_ = 200, fillEma_ = 0, cyclesPerSec_ = 375, growStep_ = 32;
    float xm1_ = 0, x0_ = 0, x1_ = 0, x2_ = 0;
    std::vector<float> tmp_;
    bool primed_ = false;
    long cleanCycles_ = 0, warmup_ = 0;
    std::atomic<float> fillPublished_{0}, targetPublished_{0}, ratio_{1};
};

struct ParamMsg {
    char type[24];
    char key[24];
    double value;
};

// ── Engine ────────────────────────────────────────────────────────────────────

class Engine {
public:
    static Engine& get() {
        static Engine e;
        return e;
    }

    std::mutex ctl;  // control-thread serialisation only; never taken on audio threads
    std::string lastError;

    // Settings (written by control, read by audio).
    std::atomic<float> volMic{1}, volVoice{1}, volSound{1}, volMonitor{1}, gateDb{-44};
    std::atomic<bool> bypass{false}, gateOn{true}, hpfOn{true}, limiterOn{true}, mute{false};
    std::atomic<bool> monitorVoice{true};  // false: monitor device plays soundboard only
    std::atomic<int> nrMode{0};  // 0 off, 1 low latency, 2 balanced, 3 quality (RNNoise as-is)
    std::atomic<float> nrStrength{0.85f};

    int start(const std::string& inUid, const std::string& outUid, int bufferFrames, double wantRate) {
        stopLocked();
        AudioObjectID in = deviceByUID(inUid), out = deviceByUID(outUid);
        if (in == kAudioObjectUnknown) return fail("input device not found: " + inUid);
        if (out == kAudioObjectUnknown) return fail("output device not found: " + outUid);
        if (channelCount(in, kAudioObjectPropertyScopeInput) < 1) return fail("device has no inputs");
        if (channelCount(out, kAudioObjectPropertyScopeOutput) < 1) return fail("device has no outputs");

        trySetRate(in, wantRate);
        if (out != in) trySetRate(out, wantRate);
        inDev_ = in;
        outDev_ = out;
        sr_ = nominalRate(in);
        outSr_ = nominalRate(out);
        if (sr_ < 8000 || outSr_ < 8000) return fail("could not read device sample rate");
        inBuf_ = (int)setBufferFrames(in, (UInt32)bufferFrames);
        outBuf_ = out == in ? inBuf_ : (int)setBufferFrames(out, (UInt32)bufferFrames);
        inChannels_ = channelCount(in, kAudioObjectPropertyScopeInput);
        outChannels_ = channelCount(out, kAudioObjectPropertyScopeOutput);

        prepareDsp();
        outRing_.reset();
        duplex_ = (in == out);
        // Wireless mics deliver audio in bursts: start with ~20 ms of slack.
        jitter_ = (isWireless(in) || isWireless(out)) ? 0.02 * sr_ : 0.0;
        if (!duplex_) outReader_.prepare(&outRing_, sr_, outSr_, inBuf_, outBuf_, jitter_);

        blockHint() = inBuf_;
        // Rebuild the active voice at the new rate and block size.
        if (!chainJson_.empty()) {
            try {
                auto c = buildChain(chainJson_, sr_, kMaxBlock);
                delete current_;
                current_ = c.release();
            } catch (const std::string& e) { lastError = e; }
        }

        OSStatus err = AudioDeviceCreateIOProcID(in, &Engine::inputProc, this, &inProc_);
        if (err != noErr) return fail("AudioDeviceCreateIOProcID(input) failed: " + std::to_string(err));
        if (!duplex_) {
            err = AudioDeviceCreateIOProcID(out, &Engine::outputProc, this, &outProc_);
            if (err != noErr) { teardown(); return fail("AudioDeviceCreateIOProcID(output) failed: " + std::to_string(err)); }
        }
        addListeners(in);
        if (!duplex_) addListeners(out);
        inCycles_.store(0);
        overloads_.store(0);  // counters are per stream
        dspPeak_.set(0.f);
        deviceChanged_.store(false);
        if ((err = AudioDeviceStart(in, inProc_)) != noErr) { teardown(); return fail("AudioDeviceStart(input) failed: " + std::to_string(err)); }
        if (!duplex_ && (err = AudioDeviceStart(out, outProc_)) != noErr) { teardown(); return fail("AudioDeviceStart(output) failed: " + std::to_string(err)); }
        running_.store(true);
        inUid_ = inUid;
        outUid_ = outUid;
        lastError.clear();
        return 0;
    }

    void stopLocked() {
        stopMonitorLocked();
        teardown();
        running_.store(false);
        drainRetired();
    }

    int startMonitor(const std::string& uid) {
        stopMonitorLocked();
        if (!running_.load()) return fail("start the voice path first");
        AudioObjectID dev = deviceByUID(uid);
        if (dev == kAudioObjectUnknown) return fail("monitor device not found: " + uid);
        if (dev == outDev_) return fail("monitor device is the voice output");
        monSr_ = nominalRate(dev);
        monBuf_ = (int)setBufferFrames(dev, (UInt32)std::max(64, inBuf_));
        monChannels_ = channelCount(dev, kAudioObjectPropertyScopeOutput);
        monRing_.reset();
        monReader_.prepare(&monRing_, sr_, monSr_, inBuf_, monBuf_,
                           std::max(jitter_, isWireless(dev) ? 0.02 * sr_ : 0.0));
        OSStatus err = AudioDeviceCreateIOProcID(dev, &Engine::monitorProc, this, &monProc_);
        if (err != noErr) return fail("monitor IOProc failed: " + std::to_string(err));
        monDev_ = dev;
        monitoring_.store(true);
        if ((err = AudioDeviceStart(dev, monProc_)) != noErr) { stopMonitorLocked(); return fail("monitor start failed"); }
        return 0;
    }

    void stopMonitorLocked() {
        if (monDev_ != kAudioObjectUnknown && monProc_) {
            monitoring_.store(false);
            AudioDeviceStop(monDev_, monProc_);
            AudioDeviceDestroyIOProcID(monDev_, monProc_);
        }
        monProc_ = nullptr;
        monDev_ = kAudioObjectUnknown;
        monitoring_.store(false);
    }

    int setChain(const std::string& js) {
        double sr = sr_ > 0 ? sr_ : 48000;
        std::unique_ptr<Chain> c;
        try {
            c = buildChain(js, sr, kMaxBlock);
        } catch (const std::string& e) {
            return fail(e);
        }
        chainJson_ = js;
        if (!running_.load()) {
            delete current_;
            current_ = c.release();
            return 0;
        }
        Chain* old = pending_.exchange(c.release(), std::memory_order_acq_rel);
        delete old;  // never reached the audio thread
        drainRetired();
        return 0;
    }

    int setParam(const std::string& type, const std::string& key, double v) {
        ParamMsg m{};
        strncpy(m.type, type.c_str(), sizeof m.type - 1);
        strncpy(m.key, key.c_str(), sizeof m.key - 1);
        m.value = v;
        if (!running_.load()) {
            if (current_) current_->setParam(type, key, v);
            return 0;
        }
        return params_.push(m) ? 0 : fail("parameter queue full");
    }

    // replace: stop whatever is playing first (waits for the audio thread to
    // drop it, so the new sound is never discarded along with the old one).
    int queueSound(const float* data, int frames, double rate, bool replace = false) {
        if (replace) {
            if (running_.load()) {
                clearSb_.store(true);
                for (int i = 0; i < 100 && clearSb_.load(); ++i) std::this_thread::sleep_for(std::chrono::milliseconds(1));
            }
            clearSb_.store(false);  // timed out (stalled device): just append
            if (!running_.load()) sbRing_.reset();  // no consumer: safe to reset here
        }
        double sr = sr_ > 0 ? sr_ : 48000;
        double step = rate / sr;
        std::vector<float> tmp;
        tmp.reserve((size_t)(frames / step) + 2);
        for (double p = 0; p < frames - 1; p += step) {
            int i = (int)p;
            float f = (float)(p - i);
            tmp.push_back(data[i] + f * (data[i + 1] - data[i]));
        }
        sbRing_.push(tmp.data(), (uint32_t)tmp.size());
        return 0;
    }

    void clearSounds() { clearSb_.store(true); }

    bool running() const { return running_.load(); }
    bool monitoring() const { return monitoring_.load(); }
    int fail(const std::string& e) { lastError = e; return -1; }

    void drainRetired() {
        Chain* c;
        while (retired_.pop(c)) delete c;
    }

private:
    static constexpr int kMaxBlock = 1024;
    static constexpr int kScope = 1024;

    AudioObjectID inDev_ = kAudioObjectUnknown, outDev_ = kAudioObjectUnknown, monDev_ = kAudioObjectUnknown;
    AudioDeviceIOProcID inProc_ = nullptr, outProc_ = nullptr, monProc_ = nullptr;
    std::string inUid_, outUid_, chainJson_;
    double sr_ = 48000, outSr_ = 48000, monSr_ = 48000;
    int inBuf_ = 128, outBuf_ = 128, monBuf_ = 128, inChannels_ = 1, outChannels_ = 2, monChannels_ = 2;
    bool duplex_ = false;
    double jitter_ = 0;
    std::atomic<bool> running_{false}, monitoring_{false}, clearSb_{false};

    FloatRing outRing_{1 << 15}, monRing_{1 << 15}, sbRing_{1 << 23};  // soundboard: ~175 s at 48 kHz
    DriftReader outReader_, monReader_;

    // Voice chain hand-off.
    Chain* current_ = nullptr;
    Chain* fading_ = nullptr;
    int fadePos_ = 0, fadeLen_ = 480;
    std::atomic<Chain*> pending_{nullptr};
    SpscQueue<Chain*, 64> retired_;
    SpscQueue<ParamMsg, 256> params_;

    nodes::Gate gate_;
    nodes::Denoise denoise_;
    nodes::Limiter limiter_;
    dsp::Biquad hpf_;
    std::vector<float> work_, fadeTmp_, sbTmp_, outTmp_;

    // Meters and scope (audio thread writes, control reads).
    AtomicFloat inRms_, outRms_, gateRms_, dspLoad_, dspPeak_, dspMs_;
    std::atomic<uint64_t> inCycles_{0};
    std::atomic<uint32_t> overloads_{0};
    std::atomic<bool> deviceChanged_{false};
    float scope_[kScope] = {};
    std::atomic<int> scopePos_{0};

    // Loopback measurement.
    std::atomic<int> measureState_{0};  // 0 idle, 1 armed, 2 sent, 3 found
    std::atomic<double> measureSentAt_{0}, measureFoundAt_{0};
    int measureQuiet_ = 0;     // audio thread: samples of silence left before the pulse
    long detectQuietRun_ = 0;  // output thread: consecutive quiet samples seen
    int detectWindow_ = 0;     // output thread: samples left to confirm a pulse
    std::atomic<long> detectMaxQuiet_{0};
    std::atomic<float> detectPeak_{0.f};

    void prepareDsp() {
        work_.assign(16384, 0.f);
        fadeTmp_.assign(kMaxBlock, 0.f);
        sbTmp_.assign(kMaxBlock, 0.f);
        outTmp_.assign(16384, 0.f);
        gate_.prepare(sr_);
        denoise_.prepare(sr_, kMaxBlock);
        limiter_.prepare(sr_);
        hpf_.highpass(sr_, 70.0, 0.7071);
        fadeLen_ = (int)(0.012 * sr_);
    }

    void teardown() {
        if (inDev_ != kAudioObjectUnknown && inProc_) {
            AudioDeviceStop(inDev_, inProc_);
            AudioDeviceDestroyIOProcID(inDev_, inProc_);
            removeListeners(inDev_);
        }
        if (outDev_ != kAudioObjectUnknown && outProc_) {
            AudioDeviceStop(outDev_, outProc_);
            AudioDeviceDestroyIOProcID(outDev_, outProc_);
            removeListeners(outDev_);
        }
        inProc_ = outProc_ = nullptr;
        // Audio threads are stopped: fold any pending/fading chain back in.
        if (Chain* p = pending_.exchange(nullptr)) { delete current_; current_ = p; }
        delete fading_;
        fading_ = nullptr;
    }

    // Device watchdog: hot-unplug, sample-rate change, overload.
    static constexpr AudioObjectPropertySelector kWatched[] = {
        kAudioDevicePropertyDeviceIsAlive, kAudioDevicePropertyNominalSampleRate, kAudioDeviceProcessorOverload};
    static OSStatus onDeviceProp(AudioObjectID, UInt32 n, const AudioObjectPropertyAddress* a, void* self) {
        auto* e = static_cast<Engine*>(self);
        for (UInt32 i = 0; i < n; ++i) {
            if (a[i].mSelector == kAudioDeviceProcessorOverload) e->overloads_.fetch_add(1);
            else e->deviceChanged_.store(true);
        }
        return noErr;
    }
    void addListeners(AudioObjectID dev) {
        for (AudioObjectPropertySelector sel : kWatched) {
            auto a = addr(sel);
            AudioObjectAddPropertyListener(dev, &a, &Engine::onDeviceProp, this);
        }
    }
    void removeListeners(AudioObjectID dev) {
        for (AudioObjectPropertySelector sel : kWatched) {
            auto a = addr(sel);
            AudioObjectRemovePropertyListener(dev, &a, &Engine::onDeviceProp, this);
        }
    }

    // ── Real-time voice path ─────────────────────────────────────────────────
    void processBlock(float* x, int n, double inputHostTime) {
        // Control messages.
        ParamMsg m;
        while (params_.pop(m))
            if (current_) current_->setParam(m.type, m.key, m.value);
        if (Chain* next = pending_.exchange(nullptr, std::memory_order_acq_rel)) {
            if (fading_) retired_.push(fading_);
            fading_ = current_;
            current_ = next;
            fadePos_ = 0;
        }

        float acc = 0;
        for (int i = 0; i < n; ++i) acc += x[i] * x[i];
        inRms_.set(linToDb(std::sqrt(acc / n)));

        const float vm = volMic.load(std::memory_order_relaxed);
        for (int i = 0; i < n; ++i) x[i] *= vm;
        if (hpfOn.load(std::memory_order_relaxed)) hpf_.process(x, n);
        denoise_.mode = nrMode.load(std::memory_order_relaxed);
        denoise_.strength = nrStrength.load(std::memory_order_relaxed);
        denoise_.process(x, n);  // Off is a no-op
        if (gateOn.load(std::memory_order_relaxed)) {
            gate_.thresholdDb = gateDb.load(std::memory_order_relaxed);
            gate_.process(x, n);
        }
        acc = 0;
        for (int i = 0; i < n; ++i) acc += x[i] * x[i];
        gateRms_.set(linToDb(std::sqrt(acc / n)));

        if (!bypass.load(std::memory_order_relaxed)) {
            if (fading_) {
                std::copy(x, x + n, fadeTmp_.begin());
                fading_->process(fadeTmp_.data(), n);
                if (current_) current_->process(x, n);
                for (int i = 0; i < n; ++i) {
                    float g = std::min(1.f, (float)(fadePos_ + i) / fadeLen_);
                    x[i] = x[i] * g + fadeTmp_[i] * (1.f - g);
                }
                fadePos_ += n;
                if (fadePos_ >= fadeLen_) {
                    retired_.push(fading_);  // on overflow it leaks: never free on the audio thread
                    fading_ = nullptr;
                }
            } else if (current_) {
                current_->process(x, n);
            }
        }

        const float vv = mute.load(std::memory_order_relaxed) ? 0.f : volVoice.load(std::memory_order_relaxed);
        for (int i = 0; i < n; ++i) x[i] *= vv;

        if (clearSb_.exchange(false)) sbRing_.skip(sbRing_.size());
        int got = (int)sbRing_.pop(sbTmp_.data(), (uint32_t)n);
        const float vs = volSound.load(std::memory_order_relaxed);
        for (int i = 0; i < got; ++i) x[i] += sbTmp_[i] * vs;

        if (limiterOn.load(std::memory_order_relaxed)) limiter_.process(x, n);
        for (int i = 0; i < n; ++i) if (!(x[i] == x[i])) x[i] = 0.f;

        // Loopback measurement: silence the path for 30 ms (so nothing already
        // queued can be mistaken for the pulse), then send a 3-sample pulse.
        int ms = measureState_.load(std::memory_order_acquire);
        if (ms == 1 || ms == 2) {
            std::fill(x, x + n, 0.f);
            if (ms == 1 && n >= 3 && (measureQuiet_ -= n) <= 0) {
                x[0] = x[1] = x[2] = 0.99f;
                double chainLat = ((current_ ? current_->latency() : 0) + denoise_.latency()) / sr_;
                measureSentAt_.store(inputHostTime - chainLat);
                measureState_.store(2, std::memory_order_release);
            }
        }

        acc = 0;
        for (int i = 0; i < n; ++i) acc += x[i] * x[i];
        outRms_.set(linToDb(std::sqrt(acc / n)));
        int sp = scopePos_.load(std::memory_order_relaxed);
        for (int i = 0; i < n; ++i) { scope_[sp] = x[i]; sp = (sp + 1) & (kScope - 1); }
        scopePos_.store(sp, std::memory_order_relaxed);

        if (monitoring_.load(std::memory_order_relaxed)) {
            if (monitorVoice.load(std::memory_order_relaxed)) {  // hear myself: voice + sounds
                const float vmo = volMonitor.load(std::memory_order_relaxed);
                for (int i = 0; i < n; ++i) outTmp_[i] = x[i] * vmo;
            } else {  // sounds-only preview: pads in your headphones, not your voice
                for (int i = 0; i < n; ++i) outTmp_[i] = i < got ? sbTmp_[i] * vs : 0.f;
            }
            monRing_.push(outTmp_.data(), (uint32_t)n);
        }
    }

    void runInput(const AudioBufferList* in, const AudioTimeStamp* inTime, int frames) {
        enableFlushToZero();
        uint64_t t0 = mach_absolute_time();
        frames = std::min(frames, (int)work_.size());
        // Channel 0 of the first buffer that has data.
        const AudioBuffer* b = nullptr;
        for (UInt32 i = 0; in && i < in->mNumberBuffers; ++i)
            if (in->mBuffers[i].mData && in->mBuffers[i].mNumberChannels > 0) { b = &in->mBuffers[i]; break; }
        if (b) {
            const float* src = static_cast<const float*>(b->mData);
            const int stride = (int)b->mNumberChannels;
            for (int i = 0; i < frames; ++i) work_[i] = src[i * stride];
        } else {
            std::fill(work_.begin(), work_.begin() + frames, 0.f);
        }
        double hostT = (inTime && (inTime->mFlags & kAudioTimeStampHostTimeValid)) ? hostToSeconds(inTime->mHostTime)
                                                                                    : hostToSeconds(mach_absolute_time());
        for (int off = 0; off < frames; off += kMaxBlock) {
            int n = std::min(kMaxBlock, frames - off);
            processBlock(work_.data() + off, n, hostT + off / sr_);
        }
        inCycles_.fetch_add(1, std::memory_order_relaxed);

        double el = hostToSeconds(mach_absolute_time() - t0);
        double budget = frames / sr_;
        float load = (float)(el / budget);
        dspLoad_.set(dspLoad_.get() + 0.05f * (load - dspLoad_.get()));
        dspMs_.set(dspMs_.get() + 0.05f * ((float)(el * 1000.0) - dspMs_.get()));
        if (load > dspPeak_.get()) dspPeak_.set(load);
    }

    static void writeOut(AudioBufferList* out, const float* src, int frames) {
        for (UInt32 i = 0; i < out->mNumberBuffers; ++i) {
            AudioBuffer& b = out->mBuffers[i];
            float* dst = static_cast<float*>(b.mData);
            if (!dst) continue;
            const int ch = (int)b.mNumberChannels;
            const int fr = std::min(frames, (int)(b.mDataByteSize / (sizeof(float) * std::max(1, ch))));
            for (int f = 0; f < fr; ++f)
                for (int c = 0; c < ch; ++c) dst[f * ch + c] = src[f];
        }
    }

    void detectPulse(const AudioBufferList* in, const AudioTimeStamp* inTime, double rate) {
        // Count quiet from arming (state 1) on; accept the pulse only once sent (2).
        const int state = measureState_.load(std::memory_order_acquire);
        if ((state != 1 && state != 2) || !in) return;
        for (UInt32 i = 0; i < in->mNumberBuffers; ++i) {
            const AudioBuffer& b = in->mBuffers[i];
            if (!b.mData || b.mNumberChannels == 0) continue;
            const float* s = static_cast<const float*>(b.mData);
            const int ch = (int)b.mNumberChannels, fr = (int)(b.mDataByteSize / (sizeof(float) * ch));
            const long needQuiet = (long)(0.01 * rate);
            for (int f = 0; f < fr; ++f) {
                float a = std::fabs(s[f * ch]);
                if (state == 2 && a > detectPeak_.load(std::memory_order_relaxed)) detectPeak_.store(a, std::memory_order_relaxed);
                // A pulse is the first sound after >= 10 ms of quiet that reaches
                // full height within 16 samples (resampling can ramp its edge).
                if (state == 2 && a >= 0.05f && detectQuietRun_ >= needQuiet) detectWindow_ = 16;
                if (detectWindow_ > 0) {
                    if (a > 0.6f) {
                        double t = hostToSeconds(inTime->mHostTime) + f / rate;
                        measureFoundAt_.store(t);
                        measureState_.store(3, std::memory_order_release);
                        detectWindow_ = 0;
                        return;
                    }
                    --detectWindow_;
                }
                detectQuietRun_ = a < 0.05f ? detectQuietRun_ + 1 : 0;
                if (detectQuietRun_ > detectMaxQuiet_.load(std::memory_order_relaxed))
                    detectMaxQuiet_.store(detectQuietRun_, std::memory_order_relaxed);
            }
            return;
        }
    }

    static OSStatus inputProc(AudioObjectID, const AudioTimeStamp*, const AudioBufferList* in,
                              const AudioTimeStamp* inTime, AudioBufferList* out, const AudioTimeStamp*,
                              void* self) {
        auto* e = static_cast<Engine*>(self);
        int frames = 0;
        if (in && in->mNumberBuffers > 0 && in->mBuffers[0].mNumberChannels > 0)
            frames = (int)(in->mBuffers[0].mDataByteSize / (sizeof(float) * in->mBuffers[0].mNumberChannels));
        if (frames <= 0) return noErr;
        e->runInput(in, inTime, frames);
        if (e->duplex_) {
            if (out) {
                e->detectPulse(in, inTime, e->sr_);
                writeOut(out, e->work_.data(), frames);
            }
        } else {
            e->outRing_.push(e->work_.data(), (uint32_t)frames);
        }
        return noErr;
    }

    static OSStatus outputProc(AudioObjectID, const AudioTimeStamp*, const AudioBufferList* in,
                               const AudioTimeStamp* inTime, AudioBufferList* out, const AudioTimeStamp*,
                               void* self) {
        auto* e = static_cast<Engine*>(self);
        enableFlushToZero();
        if (in && inTime) e->detectPulse(in, inTime, e->outSr_);
        if (!out || out->mNumberBuffers == 0) return noErr;
        const AudioBuffer& b0 = out->mBuffers[0];
        int frames = (int)(b0.mDataByteSize / (sizeof(float) * std::max<UInt32>(1, b0.mNumberChannels)));
        frames = std::min(frames, (int)e->outTmp_.size());
        e->outReader_.read(e->outTmp_.data(), frames);
        writeOut(out, e->outTmp_.data(), frames);
        return noErr;
    }

    static OSStatus monitorProc(AudioObjectID, const AudioTimeStamp*, const AudioBufferList*, const AudioTimeStamp*,
                                AudioBufferList* out, const AudioTimeStamp*, void* self) {
        auto* e = static_cast<Engine*>(self);
        enableFlushToZero();
        if (!out || out->mNumberBuffers == 0) return noErr;
        static thread_local std::vector<float> buf(16384);
        const AudioBuffer& b0 = out->mBuffers[0];
        int frames = (int)(b0.mDataByteSize / (sizeof(float) * std::max<UInt32>(1, b0.mNumberChannels)));
        frames = std::min(frames, (int)buf.size());
        e->monReader_.read(buf.data(), frames);
        writeOut(out, buf.data(), frames);
        return noErr;
    }

public:
    std::string statsJson();
    std::string measureLoopback();
};

// ── Stats ─────────────────────────────────────────────────────────────────────

std::string Engine::statsJson() {
    drainRetired();
    json::Writer w;
    w.beginObj();
    w.kvb("running", running_.load());
    w.kvb("monitoring", monitoring_.load());
    w.kvb("bypass", bypass.load());
    w.kv("input_rms_db", inRms_.get(), 1);
    w.kv("output_rms_db", outRms_.get(), 1);
    w.kv("gate_rms_db", gateRms_.get(), 1);
    w.kv("sample_rate", sr_, 0);
    w.kv("output_sample_rate", outSr_, 0);
    w.kvi("input_buffer", inBuf_);
    w.kvi("output_buffer", outBuf_);
    w.kvb("duplex", duplex_);

    // Latency breakdown (ms).
    double ms = 1000.0 / sr_;
    SideLatency li{}, lo{};
    if (running_.load()) {
        li = sideLatency(inDev_, kAudioObjectPropertyScopeInput);
        lo = sideLatency(outDev_, kAudioObjectPropertyScopeOutput);
    }
    int chainLat = current_ ? current_->latency() : 0;
    const double nrMs = denoise_.latency() * 1000.0 / sr_;
    double queued = duplex_ ? 0.0 : outReader_.queued();
    double inMs = li.total() * ms;
    double outMs = lo.total() * 1000.0 / outSr_;
    double dspMs = chainLat * ms;
    double ringMs = queued * ms;
    w.key("latency");
    w.beginObj();
    w.kv("input_ms", inMs, 2);
    w.kv("dsp_ms", dspMs, 2);
    w.kv("ring_ms", ringMs, 2);
    w.kv("output_ms", outMs, 2);
    w.kv("nr_ms", nrMs, 2);
    w.kv("total_ms", inMs + nrMs + dspMs + ringMs + outMs, 2);
    w.kv("block_ms", inBuf_ * ms, 2);
    w.kv("ring_target_ms", (duplex_ ? 0.0 : outReader_.target()) * ms, 2);
    w.kv("drift_ratio", duplex_ ? 1.0 : outReader_.ratio(), 6);
    w.key("input_frames");
    w.beginObj(); w.kvi("device", li.device); w.kvi("safety", li.safety); w.kvi("stream", li.stream); w.kvi("buffer", li.buffer); w.endObj();
    w.key("output_frames");
    w.beginObj(); w.kvi("device", lo.device); w.kvi("safety", lo.safety); w.kvi("stream", lo.stream); w.kvi("buffer", lo.buffer); w.endObj();
    w.endObj();

    w.kv("voice_activity", denoise_.vad(), 3);
    w.kv("sound_remaining_ms", sbRing_.size() * 1000.0 / sr_, 0);
    w.kvb("muted", mute.load());
    w.kv("cpu", dspLoad_.get(), 3);
    w.kv("cpu_peak", dspPeak_.get(), 3);
    w.kv("dsp_time_ms", dspMs_.get(), 3);
    const uint32_t modelDrops = current_ ? current_->dropouts() : 0;
    w.kvi("xruns", (long long)outReader_.underruns.load() + monReader_.underruns.load() + overloads_.load() + modelDrops);
    w.kvi("model_underruns", modelDrops);
    w.kv("model_step_ms", current_ ? current_->workerStepMs() : 0.0, 3);
    w.kv("model_cpu", current_ ? current_->workerLoad() : 0.0, 3);
    w.kvi("underruns", outReader_.underruns.load());
    w.kvi("overloads", overloads_.load());
    w.kvi("cycles", (long long)inCycles_.load());
    w.kvb("device_changed", deviceChanged_.load());

    // 24 log-spaced spectrum bands of the last 1024 output samples, 0..1.
    static dsp::RealFFT fft;
    static std::vector<float> win, frame(kScope), re(kScope / 2 + 1), im(kScope / 2 + 1);
    if (fft.size() != kScope) {
        fft.prepare(kScope);
        win.resize(kScope);
        for (int i = 0; i < kScope; ++i) win[i] = 0.5f - 0.5f * std::cos(2 * M_PI * i / kScope);
    }
    int sp = scopePos_.load(std::memory_order_relaxed);
    for (int i = 0; i < kScope; ++i) frame[i] = scope_[(sp + i) & (kScope - 1)] * win[i];
    fft.forward(frame.data(), re.data(), im.data());
    w.key("bands");
    w.beginArr();
    const int bands = 24, nb = kScope / 2;
    int prev = 1;
    for (int b = 1; b <= bands; ++b) {
        int edge = std::max(prev + 1, (int)std::lround(std::pow((double)nb - 1, (double)b / bands)));
        double sum = 0;
        for (int k = prev; k < edge && k <= nb; ++k) sum += std::sqrt(re[k] * re[k] + im[k] * im[k]);
        double v = sum / std::max(1, edge - prev) * 2.0;
        double db = 20 * std::log10(v + 1e-9);
        w.num(std::clamp((db + 60) / 60, 0.0, 1.0), 3);
        prev = edge;
    }
    w.endArr();
    w.kv("error", lastError);
    w.endObj();
    return w.s;
}

std::string Engine::measureLoopback() {
    if (!running_.load()) { fail("start the voice path before measuring"); return statsJson(); }
    if (channelCount(outDev_, kAudioObjectPropertyScopeInput) < 1 && !duplex_) {
        fail("output device has no input side to listen on (needs a loopback device like BlackHole)");
        return statsJson();
    }
    measureQuiet_ = (int)(0.03 * sr_);
    detectQuietRun_ = 0;
    detectWindow_ = 0;
    detectMaxQuiet_.store(0);
    detectPeak_.store(0.f);
    measureState_.store(1, std::memory_order_release);
    auto t0 = std::chrono::steady_clock::now();
    while (measureState_.load() != 3 && std::chrono::steady_clock::now() - t0 < std::chrono::milliseconds(1000))
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    const int reached = measureState_.load();
    bool ok = reached == 3;
    double loopMs = ok ? (measureFoundAt_.load() - measureSentAt_.load()) * 1000.0 : 0.0;
    measureState_.store(0, std::memory_order_release);

    // The measured span runs from the mic sample's capture timestamp, through
    // the chain (its latency added explicitly), the ring and the output, to
    // the moment the sample is readable on the virtual mic. The input
    // converter latency is the one part the timestamps cannot see.
    SideLatency li = sideLatency(inDev_, kAudioObjectPropertyScopeInput);
    double converterMs = (li.device + li.safety + li.stream) * 1000.0 / sr_;
    std::string base = statsJson();
    json::Writer w;
    w.beginObj();
    w.kvb("ok", ok);
    w.kv("measured_ms", ok ? loopMs + converterMs : 0.0, 2);
    w.kv("measured_path_ms", loopMs, 2);
    w.kv("input_converter_ms", converterMs, 2);
    w.kvi("state_reached", reached);
    w.kvi("max_quiet_samples", detectMaxQuiet_.load());
    w.kv("peak_after_send", detectPeak_.load(), 3);
    w.key("stats");
    w.raw(base);
    w.endObj();
    if (!ok) lastError = "loopback pulse not detected within 1 s";
    return w.s;
}

std::string devicesJsonImpl() {
    AudioObjectID defIn = 0, defOut = 0;
    getProp(kAudioObjectSystemObject, kAudioHardwarePropertyDefaultInputDevice, defIn);
    getProp(kAudioObjectSystemObject, kAudioHardwarePropertyDefaultOutputDevice, defOut);
    json::Writer w;
    w.beginArr();
    int index = 0;
    for (auto id : allDevices()) {
        int ins = channelCount(id, kAudioObjectPropertyScopeInput);
        int outs = channelCount(id, kAudioObjectPropertyScopeOutput);
        if (ins == 0 && outs == 0) continue;
        UInt32 transport = 0;
        getProp(id, kAudioDevicePropertyTransportType, transport);
        std::string name = stringProp(id, kAudioObjectPropertyName);
        w.beginObj();
        w.kvi("index", index++);
        w.kvi("id", id);
        w.kv("uid", stringProp(id, kAudioDevicePropertyDeviceUID));
        w.kv("name", name);
        w.kvi("inputs", ins);
        w.kvi("outputs", outs);
        w.kv("sample_rate", nominalRate(id), 0);
        w.kvb("is_virtual", transport == kAudioDeviceTransportTypeVirtual || transport == kAudioDeviceTransportTypeAggregate);
        w.kvb("is_bluetooth", transport == kAudioDeviceTransportTypeBluetooth || transport == kAudioDeviceTransportTypeBluetoothLE);
        w.kvb("is_default_input", id == defIn);
        w.kvb("is_default_output", id == defOut);
        w.endObj();
    }
    w.endArr();
    return w.s;
}

int copyOut(const std::string& s, char* buf, int cap) {
    if (buf && cap > 0) {
        int n = std::min((int)s.size(), cap - 1);
        std::memcpy(buf, s.data(), n);
        buf[n] = 0;
    }
    return (int)s.size() + 1;
}

}  // namespace

// ── C API ─────────────────────────────────────────────────────────────────────

extern "C" {

const char* ac_version(void) { return "0.1.0"; }

const char* ac_last_error(void) {
    static thread_local std::string copy;
    auto& e = Engine::get();
    std::lock_guard<std::mutex> g(e.ctl);
    copy = e.lastError;
    return copy.c_str();
}

int ac_list_devices(char* buf, int cap) { return copyOut(devicesJsonImpl(), buf, cap); }

int ac_start(const char* in_uid, const char* out_uid, int buffer_frames, double sample_rate) {
    auto& e = Engine::get();
    std::lock_guard<std::mutex> g(e.ctl);
    return e.start(in_uid ? in_uid : "", out_uid ? out_uid : "", buffer_frames > 0 ? buffer_frames : 128,
                   sample_rate > 0 ? sample_rate : 48000.0);
}

void ac_stop(void) {
    auto& e = Engine::get();
    std::lock_guard<std::mutex> g(e.ctl);
    e.stopLocked();
}

int ac_is_running(void) { return Engine::get().running() ? 1 : 0; }

int ac_start_monitor(const char* uid) {
    auto& e = Engine::get();
    std::lock_guard<std::mutex> g(e.ctl);
    return e.startMonitor(uid ? uid : "");
}

void ac_stop_monitor(void) {
    auto& e = Engine::get();
    std::lock_guard<std::mutex> g(e.ctl);
    e.stopMonitorLocked();
}

int ac_is_monitoring(void) { return Engine::get().monitoring() ? 1 : 0; }

int ac_set_chain(const char* js) {
    auto& e = Engine::get();
    std::lock_guard<std::mutex> g(e.ctl);
    return e.setChain(js ? js : "{}");
}

int ac_set_param(const char* effect, const char* param, double value) {
    auto& e = Engine::get();
    std::lock_guard<std::mutex> g(e.ctl);
    return e.setParam(effect ? effect : "", param ? param : "", value);
}

int ac_set_setting(const char* key, double v) {
    auto& e = Engine::get();
    std::string k = key ? key : "";
    if (k == "vol_mic") e.volMic.store((float)v);
    else if (k == "vol_voice") e.volVoice.store((float)v);
    else if (k == "vol_sound") e.volSound.store((float)v);
    else if (k == "vol_monitor") e.volMonitor.store((float)v);
    else if (k == "bypass") e.bypass.store(v != 0);
    else if (k == "mute") e.mute.store(v != 0);
    else if (k == "monitor_voice") e.monitorVoice.store(v != 0);
    else if (k == "gate_enabled") e.gateOn.store(v != 0);
    else if (k == "gate_db") e.gateDb.store((float)v);
    else if (k == "hpf_enabled") e.hpfOn.store(v != 0);
    else if (k == "limiter_enabled") e.limiterOn.store(v != 0);
    else if (k == "nr_mode") e.nrMode.store(std::clamp((int)v, 0, 3));
    else if (k == "nr_strength") e.nrStrength.store((float)std::clamp(v, 0.0, 1.0));
    else {
        std::lock_guard<std::mutex> g(e.ctl);
        return e.fail("unknown setting: " + k);
    }
    return 0;
}

int ac_queue_sound(const float* data, int frames, double sample_rate) {
    if (!data || frames < 2 || sample_rate <= 0) return -1;
    auto& e = Engine::get();
    std::lock_guard<std::mutex> g(e.ctl);
    return e.queueSound(data, frames, sample_rate);
}

int ac_play_sound(const float* data, int frames, double sample_rate) {
    if (!data || frames < 2 || sample_rate <= 0) return -1;
    auto& e = Engine::get();
    std::lock_guard<std::mutex> g(e.ctl);
    return e.queueSound(data, frames, sample_rate, true);
}

void ac_clear_sounds(void) { Engine::get().clearSounds(); }

int ac_get_stats(char* buf, int cap) {
    auto& e = Engine::get();
    std::lock_guard<std::mutex> g(e.ctl);
    return copyOut(e.statsJson(), buf, cap);
}

int ac_measure_loopback(char* buf, int cap) {
    auto& e = Engine::get();
    std::lock_guard<std::mutex> g(e.ctl);
    return copyOut(e.measureLoopback(), buf, cap);
}

int ac_render_offline(const char* chain_json, const float* input, float* output, int frames, double sr, int block) {
    if (!input || !output || frames <= 0 || sr <= 0) return -1;
    if (block <= 0) block = 128;
    std::unique_ptr<Chain> c;
#ifdef AURORA_NEURAL
    struct OfflineScope {
        OfflineScope() { neural::offlineMode() = true; }
        ~OfflineScope() { neural::offlineMode() = false; }
    } offline;
#endif
    const int savedHint = blockHint();
    blockHint() = std::max(block, 16);
    try {
        c = buildChain(chain_json ? chain_json : "{}", sr, std::max(block, 16));
        blockHint() = savedHint;
    } catch (const std::string& err) {
        blockHint() = savedHint;
        auto& e = Engine::get();
        std::lock_guard<std::mutex> g(e.ctl);
        e.fail(err);
        return -1;
    }
    enableFlushToZero();
    std::memcpy(output, input, sizeof(float) * frames);
    for (int off = 0; off < frames; off += block) c->process(output + off, std::min(block, frames - off));
    return c->latency();
}

}  // extern "C"
