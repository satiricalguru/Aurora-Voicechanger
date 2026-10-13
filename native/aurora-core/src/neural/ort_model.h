// Streaming ONNX model runner on ONNX Runtime's C API, loaded with dlopen so
// the engine runs (without neural voices) when ONNX Runtime is absent.
//
// Model convention (see tools/llvc/export_llvc.py):
//   input 0  "audio"  [1, 1, context + chunk]   output 0 [1, 1, chunk]
//   inputs 1..k: recurrent state                outputs 1..k: next state, same shapes
//   metadata: aurora.sample_rate, aurora.lookahead (samples)
// State lives in two preallocated tensor sets that swap roles each step, so
// run() never allocates.
#pragma once

#include <string>
#include <vector>

struct OrtApi;
struct OrtEnv;
struct OrtSession;
struct OrtSessionOptions;
struct OrtValue;
struct OrtMemoryInfo;
struct OrtRunOptions;

namespace aurora::neural {

class StreamingModel {
public:
    StreamingModel() = default;
    StreamingModel(const StreamingModel&) = delete;
    StreamingModel& operator=(const StreamingModel&) = delete;
    ~StreamingModel();

    bool load(const std::string& path, std::string& err);

    int sampleRate() const { return sampleRate_; }
    int chunk() const { return chunk_; }       // output samples per step
    int context() const { return context_; }   // extra past samples in each input
    int lookahead() const { return lookahead_; }

    // Input audio for the next step (context + chunk samples).
    float* audioIn() { return audioIn_.data(); }
    // Output audio of the last step (chunk samples).
    const float* audioOut() const { return audioOut_.data(); }

    // One step. Real-time safe after load(): no allocation.
    bool run();
    void resetState();

private:
    const OrtApi* api_ = nullptr;
    OrtSession* session_ = nullptr;
    OrtMemoryInfo* mem_ = nullptr;
    OrtRunOptions* runOpts_ = nullptr;
    int sampleRate_ = 16000, chunk_ = 0, context_ = 0, lookahead_ = 0;
    std::vector<std::string> inNames_, outNames_;
    std::vector<const char*> inNamePtrs_, outNamePtrs_;
    std::vector<float> audioIn_, audioOut_;
    std::vector<std::vector<float>> stateA_, stateB_;
    std::vector<std::vector<int64_t>> stateShapes_;
    // [0] = A as input / B as output; [1] = the reverse.
    std::vector<OrtValue*> inVals_[2], outVals_[2];
    int phase_ = 0;
    void release();
};

// Path of the ONNX Runtime library that was loaded ("" if none).
std::string onnxRuntimePath();

}  // namespace aurora::neural
