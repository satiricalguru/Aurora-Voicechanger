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
step "Engine server end to end (needs a mic + virtual mic; port 9001 must be free)"
python3 tests/e2e_server.py || status=1
step "UI build"
npx vite build 2>&1 | grep -E "error|built in" || status=1
exit $status
