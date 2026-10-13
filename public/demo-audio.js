/**
 * Demo Audio Generator for Wedding Remix Studio
 * Generates realistic wedding dance audio stems in-browser using Web Audio synthesis:
 * 1. Choreo Performance Edit (remixed wedding dance version that ends early at ~28s)
 * 2. Full Original Track (contains the matching verse and the extended outro / grand finale)
 * 3. Second Song for Medley (high-energy celebration track for 2-song transitions)
 */

class DemoAudioGenerator {
  constructor(audioContext) {
    this.ctx = audioContext || new (window.AudioContext || window.webkitAudioContext)();
  }

  /**
   * Helper to create a synthesized AudioBuffer
   */
  async createBuffer(durationSeconds) {
    const sampleRate = this.ctx.sampleRate;
    const length = Math.floor(sampleRate * durationSeconds);
    return this.ctx.createBuffer(2, length, sampleRate);
  }

  /**
   * Generates Track 1: "Choreo Edit (Dhol & Synth Remix)"
   * Tempo: 128 BPM. Plays Intro -> Build -> Remix Chorus, then abruptly stops at ~26s
   */
  async generateChoreoEdit() {
    const bpm = 128;
    const duration = 26.5; // stops abruptly where performance video cuts off
    const offlineCtx = new OfflineAudioContext(2, Math.floor(44100 * duration), 44100);
    const secondsPerBeat = 60 / bpm;
    const totalBeats = Math.floor(duration / secondsPerBeat);

    // Chords in key of D minor: Dm (D, F, A), Bb (Bb, D, F), C (C, E, G), A7 (A, C#, E)
    const chordProgression = [
      [146.83, 174.61, 220.00], // Dm
      [116.54, 146.83, 174.61], // Bb
      [130.81, 164.81, 196.00], // C
      [110.00, 138.59, 164.81]  // A
    ];

    // 1. Kick & Dhol drum pattern
    for (let beat = 0; beat < totalBeats; beat++) {
      const time = beat * secondsPerBeat;
      const isBarDownbeat = beat % 4 === 0;

      // Kick drum
      this._synthesizeKick(offlineCtx, time, isBarDownbeat ? 0.9 : 0.7);

      // Snare / Dhol Slap on beats 2 and 4
      if (beat % 2 === 1) {
        this._synthesizeSnare(offlineCtx, time, 0.65);
      }

      // Dhol bass resonance and swing 16ths
      this._synthesizeDholSub(offlineCtx, time, isBarDownbeat ? 1.0 : 0.5);
      this._synthesizeHiHat(offlineCtx, time + secondsPerBeat * 0.5, 0.25);
      if (beat % 4 >= 2) {
        this._synthesizeHiHat(offlineCtx, time + secondsPerBeat * 0.25, 0.15);
        this._synthesizeHiHat(offlineCtx, time + secondsPerBeat * 0.75, 0.18);
      }
    }

    // 2. Synth bassline & Chords
    for (let beat = 0; beat < totalBeats; beat += 2) {
      const time = beat * secondsPerBeat;
      const chordIdx = Math.floor(beat / 4) % chordProgression.length;
      const chord = chordProgression[chordIdx];

      // Bass note
      this._synthesizeBassNote(offlineCtx, time, chord[0] * 0.5, secondsPerBeat * 1.8, 0.4);

      // Pad chord
      this._synthesizePad(offlineCtx, time, chord, secondsPerBeat * 1.9, 0.25);
    }

    // 3. Catchy lead melody (Wedding dance hook)
    const melodyNotes = [
      293.66, 329.63, 349.23, 392.00, 440.00, 392.00, 349.23, 329.63,
      293.66, 349.23, 440.00, 523.25, 440.00, 392.00, 349.23, 293.66
    ];
    for (let beat = 8; beat < totalBeats; beat++) {
      const time = beat * secondsPerBeat;
      const note = melodyNotes[beat % melodyNotes.length];
      this._synthesizeLead(offlineCtx, time, note, secondsPerBeat * 0.8, 0.35);
    }

    return await offlineCtx.startRendering();
  }

  /**
   * Generates Track 2: "Original Full Wedding Song"
   * Tempo: 128 BPM. Same musical progression, but extends all the way to 52s
   * with the grand finale / extended outro that was cut from the choreo!
   */
  async generateFullOriginal() {
    const bpm = 128;
    const duration = 52.0; // Full length containing missing ending!
    const offlineCtx = new OfflineAudioContext(2, Math.floor(44100 * duration), 44100);
    const secondsPerBeat = 60 / bpm;
    const totalBeats = Math.floor(duration / secondsPerBeat);

    const chordProgression = [
      [146.83, 174.61, 220.00], // Dm
      [116.54, 146.83, 174.61], // Bb
      [130.81, 164.81, 196.00], // C
      [110.00, 138.59, 164.81]  // A
    ];

    for (let beat = 0; beat < totalBeats; beat++) {
      const time = beat * secondsPerBeat;
      const isBarDownbeat = beat % 4 === 0;

      // Acoustic & warm drums
      this._synthesizeKick(offlineCtx, time, isBarDownbeat ? 0.8 : 0.6);
      if (beat % 2 === 1) {
        this._synthesizeSnare(offlineCtx, time, 0.55);
      }
      this._synthesizeHiHat(offlineCtx, time + secondsPerBeat * 0.5, 0.2);

      // Section from beat 56 (26s) onwards is the missing grand finale!
      if (beat >= 56) {
        // Grand finale brass & energy
        this._synthesizeDholSub(offlineCtx, time, 0.85);
        this._synthesizeHiHat(offlineCtx, time + secondsPerBeat * 0.25, 0.25);
        this._synthesizeHiHat(offlineCtx, time + secondsPerBeat * 0.75, 0.25);
      }
    }

    // Harmony chords
    for (let beat = 0; beat < totalBeats; beat += 2) {
      const time = beat * secondsPerBeat;
      const chordIdx = Math.floor(beat / 4) % chordProgression.length;
      const chord = chordProgression[chordIdx];

      this._synthesizeBassNote(offlineCtx, time, chord[0] * 0.5, secondsPerBeat * 1.8, 0.35);
      this._synthesizePad(offlineCtx, time, chord, secondsPerBeat * 1.9, 0.22);
    }

    // Lead & Anthem melody extending through the finale
    const melodyNotes = [
      293.66, 329.63, 349.23, 392.00, 440.00, 392.00, 349.23, 329.63,
      293.66, 349.23, 440.00, 523.25, 440.00, 392.00, 349.23, 293.66,
      587.33, 523.25, 440.00, 392.00, 440.00, 523.25, 587.33, 659.25
    ];

    for (let beat = 4; beat < totalBeats; beat++) {
      const time = beat * secondsPerBeat;
      const note = melodyNotes[beat % melodyNotes.length];
      const intensity = beat >= 56 ? 0.45 : 0.3; // grander finish
      this._synthesizeLead(offlineCtx, time, note, secondsPerBeat * 0.75, intensity);
    }

    return await offlineCtx.startRendering();
  }

  /**
   * Generates Track B for 2-Song Medley: "Bhangra / Celebration Beat"
   * Tempo: 132 BPM, Key of G minor. High-energy celebratory track for second half of dance.
   */
  async generateCelebrationSong() {
    const bpm = 132;
    const duration = 38.0;
    const offlineCtx = new OfflineAudioContext(2, Math.floor(44100 * duration), 44100);
    const secondsPerBeat = 60 / bpm;
    const totalBeats = Math.floor(duration / secondsPerBeat);

    const chordProgression = [
      [196.00, 233.08, 293.66], // Gm
      [174.61, 220.00, 261.63], // F
      [155.56, 196.00, 233.08], // Eb
      [220.00, 277.18, 329.63]  // D7
    ];

    for (let beat = 0; beat < totalBeats; beat++) {
      const time = beat * secondsPerBeat;
      this._synthesizeKick(offlineCtx, time, 0.95);
      if (beat % 2 === 1) {
        this._synthesizeSnare(offlineCtx, time, 0.7);
      }
      this._synthesizeDholSub(offlineCtx, time, 0.8);
      this._synthesizeHiHat(offlineCtx, time + secondsPerBeat * 0.5, 0.3);
      this._synthesizeHiHat(offlineCtx, time + secondsPerBeat * 0.25, 0.2);
    }

    for (let beat = 0; beat < totalBeats; beat += 2) {
      const time = beat * secondsPerBeat;
      const chordIdx = Math.floor(beat / 4) % chordProgression.length;
      const chord = chordProgression[chordIdx];
      this._synthesizeBassNote(offlineCtx, time, chord[0] * 0.5, secondsPerBeat * 1.8, 0.45);
      this._synthesizePad(offlineCtx, time, chord, secondsPerBeat * 1.9, 0.3);
    }

    const festiveMelody = [
      392.00, 440.00, 466.16, 523.25, 587.33, 523.25, 466.16, 440.00,
      392.00, 466.16, 587.33, 698.46, 587.33, 523.25, 466.16, 392.00
    ];

    for (let beat = 0; beat < totalBeats; beat++) {
      const time = beat * secondsPerBeat;
      const note = festiveMelody[beat % festiveMelody.length];
      this._synthesizeLead(offlineCtx, time, note, secondsPerBeat * 0.7, 0.38);
    }

    return await offlineCtx.startRendering();
  }

  // --- Synthesis Helpers ---

  _synthesizeKick(ctx, time, gainLevel = 0.8) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';

    osc.frequency.setValueAtTime(140, time);
    osc.frequency.exponentialRampToValueAtTime(38, time + 0.12);

    gain.gain.setValueAtTime(gainLevel, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.28);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.3);
  }

  _synthesizeDholSub(ctx, time, gainLevel = 0.6) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';

    osc.frequency.setValueAtTime(90, time);
    osc.frequency.exponentialRampToValueAtTime(55, time + 0.2);

    gain.gain.setValueAtTime(gainLevel * 0.7, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.36);
  }

  _synthesizeSnare(ctx, time, gainLevel = 0.6) {
    // Noise burst
    const bufferSize = Math.floor(ctx.sampleRate * 0.2);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.05));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1200;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainLevel, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.2);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(time);
    noise.stop(time + 0.21);
  }

  _synthesizeHiHat(ctx, time, gainLevel = 0.2) {
    const bufferSize = Math.floor(ctx.sampleRate * 0.05);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.015));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7000;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainLevel, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(time);
    noise.stop(time + 0.06);
  }

  _synthesizeBassNote(ctx, time, freq, duration, gainLevel = 0.4) {
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(320, time);
    filter.Q.value = 3;

    gain.gain.setValueAtTime(gainLevel, time);
    gain.gain.setValueAtTime(gainLevel * 0.9, time + duration * 0.7);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + duration);
  }

  _synthesizePad(ctx, time, chordFreqs, duration, gainLevel = 0.2) {
    chordFreqs.forEach(freq => {
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, time);

      filter.type = 'lowpass';
      filter.frequency.value = 1500;

      gain.gain.setValueAtTime(0.001, time);
      gain.gain.linearRampToValueAtTime(gainLevel / chordFreqs.length, time + 0.1);
      gain.gain.setValueAtTime(gainLevel / chordFreqs.length, time + duration - 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start(time);
      osc.stop(time + duration);
    });
  }

  _synthesizeLead(ctx, time, freq, duration, gainLevel = 0.3) {
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(freq * 1.5, time);
    filter.Q.value = 2;

    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(gainLevel, time + 0.02);
    gain.gain.setValueAtTime(gainLevel * 0.8, time + duration * 0.6);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + duration);
  }
}

// Make accessible to window
if (typeof window !== 'undefined') {
  window.DemoAudioGenerator = DemoAudioGenerator;
}
if (typeof module !== 'undefined') {
  module.exports = { DemoAudioGenerator };
}
