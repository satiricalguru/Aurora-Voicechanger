"""
WebSocket JSON-RPC Server — localhost:9001
JSON commands from the Electron UI; level, spectrum and latency pushed at 30 Hz.
"""
import sys, os, asyncio, json, threading, subprocess
sys.path.insert(0, os.path.dirname(__file__))

import websockets
import sounddevice as sd


def make_engine():
    """Native C++ engine (Aurora Core) when built, else the Python engine.
    AURORA_ENGINE=python forces the Python engine."""
    if os.environ.get('AURORA_ENGINE', 'native').lower() != 'python':
        try:
            from native_engine import NativeAudioEngine
            return NativeAudioEngine(), 'native'
        except Exception as e:
            print(f"[ws] Native engine unavailable ({e}); using Python engine")
    from engine import AudioEngine
    return AudioEngine(), 'python'


engine, BACKEND = make_engine()

from soundlib import SoundLibrary  # noqa: E402
library = SoundLibrary()
engine.library = library


async def handle(websocket):
    print(f"[ws] Client connected: {websocket.remote_address}")
    try:
        async for raw in websocket:
            try:
                cmd = json.loads(raw)
            except json.JSONDecodeError as e:
                await websocket.send(json.dumps({'type': 'error', 'msg': str(e)}))
                continue
            try:
                response = await dispatch(cmd)
            except Exception as e:
                response = {'type': 'error', 'msg': f'dispatch error: {e}'}
            await websocket.send(json.dumps(response))
    except websockets.exceptions.ConnectionClosed:
        print("[ws] Client disconnected")


async def dispatch(cmd: dict) -> dict:
    c = cmd.get('cmd', '')

    if c == 'set_voice':
        engine.set_voice(cmd.get('id', ''))
        return {'type': 'voice_set', 'id': cmd.get('id')}

    elif c == 'set_devices':
        inp = cmd.get('input')
        out = cmd.get('output')
        if inp is None or out is None:
            return {'type': 'error', 'msg': 'input and output required'}
        same = (engine.is_running() and getattr(engine, '_input_idx', None) == int(inp)
                and getattr(engine, '_output_idx', None) == int(out))
        if not same:  # re-sending the current route must not interrupt audio
            engine.start(int(inp), int(out))
        return {
            'type': 'status',
            'running': engine.is_running(),
            'input': int(inp), 'output': int(out),
            'latency': engine.get_latency(),
        }

    elif c == 'toggle_bypass':
        engine.bypass = not engine.bypass
        return {'type': 'bypass', 'value': engine.bypass}

    elif c in ('toggle_mute', 'set_mute'):
        value = (not engine.muted) if c == 'toggle_mute' else bool(cmd.get('value', False))
        engine.set_mute(value)
        return {'type': 'mute', 'value': engine.muted}

    elif c == 'list_sounds':
        return {'type': 'sounds', 'list': library.list()}

    elif c == 'add_sound':
        try:
            sound = await asyncio.to_thread(library.add, cmd.get('name', ''), cmd.get('filename', ''), cmd.get('data', ''))
        except Exception as e:
            return {'type': 'sound_error', 'msg': str(e)}
        return {'type': 'sounds', 'list': library.list(), 'added': sound['id']}

    elif c == 'update_sound':
        try:
            library.update(str(cmd.get('id', '')), dict(cmd.get('changes', {})))
        except KeyError:
            return {'type': 'sound_error', 'msg': 'sound not found'}
        return {'type': 'sounds', 'list': library.list()}

    elif c == 'delete_sound':
        library.delete(str(cmd.get('id', '')))
        return {'type': 'sounds', 'list': library.list()}

    elif c == 'set_bypass':
        engine.bypass = bool(cmd.get('value', False))
        return {'type': 'bypass', 'value': engine.bypass}

    elif c == 'get_devices':
        return {'type': 'devices', 'list': engine.get_devices()}

    elif c == 'get_level':
        return {'type': 'level', **engine.get_level()}

    elif c == 'get_audio_settings':
        return {'type': 'audio_settings', 'settings': engine.get_audio_settings()}

    elif c == 'set_audio_settings':
        engine.set_audio_settings(cmd.get('settings', {}))
        return {'type': 'audio_settings', 'settings': engine.get_audio_settings()}

    elif c == 'set_custom_chain':
        engine.set_custom_chain(list(cmd.get('chain', [])))
        return {'type': 'voice_set', 'id': 'custom'}

    elif c == 'get_latency':
        return {'type': 'latency', **engine.get_latency()}

    elif c == 'set_param':
        engine.set_param(cmd.get('effect', ''), cmd.get('param', ''), cmd.get('value', 0))
        return {'type': 'ok'}

    elif c == 'stop':
        engine.stop()
        return {'type': 'stopped'}

    elif c == 'get_voices':
        from voices.presets import VOICE_PRESETS
        from voices.ai_personas import AI_PERSONAS
        from effects.beatrice import neural_available
        voices = [
            {'id': k, 'name': v['name'], 'category': v['category'],
             'emoji': v.get('emoji', '🎙️'), 'color': v.get('color', '#666680'),
             'type': 'dsp'}
            for k, v in VOICE_PRESETS.items()
        ]
        use_neural = neural_available()
        neural = engine.neural_voices() if hasattr(engine, 'neural_voices') else {}
        neural_list = [
            {'id': k, 'name': v['name'], 'category': 'Characters', 'tag': v.get('tag', 'AI'),
             'color': v.get('color', '#8b7bff'), 'description': v.get('description', ''), 'type': 'neural'}
            for k, v in neural.items()
        ]
        personas = neural_list + [
            {'id': k, 'name': v['name'], 'category': 'Characters',
             'tag': v.get('tag', ''), 'color': v.get('color', '#666680'),
             'description': v.get('description', ''),
             'type': 'neural' if use_neural else 'character'}
            for k, v in AI_PERSONAS.items()
        ]
        return {'type': 'voices', 'dsp': voices, 'ai': personas}

    elif c == 'get_backend':
        from effects.beatrice import neural_available
        return {
            'type': 'backend',
            'backend': BACKEND,
            'neural': neural_available() or bool(getattr(engine, 'neural_voices', lambda: {})()),
            'virtual_mic': _virtual_mic_status(),
        }

    elif c == 'measure_latency':
        result = await asyncio.to_thread(engine.measure_latency)
        return {'type': 'latency', **result}

    elif c == 'install_virtual_mic':
        return await asyncio.to_thread(_install_virtual_mic)

    # ── Monitor (Hear Yourself) ───────────────────────────────────────────────
    elif c == 'start_monitor':
        dev = cmd.get('device')
        if dev is None:
            # Auto-detect speaker/headphone output
            dev = engine.find_default_output()
        if dev is None:
            return {'type': 'error', 'msg': 'No output device found for monitoring'}
        engine.start_monitor(int(dev))
        return {'type': 'monitor', 'active': engine.is_monitoring(), 'device': dev}

    elif c == 'stop_monitor':
        engine.stop_monitor()
        return {'type': 'monitor', 'active': False}

    elif c == 'toggle_monitor':
        if engine.is_monitoring():
            engine.stop_monitor()
            return {'type': 'monitor', 'active': False}
        else:
            dev = cmd.get('device') or engine.find_default_output()
            if dev is None:
                return {'type': 'error', 'msg': 'No output device found'}
            engine.start_monitor(int(dev))
            return {'type': 'monitor', 'active': engine.is_monitoring(), 'device': dev}

    # ── Soundboard ────────────────────────────────────────────────────────────
    elif c == 'play_sound':
        sound_id  = cmd.get('id', 0)
        mon_dev   = cmd.get('monitor_device')
        # Run in background thread so we don't block the async loop
        def _play():
            engine.play_sound(sound_id, mon_dev)
        threading.Thread(target=_play, daemon=True).start()
        return {'type': 'sound_playing', 'id': sound_id}

    elif c == 'play_file':
        path = cmd.get('path', '')
        if path:
            engine.play_file(path)
        return {'type': 'ok'}

    elif c == 'stop_sound':
        engine.stop_sounds()
        try:
            sd.stop()
        except Exception:
            pass
        return {'type': 'sound_stopped'}

    elif c == 'ping':
        return {'type': 'pong'}

    return {'type': 'error', 'msg': f'unknown command: {c!r}'}


async def level_broadcaster(connections: set):
    tick = 0
    while True:
        await asyncio.sleep(1 / 30)
        if not connections:
            continue
        tick += 1
        try:
            level = engine.get_level()
            level['bands'] = engine.get_spectrum()
            if tick % 15 == 0:   # twice a second is plenty for latency stats
                level['latency'] = engine.get_latency()
                if hasattr(engine, 'restart_if_needed'):
                    engine.restart_if_needed()
            if engine.last_error:
                level['error'] = engine.last_error
        except Exception:
            continue  # don't let a transient engine error kill the broadcaster
        msg = json.dumps({'type': 'level', **level})
        dead = set()
        for ws in connections:
            try:
                await ws.send(msg)
            except Exception:
                dead.add(ws)
        connections -= dead


VIRTUAL_INPUTS = ('blackhole', 'voicemod', 'dubbing', 'virtual', 'loopback', 'soundflower', 'vb-audio', 'cable', 'aurora')


def _repo_root():
    return os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _virtual_mic_status() -> dict:
    """Detect BlackHole (fallback) or Aurora HAL driver if installed."""
    root = _repo_root()
    installer = os.path.join(root, 'drivers', 'aurora-hal', 'install.sh')
    hal_path = '/Library/Audio/Plug-Ins/HAL/AuroraHAL.driver'
    return {
        'blackhole': any(d.get('is_blackhole') for d in engine.get_devices()),
        'aurora_mic': any(d.get('is_aurora') for d in engine.get_devices()),
        'aurora_hal_installed': os.path.isdir(hal_path),
        'installer': installer if os.path.isfile(installer) else None,
    }


def _install_virtual_mic() -> dict:
    """
    Run the Aurora HAL installer when present; otherwise point at BlackHole.
    Requires admin for /Library/Audio/Plug-Ins/HAL — installer prompts.
    """
    status = _virtual_mic_status()
    if status['aurora_hal_installed']:
        return {'type': 'virtual_mic', 'ok': True, 'msg': 'Aurora Microphone already installed', **status}
    script = status.get('installer')
    if not script:
        return {
            'type': 'virtual_mic',
            'ok': False,
            'msg': 'Aurora HAL installer not found. Install BlackHole 2ch as the demo fallback.',
            'blackhole_url': 'https://existential.audio/blackhole/',
            **status,
        }
    try:
        proc = subprocess.run(['bash', script], capture_output=True, text=True, timeout=120)
        ok = proc.returncode == 0
        if ok:
            _route_to_aurora()
        return {
            'type': 'virtual_mic',
            'ok': ok,
            'msg': proc.stdout.strip() or proc.stderr.strip() or ('Installed' if ok else 'Install failed'),
            **_virtual_mic_status(),
        }
    except Exception as e:
        return {'type': 'virtual_mic', 'ok': False, 'msg': str(e), **status}


def _route_to_aurora():
    """After installing Aurora Microphone, move the voice path onto it."""
    import time
    for _ in range(20):  # Core Audio was just restarted; wait for the device
        out = engine.find_virtual_mic()
        devs = engine.get_devices()
        if out is not None and any(d['index'] == out and d.get('is_aurora') for d in devs):
            mic = pick_real_mic()
            if mic is not None:
                engine.start(mic, out)
            return
        time.sleep(0.5)


def pick_real_mic():
    """System default mic, unless it is a virtual device (another voice changer's
    output, BlackHole...). Then prefer the built-in mic, then any real input."""
    devs = engine.get_devices()
    real = [d for d in devs
            if d['inputs'] > 0 and not any(k in d['name'].lower() for k in VIRTUAL_INPUTS)]
    for d in real:
        if d.get('is_default_input'):
            return d['index']
    for d in real:
        if 'macbook' in d['name'].lower() or 'built-in' in d['name'].lower():
            return d['index']
    return real[0]['index'] if real else None


async def main():
    connections: set = set()

    async def handler(ws):
        connections.add(ws)
        try:
            await handle(ws)
        finally:
            connections.discard(ws)

    print("[ws] VoiceChanger WebSocket server starting on ws://localhost:9001")

    # Auto-start BlackHole routing
    bh = engine.find_virtual_mic()
    # FIX #9/#10: use already-imported sd (not __import__) and guard against
    # sd.default.device returning -1 (no configured default input).
    default_in = pick_real_mic()
    if bh is not None and default_in is not None:
        print(f"[ws] Auto-starting: mic={default_in} → virtual mic={bh}")
        engine.start(default_in, bh)
    else:
        print("[ws] No virtual mic or no input — waiting for set_devices command")

    # Large max_size: soundboard uploads arrive as base64 (25 MB files).
    async with websockets.serve(handler, 'localhost', 9001, max_size=48 * 1024 * 1024):
        broadcaster = asyncio.create_task(level_broadcaster(connections))
        try:
            await asyncio.Future()
        finally:
            broadcaster.cancel()


if __name__ == '__main__':
    asyncio.run(main())
