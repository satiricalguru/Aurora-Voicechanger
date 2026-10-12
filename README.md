<p align="center"><img src="assets/icon.png" width="128" alt="Aurora Voice icon" /></p>

<h1 align="center">Aurora Voice</h1>

<p align="center">Ultra-low-latency real-time voice changer for macOS: anime characters, realistic human voices and 50 effects, live in Discord, games and calls.</p>

<p align="center"><b>Status:</b> in development · macOS first, Windows planned · not yet released</p>

---

## Features

- **28 character voices** across anime, realistic, dark and creature styles, each with an original portrait
- **49 effects**: robots, radios, caves, demons, pitch and formant tricks
- **Voice Lab**: stack effects in any order and tune them live
- **Soundboard** with keyboard triggers and custom clips
- **Hear myself** monitoring, noise gate, noise reduction
- **Live latency readout** straight from the audio device
- WebGL aurora interface with an audio-reactive sphere and scroll-driven motion
- Everything runs locally; no account, no cloud processing

## Run it (development)

Requirements: macOS, Node 20+, Python 3.11+, [BlackHole 2ch](https://existential.audio/blackhole/).

```bash
pip3 install -r requirements.txt
npm install
npm run dev
```

Electron starts the Python audio engine (`python/ws_server.py`, `ws://localhost:9001`). In Setup, send the changed voice to **BlackHole 2ch**, then pick BlackHole as the microphone in Discord, OBS, Zoom or your game.

Hotkeys: **F1** voice on/off · **F4** show/hide window.

## Project layout

| Path | What it is |
| --- | --- |
| `electron/` | Window, tray, menu, global hotkeys; spawns the engine |
| `python/` | Audio engine: 48 kHz, 256-sample blocks, DSP effect chains, character personas |
| `src/gl/AuroraScene.js` | WebGL aurora background and audio-reactive sphere (three.js) |
| `src/lib/engine.js` | WebSocket store; meters and spectrum bypass React and feed the GL scene |
| `src/components/` | Live, Characters, Effects, Soundboard, Voice Lab, Setup, Dock |
| `src/assets/faces/` | Character portraits (`<voice id>.jpg`) |
| `website/` | Static landing page (no downloads yet) |
| `tools/` | Icon renderer, portrait sheet splitter, voice list exporter |

## Roadmap

1. **Measure**: loopback click test for true end-to-end latency
2. **Neural voices**: integrate Beatrice 2 (MIT, ~50 ms) for real voice conversion of the characters
3. **Native engine**: move the audio callback to C++/Rust with CoreAudio and ONNX Runtime; target under 15 ms for effects
4. **Own streaming model** with licensed voice-actor data and quality tiers
5. Windows build (WASAPI, virtual mic driver)

Current device-side latency on a MacBook Air mic into BlackHole is about 71 ms; most of it is the input path, which step 3 addresses.

## Licence

Proprietary. All rights reserved. See [LICENSE](LICENSE).
