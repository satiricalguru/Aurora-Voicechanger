#include "system_tap.h"

#import <CoreAudio/AudioHardwareTapping.h>
#import <CoreAudio/CATapDescription.h>
#import <Foundation/Foundation.h>
#include <dlfcn.h>
#include <unistd.h>

#include <algorithm>

#include "capture.h"

namespace aurora {

namespace {

AudioObjectPropertyAddress addr(AudioObjectPropertySelector sel) {
    return {sel, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain};
}

NSString* defaultOutputUID() {
    AudioObjectID dev = kAudioObjectUnknown;
    UInt32 size = sizeof dev;
    auto a = addr(kAudioHardwarePropertyDefaultSystemOutputDevice);
    if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &a, 0, nullptr, &size, &dev) != noErr) return nil;
    CFStringRef uid = nullptr;
    size = sizeof uid;
    auto u = addr(kAudioDevicePropertyDeviceUID);
    if (AudioObjectGetPropertyData(dev, &u, 0, nullptr, &size, &uid) != noErr || !uid) return nil;
    return (__bridge_transfer NSString*)uid;
}

// This process's Core Audio object, so the tap leaves out our own output
// (the changed voice, pad previews).
NSArray<NSNumber*>* ownProcess() {
    pid_t pid = getpid();
    AudioObjectID obj = kAudioObjectUnknown;
    UInt32 size = sizeof obj;
    auto a = addr(kAudioHardwarePropertyTranslatePIDToProcessObject);
    if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &a, sizeof pid, &pid, &size, &obj) == noErr &&
        obj != kAudioObjectUnknown)
        return @[ @(obj) ];
    return @[];
}

using PreflightFn = int (*)(CFStringRef, CFDictionaryRef);
using RequestFn = void (*)(CFStringRef, CFDictionaryRef, void (^)(Boolean));

void* tcc() {
    static void* h = dlopen("/System/Library/PrivateFrameworks/TCC.framework/Versions/A/TCC", RTLD_NOW);
    return h;
}

std::atomic<bool> requesting{false};

}  // namespace

CapturePermission capturePermission(bool fresh) {
    static std::atomic<int> cached{-2};
    static std::atomic<double> at{0};
    const double now = CFAbsoluteTimeGetCurrent();
    if (!fresh && cached.load() != -2 && now - at.load() < 1.0) return (CapturePermission)cached.load();
    auto fn = tcc() ? (PreflightFn)dlsym(tcc(), "TCCAccessPreflight") : nullptr;
    CapturePermission p = CapturePermission::Unknown;
    if (fn) {
        int r = fn(CFSTR("kTCCServiceAudioCapture"), nullptr);
        p = r == 0 ? CapturePermission::Granted : r == 1 ? CapturePermission::Denied : CapturePermission::Undetermined;
    }
    cached.store((int)p);
    at.store(now);
    return p;
}

void requestCapturePermission() {
    auto fn = tcc() ? (RequestFn)dlsym(tcc(), "TCCAccessRequest") : nullptr;
    if (!fn || requesting.exchange(true)) return;
    fn(CFSTR("kTCCServiceAudioCapture"), nullptr, ^(Boolean) { requesting.store(false); });
}

int SystemTap::start(History* h, std::string& err) {
    stop();
    if (@available(macOS 14.2, *)) {
        @autoreleasepool {
            CATapDescription* d = [[CATapDescription alloc] initMonoGlobalTapButExcludeProcesses:ownProcess()];
            d.name = @"Aurora Voice recorder";
            d.privateTap = YES;
            d.muteBehavior = CATapUnmuted;
            OSStatus st = AudioHardwareCreateProcessTap(d, &tap_);
            if (st != noErr) { err = "could not tap Mac audio (" + std::to_string(st) + ")"; tap_ = kAudioObjectUnknown; return -1; }

            NSString* outUID = defaultOutputUID();
            if (!outUID) { err = "no output device"; stop(); return -1; }
            NSDictionary* desc = @{
                @kAudioAggregateDeviceNameKey: @"Aurora Mac Audio",
                @kAudioAggregateDeviceUIDKey: [[NSUUID UUID] UUIDString],
                @kAudioAggregateDeviceMainSubDeviceKey: outUID,
                @kAudioAggregateDeviceIsPrivateKey: @YES,
                @kAudioAggregateDeviceIsStackedKey: @NO,
                @kAudioAggregateDeviceTapAutoStartKey: @YES,
                @kAudioAggregateDeviceSubDeviceListKey: @[ @{@kAudioSubDeviceUIDKey: outUID} ],
                @kAudioAggregateDeviceTapListKey: @[ @{@kAudioSubTapDriftCompensationKey: @YES,
                                                       @kAudioSubTapUIDKey: d.UUID.UUIDString} ],
            };
            st = AudioHardwareCreateAggregateDevice((__bridge CFDictionaryRef)desc, &agg_);
            if (st != noErr) { err = "could not create the capture device (" + std::to_string(st) + ")"; agg_ = kAudioObjectUnknown; stop(); return -1; }

            Float64 sr = 0;
            UInt32 size = sizeof sr;
            auto a = addr(kAudioDevicePropertyNominalSampleRate);
            AudioObjectGetPropertyData(agg_, &a, 0, nullptr, &size, &sr);
            rate_ = sr > 8000 ? sr : 48000;
            h->setRate(rate_);
            h_ = h;

            st = AudioDeviceCreateIOProcID(agg_, &SystemTap::ioProc, this, &proc_);
            if (st != noErr) { err = "capture IOProc failed (" + std::to_string(st) + ")"; proc_ = nullptr; stop(); return -1; }
            // The first start can wait here on the System Audio Recording prompt.
            st = AudioDeviceStart(agg_, proc_);
            if (st != noErr) { err = "capture start failed (" + std::to_string(st) + ")"; stop(); return -1; }
            active_.store(true);
            return 0;
        }
    }
    err = "capturing Mac audio needs macOS 14.2 or later";
    return -1;
}

void SystemTap::stop() {
    active_.store(false);
    if (agg_ != kAudioObjectUnknown && proc_) {
        AudioDeviceStop(agg_, proc_);
        AudioDeviceDestroyIOProcID(agg_, proc_);
    }
    proc_ = nullptr;
    if (agg_ != kAudioObjectUnknown) AudioHardwareDestroyAggregateDevice(agg_);
    agg_ = kAudioObjectUnknown;
    if (tap_ != kAudioObjectUnknown) {
        if (@available(macOS 14.2, *)) AudioHardwareDestroyProcessTap(tap_);
    }
    tap_ = kAudioObjectUnknown;
}

OSStatus SystemTap::ioProc(AudioObjectID, const AudioTimeStamp*, const AudioBufferList* in, const AudioTimeStamp*,
                           AudioBufferList*, const AudioTimeStamp*, void* self) {
    auto* t = static_cast<SystemTap*>(self);
    if (!t->active_.load(std::memory_order_relaxed) || !in) return noErr;
    // The tap is the aggregate's only input stream; fold any channels to mono.
    for (UInt32 b = 0; b < in->mNumberBuffers; ++b) {
        const AudioBuffer& buf = in->mBuffers[b];
        if (!buf.mData || !buf.mNumberChannels) continue;
        const int ch = (int)buf.mNumberChannels;
        const int frames = std::min((int)(buf.mDataByteSize / (sizeof(float) * ch)), 4096);
        const float* s = static_cast<const float*>(buf.mData);
        for (int i = 0; i < frames; ++i) {
            float acc = 0;
            for (int c = 0; c < ch; ++c) acc += s[i * ch + c];
            t->mix_[i] = acc / ch;
        }
        t->h_->push(t->mix_, frames);
        break;
    }
    return noErr;
}

}  // namespace aurora
