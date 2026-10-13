"""Upload a few synthesised demo sounds to a running engine (for README media).
Run against an engine started with a throwaway AURORA_DATA."""
import asyncio
import base64
import json
import struct

import numpy as np
import websockets

SR = 44100


def wav(x):
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2').tobytes()
    return (b'RIFF' + struct.pack('<I', 36 + len(pcm)) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 1, SR, SR * 2, 2, 16)
            + b'data' + struct.pack('<I', len(pcm)) + pcm)


def tone(f, d, decay=3.0):
    t = np.arange(int(SR * d)) / SR
    return np.sin(2 * np.pi * f * t) * np.exp(-t * decay)


def sounds():
    rng = np.random.default_rng(3)
    rim = np.concatenate([tone(220, .12, 30) + rng.normal(0, .3, int(SR * .12)) * np.exp(-np.arange(int(SR * .12)) / 600),
                          np.zeros(int(SR * .08)), tone(200, .12, 30), np.zeros(int(SR * .1)),
                          rng.normal(0, .25, int(SR * .6)) * np.exp(-np.arange(int(SR * .6)) / 9000)])
    fan = np.concatenate([tone(f, .18, 4) * .6 for f in (523, 659, 784)] + [tone(1047, .7, 2) * .7])
    t = np.arange(int(SR * .8)) / SR
    boing = np.sin(2 * np.pi * np.cumsum(180 + 120 * np.sin(2 * np.pi * 9 * t)) / SR) * np.exp(-t * 3) * .7
    laser = np.sin(2 * np.pi * np.cumsum(np.linspace(1800, 300, int(SR * .35))) / SR) * .5
    return [('Rimshot', rim, None), ('Victory', fan, 'Shift+1'), ('Boing', boing, 'Shift+2'), ('Laser', laser, None)]


async def main():
    ws = await websockets.connect('ws://localhost:9001', max_size=None)
    for name, x, hk in sounds():
        await ws.send(json.dumps({'cmd': 'add_sound', 'name': name, 'filename': f'{name}.wav', 'data': base64.b64encode(wav(x)).decode()}))
        while True:
            m = json.loads(await ws.recv())
            if m.get('type') == 'sounds' and m.get('added'):
                sid = m['added']
                break
        if hk:
            await ws.send(json.dumps({'cmd': 'update_sound', 'id': sid, 'changes': {'hotkey': hk}}))
    await ws.close()
    print('demo sounds uploaded')


asyncio.run(main())
