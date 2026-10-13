#!/usr/bin/env python3
import wave
import struct
import math

def read_wav_envelope(filename, frame_duration_sec=0.02):
    with wave.open(filename, 'rb') as w:
        sample_rate = w.getframerate()
        n_channels = w.getnchannels()
        n_frames = w.getnframes()
        duration = n_frames / float(sample_rate)
        
        # Read in blocks
        hop_size = int(sample_rate * frame_duration_sec)
        num_hops = n_frames // hop_size
        
        envelope = []
        timestamps = []
        
        for hop_idx in range(num_hops):
            raw_bytes = w.readframes(hop_size)
            if not raw_bytes:
                break
            # Unpack 16-bit PCM
            count = len(raw_bytes) // 2
            samples = struct.unpack(f"{count}h", raw_bytes)
            
            # If stereo, average left and right
            sum_sq = 0.0
            if n_channels == 2:
                for i in range(0, count, 2):
                    val = (samples[i] + samples[i+1]) / (2.0 * 32768.0)
                    sum_sq += val * val
                rms = math.sqrt(sum_sq / (count // 2))
            else:
                for i in range(count):
                    val = samples[i] / 32768.0
                    sum_sq += val * val
                rms = math.sqrt(sum_sq / count)
                
            envelope.append(rms)
            timestamps.append(hop_idx * frame_duration_sec)
            
        return envelope, timestamps, sample_rate, duration

def estimate_bpm_and_beats(envelope, hop_duration=0.02):
    # Envelope difference
    diff = [0.0]
    for i in range(1, len(envelope)):
        d = envelope[i] - envelope[i-1]
        diff.append(d if d > 0 else 0)
        
    # Autocorrelation for BPM (between 90 and 150 BPM)
    min_lag = int((60.0 / 150.0) / hop_duration)
    max_lag = int((60.0 / 90.0) / hop_duration)
    
    best_lag = min_lag
    max_corr = -1.0
    for lag in range(min_lag, max_lag):
        corr = sum(diff[i] * diff[i + lag] for i in range(len(diff) - lag))
        if corr > max_corr:
            max_corr = corr
            best_lag = lag
            
    seconds_per_beat = best_lag * hop_duration
    bpm = round(60.0 / seconds_per_beat)
    return bpm, seconds_per_beat, diff

def find_alignment(env_perf, env_off, hop_duration=0.02):
    # Normalize envelopes
    mean_p = sum(env_perf) / len(env_perf)
    norm_p = [x - mean_p for x in env_perf]
    var_p = math.sqrt(sum(x*x for x in norm_p)) or 1.0
    norm_p = [x / var_p for x in norm_p]
    
    len_p = len(norm_p)
    len_o = len(env_off)
    
    # Slide performance window across official track
    best_shift = 0
    max_score = -1e9
    scores = []
    
    for shift in range(0, len_o - len_p + 1):
        window_o = env_off[shift : shift + len_p]
        mean_o = sum(window_o) / len(window_o)
        norm_o = [x - mean_o for x in window_o]
        var_o = math.sqrt(sum(x*x for x in norm_o)) or 1.0
        norm_o = [x / var_o for x in norm_o]
        
        score = sum(norm_p[i] * norm_o[i] for i in range(len_p))
        scores.append((shift * hop_duration, score))
        if score > max_score:
            max_score = score
            best_shift = shift
            
    best_offset_sec = best_shift * hop_duration
    return best_offset_sec, max_score, scores

def main():
    print("Analyzing performance audio...")
    env_perf, times_perf, sr_p, dur_p = read_wav_envelope("performance_audio.wav")
    bpm_p, spb_p, onsets_p = estimate_bpm_and_beats(env_perf)
    print(f"Performance Duration: {dur_p:.2f}s | Estimated BPM: {bpm_p}")
    
    print("Analyzing official Kala Chashma track...")
    env_off, times_off, sr_o, dur_o = read_wav_envelope("kala_chashma_official.wav")
    bpm_o, spb_o, onsets_o = estimate_bpm_and_beats(env_off)
    print(f"Official Duration: {dur_o:.2f}s | Estimated BPM: {bpm_o}")
    
    print("Computing cross-correlation alignment...")
    best_offset, max_score, scores = find_alignment(env_perf, env_off)
    print(f"\n>>> Best Alignment Offset: {best_offset:.2f}s in official track!")
    print(f">>> Performance video (0.0s to {dur_p:.2f}s) corresponds to:")
    print(f"    Official Track: {best_offset:.2f}s to {best_offset + dur_p:.2f}s")
    
    remaining_official = dur_o - (best_offset + dur_p)
    print(f">>> Missing Outro in Official Track: {remaining_official:.2f}s ({best_offset + dur_p:.2f}s to {dur_o:.2f}s)")
    
    # Find candidate downbeats near the end of performance (between 34s and 40s)
    print("\n--- Candidate Splice Points ---")
    # Kala Chashma tempo is ~106 BPM (or double-time 212)
    # Let's inspect the energy envelope of the performance track in the last 10 seconds
    last_10s_hops = int(10.0 / 0.02)
    print("Tail energy in performance track:")
    for t in [32.0, 34.0, 36.0, 38.0, 39.0, 40.0, 40.5]:
        hop_idx = int(t / 0.02)
        if hop_idx < len(env_perf):
            rms = env_perf[hop_idx]
            print(f"  At {t:.1f}s: RMS = {rms:.4f}")

if __name__ == '__main__':
    main()
