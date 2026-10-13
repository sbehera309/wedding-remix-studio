# 🎵 Wedding Remix Studio (Sangeet & Performance Mix Lab)

An intelligent audio alignment, seamless choreography extension, and wedding dance mashup studio.

## 🌟 What This Solves

When preparing for wedding dances, couples and bridal parties frequently face two big hurdles:

1. **The Choreo Video Extension Problem (The "Performance Restorer")**:
   - You practiced your dance to a remixed performance video (from Instagram, YouTube, or rehearsal video), but the video cuts off early, skips a bridge, or fades out abruptly.
   - If you replace the whole song with the studio version, your practiced choreography breaks.
   - If you manually stitch the original song at the end, the rhythm hiccups, kicks clash, and dancers stumble.
   - **Solution**: Wedding Remix Studio extracts the rhythm and harmonic chroma fingerprints of both the choreo edit and the full original track, computes cross-correlation alignment, locks onto the exact downbeat (Beat 1 of the musical bar), and executes a seamless, phase-locked transition that appends the missing grand finale and ending!

2. **The 2-Song Wedding Dance Medley Problem**:
   - You want to mix Song 1 (e.g., groom/bridal party entrance) into Song 2 (e.g., high-energy family celebration or couple dance).
   - **Solution**: The engine analyzes the BPM tempo, computes Camelot harmonic keys (e.g., 8A to 8B), detects optimal exit points (chorus drops, 8-bar / 16-bar phrase ends), and applies professional DJ transition curves (like low-frequency **Bass-Swap EQ**) to avoid muddy kick drum clashes.

---

## 🚀 Quick Start (Zero External Dependencies)

Wedding Remix Studio is built to run immediately using Node.js standard libraries and browser-native Web Audio API. No `npm install` needed!

```bash
cd /Users/sandeepbehera/.gemini/antigravity/scratch/wedding-remix-studio
node server.js
```

Then open your browser to:
👉 **[http://localhost:3000](http://localhost:3000)**

---

## 🎧 Key Features

- **🎯 1-Click Interactive Demos**:
  - Test the choreo extension and medley modes immediately with built-in procedural wedding audio stems (Dhol & Synth Remix + Full Wedding Anthem with extended outro).
- **📹 Direct Rehearsal Video & Audio Drag-and-Drop**:
  - Drop `.mp4`, `.mov`, `.mp3`, `.wav`, or `.m4a` files directly onto either deck.
  - Video files have their audio tracks extracted and decoded natively right inside the browser!
- **🌐 YouTube & Spotify URL Resolver**:
  - Paste YouTube links or Spotify track links.
  - Optional integration with `yt-dlp` (`brew install yt-dlp ffmpeg`) for direct YouTube audio ripping.
- **⚡ "Audition Transition" Instant Preview**:
  - Don't waste time listening to 2 minutes of music just to check a transition! Click **"Audition Transition Only (8s)"** to instantly hear 4 seconds before the splice and 4 seconds after.
- **🎛️ Dual-Mode Transition Engine**:
  - **Downbeat Phase-Lock Splice**: Clean zero-crossing transition on the 1-beat.
  - **8-Bar DJ Bass Swap**: High-pass filter on Track 1, low-pass sweep into Track 2.
  - **Drop Cut on Beat 1**: High-energy dance drop.
  - **Smooth Equal-Power Crossfade**: Ambient fade.
- **💾 Master Mix WAV Export**:
  - High-resolution 44.1kHz / 48kHz stereo `.wav` file rendered via hardware-accelerated `OfflineAudioContext`.
- **📋 Choreography Cue Sheet Generator**:
  - Formatted rehearsal timestamps and 8-count beat markers ready to share with the bridal party and wedding DJ.

---

## 🛠️ Optional: Enable Direct YouTube Downloads

To enable direct YouTube audio downloading from URLs on your Mac:

```bash
brew install yt-dlp ffmpeg
```

If you do not have `yt-dlp` installed, you can simply **drag and drop** audio or video files into the application decks!
