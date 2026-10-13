#include "ort_model.h"

#include <dlfcn.h>

#include <cstdlib>
#include <cstring>
#include <mutex>

#include <onnxruntime_c_api.h>

namespace aurora::neural {

namespace {

// Ask for an older API revision so any ONNX Runtime >= 1.17 works.
constexpr uint32_t kApiVersion = 17;

std::mutex gLoadMutex;
const OrtApi* gApi = nullptr;
OrtEnv* gEnv = nullptr;
std::string gLibPath;

const OrtApi* api(std::string& err) {
    std::lock_guard<std::mutex> g(gLoadMutex);
    if (gApi) return gApi;
    std::vector<std::string> candidates;
    if (const char* p = std::getenv("AURORA_ORT_LIB")) candidates.push_back(p);
    Dl_info info{};
    if (dladdr((void*)&api, &info) && info.dli_fname) {
        std::string dir = info.dli_fname;
        dir = dir.substr(0, dir.find_last_of('/') + 1);
        candidates.push_back(dir + "libonnxruntime.dylib");
    }
    candidates.push_back("/opt/homebrew/opt/onnxruntime/lib/libonnxruntime.dylib");
    candidates.push_back("/usr/local/opt/onnxruntime/lib/libonnxruntime.dylib");
    candidates.push_back("libonnxruntime.dylib");
    for (auto& c : candidates) {
        void* h = dlopen(c.c_str(), RTLD_NOW | RTLD_LOCAL);
        if (!h) continue;
        auto getBase = reinterpret_cast<const OrtApiBase* (*)()>(dlsym(h, "OrtGetApiBase"));
        const OrtApi* a = getBase ? getBase()->GetApi(kApiVersion) : nullptr;
        if (!a) { dlclose(h); continue; }
        OrtEnv* env = nullptr;
        if (OrtStatus* st = a->CreateEnv(ORT_LOGGING_LEVEL_ERROR, "aurora", &env)) {
            err = a->GetErrorMessage(st);
            a->ReleaseStatus(st);
            return nullptr;
        }
        gApi = a;
        gEnv = env;
        gLibPath = c;
        return gApi;
    }
    err = "ONNX Runtime not found (brew install onnxruntime, or set AURORA_ORT_LIB)";
    return nullptr;
}

}  // namespace

std::string onnxRuntimePath() {
    std::lock_guard<std::mutex> g(gLoadMutex);
    return gLibPath;
}

#define ORT_TRY(expr)                                     \
    do {                                                  \
        if (OrtStatus* st_ = (expr)) {                    \
            err = api_->GetErrorMessage(st_);             \
            api_->ReleaseStatus(st_);                     \
            release();                                    \
            return false;                                 \
        }                                                 \
    } while (0)

StreamingModel::~StreamingModel() { release(); }

void StreamingModel::release() {
    if (!api_) return;
    for (int p = 0; p < 2; ++p) {
        for (auto* v : inVals_[p]) if (v) api_->ReleaseValue(v);
        for (auto* v : outVals_[p]) if (v) api_->ReleaseValue(v);
        inVals_[p].clear();
        outVals_[p].clear();
    }
    if (runOpts_) api_->ReleaseRunOptions(runOpts_);
    if (mem_) api_->ReleaseMemoryInfo(mem_);
    if (session_) api_->ReleaseSession(session_);
    runOpts_ = nullptr;
    mem_ = nullptr;
    session_ = nullptr;
}

bool StreamingModel::load(const std::string& path, std::string& err) {
    release();
    api_ = api(err);
    if (!api_) return false;

    OrtSessionOptions* so = nullptr;
    ORT_TRY(api_->CreateSessionOptions(&so));
    // One thread, no spinning: the worker thread is the parallelism, and a
    // spinning pool would steal cores from the audio threads.
    // Option failures are not fatal: the defaults still work.
    for (OrtStatus* opt : {api_->SetIntraOpNumThreads(so, 1), api_->SetInterOpNumThreads(so, 1),
                           api_->SetSessionGraphOptimizationLevel(so, ORT_ENABLE_ALL),
                           api_->AddSessionConfigEntry(so, "session.intra_op.allow_spinning", "0"),
                           api_->AddSessionConfigEntry(so, "session.inter_op.allow_spinning", "0")})
        if (opt) api_->ReleaseStatus(opt);
    OrtStatus* st = api_->CreateSession(gEnv, path.c_str(), so, &session_);
    api_->ReleaseSessionOptions(so);
    if (st) {
        err = api_->GetErrorMessage(st);
        api_->ReleaseStatus(st);
        release();
        return false;
    }

    OrtAllocator* alloc = nullptr;
    ORT_TRY(api_->GetAllocatorWithDefaultOptions(&alloc));

    // Metadata.
    OrtModelMetadata* md = nullptr;
    ORT_TRY(api_->SessionGetModelMetadata(session_, &md));
    auto meta = [&](const char* key, int def) {
        char* v = nullptr;
        int r = def;
        if (OrtStatus* s = api_->ModelMetadataLookupCustomMetadataMap(md, alloc, key, &v)) {
            api_->ReleaseStatus(s);
        } else if (v) {
            r = std::atoi(v);
            if (OrtStatus* f = api_->AllocatorFree(alloc, v)) api_->ReleaseStatus(f);
        }
        return r;
    };
    sampleRate_ = meta("aurora.sample_rate", 16000);
    lookahead_ = meta("aurora.lookahead", 0);
    api_->ReleaseModelMetadata(md);

    size_t nIn = 0, nOut = 0;
    ORT_TRY(api_->SessionGetInputCount(session_, &nIn));
    ORT_TRY(api_->SessionGetOutputCount(session_, &nOut));
    if (nIn < 1 || nIn != nOut) {
        err = "model must map audio+state inputs to audio+state outputs";
        release();
        return false;
    }

    auto shapeOf = [&](bool input, size_t i, std::vector<int64_t>& shape) -> bool {
        OrtTypeInfo* ti = nullptr;
        OrtStatus* s = input ? api_->SessionGetInputTypeInfo(session_, i, &ti)
                             : api_->SessionGetOutputTypeInfo(session_, i, &ti);
        if (s) { api_->ReleaseStatus(s); return false; }
        const OrtTensorTypeAndShapeInfo* tsi = nullptr;
        size_t dims = 0;
        bool ok = true;
        for (int stepNo = 0; ok && stepNo < 3; ++stepNo) {
            OrtStatus* e = stepNo == 0 ? api_->CastTypeInfoToTensorInfo(ti, &tsi)
                         : stepNo == 1 ? api_->GetDimensionsCount(tsi, &dims)
                                       : (shape.assign(dims, 0), api_->GetDimensions(tsi, shape.data(), dims));
            if (e) { api_->ReleaseStatus(e); ok = false; }
        }
        api_->ReleaseTypeInfo(ti);
        if (!ok || !tsi) return false;
        for (auto d : shape) if (d <= 0) return false;  // need static shapes
        return true;
    };

    inNames_.clear();
    outNames_.clear();
    for (size_t i = 0; i < nIn; ++i) {
        char* n = nullptr;
        ORT_TRY(api_->SessionGetInputName(session_, i, alloc, &n));
        inNames_.push_back(n);
        ORT_TRY(api_->AllocatorFree(alloc, n));
        ORT_TRY(api_->SessionGetOutputName(session_, i, alloc, &n));
        outNames_.push_back(n);
        ORT_TRY(api_->AllocatorFree(alloc, n));
    }
    inNamePtrs_.clear();
    outNamePtrs_.clear();
    for (auto& s : inNames_) inNamePtrs_.push_back(s.c_str());
    for (auto& s : outNames_) outNamePtrs_.push_back(s.c_str());

    std::vector<int64_t> aIn, aOut;
    if (!shapeOf(true, 0, aIn) || !shapeOf(false, 0, aOut)) {
        err = "audio tensors need static shapes";
        release();
        return false;
    }
    int64_t inLen = 1, outLen = 1;
    for (auto d : aIn) inLen *= d;
    for (auto d : aOut) outLen *= d;
    chunk_ = (int)outLen;
    context_ = (int)(inLen - outLen);
    if (chunk_ <= 0 || context_ < 0) {
        err = "unexpected audio tensor sizes";
        release();
        return false;
    }
    audioIn_.assign(inLen, 0.f);
    audioOut_.assign(outLen, 0.f);

    ORT_TRY(api_->CreateCpuMemoryInfo(OrtArenaAllocator, OrtMemTypeDefault, &mem_));
    ORT_TRY(api_->CreateRunOptions(&runOpts_));

    stateShapes_.clear();
    stateA_.clear();
    stateB_.clear();
    for (size_t i = 1; i < nIn; ++i) {
        std::vector<int64_t> s, so2;
        if (!shapeOf(true, i, s) || !shapeOf(false, i, so2) || s != so2) {
            err = "state input/output shapes differ for " + inNames_[i];
            release();
            return false;
        }
        int64_t n = 1;
        for (auto d : s) n *= d;
        stateShapes_.push_back(s);
        stateA_.emplace_back(n, 0.f);
        stateB_.emplace_back(n, 0.f);
    }

    auto tensor = [&](float* data, size_t count, const std::vector<int64_t>& shape, OrtValue** out) {
        return api_->CreateTensorWithDataAsOrtValue(mem_, data, count * sizeof(float), shape.data(), shape.size(),
                                                    ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT, out);
    };
    for (int p = 0; p < 2; ++p) {
        inVals_[p].assign(nIn, nullptr);
        outVals_[p].assign(nOut, nullptr);
        ORT_TRY(tensor(audioIn_.data(), audioIn_.size(), aIn, &inVals_[p][0]));
        ORT_TRY(tensor(audioOut_.data(), audioOut_.size(), aOut, &outVals_[p][0]));
        for (size_t i = 1; i < nIn; ++i) {
            auto& src = p == 0 ? stateA_[i - 1] : stateB_[i - 1];
            auto& dst = p == 0 ? stateB_[i - 1] : stateA_[i - 1];
            ORT_TRY(tensor(src.data(), src.size(), stateShapes_[i - 1], &inVals_[p][i]));
            ORT_TRY(tensor(dst.data(), dst.size(), stateShapes_[i - 1], &outVals_[p][i]));
        }
    }
    phase_ = 0;
    return true;
}

void StreamingModel::resetState() {
    for (auto& v : stateA_) std::fill(v.begin(), v.end(), 0.f);
    for (auto& v : stateB_) std::fill(v.begin(), v.end(), 0.f);
    phase_ = 0;
}

bool StreamingModel::run() {
    if (!session_) return false;
    OrtStatus* st = api_->Run(session_, runOpts_, inNamePtrs_.data(), inVals_[phase_].data(), inNamePtrs_.size(),
                              outNamePtrs_.data(), outNamePtrs_.size(), outVals_[phase_].data());
    if (st) {
        api_->ReleaseStatus(st);
        return false;
    }
    phase_ ^= 1;  // this step's output state is the next step's input
    return true;
}

}  // namespace aurora::neural
