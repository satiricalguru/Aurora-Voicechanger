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
    bool setParam(const std::string& type, const std::string& key, double v) {
        for (auto& n : nodes)
            if (n->type == type) return n->setParam(key, v);
        return false;
    }
};

// Build a node from {"effect": "...", ...params}. nullptr if unknown.
std::unique_ptr<Node> makeNode(const json::Value& stage);

// Build a chain from {"chain":[...], "persona":{...}}. Throws std::string.
std::unique_ptr<Chain> buildChain(const std::string& jsonText, double sr, int maxBlock);

}  // namespace aurora
