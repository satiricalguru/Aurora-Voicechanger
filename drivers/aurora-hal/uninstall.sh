#!/bin/bash
# Remove Aurora Microphone and restart Core Audio (asks for admin rights).
set -euo pipefail
CMD="rm -rf /Library/Audio/Plug-Ins/HAL/AuroraHAL.driver && (launchctl kickstart -k system/com.apple.audio.coreaudiod || killall coreaudiod)"
if [ "$(id -u)" -eq 0 ]; then bash -c "$CMD"
else osascript -e "do shell script \"$CMD\" with prompt \"Aurora Voice wants to remove the Aurora Microphone audio driver.\" with administrator privileges"; fi
echo "Aurora Microphone removed"
