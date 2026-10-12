import numpy as np


class BaseEffect:
    """Base class for all DSP effects."""

    def apply(self, chunk: np.ndarray) -> np.ndarray:
        """Process a chunk of audio. Returns processed audio."""
        return chunk

    def set_param(self, key: str, value):
        """Dynamically set a parameter."""
        setattr(self, key, value)
