"""
DSP Voice Presets — 50+ presets across categories.
Each preset defines a chain of effects with parameters.
Fifty-odd effect presets grouped by category.
"""

VOICE_PRESETS = {

    # ─── SCI-FI ──────────────────────────────────────────────────────────────
    "robot": {
        "name": "Robot", "category": "Sci-Fi", "emoji": "🤖", "color": "#00d4ff",
        "chain": [
            {"effect": "robot", "carrier_freq": 120, "depth": 0.8},
            {"effect": "eq", "low": 2, "mid": -2, "high": 4},
            {"effect": "reverb", "room": 0.1, "wet": 0.15},
        ]},

    "alien": {
        "name": "Alien", "category": "Sci-Fi", "emoji": "👽", "color": "#7fff00",
        "chain": [
            {"effect": "pitch", "semitones": 4, "formant": 1.4},
            {"effect": "chorus", "rate": 3.5, "depth": 8, "voices": 3},
            {"effect": "robot", "carrier_freq": 200, "depth": 0.4},
        ]},

    "android": {
        "name": "Android", "category": "Sci-Fi", "emoji": "🦾", "color": "#00ffcc",
        "chain": [
            {"effect": "robot", "carrier_freq": 150, "depth": 0.6},
            {"effect": "pitch", "semitones": 2, "formant": 1.0},
            {"effect": "distortion", "drive": 1.5, "bits": 12},
        ]},

    "spacemen": {
        "name": "Spacemen", "category": "Sci-Fi", "emoji": "🚀", "color": "#4488ff",
        "chain": [
            {"effect": "pitch", "semitones": -1, "formant": 0.9},
            {"effect": "reverb", "room": 0.6, "wet": 0.4, "pre_delay_ms": 20},
            {"effect": "chorus", "rate": 0.8, "depth": 12},
        ]},

    "cybertune": {
        "name": "Cybertune", "category": "Sci-Fi", "emoji": "⚡", "color": "#ff00ff",
        "chain": [
            {"effect": "autotune", "key": "C", "speed": 0.05},
            {"effect": "robot", "carrier_freq": 80, "depth": 0.3},
            {"effect": "chorus", "rate": 2.0, "depth": 5},
        ]},

    "ai_assistant": {
        "name": "AI Assistant", "category": "Sci-Fi", "emoji": "🧠", "color": "#00ff88",
        "chain": [
            {"effect": "pitch", "semitones": 1, "formant": 1.05},
            {"effect": "robot", "carrier_freq": 100, "depth": 0.25},
            {"effect": "eq", "low": -2, "mid": 3, "high": 2},
            {"effect": "reverb", "room": 0.05, "wet": 0.08},
        ]},

    # ─── GENDER ──────────────────────────────────────────────────────────────
    "man_to_woman": {
        "name": "Man to Woman", "category": "Gender", "emoji": "👩", "color": "#ff69b4",
        "chain": [
            {"effect": "pitch", "semitones": 5, "formant": 1.35},
            {"effect": "eq", "low": -3, "mid": 1, "high": 2},
        ]},

    "woman_to_man": {
        "name": "Woman to Man", "category": "Gender", "emoji": "🧔", "color": "#4169e1",
        "chain": [
            {"effect": "pitch", "semitones": -5, "formant": 0.72},
            {"effect": "eq", "low": 3, "mid": -1, "high": -2},
        ]},

    "adult_to_child": {
        "name": "Adult to Child", "category": "Gender", "emoji": "🧒", "color": "#ffd700",
        "chain": [
            {"effect": "pitch", "semitones": 7, "formant": 1.55},
            {"effect": "eq", "low": -5, "mid": 2, "high": 3},
        ]},

    "child_to_adult": {
        "name": "Child to Adult", "category": "Gender", "emoji": "🧑", "color": "#cd853f",
        "chain": [
            {"effect": "pitch", "semitones": -7, "formant": 0.65},
            {"effect": "eq", "low": 4, "mid": 0, "high": -2},
        ]},

    # ─── DARK ────────────────────────────────────────────────────────────────
    "dark": {
        "name": "Dark", "category": "Dark", "emoji": "🖤", "color": "#8b0000",
        "chain": [
            {"effect": "pitch", "semitones": -4, "formant": 0.8},
            {"effect": "distortion", "drive": 3},
            {"effect": "reverb", "room": 0.3, "wet": 0.2},
        ]},

    "demon": {
        "name": "Demon", "category": "Dark", "emoji": "👹", "color": "#ff2200",
        "chain": [
            {"effect": "pitch", "semitones": -8, "formant": 0.68},
            {"effect": "distortion", "drive": 6, "bits": 14},
            {"effect": "reverb", "room": 0.7, "wet": 0.5},
            {"effect": "chorus", "rate": 0.3, "depth": 20},
        ]},

    "dark_angel": {
        "name": "Dark Angel", "category": "Dark", "emoji": "😈", "color": "#660066",
        "chain": [
            {"effect": "pitch", "semitones": -6, "formant": 0.75},
            {"effect": "chorus", "rate": 0.5, "depth": 15, "voices": 2},
            {"effect": "reverb", "room": 0.5, "wet": 0.35},
            {"effect": "distortion", "drive": 2},
        ]},

    "zombie": {
        "name": "Zombie", "category": "Dark", "emoji": "🧟", "color": "#556b2f",
        "chain": [
            {"effect": "pitch", "semitones": -3, "formant": 0.82},
            {"effect": "distortion", "drive": 4, "bits": 10},
            {"effect": "chorus", "rate": 1.2, "depth": 10},
        ]},

    "venom": {
        "name": "Venom", "category": "Dark", "emoji": "🕷️", "color": "#2d2d2d",
        "chain": [
            {"effect": "pitch", "semitones": -5, "formant": 0.78},
            {"effect": "robot", "carrier_freq": 60, "depth": 0.5},
            {"effect": "distortion", "drive": 5},
            {"effect": "reverb", "room": 0.4, "wet": 0.3},
        ]},

    "spirit": {
        "name": "Ghost", "category": "Dark", "emoji": "👻", "color": "#e0e0ff",
        "chain": [
            {"effect": "pitch", "semitones": 2, "formant": 1.1},
            {"effect": "reverb", "room": 0.9, "wet": 0.7, "pre_delay_ms": 50},
            {"effect": "chorus", "rate": 0.6, "depth": 18, "voices": 4},
        ]},

    # ─── FUN ─────────────────────────────────────────────────────────────────
    "chipmunk": {
        "name": "Chipmunk", "category": "Fun", "emoji": "🐿️", "color": "#ff8c00",
        "chain": [{"effect": "pitch", "semitones": 9, "formant": 1.0}]},

    "baby": {
        "name": "Baby", "category": "Fun", "emoji": "👶", "color": "#ffb6c1",
        "chain": [
            {"effect": "pitch", "semitones": 10, "formant": 1.6},
            {"effect": "eq", "low": -4, "mid": 3, "high": 1},
        ]},

    "helium": {
        "name": "Helium", "category": "Fun", "emoji": "🎈", "color": "#ff1493",
        "chain": [{"effect": "pitch", "semitones": 12, "formant": 1.0}]},

    "ogre": {
        "name": "Ogre", "category": "Fun", "emoji": "👾", "color": "#228b22",
        "chain": [
            {"effect": "pitch", "semitones": -6, "formant": 0.7},
            {"effect": "distortion", "drive": 3},
            {"effect": "chorus", "rate": 0.8, "depth": 5},
        ]},

    "crazy": {
        "name": "Crazy", "category": "Fun", "emoji": "🤪", "color": "#ff4500",
        "chain": [
            {"effect": "pitch", "semitones": 3, "formant": 1.2},
            {"effect": "vibrato", "rate": 8, "depth": 0.3},
            {"effect": "distortion", "drive": 2.5},
        ]},

    "crazy_clown": {
        "name": "Crazy Clown", "category": "Fun", "emoji": "🤡", "color": "#ff0000",
        "chain": [
            {"effect": "pitch", "semitones": 5, "formant": 1.3},
            {"effect": "vibrato", "rate": 12, "depth": 0.5},
            {"effect": "chorus", "rate": 4, "depth": 6, "voices": 3},
        ]},

    # ─── COMMUNICATION ────────────────────────────────────────────────────────
    "telephone": {
        "name": "Telephone", "category": "Comm", "emoji": "📞", "color": "#808080",
        "chain": [
            {"effect": "eq", "low": -20, "mid": 6, "high": -20,
             "low_freq": 300, "high_freq": 3400},
            {"effect": "distortion", "drive": 1.3},
        ]},

    "cop_radio": {
        "name": "Cop Radio", "category": "Comm", "emoji": "📻", "color": "#4682b4",
        "chain": [
            {"effect": "eq", "low": -15, "mid": 8, "high": -18,
             "low_freq": 400, "high_freq": 3000},
            {"effect": "distortion", "drive": 2.0},
            {"effect": "noise_inject", "color": "white", "level": 0.04},
        ]},

    "walkie_talkie": {
        "name": "Walkie-Talkie", "category": "Comm", "emoji": "🔊", "color": "#556b2f",
        "chain": [
            {"effect": "eq", "low": -18, "mid": 10, "high": -20},
            {"effect": "distortion", "drive": 3},
            {"effect": "noise_inject", "level": 0.06},
            {"effect": "distortion", "drive": 1.5, "bits": 8},
        ]},

    "megaphone": {
        "name": "Megaphone", "category": "Comm", "emoji": "📢", "color": "#ff8c00",
        "chain": [
            {"effect": "eq", "low": -10, "mid": 12, "high": -5},
            {"effect": "distortion", "drive": 4},
            {"effect": "reverb", "room": 0.2, "wet": 0.1},
        ]},

    # ─── ENVIRONMENTS ─────────────────────────────────────────────────────────
    "cave": {
        "name": "Cave", "category": "Environment", "emoji": "🏔️", "color": "#8b7355",
        "chain": [
            {"effect": "pitch", "semitones": -1},
            {"effect": "reverb", "room": 0.95, "wet": 0.75, "pre_delay_ms": 80, "damping": 0.2},
            {"effect": "eq", "low": 4, "mid": 0, "high": -3},
        ]},

    "cathedral": {
        "name": "Cathedral", "category": "Environment", "emoji": "⛪", "color": "#9370db",
        "chain": [
            {"effect": "reverb", "room": 1.0, "wet": 0.85, "pre_delay_ms": 120, "damping": 0.1},
            {"effect": "eq", "low": 2, "mid": -1, "high": -4},
        ]},

    "underwater": {
        "name": "Underwater", "category": "Environment", "emoji": "🌊", "color": "#0080ff",
        "chain": [
            {"effect": "eq", "low": 6, "mid": -8, "high": -20, "high_freq": 800},
            {"effect": "chorus", "rate": 0.5, "depth": 25},
            {"effect": "reverb", "room": 0.4, "wet": 0.3},
        ]},

    # ─── MUSICAL ──────────────────────────────────────────────────────────────
    "magic_chords": {
        "name": "Magic Chords", "category": "Musical", "emoji": "✨", "color": "#ffd700",
        "chain": [
            {"effect": "harmony", "intervals": [4, 7], "wet": 0.4},
            {"effect": "reverb", "room": 0.4, "wet": 0.3},
        ]},

    "autotune": {
        "name": "Autotune", "category": "Musical", "emoji": "🎵", "color": "#00fa9a",
        "chain": [{"effect": "autotune", "key": "C_major", "speed": 0.03}]},

    "vibrato_voice": {
        "name": "Vibrato", "category": "Musical", "emoji": "🎶", "color": "#ff69b4",
        "chain": [{"effect": "vibrato", "rate": 5, "depth": 0.25}]},

    "double_voice": {
        "name": "Double Voice", "category": "Musical", "emoji": "👥", "color": "#40e0d0",
        "chain": [{"effect": "harmony", "intervals": [0], "detune_cents": 15, "wet": 0.5}]},

    "octaver": {
        "name": "Octaver", "category": "Musical", "emoji": "🎸", "color": "#ff6347",
        "chain": [{"effect": "harmony", "intervals": [-12], "wet": 0.5}]},

    "wah_wah": {
        "name": "Wah-Wah", "category": "Musical", "emoji": "🎺", "color": "#ff8c00",
        "chain": [{"effect": "wah", "rate": 2, "depth": 0.8}]},

    # ─── CHARACTER ────────────────────────────────────────────────────────────
    "deep_voice": {
        "name": "Deep Voice", "category": "Character", "emoji": "🦍", "color": "#8b4513",
        "chain": [
            {"effect": "pitch", "semitones": -7, "formant": 0.65},
            {"effect": "eq", "low": 5, "high": -3},
        ]},

    "storyteller": {
        "name": "Storyteller", "category": "Character", "emoji": "📖", "color": "#deb887",
        "chain": [
            {"effect": "pitch", "semitones": -2, "formant": 0.9},
            {"effect": "eq", "low": 2, "mid": 1},
            {"effect": "reverb", "room": 0.25, "wet": 0.15},
        ]},

    "whisper": {
        "name": "Whisper", "category": "Character", "emoji": "🤫", "color": "#c0c0c0",
        "chain": [
            {"effect": "whisper", "breathiness": 0.8},
            {"effect": "eq", "low": -6, "high": 3},
        ]},

    "speech_jammer": {
        "name": "Speech Jammer", "category": "Character", "emoji": "🔀", "color": "#ff4500",
        "chain": [{"effect": "delay", "delay_ms": 200, "feedback": 0.0, "wet": 0.6}]},

    "8bit": {
        "name": "8-Bit", "category": "Retro", "emoji": "🎮", "color": "#00ff00",
        "chain": [
            {"effect": "distortion", "bits": 4, "downsample": 6},
            {"effect": "pitch", "semitones": 1},
        ]},

    # ─── GAMING ───────────────────────────────────────────────────────────────
    "cs_ct": {
        "name": "CS Counter-Terrorist", "category": "Gaming", "emoji": "🎯", "color": "#1e90ff",
        "chain": [
            {"effect": "eq", "low": -8, "mid": 6, "high": -8,
             "low_freq": 350, "high_freq": 3200},
            {"effect": "distortion", "drive": 1.8},
            {"effect": "noise_inject", "level": 0.03},
        ]},

    "cs_t": {
        "name": "CS Terrorist", "category": "Gaming", "emoji": "💣", "color": "#ff4500",
        "chain": [
            {"effect": "eq", "low": -10, "mid": 8, "high": -12},
            {"effect": "distortion", "drive": 2.5},
            {"effect": "noise_inject", "level": 0.05},
        ]},

    "announcer": {
        "name": "Game Announcer", "category": "Gaming", "emoji": "🏆", "color": "#ffd700",
        "chain": [
            {"effect": "pitch", "semitones": -2, "formant": 0.88},
            {"effect": "eq", "low": -3, "mid": 4, "high": 2},
            {"effect": "reverb", "room": 0.35, "wet": 0.2},
            {"effect": "distortion", "drive": 1.4},
        ]},

    "streamer": {
        "name": "Streamer", "category": "Gaming", "emoji": "🎮", "color": "#9146ff",
        "chain": [
            {"effect": "eq", "low": -2, "mid": 2, "high": 1},
            {"effect": "reverb", "room": 0.1, "wet": 0.05},
        ]},

    # ─── HORROR ───────────────────────────────────────────────────────────────
    "possessed": {
        "name": "Possessed", "category": "Horror", "emoji": "💀", "color": "#4b0082",
        "chain": [
            {"effect": "pitch", "semitones": -3, "formant": 0.85},
            {"effect": "chorus", "rate": 0.2, "depth": 30, "voices": 3},
            {"effect": "reverb", "room": 0.8, "wet": 0.6},
            {"effect": "distortion", "drive": 2},
        ]},

    "exorcist": {
        "name": "Exorcist", "category": "Horror", "emoji": "🕯️", "color": "#8b0000",
        "chain": [
            {"effect": "pitch", "semitones": -12, "formant": 0.6},
            {"effect": "distortion", "drive": 5, "bits": 12},
            {"effect": "reverb", "room": 0.9, "wet": 0.7},
            {"effect": "chorus", "rate": 0.1, "depth": 40, "voices": 4},
        ]},

    # ─── NATURE ───────────────────────────────────────────────────────────────
    "forest": {
        "name": "Forest Spirit", "category": "Nature", "emoji": "🌲", "color": "#228b22",
        "chain": [
            {"effect": "chorus", "rate": 0.4, "depth": 20, "voices": 4},
            {"effect": "reverb", "room": 0.7, "wet": 0.5},
            {"effect": "eq", "low": 3, "mid": -2, "high": -4},
        ]},

    "wind": {
        "name": "Wind", "category": "Nature", "emoji": "🌬️", "color": "#87ceeb",
        "chain": [
            {"effect": "whisper", "breathiness": 0.6},
            {"effect": "chorus", "rate": 0.3, "depth": 30},
            {"effect": "reverb", "room": 0.6, "wet": 0.4},
        ]},

    # ─── BYPASS (passthrough) ─────────────────────────────────────────────────
    "bypass": {
        "name": "Original Voice", "category": "None", "emoji": "🎙️", "color": "#666680",
        "chain": []},
}
