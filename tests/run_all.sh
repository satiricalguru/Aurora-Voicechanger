#!/bin/bash
# Full test run: native DSP + all voices, virtual mic driver, live server end to end, UI build.
set -uo pipefail
cd "$(dirname "$0")/.."
status=0
step() { echo; echo "━━ $1"; }
step "Native engine (DSP, resampler, denoiser, every voice)"
npm run --silent build:native >/dev/null && npm run --silent test:native | grep -E "FAIL|passed|worst" || status=1
step "Aurora Microphone driver"
npm run --silent build:driver | grep -E "FAIL|passed" || status=1
step "Recorder and instant replay on real devices (built-in mic -> virtual mic)"
read -r MIC VMIC < <(python3 - <<'PY'
import ctypes, json
L = ctypes.CDLL('native/aurora-core/build/libaurora_core.dylib')
b = ctypes.create_string_buffer(1 << 16); L.ac_list_devices(b, 1 << 16)
d = json.loads(b.value)
mic = next((x['uid'] for x in d if x['inputs'] and 'BuiltInMicrophone' in x['uid']), '')
vm = (next((x['uid'] for x in d if x['uid'] == 'AuroraMicrophone_UID'), '')
      or next((x['uid'] for x in d if 'blackhole' in x['name'].lower()), ''))
print(mic or '-', vm or '-')
PY
)
if [ "$MIC" != "-" ] && [ "$VMIC" != "-" ]; then
  native/aurora-core/build/aurora_capture_probe "$MIC" "$VMIC" | grep -E "FAIL|skip|passed" || status=1
else
  echo "skipped: needs the built-in mic and Aurora Microphone or BlackHole"
fi
step "Engine server end to end (needs a mic + virtual mic; port 9001 must be free)"
python3 tests/e2e_server.py || status=1
step "UI build"
npx vite build 2>&1 | grep -E "error|built in" || status=1
exit $status
