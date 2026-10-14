/*
 * Aurora Core: native real-time voice engine for macOS.
 *
 * Plain C ABI so Python (ctypes), Electron (N-API) or Swift can drive it.
 * Every call here runs on a control thread. The audio threads never block on
 * anything these calls touch: chains, parameters and settings reach the
 * real-time side through atomics and lock-free queues.
 *
 * JSON in, JSON out. Strings returned through (buf, cap) are NUL-terminated;
 * the return value is the full length needed, so a caller can retry with a
 * larger buffer.
 */
#ifndef AURORA_CORE_H
#define AURORA_CORE_H

#ifdef __cplusplus
extern "C" {
#endif

#define AC_API __attribute__((visibility("default")))

/* Version string, e.g. "0.1.0". */
AC_API const char* ac_version(void);

/* Last error message from a failed call ("" when none). */
AC_API const char* ac_last_error(void);

/* JSON array of audio devices:
 * [{"index":0,"uid":"...","name":"...","inputs":1,"outputs":0,
 *   "sample_rate":48000,"is_virtual":false,"is_default_input":true,...}] */
AC_API int ac_list_devices(char* buf, int cap);

/* Start the voice path: mic `in_uid` -> chain -> `out_uid` (virtual mic).
 * buffer_frames: requested HAL I/O buffer (e.g. 64, 128, 256); clamped to
 * what each device allows. sample_rate: preferred rate (48000); devices that
 * cannot switch keep their own rate and the engine resamples.
 * Returns 0 on success. */
AC_API int ac_start(const char* in_uid, const char* out_uid, int buffer_frames, double sample_rate);
AC_API void ac_stop(void);
AC_API int ac_is_running(void);

/* "Hear yourself" on a third device (headphones). */
AC_API int ac_start_monitor(const char* out_uid);
AC_API void ac_stop_monitor(void);
AC_API int ac_is_monitoring(void);

/* Replace the voice: {"chain":[{"effect":"pitch","semitones":5,...},...],
 *                     "persona":{...optional character params...}}
 * The new chain is built here, then crossfaded in on the audio thread. */
AC_API int ac_set_chain(const char* json);

/* Live parameter tweak on the first node named `effect`. */
AC_API int ac_set_param(const char* effect, const char* param, double value);

/* Engine settings: vol_mic, vol_voice, vol_sound, vol_monitor, bypass,
 * gate_enabled, gate_db, hpf_enabled, limiter_enabled,
 * nr_mode (0 off, 1 low latency, 2 balanced, 3 quality), nr_strength (0..1),
 * mute (silences the voice; soundboard still plays),
 * monitor_voice (1: monitor = voice + sounds; 0: sounds only, for pad preview). */
AC_API int ac_set_setting(const char* key, double value);

/* Mix mono float samples (at `sample_rate`) into the voice path. */
AC_API int ac_queue_sound(const float* data, int frames, double sample_rate);
/* Same, but replaces whatever is playing. */
AC_API int ac_play_sound(const float* data, int frames, double sample_rate);
AC_API void ac_clear_sounds(void);

/* Recorder and instant replay. Sources: 0 = the voice the call hears
 * (voice + soundboard, post-limiter), 1 = Mac audio (every other app, through
 * a Core Audio process tap; macOS 14.2+, asks for System Audio Recording
 * permission). Each source keeps the last ~85 s in memory.
 * Files are 16-bit mono WAV at the source's rate. */
/* Start/stop the Mac audio tap. Needs System Audio Recording permission:
 * when it hasn't been decided yet this shows the macOS prompt and fails with
 * "waiting for permission" (call again once stats' capture.system_permission
 * is 0); "permission denied" when the user said no. */
AC_API int ac_capture_system(int on);
AC_API int ac_record_start(int source, const char* wav_path);
AC_API double ac_record_stop(void);                      /* seconds recorded, -1 if idle */
/* Last `seconds` of a source to a WAV file; returns the seconds written or -1. */
AC_API double ac_replay_save(int source, double seconds, const char* wav_path);

/* Live stats: levels, latency breakdown, DSP load, xruns, spectrum,
 * capture state ("capture": recording, record_seconds, voice_seconds, ...). */
AC_API int ac_get_stats(char* buf, int cap);

/* Loopback measurement through the output device's own input side (works on
 * BlackHole-style loopback devices). Blocks up to ~1 s. Writes stats JSON. */
AC_API int ac_measure_loopback(char* buf, int cap);

/* Offline render for tests and benchmarks: runs `chain_json` over `input`
 * in blocks of `block` frames. Returns the chain's reported latency in
 * samples, or -1 on error. */
AC_API int ac_render_offline(const char* chain_json, const float* input, float* output,
                             int frames, double sample_rate, int block);

#ifdef __cplusplus
}
#endif

#endif /* AURORA_CORE_H */
