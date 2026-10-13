#include "graph.h"

#include "nodes.h"

namespace aurora {

using json::Value;

namespace {

int noiseColor(const std::string& c) {
    if (c == "pink") return 1;
    if (c == "brown") return 2;
    return 0;
}

}  // namespace

std::unique_ptr<Node> makeNode(const Value& s) {
    const std::string fx = s.string("effect", "");
    if (fx == "pitch") {
        auto n = std::make_unique<nodes::Pitch>();
        n->semitones = (float)s.number("semitones", 0);
        n->formant = (float)s.number("formant", 1);
        n->preserve = s.number("preserve_formants", 1) != 0;
        n->fftSize = (int)s.number("fft_size", 0);
        n->type = fx;
        return n;
    }
    if (fx == "autotune") {
        auto n = std::make_unique<nodes::Autotune>();
        n->key = s.string("key", "C_major");
        n->speed = (float)s.number("speed", 0.05);
        n->type = fx;
        return n;
    }
    if (fx == "harmony") {
        auto n = std::make_unique<nodes::Harmony>();
        if (const Value* iv = s.get("intervals"); iv && iv->isArray()) {
            n->intervals.clear();
            for (auto& v : iv->arr) if (v.isNumber()) n->intervals.push_back((float)v.num);
        }
        n->detuneCents = (float)s.number("detune_cents", 0);
        n->wet = (float)s.number("wet", 0.4);
        n->type = fx;
        return n;
    }
    if (fx == "whisper") {
        auto n = std::make_unique<nodes::Whisper>();
        n->breathiness = (float)s.number("breathiness", 0.7);
        n->type = fx;
        return n;
    }
    if (fx == "robot") {
        auto n = std::make_unique<nodes::Robot>();
        n->carrierFreq = (float)s.number("carrier_freq", 120);
        n->depth = (float)s.number("depth", 0.8);
        n->type = fx;
        return n;
    }
    if (fx == "reverb") {
        auto n = std::make_unique<nodes::Reverb>();
        n->room = (float)s.number("room", 0.4);
        n->damping = (float)s.number("damping", 0.6);
        n->wet = (float)s.number("wet", 0.25);
        n->preDelayMs = (float)std::clamp(s.number("pre_delay_ms", 5), 0.0, 190.0);
        n->type = fx;
        return n;
    }
    if (fx == "chorus") {
        auto n = std::make_unique<nodes::Chorus>();
        n->rate = (float)s.number("rate", 1.5);
        n->depthMs = (float)std::clamp(s.number("depth", 10), 0.0, 50.0);
        n->feedback = (float)s.number("feedback", 0.2);
        n->voices = (int)s.number("voices", 2);
        n->wet = (float)s.number("wet", 0.5);
        n->type = fx;
        return n;
    }
    if (fx == "vibrato") {
        auto n = std::make_unique<nodes::Vibrato>();
        n->rate = (float)s.number("rate", 5);
        n->depth = (float)std::clamp(s.number("depth", 0.3), 0.0, 5.0);
        n->type = fx;
        return n;
    }
    if (fx == "delay") {
        auto n = std::make_unique<nodes::Delay>();
        n->delayMs = (float)std::clamp(s.number("delay_ms", 250), 1.0, 1990.0);
        n->feedback = (float)s.number("feedback", 0.3);
        n->wet = (float)s.number("wet", 0.4);
        n->type = fx;
        return n;
    }
    if (fx == "wah") {
        auto n = std::make_unique<nodes::Wah>();
        n->rate = (float)s.number("rate", 2);
        n->depth = (float)s.number("depth", 0.7);
        n->type = fx;
        return n;
    }
    if (fx == "distortion") {
        auto n = std::make_unique<nodes::Distortion>();
        n->drive = (float)std::max(0.1, s.number("drive", 3));
        n->bits = std::clamp((int)s.number("bits", 16), 2, 16);
        n->downsample = std::clamp((int)s.number("downsample", 1), 1, 32);
        n->type = fx;
        return n;
    }
    if (fx == "eq") {
        auto n = std::make_unique<nodes::EQ>();
        n->low = (float)s.number("low", 0);
        n->mid = (float)s.number("mid", 0);
        n->high = (float)s.number("high", 0);
        n->lowFreq = (float)s.number("low_freq", 200);
        n->midFreq = (float)s.number("mid_freq", 1000);
        n->highFreq = (float)s.number("high_freq", 4000);
        n->midQ = (float)s.number("mid_q", 0.7);
        n->type = fx;
        return n;
    }
    if (fx == "noise_inject") {
        auto n = std::make_unique<nodes::NoiseInject>();
        n->color = noiseColor(s.string("color", "white"));
        n->level = (float)s.number("level", 0.03);
        n->type = fx;
        return n;
    }
    return nullptr;
}

std::unique_ptr<Chain> buildChain(const std::string& text, double sr, int maxBlock) {
    Value root;
    std::string err;
    if (!json::Parser(text.c_str()).parse(root, err)) throw std::string("chain JSON: " + err);
    auto chain = std::make_unique<Chain>();

    if (const Value* p = root.get("persona"); p && p->isObject()) {
        auto n = std::make_unique<nodes::Persona>();
        n->targetF0 = (float)p->number("target_f0_mean", 200);
        n->formant = (float)p->number("resonance_shift", 1.0);
        n->breathiness = (float)p->number("breathiness", 0);
        n->roughness = (float)p->number("roughness", 0);
        n->brightness = (float)p->number("brightness", 0);
        n->vibRate = (float)p->number("vibrato_rate", 0);
        n->vibDepthCents = (float)p->number("vibrato_depth", 0);
        n->type = "persona";
        chain->nodes.push_back(std::move(n));
    }
    if (const Value* c = root.get("chain"); c && c->isArray()) {
        for (auto& stage : c->arr) {
            auto n = makeNode(stage);
            if (n) chain->nodes.push_back(std::move(n));
        }
    }
    chain->prepare(sr, maxBlock);
    return chain;
}

}  // namespace aurora
