// Mac audio capture (YouTube, games, any app) through a Core Audio process
// tap (macOS 14.2+). The tap mixes every process except this one down to
// mono; a private aggregate device delivers it to an IOProc that writes a
// History. The first start asks for "System Audio Recording" permission;
// without it the tap delivers silence.
#pragma once

#include <CoreAudio/CoreAudio.h>

#include <atomic>
#include <string>

namespace aurora {

class History;

// System Audio Recording permission (TCC service kTCCServiceAudioCapture).
// macOS has no public call for it; like Apple-sample-based tap apps we use
// TCC's own preflight/request, loaded at run time. Asking first matters: a
// tap created while the prompt is undecided blocks Core Audio in this whole
// process until the user answers.
enum class CapturePermission { Unknown = -1, Granted = 0, Denied = 1, Undetermined = 2 };
CapturePermission capturePermission(bool fresh = false);  // cached for 1 s unless fresh
void requestCapturePermission();  // shows the prompt; returns at once

class SystemTap {
public:
    ~SystemTap() { stop(); }
    int start(History* h, std::string& err);  // 0 on success
    void stop();
    bool active() const { return active_.load(); }
    double rate() const { return rate_; }

private:
    static OSStatus ioProc(AudioObjectID, const AudioTimeStamp*, const AudioBufferList* in, const AudioTimeStamp*,
                           AudioBufferList*, const AudioTimeStamp*, void* self);
    AudioObjectID tap_ = kAudioObjectUnknown, agg_ = kAudioObjectUnknown;
    AudioDeviceIOProcID proc_ = nullptr;
    History* h_ = nullptr;
    double rate_ = 48000;
    std::atomic<bool> active_{false};
    float mix_[4096] = {};
};

}  // namespace aurora
