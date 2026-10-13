#!/bin/bash
# Install Aurora Microphone (AuroraHAL.driver) into /Library/Audio/Plug-Ins/HAL
# and restart Core Audio. Needs admin rights: asks via the macOS password
# dialog when not run as root. Restarting Core Audio briefly interrupts all
# audio on the Mac.
set -euo pipefail
cd "$(dirname "$0")"
SRC="$PWD/build/AuroraHAL.driver"
[ -d "$SRC" ] || ./build.sh >/dev/null
DEST=/Library/Audio/Plug-Ins/HAL
CMD="rm -rf '$DEST/AuroraHAL.driver' && cp -R '$SRC' '$DEST/' && chown -R root:wheel '$DEST/AuroraHAL.driver' && (launchctl kickstart -k system/com.apple.audio.coreaudiod || killall coreaudiod)"
if [ "$(id -u)" -eq 0 ]; then
  bash -c "$CMD"
else
  osascript -e "do shell script \"$CMD\" with prompt \"Aurora Voice wants to install the Aurora Microphone audio driver.\" with administrator privileges"
fi
for _ in $(seq 1 30); do
  if system_profiler SPAudioDataType 2>/dev/null | grep -q "Aurora Microphone"; then
    echo "Aurora Microphone installed"
    exit 0
  fi
  sleep 0.5
done
echo "Installed, but Aurora Microphone has not appeared yet; it may need a moment or a log-out." >&2
