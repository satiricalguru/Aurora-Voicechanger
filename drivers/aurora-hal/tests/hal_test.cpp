// Loads build/AuroraHAL.driver in-process the way coreaudiod does (CFPlugIn
// factory -> driver interface), then checks properties and simulated IO.
#include <CoreAudio/AudioServerPlugIn.h>
#include <CoreFoundation/CoreFoundation.h>
#include <mach/mach_time.h>
#include <unistd.h>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <cstdio>
#include <string>
#include <vector>

static int failures = 0;
#define CHECK(c, ...) do { bool ok_ = (c); std::printf(ok_ ? "  ok    " : "  FAIL  "); if (!ok_) ++failures; std::printf(__VA_ARGS__); std::printf("\n"); } while (0)

static int changes = 0;
static OSStatus PropertiesChanged(AudioServerPlugInHostRef, AudioObjectID, UInt32 n, const AudioObjectPropertyAddress*) { changes += n; return noErr; }
static OSStatus CopyFromStorage(AudioServerPlugInHostRef, CFStringRef, CFPropertyListRef* out) { *out = nullptr; return noErr; }
static OSStatus WriteToStorage(AudioServerPlugInHostRef, CFStringRef, CFPropertyListRef) { return noErr; }
static OSStatus DeleteFromStorage(AudioServerPlugInHostRef, CFStringRef) { return noErr; }
static OSStatus RequestConfigChange(AudioServerPlugInHostRef, AudioObjectID, UInt64, void*) { return noErr; }
static AudioServerPlugInHostInterface host = {PropertiesChanged, CopyFromStorage, WriteToStorage, DeleteFromStorage, RequestConfigChange};

static AudioServerPlugInDriverRef drv;

static AudioObjectPropertyAddress A(AudioObjectPropertySelector s, AudioObjectPropertyScope sc = kAudioObjectPropertyScopeGlobal) {
    return {s, sc, kAudioObjectPropertyElementMain};
}
template <typename T>
static T get(AudioObjectID o, AudioObjectPropertySelector s, AudioObjectPropertyScope sc = kAudioObjectPropertyScopeGlobal) {
    T v{};
    UInt32 size = sizeof v;
    auto a = A(s, sc);
    OSStatus e = (*drv)->GetPropertyData(drv, o, 0, &a, 0, nullptr, sizeof v, &size, &v);
    if (e) std::printf("  (get %.4s on %u -> %d)\n", (char*)&s, o, (int)e);
    return v;
}
static std::string str(CFStringRef s) {
    char b[256] = {};
    if (s) CFStringGetCString(s, b, sizeof b, kCFStringEncodingUTF8);
    return b;
}
static std::vector<AudioObjectID> ids(AudioObjectID o, AudioObjectPropertySelector s, AudioObjectPropertyScope sc = kAudioObjectPropertyScopeGlobal) {
    auto a = A(s, sc);
    UInt32 size = 0;
    (*drv)->GetPropertyDataSize(drv, o, 0, &a, 0, nullptr, &size);
    std::vector<AudioObjectID> v(size / sizeof(AudioObjectID));
    if (size) (*drv)->GetPropertyData(drv, o, 0, &a, 0, nullptr, size, &size, v.data());
    return v;
}

int main(int argc, char** argv) {
    const char* path = argc > 1 ? argv[1] : "build/AuroraHAL.driver";
    CFURLRef url = CFURLCreateFromFileSystemRepresentation(nullptr, (const UInt8*)path, strlen(path), true);
    CFPlugInRef plug = CFPlugInCreate(nullptr, url);
    if (!plug) { std::printf("cannot load %s\n", path); return 1; }
    CFArrayRef factories = CFPlugInFindFactoriesForPlugInType(kAudioServerPlugInTypeUUID);
    CHECK(factories && CFArrayGetCount(factories) == 1, "one AudioServerPlugIn factory registered");
    void* iunk = CFPlugInInstanceCreate(nullptr, (CFUUIDRef)CFArrayGetValueAtIndex(factories, 0), kAudioServerPlugInTypeUUID);
    CHECK(iunk != nullptr, "factory returns an instance");
    auto unk = (IUnknownVTbl**)iunk;
    void* ifc = nullptr;
    (*unk)->QueryInterface(iunk, CFUUIDGetUUIDBytes(kAudioServerPlugInDriverInterfaceUUID), &ifc);
    drv = (AudioServerPlugInDriverRef)ifc;
    CHECK(drv != nullptr, "QueryInterface(driver interface)");
    CHECK((*drv)->Initialize(drv, &host) == noErr, "Initialize");

    std::printf("Properties\n");
    auto devs = ids(kAudioObjectPlugInObject, kAudioPlugInPropertyDeviceList);
    CHECK(devs.size() == 1, "device list has %zu device", devs.size());
    AudioObjectID dev = devs.empty() ? 0 : devs[0];
    CHECK(str(get<CFStringRef>(dev, kAudioObjectPropertyName)) == "Aurora Microphone", "name '%s'", str(get<CFStringRef>(dev, kAudioObjectPropertyName)).c_str());
    CHECK(str(get<CFStringRef>(dev, kAudioDevicePropertyDeviceUID)) == "AuroraMicrophone_UID", "UID");
    CHECK(get<Float64>(dev, kAudioDevicePropertyNominalSampleRate) == 48000.0, "48 kHz");
    CHECK(get<UInt32>(dev, kAudioDevicePropertyLatency) == 0 && get<UInt32>(dev, kAudioDevicePropertySafetyOffset) == 0, "zero latency + safety offset");
    CHECK(get<UInt32>(dev, kAudioDevicePropertyDeviceCanBeDefaultDevice, kAudioObjectPropertyScopeInput) == 1, "can be default input");
    CHECK(get<UInt32>(dev, kAudioDevicePropertyDeviceCanBeDefaultDevice, kAudioObjectPropertyScopeOutput) == 0, "never default output");
    CHECK(get<UInt32>(dev, kAudioDevicePropertyDeviceCanBeDefaultSystemDevice) == 0, "never system-sound device");
    auto ins = ids(dev, kAudioDevicePropertyStreams, kAudioObjectPropertyScopeInput), outs = ids(dev, kAudioDevicePropertyStreams, kAudioObjectPropertyScopeOutput);
    CHECK(ins.size() == 1 && outs.size() == 1, "one input + one output stream");
    AudioObjectID inS = ins.empty() ? 0 : ins[0], outS = outs.empty() ? 0 : outs[0];
    auto fmt = get<AudioStreamBasicDescription>(inS, kAudioStreamPropertyVirtualFormat);
    CHECK(fmt.mChannelsPerFrame == 2 && fmt.mBitsPerChannel == 32 && (fmt.mFormatFlags & kAudioFormatFlagIsFloat), "stereo float32 format");
    CHECK(get<UInt32>(inS, kAudioStreamPropertyDirection) == 1 && get<UInt32>(outS, kAudioStreamPropertyDirection) == 0, "stream directions");
    {
        CFStringRef uid = CFSTR("AuroraMicrophone_UID");
        AudioObjectID found = 0;
        UInt32 size = sizeof found;
        auto a = A(kAudioPlugInPropertyTranslateUIDToDevice);
        (*drv)->GetPropertyData(drv, kAudioObjectPlugInObject, 0, &a, sizeof uid, &uid, sizeof found, &size, &found);
        CHECK(found == dev, "TranslateUIDToDevice");
    }
    {
        auto a = A(kAudioDevicePropertyIcon);
        CHECK(!(*drv)->HasProperty(drv, dev, 0, &a), "unknown property reported as absent");
    }

    std::printf("IO\n");
    CHECK((*drv)->StartIO(drv, dev, 1) == noErr, "StartIO");
    CHECK(get<UInt32>(dev, kAudioDevicePropertyDeviceIsRunning) == 1, "running");
    Boolean willDo = false, inPlace = false;
    (*drv)->WillDoIOOperation(drv, dev, 1, kAudioServerPlugInIOOperationWriteMix, &willDo, &inPlace);
    CHECK(willDo && inPlace, "does WriteMix in place");

    const UInt32 B = 128;
    std::vector<float> w(B * 2), r(B * 2);
    AudioServerPlugInIOCycleInfo cyc{};
    auto write = [&](double t, float base) {
        for (UInt32 i = 0; i < B; ++i) { w[2 * i] = base + i; w[2 * i + 1] = -(base + i); }
        cyc.mOutputTime.mSampleTime = t;
        (*drv)->DoIOOperation(drv, dev, outS, 1, kAudioServerPlugInIOOperationWriteMix, B, &cyc, w.data(), nullptr);
    };
    auto read = [&](double t) {
        cyc.mInputTime.mSampleTime = t;
        (*drv)->DoIOOperation(drv, dev, inS, 2, kAudioServerPlugInIOOperationReadInput, B, &cyc, r.data(), nullptr);
    };
    auto allZero = [&] { for (float v : r) if (v != 0.f) return false; return true; };

    read(0);
    CHECK(allZero(), "silence before anything is written");
    // Writer runs one buffer ahead of the reader, across the ring wrap point.
    bool exact = true;
    for (int k = 0; k < 200; ++k) {
        double t = 16000.0 + k * B;
        write(t + B, (float)(t + B));
        read(t);
        if (k == 0) continue;  // first read precedes the run
        for (UInt32 i = 0; i < B; ++i) exact &= r[2 * i] == (float)(t + i) && r[2 * i + 1] == -(float)(t + i);
    }
    CHECK(exact, "loopback is sample-exact across the ring wrap (200 cycles)");
    double end = 16000.0 + 200 * B + B;
    read(end);
    CHECK(allZero(), "reader ahead of writer gets silence, not stale audio");
    read(end - 20000);
    CHECK(allZero(), "reads older than the ring get silence");
    write(end + 10 * B, 5.f);  // gap: the app stalled for 10 buffers
    read(end + 9 * B);
    CHECK(allZero(), "frames before a write gap are silent, not old ring contents");
    read(end + 10 * B);
    CHECK(r[0] == 5.f, "new run readable after the gap");

    std::printf("Clock\n");
    Float64 st0, st1; UInt64 ht0, ht1, seed;
    (*drv)->GetZeroTimeStamp(drv, dev, 1, &st0, &ht0, &seed);
    usleep(400000);
    (*drv)->GetZeroTimeStamp(drv, dev, 1, &st1, &ht1, &seed);
    mach_timebase_info_data_t tb; mach_timebase_info(&tb);
    double sec = (double)(ht1 - ht0) * tb.numer / tb.denom * 1e-9;
    CHECK(st1 - st0 == 16384 && std::fabs((st1 - st0) / sec - 48000) < 1, "zero timestamps advance at 48 kHz (%.0f frames in %.4f s)", st1 - st0, sec);
    CHECK((*drv)->StopIO(drv, dev, 1) == noErr && get<UInt32>(dev, kAudioDevicePropertyDeviceIsRunning) == 0, "StopIO");

    std::printf(failures ? "\n%d FAILED\n" : "\nall passed\n", failures);
    return failures ? 1 : 0;
}
