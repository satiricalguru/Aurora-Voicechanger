"""
WebSocket JSON-RPC Server — localhost:9001
JSON commands from the Electron UI; level, spectrum and latency pushed at 30 Hz.
"""
import sys, os, asyncio, json, threading
sys.path.insert(0, os.path.dirname(__file__))

import websockets
from engine import AudioEngine
import sounddevice as sd

engine = AudioEngine()


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
        voices = [
            {'id': k, 'name': v['name'], 'category': v['category'],
             'emoji': v.get('emoji', '🎙️'), 'color': v.get('color', '#666680'),
             'type': 'dsp'}
            for k, v in VOICE_PRESETS.items()
        ]
        personas = [
            {'id': k, 'name': v['name'], 'category': v['category'],
             'tag': v.get('tag', ''), 'color': v.get('color', '#666680'),
             'description': v.get('description', ''), 'type': 'ai'}
            for k, v in AI_PERSONAS.items()
        ]
        return {'type': 'voices', 'dsp': voices, 'ai': personas}

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
        sound_id  = int(cmd.get('id', 0))
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


VIRTUAL_INPUTS = ('blackhole', 'voicemod', 'dubbing', 'virtual', 'loopback', 'soundflower', 'vb-audio', 'cable')


def pick_real_mic():
    """System default mic, unless it is a virtual device (another voice changer's
    output, BlackHole...). Then prefer the built-in mic, then any real input."""
    devs = sd.query_devices()
    real = [i for i, d in enumerate(devs)
            if d['max_input_channels'] > 0 and not any(k in d['name'].lower() for k in VIRTUAL_INPUTS)]
    default_in = sd.default.device[0]
    if isinstance(default_in, int) and default_in in real:
        return default_in
    for i in real:
        if 'macbook' in devs[i]['name'].lower() or 'built-in' in devs[i]['name'].lower():
            return i
    return real[0] if real else None


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
    bh = engine.find_blackhole()
    # FIX #9/#10: use already-imported sd (not __import__) and guard against
    # sd.default.device returning -1 (no configured default input).
    default_in = pick_real_mic()
    if bh is not None and default_in is not None:
        print(f"[ws] Auto-starting: mic={default_in} → BlackHole={bh}")
        engine.start(default_in, bh)
    else:
        print("[ws] BlackHole not found or no default input — waiting for set_devices command")

    async with websockets.serve(handler, 'localhost', 9001):
        broadcaster = asyncio.create_task(level_broadcaster(connections))
        try:
            await asyncio.Future()
        finally:
            broadcaster.cancel()


if __name__ == '__main__':
    asyncio.run(main())
