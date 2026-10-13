"""
End-to-end test of the engine server (python/ws_server.py) over its
WebSocket API, with real audio devices: needs a mic and a virtual mic
(Aurora Microphone or BlackHole). Uses a throwaway sound library.

    python3 tests/e2e_server.py
"""
import asyncio
import base64
import json
import os
import struct
import subprocess
import sys
import tempfile

import numpy as np
import websockets

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
failures = []


def check(cond, msg):
    print(('  ok    ' if cond else '  FAIL  ') + msg)
    if not cond:
        failures.append(msg)


def wav_bytes(seconds=1.0, sr=44100, freq=440.0):
    n = int(sr * seconds)
    t = np.arange(n) / sr
    pcm = (0.4 * np.sin(2 * np.pi * freq * t) * np.exp(-t) * 32767).astype('<i2').tobytes()
    return (b'RIFF' + struct.pack('<I', 36 + len(pcm)) + b'WAVE'
            + b'fmt ' + struct.pack('<IHHIIHH', 16, 1, 1, sr, sr * 2, 2, 16)
            + b'data' + struct.pack('<I', len(pcm)) + pcm)


async def main(data_dir):
    ws = None
    for _ in range(80):
        try:
            ws = await websockets.connect('ws://localhost:9001', max_size=None)
            break
        except OSError:
            await asyncio.sleep(0.25)
    assert ws, 'server did not start'

    async def rpc(cmd, want=None):
        await ws.send(json.dumps(cmd))
        while True:
            m = json.loads(await ws.recv())
            if m.get('type') != 'level' and (want is None or m.get('type') == want):
                return m

    async def level():
        """Newest level message: drain ~150 ms of buffered messages so the state is current."""
        loop = asyncio.get_running_loop()
        end = loop.time() + 0.15
        last = None
        while last is None or loop.time() < end:
            m = json.loads(await asyncio.wait_for(ws.recv(), timeout=3))
            if m.get('type') == 'level':
                last = m
        return last

    print('Engine')
    b = await rpc({'cmd': 'get_backend'}, 'backend')
    check(b['backend'] == 'native', f"native backend ({b['backend']})")
    devs = (await rpc({'cmd': 'get_devices'}, 'devices'))['list']
    real = [d for d in devs if d['inputs'] > 0 and not d.get('is_virtual_mic') and not d.get('is_virtual')]
    # Built-in mic first: wireless mics (AirPods, iPhone) add their own jitter.
    want = os.environ.get('E2E_MIC', '').lower()  # e.g. E2E_MIC=airpods to test another mic
    mic = (next((d for d in real if want and want in d['name'].lower()), None)
           or next((d for d in real if 'macbook' in d['name'].lower() or 'built-in' in d['name'].lower()), real[0] if real else None))
    vm = next((d for d in devs if d.get('is_virtual_mic') and d['outputs'] > 0), None)
    check(mic is not None and vm is not None, f"found mic ({mic and mic['name']}) and virtual mic ({vm and vm['name']})")
    st = await rpc({'cmd': 'set_devices', 'input': mic['index'], 'output': vm['index']}, 'status')
    check(st['running'], 'stream running')

    print('Voices')
    v = await rpc({'cmd': 'get_voices'}, 'voices')
    check(len(v['dsp']) == 49 and len(v['ai']) >= 28, f"{len(v['dsp'])} effects, {len(v['ai'])} characters")
    for vid in ('kawaii', 'robot', 'lyra', 'bypass'):
        r = await rpc({'cmd': 'set_voice', 'id': vid}, 'voice_set')
        await asyncio.sleep(0.6)
        lv = await level()
        check(r['id'] == vid and lv['voice'] == vid and not lv.get('error'), f'set_voice {vid}')
    r = await rpc({'cmd': 'set_custom_chain', 'chain': [{'effect': 'pitch', 'semitones': 4}, {'effect': 'reverb', 'wet': 0.2}]}, 'voice_set')
    check(r['id'] == 'custom', 'custom chain')
    r = await rpc({'cmd': 'set_param', 'effect': 'pitch', 'param': 'semitones', 'value': 6})
    check(r['type'] == 'ok', 'live parameter change')

    print('Toggles')
    r = await rpc({'cmd': 'toggle_bypass'}, 'bypass')
    check(r['value'] is True, 'voice off')
    r = await rpc({'cmd': 'toggle_bypass'}, 'bypass')
    check(r['value'] is False, 'voice on')
    r = await rpc({'cmd': 'toggle_mute'}, 'mute')
    await asyncio.sleep(0.2)
    check(r['value'] is True and (await level())['muted'] is True, 'mute')
    r = await rpc({'cmd': 'toggle_mute'}, 'mute')
    check(r['value'] is False, 'unmute')

    print('Noise removal')
    sr = (await rpc({'cmd': 'get_latency'}, 'latency')).get('sample_rate', 48000)
    # Studio runs RNNoise's own 48 kHz path; other mic rates use Balanced.
    for mode, want in (('low_latency', 5.33), ('balanced', 15.33), ('quality', 30.0 if sr == 48000 else 15.33)):
        await rpc({'cmd': 'set_audio_settings', 'settings': {'noise_reduction_enabled': True, 'noise_reduction_mode': mode}}, 'audio_settings')
        await asyncio.sleep(0.4)
        lat = await rpc({'cmd': 'get_latency'}, 'latency')
        check(abs(lat.get('nr_ms', 0) - want) < 0.5, f"{mode}: +{lat.get('nr_ms')} ms")
    await rpc({'cmd': 'set_audio_settings', 'settings': {'noise_reduction_enabled': False}}, 'audio_settings')

    print('Soundboard')
    lst = (await rpc({'cmd': 'list_sounds'}, 'sounds'))['list']
    check(sum(1 for s in lst if s['builtin']) == 12, '12 built-in pads')
    r = await rpc({'cmd': 'add_sound', 'name': 'Test', 'filename': 'test.wav', 'data': base64.b64encode(wav_bytes()).decode()})
    check(r['type'] == 'sounds' and r.get('added'), 'upload WAV')
    sid = r['added']
    tmp = os.path.join(data_dir, 'x.wav')
    with open(tmp, 'wb') as f:
        f.write(wav_bytes(0.5, freq=880))
    subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', tmp, tmp + '.m4a'], check=True, capture_output=True)
    with open(tmp + '.m4a', 'rb') as f:
        r = await rpc({'cmd': 'add_sound', 'name': 'AAC', 'filename': 'x.m4a', 'data': base64.b64encode(f.read()).decode()})
    check(r['type'] == 'sounds', 'upload M4A/AAC')
    r = await rpc({'cmd': 'add_sound', 'name': 'Bad', 'filename': 'bad.mp3', 'data': base64.b64encode(b'not audio').decode()})
    check(r['type'] == 'sound_error', 'rejects a non-audio file')
    r = await rpc({'cmd': 'update_sound', 'id': sid, 'changes': {'name': 'Renamed', 'volume': 0.5, 'loop': True, 'hotkey': 'Shift+5'}}, 'sounds')
    s = next(x for x in r['list'] if x['id'] == sid)
    check((s['name'], s['volume'], s['loop'], s['hotkey']) == ('Renamed', 0.5, True, 'Shift+5'), 'rename / volume / loop / hotkey')
    await rpc({'cmd': 'play_sound', 'id': sid}, 'sound_playing')
    await asyncio.sleep(1.6)
    check((await level())['sound_playing'], 'looping sound keeps playing')
    await rpc({'cmd': 'stop_sound'}, 'sound_stopped')
    await asyncio.sleep(0.5)
    check(not (await level())['sound_playing'], 'stop')
    await rpc({'cmd': 'play_sound', 'id': 3}, 'sound_playing')
    await asyncio.sleep(0.3)
    check((await level())['sound_playing'], 'built-in pad by index')
    await rpc({'cmd': 'stop_sound'}, 'sound_stopped')
    r = await rpc({'cmd': 'delete_sound', 'id': sid}, 'sounds')
    check(all(x['id'] != sid for x in r['list']), 'delete')

    print('Latency')
    await rpc({'cmd': 'set_voice', 'id': 'kawaii'}, 'voice_set')
    await asyncio.sleep(1.0)
    m = await rpc({'cmd': 'measure_latency'}, 'latency')
    ok = m.get('measured_ms') and abs(m['measured_ms'] - m['total_ms']) < 6
    check(bool(ok), f"loopback {m.get('measured_ms')} ms vs estimate {m.get('total_ms')} ms, {m.get('xruns')} dropouts")
    check(m.get('xruns', 1) == 0, 'no dropouts during the run')

    await rpc({'cmd': 'stop'}, 'stopped')
    await ws.close()


if __name__ == '__main__':
    with tempfile.TemporaryDirectory() as d:
        env = dict(os.environ, AURORA_DATA=d)
        proc = subprocess.Popen([sys.executable, '-u', os.path.join(ROOT, 'python', 'ws_server.py')],
                                cwd=os.path.join(ROOT, 'python'), env=env, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True)
        try:
            asyncio.run(main(d))
        finally:
            proc.terminate()
            log = proc.communicate(timeout=10)[0]
        errors = [line for line in log.splitlines() if 'Traceback' in line or 'Error' in line]
        if errors and os.environ.get('E2E_LOG'):
            print(log)
        check(not errors, f'server log clean{": " + errors[0] if errors else ""}')
    print(f"\n{len(failures)} FAILED" if failures else '\nall passed')
    sys.exit(1 if failures else 0)
