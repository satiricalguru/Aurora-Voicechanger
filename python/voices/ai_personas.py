"""
AI Voice Persona Definitions — 30 personas across ANIME / REALISTIC / DARK / CREATURE categories.
Each persona defines acoustic parameters for the AIVoicePersona DSP engine.
All characters are original. These are DSP approximations until neural voice models land.
"""

AI_PERSONAS = {

    # ── ANIME ─────────────────────────────────────────────────────────────────
    "akatsume": {
        "name": "Akuma Rei", "category": "AI Voices", "tag": "ANIME",
        "description": "Dark demon anime girl — menacing villain", "color": "#cc00ff",
        "target_f0_mean": 155, "target_f0_std": 25,
        "formant_profile": [620, 1100, 2500, 3400],
        "breathiness": 0.15, "roughness": 0.25, "brightness": -0.2,
        "resonance_shift": 0.92, "vibrato_rate": 4.5, "vibrato_depth": 15,
        "pitch_chain": [
            {"effect": "reverb", "room": 0.25, "wet": 0.15},
            {"effect": "distortion", "drive": 1.3}
        ]},

    "genki": {
        "name": "Hina", "category": "AI Voices", "tag": "ANIME",
        "description": "Energetic anime girl — bright and cheerful", "color": "#00aaff",
        "target_f0_mean": 240, "target_f0_std": 45,
        "formant_profile": [850, 2100, 2900, 3700],
        "breathiness": 0.1, "roughness": 0.0, "brightness": 0.4,
        "resonance_shift": 1.12, "vibrato_rate": 5.5, "vibrato_depth": 20,
        "pitch_chain": [
            {"effect": "chorus", "rate": 2.0, "depth": 3, "voices": 2},
            {"effect": "eq", "low": -1, "mid": 0, "high": 1}
        ]},

    "kawaii": {
        "name": "Mochi", "category": "AI Voices", "tag": "ANIME",
        "description": "Super cute cat-girl — soft kawaii voice", "color": "#ff69b4",
        "target_f0_mean": 265, "target_f0_std": 40,
        "formant_profile": [900, 2200, 3100, 3800],
        "breathiness": 0.3, "roughness": 0.0, "brightness": 0.5,
        "resonance_shift": 1.18, "vibrato_rate": 6.0, "vibrato_depth": 18,
        "pitch_chain": [
            {"effect": "eq", "low": -2, "mid": 1, "high": 2}
        ]},

    "yoen": {
        "name": "Yoru", "category": "AI Voices", "tag": "ANIME",
        "description": "Dark anime girl — mysterious, cool, emotionless", "color": "#6600cc",
        "target_f0_mean": 175, "target_f0_std": 15,
        "formant_profile": [600, 1050, 2400, 3200],
        "breathiness": 0.05, "roughness": 0.08, "brightness": -0.15,
        "resonance_shift": 0.95, "vibrato_rate": 0, "vibrato_depth": 0,
        "pitch_chain": [
            {"effect": "reverb", "room": 0.2, "wet": 0.1}
        ]},

    "lovely": {
        "name": "Stella", "category": "AI Voices", "tag": "ANIME",
        "description": "Magical girl — sweet idol voice", "color": "#ff99cc",
        "target_f0_mean": 255, "target_f0_std": 50,
        "formant_profile": [880, 2150, 3000, 3750],
        "breathiness": 0.25, "roughness": 0.0, "brightness": 0.45,
        "resonance_shift": 1.15, "vibrato_rate": 5.8, "vibrato_depth": 22,
        "pitch_chain": [
            {"effect": "harmony", "intervals": [12], "wet": 0.15},
            {"effect": "reverb", "room": 0.3, "wet": 0.2}
        ]},

    "akari": {
        "name": "Luna", "category": "AI Voices", "tag": "ANIME",
        "description": "Vtuber-style anime girl — clean streamer voice", "color": "#00ddff",
        "target_f0_mean": 230, "target_f0_std": 35,
        "formant_profile": [820, 2050, 2850, 3650],
        "breathiness": 0.12, "roughness": 0.0, "brightness": 0.3,
        "resonance_shift": 1.1, "vibrato_rate": 5.0, "vibrato_depth": 16,
        "pitch_chain": [
            {"effect": "eq", "low": -2, "mid": 1, "high": 2}
        ]},

    "kidol": {
        "name": "Nova", "category": "AI Voices", "tag": "ANIME",
        "description": "K-pop idol — polished, bright, high-energy", "color": "#00ffcc",
        "target_f0_mean": 245, "target_f0_std": 55,
        "formant_profile": [870, 2100, 2950, 3720],
        "breathiness": 0.2, "roughness": 0.0, "brightness": 0.5,
        "resonance_shift": 1.13, "vibrato_rate": 6.2, "vibrato_depth": 25,
        "pitch_chain": [
            {"effect": "autotune", "key": "C_major", "speed": 0.04},
            {"effect": "reverb", "room": 0.3, "wet": 0.2}
        ]},

    "cartoon_girl": {
        "name": "Pippa", "category": "AI Voices", "tag": "ANIME",
        "description": "Classic cartoon — exaggerated, bouncy", "color": "#ffcc00",
        "target_f0_mean": 270, "target_f0_std": 65,
        "formant_profile": [920, 2200, 3100, 3820],
        "breathiness": 0.1, "roughness": 0.05, "brightness": 0.5,
        "resonance_shift": 1.18, "vibrato_rate": 7.0, "vibrato_depth": 30,
        "pitch_chain": [
            {"effect": "distortion", "drive": 1.2},
            {"effect": "eq", "high": 3}
        ]},

    # ── REALISTIC ─────────────────────────────────────────────────────────────
    "corinne": {
        "name": "Claire", "category": "AI Voices", "tag": "REALISTIC",
        "description": "Calm, confident adult woman — natural accent", "color": "#c8a882",
        "target_f0_mean": 195, "target_f0_std": 30,
        "formant_profile": [760, 1680, 2600, 3400],
        "breathiness": 0.08, "roughness": 0.05, "brightness": 0.0,
        "resonance_shift": 1.0, "vibrato_rate": 4.0, "vibrato_depth": 10,
        "pitch_chain": []},

    "jennifer": {
        "name": "Emma", "category": "AI Voices", "tag": "REALISTIC",
        "description": "Warm, friendly young woman", "color": "#ff8844",
        "target_f0_mean": 210, "target_f0_std": 38,
        "formant_profile": [800, 1750, 2650, 3450],
        "breathiness": 0.12, "roughness": 0.02, "brightness": 0.15,
        "resonance_shift": 1.05, "vibrato_rate": 4.5, "vibrato_depth": 12,
        "pitch_chain": []},

    "vicky": {
        "name": "Scarlett", "category": "AI Voices", "tag": "REALISTIC",
        "description": "Dramatic woman — theatrical, wide dynamic range", "color": "#dd4444",
        "target_f0_mean": 185, "target_f0_std": 60,
        "formant_profile": [720, 1620, 2550, 3350],
        "breathiness": 0.18, "roughness": 0.12, "brightness": 0.1,
        "resonance_shift": 0.98, "vibrato_rate": 5.0, "vibrato_depth": 28,
        "pitch_chain": [
            {"effect": "reverb", "room": 0.15, "wet": 0.1}
        ]},

    "haley": {
        "name": "Maddie", "category": "AI Voices", "tag": "REALISTIC",
        "description": "Cheerful girl — bright, friendly, light", "color": "#ff6699",
        "target_f0_mean": 220, "target_f0_std": 42,
        "formant_profile": [830, 1800, 2700, 3480],
        "breathiness": 0.15, "roughness": 0.0, "brightness": 0.25,
        "resonance_shift": 1.07, "vibrato_rate": 4.8, "vibrato_depth": 14,
        "pitch_chain": []},

    "claudia": {
        "name": "Margot", "category": "AI Voices", "tag": "REALISTIC",
        "description": "Mature, sophisticated woman — 40s, elegant", "color": "#9988bb",
        "target_f0_mean": 175, "target_f0_std": 28,
        "formant_profile": [690, 1580, 2480, 3280],
        "breathiness": 0.06, "roughness": 0.08, "brightness": -0.05,
        "resonance_shift": 0.96, "vibrato_rate": 4.2, "vibrato_depth": 10,
        "pitch_chain": []},

    "blake": {
        "name": "Riley", "category": "AI Voices", "tag": "REALISTIC",
        "description": "Cool, edgy — alt girl, slightly raspy", "color": "#cc55ff",
        "target_f0_mean": 185, "target_f0_std": 35,
        "formant_profile": [730, 1640, 2550, 3350],
        "breathiness": 0.2, "roughness": 0.18, "brightness": 0.05,
        "resonance_shift": 0.97, "vibrato_rate": 3.5, "vibrato_depth": 8,
        "pitch_chain": []},

    "alice": {
        "name": "Director Hale", "category": "AI Voices", "tag": "REALISTIC",
        "description": "Stern, commanding — authoritative, no-nonsense", "color": "#445588",
        "target_f0_mean": 165, "target_f0_std": 20,
        "formant_profile": [650, 1520, 2450, 3250],
        "breathiness": 0.02, "roughness": 0.1, "brightness": -0.1,
        "resonance_shift": 0.93, "vibrato_rate": 3.0, "vibrato_depth": 6,
        "pitch_chain": []},

    "agatha": {
        "name": "Grandma Rose", "category": "AI Voices", "tag": "REALISTIC",
        "description": "Sweet grandmother — warm, elderly, kind", "color": "#ddccaa",
        "target_f0_mean": 165, "target_f0_std": 40,
        "formant_profile": [670, 1540, 2460, 3260],
        "breathiness": 0.35, "roughness": 0.25, "brightness": -0.2,
        "resonance_shift": 0.94, "vibrato_rate": 6.5, "vibrato_depth": 35,
        "pitch_chain": [
            {"effect": "reverb", "room": 0.2, "wet": 0.1}
        ]},

    # ── DARK ──────────────────────────────────────────────────────────────────
    "creepy_girl": {
        "name": "Hollow", "category": "AI Voices", "tag": "DARK",
        "description": "Horror child — uncanny valley, unsettling", "color": "#880000",
        "target_f0_mean": 280, "target_f0_std": 20,
        "formant_profile": [950, 2250, 3200, 3900],
        "breathiness": 0.4, "roughness": 0.3, "brightness": -0.1,
        "resonance_shift": 1.2, "vibrato_rate": 0, "vibrato_depth": 0,
        "pitch_chain": [
            {"effect": "reverb", "room": 0.5, "wet": 0.3},
            {"effect": "distortion", "drive": 1.2}
        ]},

    "runic_sorceress": {
        "name": "Runeweaver", "category": "AI Voices", "tag": "DARK",
        "description": "Dark fantasy sorceress — ancient, mystical", "color": "#550088",
        "target_f0_mean": 155, "target_f0_std": 35,
        "formant_profile": [600, 1050, 2400, 3180],
        "breathiness": 0.2, "roughness": 0.2, "brightness": -0.25,
        "resonance_shift": 0.9, "vibrato_rate": 4.5, "vibrato_depth": 20,
        "pitch_chain": [
            {"effect": "reverb", "room": 0.7, "wet": 0.45},
            {"effect": "chorus", "rate": 0.6, "depth": 15, "voices": 3}
        ]},

    "ping": {
        "name": "Shade", "category": "AI Voices", "tag": "DARK",
        "description": "Mysterious hooded girl — quiet, haunted", "color": "#334455",
        "target_f0_mean": 170, "target_f0_std": 25,
        "formant_profile": [650, 1500, 2430, 3200],
        "breathiness": 0.5, "roughness": 0.15, "brightness": -0.2,
        "resonance_shift": 0.96, "vibrato_rate": 3.5, "vibrato_depth": 12,
        "pitch_chain": [
            {"effect": "reverb", "room": 0.4, "wet": 0.25}
        ]},

    "fox": {
        "name": "Kitsune", "category": "AI Voices", "tag": "DARK",
        "description": "Cunning, sly — low, smoky character", "color": "#ff6600",
        "target_f0_mean": 165, "target_f0_std": 38,
        "formant_profile": [640, 1480, 2420, 3180],
        "breathiness": 0.22, "roughness": 0.15, "brightness": 0.05,
        "resonance_shift": 0.95, "vibrato_rate": 4.0, "vibrato_depth": 14,
        "pitch_chain": []},

    "shiva": {
        "name": "Valka", "category": "AI Voices", "tag": "DARK",
        "description": "Fierce warrior — intense, battle-hardened", "color": "#884400",
        "target_f0_mean": 160, "target_f0_std": 45,
        "formant_profile": [620, 1430, 2380, 3150],
        "breathiness": 0.08, "roughness": 0.3, "brightness": 0.1,
        "resonance_shift": 0.91, "vibrato_rate": 4.8, "vibrato_depth": 18,
        "pitch_chain": [
            {"effect": "distortion", "drive": 1.8}
        ]},

    "angry_girl": {
        "name": "Fury", "category": "AI Voices", "tag": "DARK",
        "description": "Rage mode — furious, unhinged", "color": "#ff2200",
        "target_f0_mean": 220, "target_f0_std": 70,
        "formant_profile": [840, 1900, 2750, 3520],
        "breathiness": 0.05, "roughness": 0.4, "brightness": 0.35,
        "resonance_shift": 1.06, "vibrato_rate": 8.0, "vibrato_depth": 35,
        "pitch_chain": [
            {"effect": "distortion", "drive": 2.0},
            {"effect": "eq", "mid": 4, "high": 2}
        ]},

    "field": {
        "name": "Sentinel", "category": "AI Voices", "tag": "DARK",
        "description": "Military operative — masked, tactical command", "color": "#336644",
        "target_f0_mean": 155, "target_f0_std": 18,
        "formant_profile": [610, 1080, 2380, 3200],
        "breathiness": 0.05, "roughness": 0.2, "brightness": -0.1,
        "resonance_shift": 0.90, "vibrato_rate": 2.0, "vibrato_depth": 5,
        "pitch_chain": [
            {"effect": "eq", "low": -5, "mid": 5, "high": -8,
             "low_freq": 350, "high_freq": 3200},
            {"effect": "distortion", "drive": 1.4}
        ]},

    # ── CREATURE ──────────────────────────────────────────────────────────────
    "mother_entity": {
        "name": "The Matriarch", "category": "AI Voices", "tag": "CREATURE",
        "description": "Ancient cosmic horror — alien intelligence", "color": "#003322",
        "target_f0_mean": 130, "target_f0_std": 60,
        "formant_profile": [500, 950, 2200, 3000],
        "breathiness": 0.3, "roughness": 0.4, "brightness": -0.4,
        "resonance_shift": 0.82, "vibrato_rate": 2.5, "vibrato_depth": 40,
        "pitch_chain": [
            {"effect": "harmony", "intervals": [-12, -7], "wet": 0.35},
            {"effect": "reverb", "room": 0.9, "wet": 0.6},
            {"effect": "distortion", "drive": 2.5}
        ]},

    "aetherian": {
        "name": "Xyra", "category": "AI Voices", "tag": "CREATURE",
        "description": "Cybernetic alien warrior — metallic, otherworldly", "color": "#00ff88",
        "target_f0_mean": 175, "target_f0_std": 30,
        "formant_profile": [580, 1020, 2350, 3250],
        "breathiness": 0.05, "roughness": 0.35, "brightness": 0.2,
        "resonance_shift": 0.88, "vibrato_rate": 3.0, "vibrato_depth": 8,
        "pitch_chain": [
            {"effect": "robot", "carrier_freq": 140, "depth": 0.3},
            {"effect": "distortion", "drive": 1.6}
        ]},

    "farty_kawaii": {
        "name": "Gobbie", "category": "AI Voices", "tag": "CREATURE",
        "description": "Chaotic goblin girl — cute gone wrong", "color": "#88ff44",
        "target_f0_mean": 300, "target_f0_std": 80,
        "formant_profile": [1000, 2400, 3300, 4000],
        "breathiness": 0.3, "roughness": 0.35, "brightness": 0.6,
        "resonance_shift": 1.25, "vibrato_rate": 9.0, "vibrato_depth": 40,
        "pitch_chain": [
            {"effect": "distortion", "drive": 2.0, "bits": 12},
            {"effect": "chorus", "rate": 5, "depth": 8, "voices": 3}
        ]},

    "guardian_doll": {
        "name": "Porcelain", "category": "AI Voices", "tag": "CREATURE",
        "description": "Creepy porcelain doll — eerily perfect", "color": "#eeddcc",
        "target_f0_mean": 290, "target_f0_std": 10,
        "formant_profile": [980, 2300, 3250, 3950],
        "breathiness": 0.2, "roughness": 0.05, "brightness": 0.1,
        "resonance_shift": 1.22, "vibrato_rate": 0, "vibrato_depth": 0,
        "pitch_chain": [
            {"effect": "reverb", "room": 0.5, "wet": 0.35}
        ]},

    "the_ringer": {
        "name": "Skullhorn", "category": "AI Voices", "tag": "CREATURE",
        "description": "Beast mask — animalistic, primal, monstrous", "color": "#664400",
        "target_f0_mean": 140, "target_f0_std": 50,
        "formant_profile": [520, 900, 2100, 2900],
        "breathiness": 0.15, "roughness": 0.45, "brightness": -0.3,
        "resonance_shift": 0.82, "vibrato_rate": 3.0, "vibrato_depth": 20,
        "pitch_chain": [
            {"effect": "distortion", "drive": 3.5},
            {"effect": "harmony", "intervals": [-7], "wet": 0.25}
        ]},
}
