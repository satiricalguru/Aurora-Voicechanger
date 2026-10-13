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

## Measured (MacBook Air M2, built-in mic -> BlackHole 2ch, 48 kHz)

| HAL buffer | After-mic path (measured) | Total incl. mic converter | Dropouts |
| --- | --- | --- | --- |
| 256 | 25.9 ms | 57.0 ms | 0 |
| 128 | 15.9 ms | 46.9 ms | 0 |
| 64 (default) | 7.6–11.4 ms | 38.6–42.4 ms | 0 |
| 32 | 9.5 ms | 40.5 ms | 0 |
| 16 | 8.4 ms | 39.4 ms | 0 |

These figures include the 5.33 ms pitch look-ahead. The built-in mic reports 1439 frames (~31 ms) of stream latency of its own; a USB or interface mic removes most of that. DSP load: heaviest voice ~10 % of one core in offline render, ~4–8 % live.

Pitch accuracy −12…+12 semitones: within ±2.2 cents. Identity reconstruction SNR: 137 dB.

## Next

1. Own virtual mic (AudioServerPlugIn): fixed 48 kHz, zero device latency, silence on reader overrun, client-start signalling to the app.
2. Join the HAL I/O `os_workgroup`, real-time AI worker thread.
3. Streaming neural voice conversion on a worker thread with a jitter buffer (CoreML / ONNX Runtime).
