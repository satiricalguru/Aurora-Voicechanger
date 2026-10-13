// Minimal JSON reader for chain configs (control thread only) and a small
// writer for stats. Not a general-purpose library: no \u surrogate pairs in
// output, numbers are doubles.
#pragma once

#include <cstdio>
#include <cstdlib>
#include <map>
#include <memory>
#include <string>
#include <vector>

namespace aurora::json {

struct Value {
    enum Type { Null, Bool, Number, String, Array, Object } type = Null;
    bool b = false;
    double num = 0;
    std::string str;
    std::vector<Value> arr;
    std::map<std::string, Value> obj;

    bool isObject() const { return type == Object; }
    bool isArray() const { return type == Array; }
    bool isNumber() const { return type == Number; }
    bool isString() const { return type == String; }

    const Value* get(const std::string& k) const {
        if (type != Object) return nullptr;
        auto it = obj.find(k);
        return it == obj.end() ? nullptr : &it->second;
    }
    double number(const std::string& k, double def) const {
        const Value* v = get(k);
        if (!v) return def;
        if (v->type == Number) return v->num;
        if (v->type == Bool) return v->b ? 1.0 : 0.0;
        return def;
    }
    std::string string(const std::string& k, const std::string& def) const {
        const Value* v = get(k);
        return (v && v->type == String) ? v->str : def;
    }
};

class Parser {
public:
    explicit Parser(const char* s) : p_(s) {}

    bool parse(Value& out, std::string& err) {
        try {
            out = value();
            ws();
            if (*p_) throw std::string("trailing characters");
            return true;
        } catch (const std::string& e) {
            err = e;
            return false;
        }
    }

private:
    const char* p_;

    void ws() {
        while (*p_ == ' ' || *p_ == '\n' || *p_ == '\r' || *p_ == '\t') ++p_;
    }

    Value value() {
        ws();
        Value v;
        switch (*p_) {
            case '{': return object();
            case '[': return array();
            case '"':
                v.type = Value::String;
                v.str = stringLit();
                return v;
            case 't': lit("true"); v.type = Value::Bool; v.b = true; return v;
            case 'f': lit("false"); v.type = Value::Bool; v.b = false; return v;
            case 'n': lit("null"); return v;
            default: return number();
        }
    }

    void lit(const char* s) {
        for (; *s; ++s, ++p_)
            if (*p_ != *s) throw std::string("bad literal");
    }

    Value number() {
        char* end = nullptr;
        double d = std::strtod(p_, &end);
        if (end == p_) throw std::string("bad number");
        p_ = end;
        Value v;
        v.type = Value::Number;
        v.num = d;
        return v;
    }

    std::string stringLit() {
        ++p_;  // opening quote
        std::string s;
        while (*p_ && *p_ != '"') {
            if (*p_ == '\\') {
                ++p_;
                switch (*p_) {
                    case 'n': s += '\n'; break;
                    case 't': s += '\t'; break;
                    case 'r': s += '\r'; break;
                    case 'b': s += '\b'; break;
                    case 'f': s += '\f'; break;
                    case 'u': {
                        unsigned cp = std::strtoul(std::string(p_ + 1, 4).c_str(), nullptr, 16);
                        p_ += 4;
                        if (cp < 0x80) s += char(cp);
                        else if (cp < 0x800) { s += char(0xC0 | (cp >> 6)); s += char(0x80 | (cp & 0x3F)); }
                        else { s += char(0xE0 | (cp >> 12)); s += char(0x80 | ((cp >> 6) & 0x3F)); s += char(0x80 | (cp & 0x3F)); }
                        break;
                    }
                    default: s += *p_;
                }
                ++p_;
            } else {
                s += *p_++;
            }
        }
        if (*p_ != '"') throw std::string("unterminated string");
        ++p_;
        return s;
    }

    Value array() {
        ++p_;
        Value v;
        v.type = Value::Array;
        ws();
        if (*p_ == ']') { ++p_; return v; }
        for (;;) {
            v.arr.push_back(value());
            ws();
            if (*p_ == ',') { ++p_; continue; }
            if (*p_ == ']') { ++p_; return v; }
            throw std::string("expected , or ]");
        }
    }

    Value object() {
        ++p_;
        Value v;
        v.type = Value::Object;
        ws();
        if (*p_ == '}') { ++p_; return v; }
        for (;;) {
            ws();
            if (*p_ != '"') throw std::string("expected key");
            std::string k = stringLit();
            ws();
            if (*p_ != ':') throw std::string("expected :");
            ++p_;
            v.obj[k] = value();
            ws();
            if (*p_ == ',') { ++p_; continue; }
            if (*p_ == '}') { ++p_; return v; }
            throw std::string("expected , or }");
        }
    }
};

// Tiny streaming writer.
class Writer {
public:
    std::string s;
    void raw(const std::string& x) { s += x; }
    void key(const char* k) {
        comma();
        quote(k);
        s += ':';
        needComma_ = false;
    }
    void beginObj() { comma(); s += '{'; needComma_ = false; }
    void endObj() { s += '}'; needComma_ = true; }
    void beginArr() { comma(); s += '['; needComma_ = false; }
    void endArr() { s += ']'; needComma_ = true; }
    void num(double d, int prec = 3) {
        comma();
        char b[64];
        if (d != d || d > 1e300 || d < -1e300) d = 0;
        snprintf(b, sizeof b, "%.*f", prec, d);
        s += b;
        needComma_ = true;
    }
    void integer(long long v) {
        comma();
        s += std::to_string(v);
        needComma_ = true;
    }
    void boolean(bool v) { comma(); s += v ? "true" : "false"; needComma_ = true; }
    void null() { comma(); s += "null"; needComma_ = true; }
    void str(const std::string& v) { comma(); quote(v); needComma_ = true; }

    void kv(const char* k, double d, int prec = 3) { key(k); num(d, prec); }
    void kv(const char* k, const std::string& v) { key(k); str(v); }
    void kvb(const char* k, bool v) { key(k); boolean(v); }
    void kvi(const char* k, long long v) { key(k); integer(v); }

private:
    bool needComma_ = false;
    void comma() {
        if (needComma_) s += ',';
        needComma_ = false;
    }
    void quote(const std::string& v) {
        s += '"';
        for (unsigned char c : v) {
            if (c == '"' || c == '\\') { s += '\\'; s += char(c); }
            else if (c < 0x20) { char b[8]; snprintf(b, sizeof b, "\\u%04x", c); s += b; }
            else s += char(c);
        }
        s += '"';
    }
};

}  // namespace aurora::json
