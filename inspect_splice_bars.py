#!/usr/bin/env python3
import wave
import struct

def find_beats_in_range(wav_file, start_sec, end_sec, target_bpm=107.0):
    spb = 60.0 / target_bpm
    with wave.open(wav_file, 'rb') as w:
        sr = w.getframerate()
        n_channels = w.getnchannels()
        start_frame = int(start_sec * sr)
        end_frame = int(end_sec * sr)
        w.setpos(start_frame)
        frames_to_read = end_frame - start_frame
        raw = w.readframes(frames_to_read)
        
        count = len(raw) // 2
        samples = struct.unpack(f"{count}h", raw)
        
        # 10ms energy windows
        win = int(sr * 0.01)
        energies = []
        for i in range(0, count, win * n_channels):
            chunk = samples[i : i + win * n_channels]
            if not chunk: break
            rms = (sum(s*s for s in chunk) / len(chunk)) ** 0.5
            energies.append(rms)
            
        return sr, energies

def main():
    offset = 58.08
    dur_p = 41.00
    bpm = 107.0
    spb = 60.0 / bpm
    bar_sec = spb * 4.0 # 4 beats per bar = 2.243s per bar
    
    print(f"BPM: {bpm} | Seconds Per Beat: {spb:.3f}s | Bar Duration (4 beats): {bar_sec:.3f}s")
    print(f"Performance Start aligns to Official: {offset:.2f}s")
    
    # Calculate bars in performance track:
    # 41.0s / 2.243s = ~18.28 bars
    print("\n--- Bars towards the end of performance video ---")
    for bar in range(14, 20):
        t_perf = bar * bar_sec
        t_off = offset + t_perf
        if t_perf <= dur_p + 2.0:
            print(f"Bar {bar}: Perf Time = {t_perf:.2f}s | Official Time = {t_off:.2f}s (Min:Sec: {int(t_off//60)}:{t_off%60:04.1f})")

if __name__ == '__main__':
    main()
