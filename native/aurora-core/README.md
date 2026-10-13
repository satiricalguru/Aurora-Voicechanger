# Aurora Core

Native real-time voice engine for macOS (C++17, CoreAudio HAL, Accelerate). Python drives it through a C API (`include/aurora_core.h`) via `python/native_engine.py`.

```bash
npm run build:native   # cmake configure + build (libaurora_core.dylib, aurora_bench)
npm run test:native    # DSP tests + render/timing of all 77 voices
```

## Signal path

```
mic IOProc (real-time)                                   virtual-mic IOProc (real-time)
  ch0 -> mic gain -> 70 Hz HPF -> gate -> voice chain       drift-corrected cubic read
      -> voice gain -> soundboard mix -> limiter  ──SPSC──>  from the ring -> all channels
                                                  └─SPSC──>  monitor IOProc (headphones)
```

- **I/O**: HAL IOProcs directly (no PortAudio). Mic and virtual mic run on independent clocks; a lock-free ring plus a ±0.2 % adaptive resampler bridges them. The queue target starts at `out + in/2 + 16` frames, grows on underruns and shrinks after 10 s clean, so it settles at the smallest stable size. Same-device input/output uses one duplex IOProc with no ring.
- **Voice changes**: chains are built on the control thread, handed over with an atomic exchange and crossfaded over 12 ms. Retired chains go back through a queue and are freed off the audio thread. Parameter tweaks travel through an SPSC queue.
- **Watchdog**: listeners for device death, sample-rate change and processor overload; `device_changed` in stats triggers a restart from Python.
- **Measurement**: `ac_measure_loopback` sends a post-chain pulse stamped with the mic sample's capture host time and finds it on the virtual device's input side. Chain latency is added exactly; the mic converter's reported latency is the only unmeasured part.

## Pitch and formant shifter (`src/dsp/spectral.h`)

Low-delay analysis/synthesis (Mauler & Martin 2011): a 2048-sample asymmetric analysis window resolves harmonics of low voices while the 256-sample synthesis window keeps the delay at 5.33 ms. Peak-locked phase vocoder (Laroche & Dolson 1999) moves each partial with a running phase rotation. A liftered cepstral envelope re-weights moved bins so pitch and formants shift independently. The same core does whisper (phase randomisation), harmony, autotune and character voices.

Character voices track the speaker's long-term mean log-F0 and shift by the ratio to the target, so intonation survives instead of being flattened to one note.

## Background-noise removal (`src/denoise.h`)

Mic-input stage (after the high-pass, before the gate), like Voicemod's denoiser, built on Xiph's RNNoise 0.2 (BSD-3, vendored in `third_party/rnnoise` with a small gain-only API added; see `AURORA_CHANGES.md`). RNNoise looks one 10 ms frame ahead, so used as-is it adds 30 ms. Aurora offers three modes (engine setting `nr_mode`, strength `nr_strength` = 6..40 dB attenuation floor):

| Mode | Added latency | SI-SDR gain* | How |
| --- | --- | --- | --- |
| Low latency | 5.3 ms | +3.5 dB | RNNoise band gains (two instances staggered by 5 ms) applied through a low-delay STFT |
| Balanced (default) | 15.3 ms | +5.2 dB | same, audio held back 10 ms so the gains line up |
| Studio | 30.0 ms | +6.0 dB | RNNoise end to end, including its pitch comb filter |

*LibriSpeech speech with hiss, fan hum and keyboard noise at 5–10 dB SNR. Gaps between words drop by ~25 dB in all modes; babble (other voices) is RNNoise's weak spot. At engine rates other than 48 kHz the network gets a resampled copy and Studio falls back to Balanced.

## Neural voices (`src/neural/`)

Streaming voice-conversion models run through ONNX Runtime's C API, loaded with `dlopen` (the engine works without it; neural voices just don't appear). Any model exported in the step convention works: `[context | chunk]` audio plus recurrent state in, `chunk` audio plus next state out, with `aurora.sample_rate` / `aurora.lookahead` metadata.

- The audio thread only resamples (band-limited, 1.1 ms round trip 48k↔16k, 77 dB SNR) and moves samples through lock-free rings.
- A Mach real-time worker thread, woken by a semaphore, runs one model step per chunk; state tensors ping-pong between two preallocated sets, so a step never allocates.
- Output starts with a fixed lead (one chunk + 1.5x measured step time + 3 ms + one I/O block), so latency is constant and a late step is a counted `model_underruns`, never drift.
- `ac_render_offline` runs steps inline, so offline renders match the live path sample for sample (verified against PyTorch: correlation 0.9999).

First model: [LLVC](https://github.com/KoeAI/LLVC) (MIT, 3.3 M parameters, 16 kHz, 13 ms chunks). Export with `tools/llvc/export_llvc.py` into `models/llvc/llvc.onnx`. Voices are defined in `python/voices/neural.py` (Lyra, Lyra Bright, Lyra Low: the model plus DSP shaping).

Microsoft's ONNX Runtime build (shipped in the `onnxruntime` pip package, which `native_engine.py` finds automatically) runs a step in ~4.2 ms; Homebrew's build takes ~6.2 ms. Set `AURORA_ORT_LIB` to choose explicitly.

## Measured (MacBook Air M2, built-in mic -> BlackHole 2ch, 48 kHz)

| HAL buffer | After-mic path (measured) | Total incl. mic converter | Dropouts |
| --- | --- | --- | --- |
| 256 | 25.9 ms | 57.0 ms | 0 |
| 128 | 15.9 ms | 46.9 ms | 0 |
| 64 (default) | 7.6–11.4 ms | 38.6–42.4 ms | 0 |
| 32 | 9.5 ms | 40.5 ms | 0 |
| 16 | 8.4 ms | 39.4 ms | 0 |

Loopback measurements per voice type (64-frame buffers, repeatable to 0.01 ms, within 1.7 ms of the engine's own estimate):

| Mic | DSP voice (pitch) | Neural voice (Lyra) |
| --- | --- | --- |
| MacBook Air (31 ms of its own) | 42.4 ms | 62.1 ms |
| AirPods Pro, 24 kHz Bluetooth | 43.2 ms | 63.7 ms |

These figures include the 5.33 ms pitch look-ahead. The built-in mic reports 1439 frames (~31 ms) of stream latency of its own; a USB or interface mic removes most of that. DSP load: heaviest voice ~10 % of one core in offline render, ~4–8 % live.

Pitch accuracy −12…+12 semitones: within ±2.2 cents. Identity reconstruction SNR: 137 dB.

## Next

1. Verify Aurora Microphone (`drivers/aurora-hal`) live once installed; client-start signalling to the app.
2. Join the HAL I/O `os_workgroup` from the neural worker.
3. Neural: adaptive lead (shrink while clean), our own character models trained on licensed voice data, CoreML/ANE path for larger models.
