# Aurora Microphone (AuroraHAL.driver)

Virtual microphone for Aurora Voice: an AudioServerPlugIn loaded by Core Audio. The engine writes the changed voice to its output side; Discord, OBS, Zoom and games read it as a microphone.

```bash
npm run build:driver              # build (universal, ad-hoc signed) + in-process tests
drivers/aurora-hal/install.sh     # copy to /Library/Audio/Plug-Ins/HAL, restart Core Audio (asks for your password)
drivers/aurora-hal/uninstall.sh   # remove it again
```

Restarting Core Audio cuts all audio on the Mac for a second or two. The app's Setup screen runs the same installer.

## Design

- One device, "Aurora Microphone", UID `AuroraMicrophone_UID`: 48 kHz, stereo float32, one input and one output stream.
- **Zero latency and zero safety offset.** Writer and readers share the device clock, so the only delay is one I/O buffer on each side and there is no drift to correct.
- Can be the default *input*; never the default output or system-sound device, so the Mac's own sounds can't leak into calls.
- Ring of 16384 frames indexed by device sample time. Readers only get frames from the writer's current contiguous run: before anything is written, after the app stops, across a stall, or older than the ring, they read silence rather than stale audio.
- Host-time clock anchored at the first StartIO, one anchor per 16384 frames.

`tests/hal_test.cpp` loads the bundle through CFPlugIn the way coreaudiod does and checks properties, sample-exact loopback across the ring wrap, the silence rules and the clock rate.

For distribution the bundle needs a Developer ID signature (`AURORA_SIGN_IDENTITY="Developer ID Application: …" npm run build:driver`) and notarisation inside the app.
