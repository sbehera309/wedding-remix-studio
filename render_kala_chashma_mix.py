#!/usr/bin/env python3
"""
Renders the seamless extended mix of:
Track 1: Performance video audio (F416B608-0F5B-4279-BAA1-B58617745CEF.MOV)
Track 2: Official Kala Chashma track (youtube.com/watch?v=k4yXQkG2s1E)
"""

import wave
import struct
import math

def read_wav(filename):
    with wave.open(filename, 'rb') as w:
        sr = w.getframerate()
        n_channels = w.getnchannels()
        n_frames = w.getnframes()
        raw = w.readframes(n_frames)
        total_samples = n_frames * n_channels
        samples = struct.unpack(f"{total_samples}h", raw)
        return sr, n_channels, samples, n_frames

def write_wav(filename, sr, n_channels, samples):
    with wave.open(filename, 'wb') as w:
        w.setnchannels(n_channels)
        w.setsampwidth(2)
        w.setframerate(sr)
        raw = struct.pack(f"{len(samples)}h", *samples)
        w.writeframes(raw)

def main():
    print("Reading performance audio...")
    sr_p, ch_p, samples_p, frames_p = read_wav("performance_audio.wav")
    print(f"Performance: {frames_p / sr_p:.2f}s, {ch_p}ch, {sr_p}Hz")

    print("Reading official Kala Chashma audio...")
    sr_o, ch_o, samples_o, frames_o = read_wav("kala_chashma_official.wav")
    print(f"Official: {frames_o / sr_o:.2f}s, {ch_o}ch, {sr_o}Hz")

    # Splice configuration
    # Splice Point 1 (Bar 17): 38.13s in Performance -> 96.21s in Official
    splice_p_sec = 38.13
    splice_o_sec = 96.21
    crossfade_sec = 0.35  # 350ms seamless crossfade

    # Calculate frame positions
    splice_p_frame = int(splice_p_sec * sr_p)
    splice_o_frame = int(splice_o_sec * sr_o)
    crossfade_frames = int(crossfade_sec * sr_p)

    # Calculate RMS of both around splice point for gain matching
    check_frames = int(2.0 * sr_p)
    rms_p = math.sqrt(sum(samples_p[i]**2 for i in range((splice_p_frame - check_frames)*ch_p, splice_p_frame*ch_p)) / (check_frames * ch_p))
    rms_o = math.sqrt(sum(samples_o[i]**2 for i in range(splice_o_frame*ch_o, (splice_o_frame + check_frames)*ch_o)) / (check_frames * ch_o))
    gain_match = (rms_p / rms_o) if rms_o > 0 else 1.0
    # Soft clamp gain match to avoid distortion
    gain_match = min(1.3, max(0.7, gain_match))
    print(f"Volume matching gain: {gain_match:.2f}")

    output_samples = []

    # 1. Performance section before crossfade
    pre_crossfade_frames = splice_p_frame - crossfade_frames
    for i in range(pre_crossfade_frames * ch_p):
        output_samples.append(samples_p[i])

    # 2. Crossfade region
    for f in range(crossfade_frames):
        alpha = f / float(crossfade_frames) # 0 to 1
        # Equal power crossfade curves
        gain_a = math.cos(alpha * 0.5 * math.pi)
        gain_b = math.sin(alpha * 0.5 * math.pi) * gain_match

        p_idx = (pre_crossfade_frames + f) * ch_p
        o_idx = (splice_o_frame - crossfade_frames + f) * ch_o

        for c in range(ch_p):
            sample_a = samples_p[p_idx + c] if (p_idx + c) < len(samples_p) else 0
            sample_b = samples_o[o_idx + c] if (o_idx + c) < len(samples_o) else 0
            blended = int(sample_a * gain_a + sample_b * gain_b)
            # Clip
            blended = max(-32768, min(32767, blended))
            output_samples.append(blended)

    # 3. Official track continuation from splice point to end
    remaining_official_frames = frames_o - splice_o_frame
    for f in range(remaining_official_frames):
        o_idx = (splice_o_frame + f) * ch_o
        for c in range(ch_o):
            sample = int(samples_o[o_idx + c] * gain_match)
            sample = max(-32768, min(32767, sample))
            output_samples.append(sample)

    output_wav = "Kala_Chashma_Performance_Extended_Mix.wav"
    print(f"Writing {output_wav}...")
    write_wav(output_wav, sr_p, ch_p, output_samples)
    total_duration = len(output_samples) / (ch_p * sr_p)
    print(f"Successfully generated mix! Total Duration: {total_duration:.2f}s ({int(total_duration//60)}m {total_duration%60:.1f}s)")

if __name__ == '__main__':
    main()
