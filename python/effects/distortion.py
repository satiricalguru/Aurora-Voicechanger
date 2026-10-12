"""
Distortion / Bitcrusher / Whisper Effects
Drive, bitcrusher and whisper effects.
"""
import numpy as np
from .base import BaseEffect


class DistortionEffect(BaseEffect):
    """
    Soft-clip waveshaper + optional bitcrusher + decimator.
    drive:          input gain before clipping (1–20)
    bits:           bit depth for quantization (4–16; 16 = off)
    downsample:     decimation factor (1 = off, 8 = heavy lo-fi)
    """

    def __init__(self,
                 drive: float = 3.0,
                 bits: int = 16,
                 downsample: int = 1):
        self.drive = drive
        self.bits = bits
        self.downsample = max(1, int(downsample))
        self._last_sample = 0.0
        self._ds_counter = 0

    def apply(self, chunk: np.ndarray) -> np.ndarray:
        n = len(chunk)
        out = chunk.copy()

        # Decimator (sample-rate reduction)
        if self.downsample > 1:
            first_grab = (self.downsample - self._ds_counter) % self.downsample
            idx_map = np.empty(n, dtype=np.int32)
            if first_grab > 0:
                idx_map[:first_grab] = -1
                idx_map[first_grab:] = first_grab + ((np.arange(first_grab, n) - first_grab) // self.downsample) * self.downsample
            else:
                idx_map[:] = (np.arange(n) // self.downsample) * self.downsample

            out = np.where(idx_map == -1, self._last_sample, out[np.maximum(0, idx_map)])

            if n > 0:
                last_grab = (n - 1 - first_grab) // self.downsample * self.downsample + first_grab
                if last_grab < n and last_grab >= 0:
                    self._last_sample = float(chunk[last_grab])
            self._ds_counter = (self._ds_counter + n) % self.downsample

        # Soft-clip waveshaper: tanh(drive * x) / tanh(drive)
        driven = out * self.drive
        out = np.tanh(driven) / np.tanh(min(self.drive, 20.0))

        # Bitcrusher
        if self.bits < 16:
            levels = 2.0 ** (self.bits - 1)
            out = np.round(out * levels) / levels

        return out.astype(np.float32)


class WhisperEffect(BaseEffect):
    """
    Whisper effect: spectral noise shaping + breathiness injection.
    Replaces voiced excitation with shaped noise (unvoiced approximation).
    breathiness: 0 = normal voice, 1 = full whisper
    """

    def __init__(self, breathiness: float = 0.7):
        self.breathiness = breathiness
        # FIX: HOP must match AudioEngine.CHUNK (256) so the ring-buffer slice
        # self._in_buf[-H:] = chunk[:H] never sees a shape mismatch.
        self._FFT = 2048
        self._HOP = 256   # was 512 — must equal engine CHUNK
        self._window = np.hanning(self._FFT).astype(np.float32)
        self._in_buf = np.zeros(self._FFT, dtype=np.float32)
        self._out_buf = np.zeros(self._FFT + self._HOP, dtype=np.float32)

    def apply(self, chunk: np.ndarray) -> np.ndarray:
        H = self._HOP
        N = self._FFT

        self._in_buf[:-H] = self._in_buf[H:]
        self._in_buf[-H:] = chunk[:H]

        frame = self._in_buf * self._window
        spec = np.fft.rfft(frame, n=N)
        mag = np.abs(spec)

        # Replace phase with random noise phase (whisper)
        noise_phase = np.random.uniform(-np.pi, np.pi, len(mag))
        voiced_phase = np.angle(spec)
        blended_phase = voiced_phase * (1.0 - self.breathiness) + noise_phase * self.breathiness

        new_spec = mag * np.exp(1j * blended_phase)
        out_frame = np.fft.irfft(new_spec, n=N).real.astype(np.float32) * self._window

        ola_gain = np.sum(self._window ** 2) / H
        self._out_buf[:N] += out_frame
        output = self._out_buf[:H].copy()
        self._out_buf[:-H] = self._out_buf[H:]
        self._out_buf[-H:] = 0.0

        if ola_gain > 0:
            output /= ola_gain

        return output
