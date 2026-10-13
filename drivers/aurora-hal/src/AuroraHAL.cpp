// Aurora Microphone: a loopback AudioServerPlugIn (CoreAudio virtual device).
//
// The Aurora engine writes the changed voice to the device's output stream;
// Discord, OBS, Zoom and games read it from the input stream. Both sides run
// on this device's clock, so there is no drift to correct, and the device
// reports zero latency and zero safety offset: the only delay is one I/O
// buffer on each side.
//
// Audio is kept in a ring indexed by device sample time. A reader only ever
// gets frames from the writer's current contiguous run; anything older, newer
// or from before a gap reads as silence, so stale audio is never replayed when
// the app stops or stalls.
//
// Objects: plug-in (1) -> device (2) -> input stream (3), output stream (4).

#include <CoreAudio/AudioServerPlugIn.h>
#include <mach/mach_time.h>
#include <pthread.h>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstring>

namespace {

// ── Fixed device description ──────────────────────────────────────────────────

enum : AudioObjectID {
    kPlugIn = kAudioObjectPlugInObject,  // 1
    kDevice = 2,
    kInStream = 3,
    kOutStream = 4,
};

constexpr Float64 kSampleRate = 48000.0;
constexpr UInt32 kChannels = 2;
constexpr UInt32 kBytesPerFrame = kChannels * sizeof(Float32);
constexpr UInt32 kZeroTimeStampPeriod = 16384;  // frames between clock anchors
constexpr UInt32 kRingFrames = 16384;           // 341 ms of audio history

#define kManufacturer CFSTR("Aurora Voice")
#define kDeviceName CFSTR("Aurora Microphone")
#define kDeviceUID CFSTR("AuroraMicrophone_UID")
#define kModelUID CFSTR("AuroraMicrophone_ModelUID")

// ── State ─────────────────────────────────────────────────────────────────────

AudioServerPlugInHostRef gHost = nullptr;
pthread_mutex_t gStateMutex = PTHREAD_MUTEX_INITIALIZER;  // control + clock, never held during DoIO copies
std::atomic<UInt32> gRefCount{0};

UInt64 gIOCount = 0;          // clients doing IO
Float64 gHostTicksPerFrame = 0;
UInt64 gAnchorHostTime = 0;
UInt64 gNumberTimeStamps = 0;
bool gInStreamActive = true, gOutStreamActive = true;

// Ring (only touched from the device's IO thread, which serialises DoIO).
Float32 gRing[kRingFrames * kChannels];
Float64 gRunStart = 0;    // first sample time of the writer's current contiguous run
Float64 gWriteEnd = -1;   // one past the last written sample time (-1: nothing written)

// ── Helpers ───────────────────────────────────────────────────────────────────

AudioStreamBasicDescription streamFormat() {
    AudioStreamBasicDescription f{};
    f.mSampleRate = kSampleRate;
    f.mFormatID = kAudioFormatLinearPCM;
    f.mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagsNativeEndian | kAudioFormatFlagIsPacked;
    f.mBytesPerPacket = kBytesPerFrame;
    f.mFramesPerPacket = 1;
    f.mBytesPerFrame = kBytesPerFrame;
    f.mChannelsPerFrame = kChannels;
    f.mBitsPerChannel = 32;
    return f;
}

bool isStream(AudioObjectID id) { return id == kInStream || id == kOutStream; }

inline UInt32 ringIndex(Float64 sampleTime) {
    SInt64 t = (SInt64)sampleTime;
    SInt64 m = t % (SInt64)kRingFrames;
    return (UInt32)(m < 0 ? m + kRingFrames : m);
}

// Writes `value` into outData if it fits; returns the size the property needs.
template <typename T>
OSStatus put(const T& value, UInt32 inDataSize, UInt32* outDataSize, void* outData) {
    if (outData) {
        if (inDataSize < sizeof(T)) return kAudioHardwareBadPropertySizeError;
        std::memcpy(outData, &value, sizeof(T));
    }
    *outDataSize = sizeof(T);
    return noErr;
}

// Writes as many IDs as fit.
OSStatus putIDs(const AudioObjectID* ids, UInt32 n, UInt32 inDataSize, UInt32* outDataSize, void* outData) {
    if (outData) {
        UInt32 fit = std::min<UInt32>(n, inDataSize / sizeof(AudioObjectID));
        std::memcpy(outData, ids, fit * sizeof(AudioObjectID));
        *outDataSize = fit * sizeof(AudioObjectID);
    } else {
        *outDataSize = n * sizeof(AudioObjectID);
    }
    return noErr;
}

// ── Properties ────────────────────────────────────────────────────────────────
// One function answers HasProperty (outDataSize only), GetPropertyDataSize
// and GetPropertyData (outData non-null).

OSStatus plugInProperty(const AudioObjectPropertyAddress* a, UInt32 qualSize, const void* qual,
                        UInt32 inSize, UInt32* outSize, void* out) {
    static const AudioObjectID devices[] = {kDevice};
    switch (a->mSelector) {
        case kAudioObjectPropertyBaseClass: return put<AudioClassID>(kAudioObjectClassID, inSize, outSize, out);
        case kAudioObjectPropertyClass: return put<AudioClassID>(kAudioPlugInClassID, inSize, outSize, out);
        case kAudioObjectPropertyOwner: return put<AudioObjectID>(kAudioObjectUnknown, inSize, outSize, out);
        case kAudioObjectPropertyManufacturer: return put<CFStringRef>(kManufacturer, inSize, outSize, out);
        case kAudioObjectPropertyOwnedObjects:
        case kAudioPlugInPropertyDeviceList: return putIDs(devices, 1, inSize, outSize, out);
        case kAudioPlugInPropertyTranslateUIDToDevice: {
            AudioObjectID id = kAudioObjectUnknown;
            if (out && qualSize == sizeof(CFStringRef) && qual &&
                CFStringCompare(*static_cast<const CFStringRef*>(qual), kDeviceUID, 0) == kCFCompareEqualTo)
                id = kDevice;
            return put(id, inSize, outSize, out);
        }
        case kAudioPlugInPropertyResourceBundle: return put<CFStringRef>(CFSTR(""), inSize, outSize, out);
        default: return kAudioHardwareUnknownPropertyError;
    }
}

OSStatus deviceProperty(const AudioObjectPropertyAddress* a, UInt32 inSize, UInt32* outSize, void* out) {
    const bool in = a->mScope == kAudioObjectPropertyScopeInput;
    const bool outScope = a->mScope == kAudioObjectPropertyScopeOutput;
    switch (a->mSelector) {
        case kAudioObjectPropertyBaseClass: return put<AudioClassID>(kAudioObjectClassID, inSize, outSize, out);
        case kAudioObjectPropertyClass: return put<AudioClassID>(kAudioDeviceClassID, inSize, outSize, out);
        case kAudioObjectPropertyOwner: return put<AudioObjectID>(kPlugIn, inSize, outSize, out);
        case kAudioObjectPropertyName: return put<CFStringRef>(kDeviceName, inSize, outSize, out);
        case kAudioObjectPropertyManufacturer: return put<CFStringRef>(kManufacturer, inSize, outSize, out);
        case kAudioDevicePropertyDeviceUID: return put<CFStringRef>(kDeviceUID, inSize, outSize, out);
        case kAudioDevicePropertyModelUID: return put<CFStringRef>(kModelUID, inSize, outSize, out);
        case kAudioDevicePropertyTransportType: return put<UInt32>(kAudioDeviceTransportTypeVirtual, inSize, outSize, out);
        case kAudioDevicePropertyRelatedDevices: { AudioObjectID d = kDevice; return putIDs(&d, 1, inSize, outSize, out); }
        case kAudioDevicePropertyClockDomain: return put<UInt32>(0, inSize, outSize, out);
        case kAudioDevicePropertyDeviceIsAlive: return put<UInt32>(1, inSize, outSize, out);
        case kAudioDevicePropertyDeviceIsRunning: {
            pthread_mutex_lock(&gStateMutex);
            UInt32 r = gIOCount > 0;
            pthread_mutex_unlock(&gStateMutex);
            return put(r, inSize, outSize, out);
        }
        // Usable as the default *input* (a microphone). Never as the default
        // output or system-sound device, so the Mac's own audio can't land here.
        case kAudioDevicePropertyDeviceCanBeDefaultDevice: return put<UInt32>(in ? 1 : 0, inSize, outSize, out);
        case kAudioDevicePropertyDeviceCanBeDefaultSystemDevice: return put<UInt32>(0, inSize, outSize, out);
        case kAudioDevicePropertyLatency: return put<UInt32>(0, inSize, outSize, out);
        case kAudioDevicePropertySafetyOffset: return put<UInt32>(0, inSize, outSize, out);
        case kAudioObjectPropertyOwnedObjects:
        case kAudioDevicePropertyStreams: {
            static const AudioObjectID both[] = {kInStream, kOutStream}, inOnly[] = {kInStream}, outOnly[] = {kOutStream};
            if (in) return putIDs(inOnly, 1, inSize, outSize, out);
            if (outScope) return putIDs(outOnly, 1, inSize, outSize, out);
            return putIDs(both, 2, inSize, outSize, out);
        }
        case kAudioObjectPropertyControlList: return putIDs(nullptr, 0, inSize, outSize, out);
        case kAudioDevicePropertyNominalSampleRate: return put<Float64>(kSampleRate, inSize, outSize, out);
        case kAudioDevicePropertyAvailableNominalSampleRates: {
            AudioValueRange r{kSampleRate, kSampleRate};
            return put(r, inSize, outSize, out);
        }
        case kAudioDevicePropertyIsHidden: return put<UInt32>(0, inSize, outSize, out);
        case kAudioDevicePropertyZeroTimeStampPeriod: return put<UInt32>(kZeroTimeStampPeriod, inSize, outSize, out);
        case kAudioDevicePropertyPreferredChannelsForStereo: {
            UInt32 ch[2] = {1, 2};
            if (out) {
                if (inSize < sizeof ch) return kAudioHardwareBadPropertySizeError;
                std::memcpy(out, ch, sizeof ch);
            }
            *outSize = sizeof ch;
            return noErr;
        }
        case kAudioDevicePropertyPreferredChannelLayout: {
            const UInt32 size = offsetof(AudioChannelLayout, mChannelDescriptions) + kChannels * sizeof(AudioChannelDescription);
            if (out) {
                if (inSize < size) return kAudioHardwareBadPropertySizeError;
                auto* l = static_cast<AudioChannelLayout*>(out);
                std::memset(l, 0, size);
                l->mChannelLayoutTag = kAudioChannelLayoutTag_UseChannelDescriptions;
                l->mNumberChannelDescriptions = kChannels;
                l->mChannelDescriptions[0].mChannelLabel = kAudioChannelLabel_Left;
                l->mChannelDescriptions[1].mChannelLabel = kAudioChannelLabel_Right;
            }
            *outSize = size;
            return noErr;
        }
        default: return kAudioHardwareUnknownPropertyError;
    }
}

OSStatus streamProperty(AudioObjectID id, const AudioObjectPropertyAddress* a, UInt32 inSize, UInt32* outSize, void* out) {
    const bool input = id == kInStream;
    switch (a->mSelector) {
        case kAudioObjectPropertyBaseClass: return put<AudioClassID>(kAudioObjectClassID, inSize, outSize, out);
        case kAudioObjectPropertyClass: return put<AudioClassID>(kAudioStreamClassID, inSize, outSize, out);
        case kAudioObjectPropertyOwner: return put<AudioObjectID>(kDevice, inSize, outSize, out);
        case kAudioObjectPropertyOwnedObjects: return putIDs(nullptr, 0, inSize, outSize, out);
        case kAudioObjectPropertyName:
            return put<CFStringRef>(input ? CFSTR("Aurora Microphone In") : CFSTR("Aurora Microphone Out"), inSize, outSize, out);
        case kAudioStreamPropertyIsActive: {
            pthread_mutex_lock(&gStateMutex);
            UInt32 v = input ? gInStreamActive : gOutStreamActive;
            pthread_mutex_unlock(&gStateMutex);
            return put(v, inSize, outSize, out);
        }
        case kAudioStreamPropertyDirection: return put<UInt32>(input ? 1 : 0, inSize, outSize, out);
        case kAudioStreamPropertyTerminalType:
            return put<UInt32>(input ? kAudioStreamTerminalTypeMicrophone : kAudioStreamTerminalTypeLine, inSize, outSize, out);
        case kAudioStreamPropertyStartingChannel: return put<UInt32>(1, inSize, outSize, out);
        case kAudioStreamPropertyLatency: return put<UInt32>(0, inSize, outSize, out);
        case kAudioStreamPropertyVirtualFormat:
        case kAudioStreamPropertyPhysicalFormat: return put(streamFormat(), inSize, outSize, out);
        case kAudioStreamPropertyAvailableVirtualFormats:
        case kAudioStreamPropertyAvailablePhysicalFormats: {
            AudioStreamRangedDescription d{};
            d.mFormat = streamFormat();
            d.mSampleRateRange = {kSampleRate, kSampleRate};
            return put(d, inSize, outSize, out);
        }
        default: return kAudioHardwareUnknownPropertyError;
    }
}

OSStatus property(AudioObjectID id, const AudioObjectPropertyAddress* a, UInt32 qualSize, const void* qual,
                  UInt32 inSize, UInt32* outSize, void* out) {
    if (!a || !outSize) return kAudioHardwareIllegalOperationError;
    if (id == kPlugIn) return plugInProperty(a, qualSize, qual, inSize, outSize, out);
    if (id == kDevice) return deviceProperty(a, inSize, outSize, out);
    if (isStream(id)) return streamProperty(id, a, inSize, outSize, out);
    return kAudioHardwareBadObjectError;
}

// ── Driver interface ──────────────────────────────────────────────────────────

HRESULT QueryInterface(void* driver, REFIID iid, LPVOID* out);
ULONG AddRef(void*) { return ++gRefCount; }
ULONG Release(void*) {
    UInt32 c = gRefCount.load();
    if (c > 0) c = --gRefCount;
    return c;
}

OSStatus Initialize(AudioServerPlugInDriverRef, AudioServerPlugInHostRef host) {
    gHost = host;
    mach_timebase_info_data_t tb;
    mach_timebase_info(&tb);
    Float64 hostClockFrequency = (Float64)tb.denom / (Float64)tb.numer * 1e9;
    gHostTicksPerFrame = hostClockFrequency / kSampleRate;
    return noErr;
}

OSStatus CreateDevice(AudioServerPlugInDriverRef, CFDictionaryRef, const AudioServerPlugInClientInfo*, AudioObjectID*) {
    return kAudioHardwareUnsupportedOperationError;
}
OSStatus DestroyDevice(AudioServerPlugInDriverRef, AudioObjectID) { return kAudioHardwareUnsupportedOperationError; }
OSStatus AddDeviceClient(AudioServerPlugInDriverRef, AudioObjectID id, const AudioServerPlugInClientInfo*) {
    return id == kDevice ? noErr : kAudioHardwareBadObjectError;
}
OSStatus RemoveDeviceClient(AudioServerPlugInDriverRef, AudioObjectID id, const AudioServerPlugInClientInfo*) {
    return id == kDevice ? noErr : kAudioHardwareBadObjectError;
}
OSStatus PerformDeviceConfigurationChange(AudioServerPlugInDriverRef, AudioObjectID, UInt64, void*) { return noErr; }
OSStatus AbortDeviceConfigurationChange(AudioServerPlugInDriverRef, AudioObjectID, UInt64, void*) { return noErr; }

Boolean HasProperty(AudioServerPlugInDriverRef, AudioObjectID id, pid_t, const AudioObjectPropertyAddress* a) {
    UInt32 size = 0;
    return property(id, a, 0, nullptr, 0, &size, nullptr) == noErr;
}

OSStatus IsPropertySettable(AudioServerPlugInDriverRef, AudioObjectID id, pid_t, const AudioObjectPropertyAddress* a,
                            Boolean* settable) {
    UInt32 size = 0;
    OSStatus err = property(id, a, 0, nullptr, 0, &size, nullptr);
    if (err != noErr) return err;
    // Stream activity and format can be "set" (format only to the one we have).
    *settable = isStream(id) && (a->mSelector == kAudioStreamPropertyIsActive ||
                                 a->mSelector == kAudioStreamPropertyVirtualFormat ||
                                 a->mSelector == kAudioStreamPropertyPhysicalFormat);
    return noErr;
}

OSStatus GetPropertyDataSize(AudioServerPlugInDriverRef, AudioObjectID id, pid_t, const AudioObjectPropertyAddress* a,
                             UInt32 qualSize, const void* qual, UInt32* outSize) {
    return property(id, a, qualSize, qual, 0, outSize, nullptr);
}

OSStatus GetPropertyData(AudioServerPlugInDriverRef, AudioObjectID id, pid_t, const AudioObjectPropertyAddress* a,
                         UInt32 qualSize, const void* qual, UInt32 inSize, UInt32* outSize, void* out) {
    if (!out) return kAudioHardwareIllegalOperationError;
    return property(id, a, qualSize, qual, inSize, outSize, out);
}

OSStatus SetPropertyData(AudioServerPlugInDriverRef, AudioObjectID id, pid_t, const AudioObjectPropertyAddress* a,
                         UInt32, const void*, UInt32 inSize, const void* data) {
    if (!isStream(id)) return kAudioHardwareUnknownPropertyError;
    if (a->mSelector == kAudioStreamPropertyIsActive) {
        if (inSize < sizeof(UInt32)) return kAudioHardwareBadPropertySizeError;
        bool v = *static_cast<const UInt32*>(data) != 0;
        pthread_mutex_lock(&gStateMutex);
        bool& slot = id == kInStream ? gInStreamActive : gOutStreamActive;
        bool changed = slot != v;
        slot = v;
        pthread_mutex_unlock(&gStateMutex);
        if (changed && gHost) {
            AudioObjectPropertyAddress addr{kAudioStreamPropertyIsActive, kAudioObjectPropertyScopeGlobal,
                                            kAudioObjectPropertyElementMain};
            gHost->PropertiesChanged(gHost, id, 1, &addr);
        }
        return noErr;
    }
    if (a->mSelector == kAudioStreamPropertyVirtualFormat || a->mSelector == kAudioStreamPropertyPhysicalFormat) {
        if (inSize < sizeof(AudioStreamBasicDescription)) return kAudioHardwareBadPropertySizeError;
        auto* f = static_cast<const AudioStreamBasicDescription*>(data);
        AudioStreamBasicDescription ours = streamFormat();
        bool same = f->mFormatID == ours.mFormatID && f->mChannelsPerFrame == ours.mChannelsPerFrame &&
                    std::fabs(f->mSampleRate - ours.mSampleRate) < 0.5 && f->mBitsPerChannel == ours.mBitsPerChannel;
        return same ? (OSStatus)noErr : (OSStatus)kAudioDeviceUnsupportedFormatError;
    }
    return kAudioHardwareUnknownPropertyError;
}

OSStatus StartIO(AudioServerPlugInDriverRef, AudioObjectID id, UInt32) {
    if (id != kDevice) return kAudioHardwareBadObjectError;
    pthread_mutex_lock(&gStateMutex);
    if (gIOCount++ == 0) {
        gNumberTimeStamps = 0;
        gAnchorHostTime = mach_absolute_time();
        gWriteEnd = -1;
        gRunStart = 0;
        std::memset(gRing, 0, sizeof gRing);
    }
    pthread_mutex_unlock(&gStateMutex);
    return noErr;
}

OSStatus StopIO(AudioServerPlugInDriverRef, AudioObjectID id, UInt32) {
    if (id != kDevice) return kAudioHardwareBadObjectError;
    pthread_mutex_lock(&gStateMutex);
    if (gIOCount > 0) --gIOCount;
    pthread_mutex_unlock(&gStateMutex);
    return noErr;
}

// Clock: a perfect host-time clock anchored at StartIO, one anchor per
// zero-timestamp period.
OSStatus GetZeroTimeStamp(AudioServerPlugInDriverRef, AudioObjectID, UInt32, Float64* sampleTime, UInt64* hostTime,
                          UInt64* seed) {
    pthread_mutex_lock(&gStateMutex);
    UInt64 now = mach_absolute_time();
    Float64 ticksPerPeriod = gHostTicksPerFrame * kZeroTimeStampPeriod;
    Float64 elapsed = (Float64)(now - gAnchorHostTime);
    Float64 next = (Float64)(gNumberTimeStamps + 1) * ticksPerPeriod;
    if (next <= elapsed) ++gNumberTimeStamps;
    *sampleTime = (Float64)(gNumberTimeStamps * kZeroTimeStampPeriod);
    *hostTime = gAnchorHostTime + (UInt64)((Float64)gNumberTimeStamps * ticksPerPeriod);
    *seed = 1;
    pthread_mutex_unlock(&gStateMutex);
    return noErr;
}

OSStatus WillDoIOOperation(AudioServerPlugInDriverRef, AudioObjectID, UInt32, UInt32 op, Boolean* willDo,
                           Boolean* inPlace) {
    *willDo = op == kAudioServerPlugInIOOperationReadInput || op == kAudioServerPlugInIOOperationWriteMix;
    *inPlace = true;
    return noErr;
}

OSStatus BeginIOOperation(AudioServerPlugInDriverRef, AudioObjectID, UInt32, UInt32, UInt32,
                          const AudioServerPlugInIOCycleInfo*) {
    return noErr;
}

void writeRing(const Float32* src, UInt32 frames, Float64 t0) {
    if (gWriteEnd < 0 || std::fabs(t0 - gWriteEnd) > 0.5) gRunStart = t0;  // new contiguous run
    UInt32 i = ringIndex(t0);
    UInt32 first = std::min(frames, kRingFrames - i);
    std::memcpy(&gRing[i * kChannels], src, first * kBytesPerFrame);
    std::memcpy(&gRing[0], src + first * kChannels, (frames - first) * kBytesPerFrame);
    gWriteEnd = t0 + frames;
}

void readRing(Float32* dst, UInt32 frames, Float64 t0) {
    // Valid window: the current run, no older than the ring holds.
    const Float64 lo = std::max(gRunStart, gWriteEnd - kRingFrames), hi = gWriteEnd;
    if (gWriteEnd < 0 || t0 + frames <= lo || t0 >= hi) {
        std::memset(dst, 0, frames * kBytesPerFrame);
        return;
    }
    for (UInt32 f = 0; f < frames; ++f) {
        Float64 t = t0 + f;
        Float32* d = dst + f * kChannels;
        if (t < lo || t >= hi) {
            for (UInt32 c = 0; c < kChannels; ++c) d[c] = 0.f;
        } else {
            const Float32* s = &gRing[ringIndex(t) * kChannels];
            for (UInt32 c = 0; c < kChannels; ++c) d[c] = s[c];
        }
    }
}

OSStatus DoIOOperation(AudioServerPlugInDriverRef, AudioObjectID, AudioObjectID stream, UInt32, UInt32 op,
                       UInt32 frames, const AudioServerPlugInIOCycleInfo* cycle, void* mainBuf, void*) {
    if (!mainBuf || !cycle) return noErr;
    if (op == kAudioServerPlugInIOOperationWriteMix && stream == kOutStream)
        writeRing(static_cast<const Float32*>(mainBuf), frames, cycle->mOutputTime.mSampleTime);
    else if (op == kAudioServerPlugInIOOperationReadInput && stream == kInStream)
        readRing(static_cast<Float32*>(mainBuf), frames, cycle->mInputTime.mSampleTime);
    return noErr;
}

OSStatus EndIOOperation(AudioServerPlugInDriverRef, AudioObjectID, UInt32, UInt32, UInt32,
                        const AudioServerPlugInIOCycleInfo*) {
    return noErr;
}

AudioServerPlugInDriverInterface gInterface = {
    nullptr,
    QueryInterface,
    AddRef,
    Release,
    Initialize,
    CreateDevice,
    DestroyDevice,
    AddDeviceClient,
    RemoveDeviceClient,
    PerformDeviceConfigurationChange,
    AbortDeviceConfigurationChange,
    HasProperty,
    IsPropertySettable,
    GetPropertyDataSize,
    GetPropertyData,
    SetPropertyData,
    StartIO,
    StopIO,
    GetZeroTimeStamp,
    WillDoIOOperation,
    BeginIOOperation,
    DoIOOperation,
    EndIOOperation,
};
AudioServerPlugInDriverInterface* gInterfacePtr = &gInterface;
AudioServerPlugInDriverRef gDriverRef = &gInterfacePtr;

HRESULT QueryInterface(void* driver, REFIID iid, LPVOID* out) {
    if (driver != gDriverRef || !out) return kAudioHardwareIllegalOperationError;
    CFUUIDRef req = CFUUIDCreateFromUUIDBytes(nullptr, iid);
    HRESULT r = E_NOINTERFACE;
    if (CFEqual(req, IUnknownUUID) || CFEqual(req, kAudioServerPlugInDriverInterfaceUUID)) {
        ++gRefCount;
        *out = gDriverRef;
        r = S_OK;
    }
    CFRelease(req);
    return r;
}

}  // namespace

// Factory named in Info.plist (CFPlugInFactories).
extern "C" __attribute__((visibility("default"))) void* AuroraHAL_Create(CFAllocatorRef, CFUUIDRef type) {
    if (!CFEqual(type, kAudioServerPlugInTypeUUID)) return nullptr;
    return gDriverRef;
}
