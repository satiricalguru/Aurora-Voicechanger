#!/bin/bash
# Build AuroraHAL.driver (universal) into drivers/aurora-hal/build/.
set -euo pipefail
cd "$(dirname "$0")"
OUT=build/AuroraHAL.driver
rm -rf "$OUT"
mkdir -p "$OUT/Contents/MacOS"
cp Info.plist "$OUT/Contents/Info.plist"
clang++ -std=c++17 -O2 -Wall -Wextra -Wno-unused-parameter \
  -arch arm64 -arch x86_64 -mmacosx-version-min=12.0 \
  -bundle -fvisibility=hidden \
  -framework CoreAudio -framework CoreFoundation \
  -o "$OUT/Contents/MacOS/AuroraHAL" src/AuroraHAL.cpp
codesign --force --sign "${AURORA_SIGN_IDENTITY:--}" --timestamp=none "$OUT"
# In-process test host (loads the bundle like coreaudiod would).
clang++ -std=c++17 -O2 -arch "$(uname -m)" -framework CoreAudio -framework CoreFoundation \
  -o build/hal_test tests/hal_test.cpp
echo "built $OUT"
