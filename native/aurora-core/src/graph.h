// Voice graph: an ordered chain of nodes processing mono audio in place.
// Built on a control thread, then handed to the audio thread whole; nodes
// never allocate in process().
#pragma once

#include <memory>
#include <string>
#include <vector>

#include "json.h"

namespace aurora {

class Node {
public:
    virtual ~Node() = default;
    virtual void prepare(double sr, int maxBlock) = 0;
    virtual void process(float* x, int n) = 0;
    // Algorithmic delay this node adds, in samples.
    virtual int latency() const { return 0; }
    // Real-time safe parameter update; false if unknown.
    virtual bool setParam(const std::string& key, double v) { (void)key; (void)v; return false; }
    // Output gaps this node caused (e.g. a late neural step). Any thread.
    virtual uint32_t dropouts() const { return 0; }
    // Average time of work done off the audio thread per step, in ms (0 if none).
    virtual float workerStepMs() const { return 0.f; }
    // Fraction of a core that off-thread work uses.
    virtual float workerLoad() const { return 0.f; }

    std::string type;
};

class Chain {
public:
    std::vector<std::unique_ptr<Node>> nodes;
    std::string description;

    void prepare(double sr, int maxBlock) {
        for (auto& n : nodes) n->prepare(sr, maxBlock);
    }
    void process(float* x, int n) {
        for (auto& node : nodes) node->process(x, n);
    }
    int latency() const {
        int l = 0;
        for (auto& n : nodes) l += n->latency();
        return l;
    }
    float workerStepMs() const {
        float m = 0;
        for (auto& n : nodes) m += n->workerStepMs();
        return m;
    }
    float workerLoad() const {
        float l = 0;
        for (auto& n : nodes) l += n->workerLoad();
        return l;
    }
    uint32_t dropouts() const {
        uint32_t d = 0;
        for (auto& n : nodes) d += n->dropouts();
        return d;
    }
    bool setParam(const std::string& type, const std::string& key, double v) {
        for (auto& n : nodes)
            if (n->type == type) return n->setParam(key, v);
        return false;
    }
};

// Typical block size the chain will see (the device I/O buffer), as opposed
// to maxBlock, the largest it must handle. Nodes that queue audio size their
// latency from this. Set by the engine before building chains.
inline int& blockHint() {
    static int v = 128;
    return v;
}

// Build a node from {"effect": "...", ...params}. nullptr if unknown.
std::unique_ptr<Node> makeNode(const json::Value& stage);

// Build a chain from {"chain":[...], "persona":{...}}. Throws std::string.
std::unique_ptr<Chain> buildChain(const std::string& jsonText, double sr, int maxBlock);

}  // namespace aurora
