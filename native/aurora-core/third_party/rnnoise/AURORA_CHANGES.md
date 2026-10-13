RNNoise 0.2 (https://github.com/xiph/rnnoise/releases/tag/v0.2), BSD-3-Clause, see COPYING.

Vendored unchanged except:
- `src/denoise.c`: appended `rnnoise_compute_gains()`, `rnnoise_band_count()`, `rnnoise_band_edges()`.
- `include/rnnoise.h`: declarations for those three functions.
- Only the sources Aurora builds are included (no training tools, no x86 run-time dispatch).
- `src/os_support.h`: minimal stand-in (OPUS_COPY/MOVE/CLEAR) for the Opus header the release's `vec*.h` include but don't ship.
