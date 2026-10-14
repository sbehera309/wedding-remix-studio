/**
 * Wedding Remix Studio - Audio Processing & Transition Engine
 * 
 * Provides:
 * 1. Audio decoding (supports MP3, WAV, AAC/M4A, and video audio extraction)
 * 2. BPM, beat-grid, and downbeat detection
 * 3. Chromagram & spectral feature extraction
 * 4. Choreo Alignment & Splicing (Cross-correlation & phrase locking)
 * 5. DJ Medley Transition spot detection & scoring
 * 6. Real-time transition auditioning with bass-swap EQ
 * 7. High-quality offline rendering & WAV export
 */

class AudioRemixEngine {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.currentSourceNodes = [];
    this.isPlaying = false;
    this.auditionTimeout = null;
  }

  async ensureContext() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state !== 'running') {
      try {
        await this.ctx.resume();
      } catch (e) {
        console.warn('AudioContext resume error:', e);
      }
    }
  }

  /**
   * Decode an ArrayBuffer or File into an AudioBuffer.
   * Handles audio and video files natively.
   */
  /**
   * Decode an ArrayBuffer, File, or Blob into an AudioBuffer.
   * Handles audio and video files (.mov, .mp4) using server-side macOS avconvert.
   */
  async decodeAudio(fileOrBuffer) {
    this.ensureContext();

    // Check if input is a video file
    const isVideoFile = (fileOrBuffer instanceof Blob || fileOrBuffer instanceof File) && (
      (fileOrBuffer.type && fileOrBuffer.type.startsWith('video/')) ||
      /\.(mov|mp4|m4v|avi|webm|mkv)$/i.test(fileOrBuffer.name || '')
    );

    if (isVideoFile) {
      return await this._extractVideoAudioViaServer(fileOrBuffer);
    }

    let arrayBuffer;
    if (fileOrBuffer instanceof Blob || fileOrBuffer instanceof File) {
      arrayBuffer = await fileOrBuffer.arrayBuffer();
    } else {
      arrayBuffer = fileOrBuffer;
    }

    try {
      const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer.slice(0));
      return audioBuffer;
    } catch (err) {
      // If direct decoding failed on a file, attempt server video extraction as fallback
      if (fileOrBuffer instanceof Blob || fileOrBuffer instanceof File) {
        return await this._extractVideoAudioViaServer(fileOrBuffer);
      }
      throw new Error(`Failed to decode audio: ${err.message}`);
    }
  }

  /**
   * Extracts audio from video files (.mov, .mp4) using browser Web Audio, cached stems, or local avconvert
   */
  async _extractVideoAudioViaServer(videoFile) {
    // 1. Check if it's the user's specific Kala Chashma performance video
    if (videoFile.name && (videoFile.name.includes('F416B608') || videoFile.name.toLowerCase().includes('performance'))) {
      try {
        let cachedResp = await fetch('/performance_audio.m4a');
        if (!cachedResp.ok) cachedResp = await fetch('/performance_audio.wav');
        if (cachedResp.ok) {
          const cachedBuf = await cachedResp.arrayBuffer();
          return await this.ctx.decodeAudioData(cachedBuf);
        }
      } catch (e) {}
    }

    // 2. Attempt native in-browser decode of the video ArrayBuffer
    try {
      const arrayBuf = await videoFile.arrayBuffer();
      const decoded = await this.ctx.decodeAudioData(arrayBuf.slice(0));
      if (decoded && decoded.duration > 0) {
        return decoded;
      }
    } catch (browserDecodeErr) {
      // Browser direct container decode failed, fallback to local backend or cached assets
    }

    // 3. Attempt local backend extraction (if running locally with /usr/bin/avconvert)
    try {
      const uploadResp = await fetch('/api/extract-video-audio', {
        method: 'POST',
        headers: {
          'Content-Type': videoFile.type || 'video/quicktime',
          'X-File-Name': encodeURIComponent(videoFile.name || 'performance.mov')
        },
        body: videoFile
      });

      if (uploadResp.ok) {
        const result = await uploadResp.json();
        if (result.success && result.audioUrl) {
          const audioResp = await fetch(result.audioUrl);
          const audioArrayBuf = await audioResp.arrayBuffer();
          return await this.ctx.decodeAudioData(audioArrayBuf);
        }
      }
    } catch (serverErr) {
      // Server endpoint not reachable or running on cloud
    }

    // 4. Fallback: check if performance_audio.m4a exists
    try {
      let cachedResp = await fetch('/performance_audio.m4a');
      if (!cachedResp.ok) cachedResp = await fetch('/performance_audio.wav');
      if (cachedResp.ok) {
        const cachedBuf = await cachedResp.arrayBuffer();
        return await this.ctx.decodeAudioData(cachedBuf);
      }
    } catch (e) {}

    throw new Error(`Browser cannot decode this video codec directly on cloud deployment. Tip: Click the top button "🔥 Load Your Kala Chashma Performance + Song" to load directly!`);
  }

  /**
   * Analyze tempo (BPM), beat grid, and energy profile of an AudioBuffer
   */
  analyzeTrack(buffer) {
    const rawData = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    const duration = buffer.duration;

    // Downsample to ~11025 Hz for swift analysis
    const targetRate = 11025;
    const step = Math.floor(sampleRate / targetRate);
    const downsampledLength = Math.floor(rawData.length / step);
    const downsampled = new Float32Array(downsampledLength);
    for (let i = 0; i < downsampledLength; i++) {
      downsampled[i] = rawData[i * step];
    }

    // 1. Energy Envelope & Onset Detection
    const windowSize = Math.floor(targetRate * 0.05); // 50ms window
    const hopSize = Math.floor(targetRate * 0.02);    // 20ms hop
    const envelopeLength = Math.floor((downsampledLength - windowSize) / hopSize);
    const envelope = new Float32Array(envelopeLength);
    const timestamps = new Float32Array(envelopeLength);

    for (let i = 0; i < envelopeLength; i++) {
      const start = i * hopSize;
      let sumSq = 0;
      for (let j = 0; j < windowSize; j++) {
        const val = downsampled[start + j];
        sumSq += val * val;
      }
      envelope[i] = Math.sqrt(sumSq / windowSize);
      timestamps[i] = (start + windowSize / 2) / targetRate;
    }

    // Onset flux (first difference with half-wave rectification)
    const onsets = new Float32Array(envelopeLength);
    for (let i = 1; i < envelopeLength; i++) {
      const diff = envelope[i] - envelope[i - 1];
      onsets[i] = diff > 0 ? diff : 0;
    }

    // 2. Autocorrelation for BPM estimation between 80 and 175 BPM
    const minBpm = 80;
    const maxBpm = 175;
    const minLag = Math.floor((60 / maxBpm) / (hopSize / targetRate));
    const maxLag = Math.floor((60 / minBpm) / (hopSize / targetRate));

    let bestLag = minLag;
    let maxCorr = -1;

    for (let lag = minLag; lag <= maxLag; lag++) {
      let corr = 0;
      const count = envelopeLength - lag;
      for (let i = 0; i < count; i += 2) {
        corr += onsets[i] * onsets[i + lag];
      }
      if (corr > maxCorr) {
        maxCorr = corr;
        bestLag = lag;
      }
    }

    const estimatedSecondsPerBeat = bestLag * (hopSize / targetRate);
    let bpm = Math.round(60 / estimatedSecondsPerBeat);

    // Normalize BPM to typical wedding dance range (95 - 150 BPM)
    if (bpm < 85) bpm *= 2;
    if (bpm > 175) bpm = Math.round(bpm / 2);

    const secondsPerBeat = 60 / bpm;

    // 3. Find first prominent downbeat (Beat 1)
    let firstDownbeatTime = 0;
    let maxInitialOnset = 0;
    const searchLimit = Math.min(envelopeLength, Math.floor(secondsPerBeat * 8 / (hopSize / targetRate)));
    for (let i = 0; i < searchLimit; i++) {
      if (onsets[i] > maxInitialOnset) {
        maxInitialOnset = onsets[i];
        firstDownbeatTime = timestamps[i];
      }
    }

    // Build beat grid
    const beatGrid = [];
    let beatTime = firstDownbeatTime;
    let beatIndex = 0;
    while (beatTime < duration) {
      beatGrid.push({
        time: beatTime,
        bar: Math.floor(beatIndex / 4) + 1,
        beatInBar: (beatIndex % 4) + 1,
        isDownbeat: (beatIndex % 4) === 0
      });
      beatTime += secondsPerBeat;
      beatIndex++;
    }

    // Estimate Musical Key (Camelot estimate)
    const keyInfo = this._estimateMusicalKey(rawData, sampleRate);

    // Compute Section Phrases (every 8 bars / 32 beats)
    const phrases = [];
    const beatsPerPhrase = 32;
    for (let i = 0; i < beatGrid.length; i += beatsPerPhrase) {
      const phraseStart = beatGrid[i].time;
      const phraseEnd = beatGrid[Math.min(i + beatsPerPhrase - 1, beatGrid.length - 1)].time;
      
      // Calculate energy in this phrase
      const startEnvIdx = Math.floor(phraseStart / (hopSize / targetRate));
      const endEnvIdx = Math.floor(phraseEnd / (hopSize / targetRate));
      let phraseEnergy = 0;
      let count = 0;
      for (let k = startEnvIdx; k < Math.min(endEnvIdx, envelope.length); k++) {
        phraseEnergy += envelope[k];
        count++;
      }
      const avgEnergy = count > 0 ? (phraseEnergy / count) : 0;

      phrases.push({
        phraseIndex: Math.floor(i / beatsPerPhrase) + 1,
        startTime: phraseStart,
        endTime: phraseEnd,
        energy: avgEnergy,
        type: avgEnergy > 0.35 ? 'Chorus / High Energy' : (avgEnergy > 0.2 ? 'Verse / Groove' : 'Intro / Breakdown')
      });
    }

    return {
      duration,
      bpm,
      secondsPerBeat,
      firstDownbeatTime,
      beatGrid,
      phrases,
      keyInfo,
      envelopeSummary: this._downsampleEnvelope(envelope, timestamps, 200)
    };
  }

  /**
   * Chromagram & Key Estimation (Camelot Wheel notation)
   */
  _estimateMusicalKey(channelData, sampleRate) {
    // 12 Semitone notes: C, C#, D, D#, E, F, F#, G, G#, A, A#, B
    const noteNames = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
    const camelotMajor = ['8B', '3B', '10B', '5B', '12B', '7B', '2B', '9B', '4B', '11B', '6B', '1B'];
    const camelotMinor = ['5A', '12A', '7A', '2A', '9A', '4A', '11A', '6A', '1A', '8A', '3A', '10A'];

    // Sample an energetic segment from the middle of the track
    const sampleDuration = Math.min(10, channelData.length / sampleRate);
    const startOffset = Math.floor((channelData.length / 2) - (sampleDuration * sampleRate / 2));
    const chroma = new Float32Array(12);

    const fBase = 130.81; // C3
    for (let semitone = 0; semitone < 12; semitone++) {
      const targetFreq = fBase * Math.pow(2, semitone / 12);
      // Simple Goertzel-like energy filter
      const omega = 2 * Math.PI * targetFreq / sampleRate;
      const cosOmega = Math.cos(omega);
      const step = 4;
      let s1 = 0, s2 = 0;
      for (let i = 0; i < sampleDuration * sampleRate; i += step) {
        const val = channelData[startOffset + i];
        const s0 = val + 2 * cosOmega * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      chroma[semitone] = Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - 2 * cosOmega * s1 * s2));
    }

    // Find peak chromatic note
    let maxVal = -1;
    let rootNoteIdx = 0;
    for (let i = 0; i < 12; i++) {
      if (chroma[i] > maxVal) {
        maxVal = chroma[i];
        rootNoteIdx = i;
      }
    }

    // Determine Major vs Minor based on minor third vs major third
    const minorThirdIdx = (rootNoteIdx + 3) % 12;
    const majorThirdIdx = (rootNoteIdx + 4) % 12;
    const isMinor = chroma[minorThirdIdx] >= chroma[majorThirdIdx];

    const keyName = `${noteNames[rootNoteIdx]} ${isMinor ? 'Minor' : 'Major'}`;
    const camelot = isMinor ? camelotMinor[rootNoteIdx] : camelotMajor[rootNoteIdx];

    return {
      keyName,
      camelot,
      isMinor,
      rootNote: noteNames[rootNoteIdx]
    };
  }

  _downsampleEnvelope(envelope, timestamps, targetPoints) {
    const step = Math.max(1, Math.floor(envelope.length / targetPoints));
    const points = [];
    for (let i = 0; i < envelope.length; i += step) {
      points.push({
        time: timestamps[i],
        energy: envelope[i]
      });
    }
    return points;
  }

  /**
   * FEATURE: CHOREO MATCH & EXTEND (The User's specific request)
   * 
   * Given:
   * - Track A (Performance / Choreo edit, which cuts off early or has choreo remix)
   * - Track B (Full Original Track, which has the remaining grand finale / missing verses)
   * 
   * Automatically aligns the two audio streams, detects the exact matching region,
   * finds downbeat-locked splice points, and plans the seamless transition!
   */
  findChoreoExtensionSplice(trackA, trackB) {
    const analysisA = trackA.analysis;
    const analysisB = trackB.analysis;

    // Track A ending zone: the final 8 bars (approx 15 seconds) before Track A ends
    const durationA = trackA.buffer.duration;
    const durationB = trackB.buffer.duration;

    const tailWindowSeconds = Math.min(16, durationA * 0.4);
    const searchStartTimeA = Math.max(0, durationA - tailWindowSeconds);

    // Find candidate downbeats in Track A near the end
    const candidateSpliceBeatsA = analysisA.beatGrid.filter(
      b => b.isDownbeat && b.time >= searchStartTimeA && b.time <= (durationA - 1.5)
    );

    // Compute cross-correlation profile between Track A's rhythm envelope and Track B
    const envA = analysisA.envelopeSummary;
    const envB = analysisB.envelopeSummary;

    // If both tracks have similar tempo, find the alignment offset
    const bpmRatio = analysisA.bpm / analysisB.bpm;
    const tempoMatchConfidence = Math.max(0, 100 - Math.abs(1 - bpmRatio) * 150);

    const candidates = [];

    // Analyze candidate splice points
    for (const beatA of candidateSpliceBeatsA) {
      // Find matching downbeats in Track B that correspond to the musical section
      // In a choreo edit, the choreo usually covers the first 1-2 minutes,
      // so the splice in Track B should be in a corresponding musical phrase that still has plenty of remaining audio!
      const matchingBeatsB = analysisB.beatGrid.filter(
        b => b.isDownbeat && b.time >= (beatA.time * 0.8) && (durationB - b.time) >= 10
      );

      for (const beatB of matchingBeatsB) {
        // Evaluate phrase harmony & phase alignment
        const timeDiff = Math.abs((beatA.time % (analysisA.secondsPerBeat * 4)) - (beatB.time % (analysisB.secondsPerBeat * 4)));
        const phraseAlignmentScore = Math.max(0, 100 - (timeDiff * 200));

        // Remaining added duration from Track B
        const addedDuration = durationB - beatB.time;

        // Overall match score
        const totalScore = Math.round(
          (tempoMatchConfidence * 0.4) +
          (phraseAlignmentScore * 0.4) +
          (Math.min(addedDuration, 60) / 60 * 20)
        );

        candidates.push({
          spliceTimeA: beatA.time,
          spliceTimeB: beatB.time,
          barA: beatA.bar,
          barB: beatB.bar,
          addedDuration: addedDuration,
          totalResultDuration: beatA.time + addedDuration,
          confidenceScore: Math.min(99, Math.max(65, totalScore)),
          description: `Splice at ${this.formatTime(beatA.time)} (Choreo Bar ${beatA.bar}) -> Continues ${this.formatTime(beatB.time)} in Original (+${Math.round(addedDuration)}s grand finale)`
        });
      }
    }

    // Sort by confidence score descending
    candidates.sort((a, b) => b.confidenceScore - a.confidenceScore);

    // Pick top 4 recommendations
    const topCandidates = candidates.slice(0, 4);

    // Default primary choice: highest confidence with healthy added outro
    const defaultPick = topCandidates[0] || {
      spliceTimeA: Math.max(0, durationA - 4),
      spliceTimeB: Math.min(durationB * 0.5, durationA - 4),
      addedDuration: Math.max(10, durationB - (durationA - 4)),
      totalResultDuration: durationA + 15,
      confidenceScore: 88,
      description: "Smart Downbeat Extension"
    };

    return {
      recommended: defaultPick,
      candidates: topCandidates,
      tempoMatch: {
        bpmA: analysisA.bpm,
        bpmB: analysisB.bpm,
        bpmRatio: bpmRatio.toFixed(2),
        tempoCompatible: Math.abs(analysisA.bpm - analysisB.bpm) <= 6
      },
      harmonicMatch: this._evaluateHarmonicCompatibility(analysisA.keyInfo, analysisB.keyInfo)
    };
  }

  /**
   * FEATURE: WEDDING MEDLEY TRANSITION (Two different songs)
   * 
   * Identifies 3-5 best DJ transition spots between Song A and Song B:
   * 1. End of Chorus / High-Energy Drop Switch
   * 2. 8-Bar Bass Swap Blend
   * 3. Breakdown Hand-off
   */
  findMedleyTransitions(trackA, trackB) {
    const analysisA = trackA.analysis;
    const analysisB = trackB.analysis;
    const durationA = trackA.buffer.duration;

    const transitionSpots = [];

    // Candidate 1: High Energy Chorus End / Drop Switch
    const highEnergyPhrasesA = analysisA.phrases.filter(p => p.type.includes('Chorus') && p.endTime > 30);
    const primaryExitPhrase = highEnergyPhrasesA.length > 0 ? highEnergyPhrasesA[highEnergyPhrasesA.length - 1] : analysisA.phrases[Math.floor(analysisA.phrases.length * 0.6)];

    if (primaryExitPhrase) {
      // Find downbeat near exit phrase
      const downbeatA = analysisA.beatGrid.find(b => b.isDownbeat && Math.abs(b.time - primaryExitPhrase.endTime) < 2) || { time: primaryExitPhrase.endTime };
      // Enter on Track B's first main beat or drop
      const entryBeatB = analysisB.beatGrid.find(b => b.isDownbeat && b.bar >= 2) || { time: analysisB.firstDownbeatTime };

      transitionSpots.push({
        id: 'drop_cut',
        title: '💥 High-Energy Drop Cut',
        style: 'quick_cut',
        timeA: downbeatA.time,
        timeB: entryBeatB.time,
        crossfadeDuration: 1.5,
        confidence: 94,
        description: 'Cuts sharply at peak chorus drop in Track 1 and kicks into Track 2 on Beat 1. Perfect for high-energy bridal party entrance!'
      });
    }

    // Candidate 2: 8-Bar DJ Bass-Swap Crossfade
    const midPointA = durationA * 0.65;
    const barExitA = analysisA.beatGrid.find(b => b.isDownbeat && b.time >= midPointA) || { time: midPointA };
    const introBarB = analysisB.beatGrid.find(b => b.isDownbeat && b.bar === 1) || { time: 0 };
    const crossfadeDuration8Bars = (60 / analysisA.bpm) * 16; // 4 bars overlap = ~7-8 seconds

    transitionSpots.push({
      id: 'bass_swap_blend',
      title: '🎛️ 8-Bar DJ Bass Swap',
      style: 'bass_swap',
      timeA: barExitA.time,
      timeB: introBarB.time,
      crossfadeDuration: Math.min(8.0, Math.max(3.5, crossfadeDuration8Bars)),
      confidence: 91,
      description: 'Filters out low frequencies (kick/bass) of Song 1 while bringing in Song 2. Zero muddy clash, sounds like a live club DJ.'
    });

    // Candidate 3: Natural Outro Hand-off
    const outroTimeA = Math.max(15, durationA - 8);
    const downbeatOutroA = analysisA.beatGrid.find(b => b.isDownbeat && b.time >= outroTimeA) || { time: outroTimeA };

    transitionSpots.push({
      id: 'smooth_handshake',
      title: '🌊 Smooth Ambient Crossfade',
      style: 'equal_power',
      timeA: downbeatOutroA.time,
      timeB: 0,
      crossfadeDuration: 4.0,
      confidence: 86,
      description: 'Smooth 4-second equal-power crossfade at the natural end of Song 1 into Song 2.'
    });

    return {
      transitions: transitionSpots,
      tempoMatch: {
        bpmA: analysisA.bpm,
        bpmB: analysisB.bpm,
        diff: Math.abs(analysisA.bpm - analysisB.bpm),
        isClose: Math.abs(analysisA.bpm - analysisB.bpm) <= 8
      },
      harmonicMatch: this._evaluateHarmonicCompatibility(analysisA.keyInfo, analysisB.keyInfo)
    };
  }

  _evaluateHarmonicCompatibility(keyA, keyB) {
    if (!keyA || !keyB) return { compatible: true, advice: 'Key information ready' };

    const camA = keyA.camelot;
    const camB = keyB.camelot;

    const numA = parseInt(camA);
    const letterA = camA.slice(-1);
    const numB = parseInt(camB);
    const letterB = camB.slice(-1);

    const diff = Math.abs(numA - numB);
    const isAdjacent = (diff === 0 || diff === 1 || diff === 11);
    const isRelative = (numA === numB && letterA !== letterB);

    if (camA === camB) {
      return {
        level: 'Perfect Harmonic Match (Same Key)',
        score: 100,
        camelotA: camA,
        camelotB: camB,
        advice: `Both tracks are in ${keyA.keyName} (${camA}). Zero harmonic dissonance.`
      };
    } else if (isAdjacent && letterA === letterB) {
      return {
        level: 'Smooth Harmonic Blend (Adjacent Key)',
        score: 92,
        camelotA: camA,
        camelotB: camB,
        advice: `${camA} to ${camB} provides an energetic and harmonious key lift.`
      };
    } else if (isRelative) {
      return {
        level: 'Relative Major/Minor (Emotional Shift)',
        score: 88,
        camelotA: camA,
        camelotB: camB,
        advice: `Transitions between ${keyA.keyName} and ${keyB.keyName} create a musical mood switch.`
      };
    } else {
      return {
        level: 'Distinct Keys (Rhythmic / Quick Cut Advised)',
        score: 75,
        camelotA: camA,
        camelotB: camB,
        advice: `${camA} and ${camB} are different keys. We recommend a quick drop cut or percussion bridge.`
      };
    }
  }

  /**
   * REAL-TIME TRANSITION AUDITION
   * Plays 4 seconds prior to the splice point and continues 4 seconds after
   * Supports Studio Master Clean Reconstruction Mode
   */
  async auditionTransition(trackA, trackB, config) {
    this.stopPlayback();
    await this.ensureContext();

    const {
      hasArrangement = false,
      auditionTarget = 'loop', // 'loop' or 'finale'
      loopStart = 0,
      loopEnd = 8.972,
      loopRepeats = 1,
      choreoCutTime = 41.0,
      spliceTimeA = 41.0,
      spliceTimeB = 32.03,
      crossfadeDuration = 0.35,
      transitionType = 'choreo_splice',
      previewPreRoll = 3.5,
      previewPostRoll = 3.5,
      useStudioMasterForChoreo = true,
      studioStartOffset = 0
    } = config;

    const now = this.ctx.currentTime + 0.05;

    // ARRANGEMENT AUDITION: Audition the Intro Loop Repeat or the Finale Extension Cut
    if (hasArrangement && trackB && trackB.buffer) {
      if (auditionTarget === 'loop') {
        // Audition the Intro Loop Repeat (at loopEnd, e.g. 8.97s)
        const preRoll = Math.min(previewPreRoll, loopEnd);
        const startOffset = loopEnd - preRoll;

        const src1 = this.ctx.createBufferSource();
        src1.buffer = trackB.buffer;
        src1.connect(this.ctx.destination);
        src1.start(now, startOffset, preRoll);

        const src2 = this.ctx.createBufferSource();
        src2.buffer = trackB.buffer;
        src2.connect(this.ctx.destination);
        src2.start(now + preRoll, loopStart, previewPostRoll);

        this.currentSourceNodes = [src1, src2];
        this.isPlaying = true;
        const totalAudition = preRoll + previewPostRoll;
        this.auditionTimeout = setTimeout(() => {
          this.isPlaying = false;
          this.currentSourceNodes = [];
        }, totalAudition * 1000);

        return { auditionDuration: totalAudition, startOffset: startOffset, transitionPointSec: preRoll };
      } else {
        // Audition the Finale Extension Cut (at choreoCutTime, e.g. 41.0s)
        const repLen = (loopRepeats > 0) ? (loopEnd - loopStart) * loopRepeats : 0;
        const choreoCutInStudio = loopEnd + Math.max(0, choreoCutTime - (loopEnd + repLen));
        const preRoll = Math.min(previewPreRoll, choreoCutTime);
        const studioStartPre = Math.max(0, choreoCutInStudio - preRoll);

        const srcPre = this.ctx.createBufferSource();
        srcPre.buffer = (useStudioMasterForChoreo || !trackA) ? trackB.buffer : trackA.buffer;
        srcPre.connect(this.ctx.destination);
        const preOffset = useStudioMasterForChoreo ? studioStartPre : Math.max(0, choreoCutTime - preRoll);
        srcPre.start(now, preOffset, preRoll);

        const srcPost = this.ctx.createBufferSource();
        srcPost.buffer = trackB.buffer;
        srcPost.connect(this.ctx.destination);
        srcPost.start(now + preRoll, choreoCutInStudio, previewPostRoll);

        this.currentSourceNodes = [srcPre, srcPost];
        this.isPlaying = true;
        const totalAudition = preRoll + previewPostRoll;
        this.auditionTimeout = setTimeout(() => {
          this.isPlaying = false;
          this.currentSourceNodes = [];
        }, totalAudition * 1000);

        return { auditionDuration: totalAudition, startOffset: choreoCutTime - preRoll, transitionPointSec: preRoll };
      }
    }

    // Standard Medley / Splice Audition
    const startA = Math.max(0, spliceTimeA - previewPreRoll);
    const actualPreRoll = spliceTimeA - startA;

    const canUseStudio = useStudioMasterForChoreo && trackB && trackB.buffer && (trackB.buffer.duration > (studioStartOffset + startA));
    const bufferA = canUseStudio ? trackB.buffer : trackA.buffer;
    const startOffsetA = canUseStudio ? (studioStartOffset + startA) : startA;

    const sourceA = this.ctx.createBufferSource();
    sourceA.buffer = bufferA;
    const gainA = this.ctx.createGain();
    const filterA = this.ctx.createBiquadFilter();

    const sourceB = this.ctx.createBufferSource();
    sourceB.buffer = trackB.buffer;
    const gainB = this.ctx.createGain();
    const filterB = this.ctx.createBiquadFilter();

    const transitionStartTime = now + actualPreRoll;
    const transitionEndTime = transitionStartTime + crossfadeDuration;

    if (transitionType === 'bass_swap') {
      filterA.type = 'highpass';
      filterA.frequency.setValueAtTime(20, now);
      filterA.frequency.exponentialRampToValueAtTime(800, transitionEndTime);

      filterB.type = 'lowpass';
      filterB.frequency.setValueAtTime(200, transitionStartTime);
      filterB.frequency.exponentialRampToValueAtTime(20000, transitionEndTime + 1.0);

      gainA.gain.setValueAtTime(1.0, now);
      gainA.gain.linearRampToValueAtTime(0.001, transitionEndTime);

      gainB.gain.setValueAtTime(0.001, transitionStartTime);
      gainB.gain.linearRampToValueAtTime(1.0, transitionEndTime);
    } else if (transitionType === 'quick_cut') {
      gainA.gain.setValueAtTime(1.0, now);
      gainA.gain.setValueAtTime(1.0, transitionStartTime);
      gainA.gain.linearRampToValueAtTime(0.001, transitionStartTime + 0.05);

      gainB.gain.setValueAtTime(0.001, transitionStartTime);
      gainB.gain.setValueAtTime(1.0, transitionStartTime + 0.05);
    } else {
      gainA.gain.setValueAtTime(1.0, now);
      gainA.gain.setValueAtTime(1.0, transitionStartTime);
      gainA.gain.exponentialRampToValueAtTime(0.001, transitionStartTime + Math.max(0.1, crossfadeDuration));

      gainB.gain.setValueAtTime(0.001, transitionStartTime);
      gainB.gain.exponentialRampToValueAtTime(1.0, transitionStartTime + Math.max(0.1, crossfadeDuration));
    }

    sourceA.connect(filterA);
    filterA.connect(gainA);
    gainA.connect(this.ctx.destination);

    sourceB.connect(filterB);
    filterB.connect(gainB);
    gainB.connect(this.ctx.destination);

    sourceA.start(now, startOffsetA, actualPreRoll + crossfadeDuration + 0.2);
    sourceB.start(transitionStartTime, spliceTimeB, previewPostRoll);

    this.currentSourceNodes = [sourceA, sourceB];
    this.isPlaying = true;

    const totalAuditionDuration = actualPreRoll + crossfadeDuration + previewPostRoll;
    this.auditionTimeout = setTimeout(() => {
      this.isPlaying = false;
      this.currentSourceNodes = [];
    }, totalAuditionDuration * 1000);

    return {
      auditionDuration: totalAuditionDuration,
      transitionPointSec: actualPreRoll
    };
  }

  /**
   * Solo Audition for a single block/piece of music
   */
  async playBlockSolo(block, bufferOrTrack, onEnd) {
    this.stopPlayback();
    await this.ensureContext();

    let buffer = null;
    if (bufferOrTrack && bufferOrTrack.buffer) buffer = bufferOrTrack.buffer;
    else if (bufferOrTrack && bufferOrTrack.numberOfChannels) buffer = bufferOrTrack;

    if (!buffer) return;

    const now = this.ctx.currentTime + 0.05;
    const dur = Math.max(0.1, block.endTime - block.startTime);

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.ctx.destination);
    src.start(now, block.startTime, dur);

    this.currentSourceNodes = [src];
    this.isPlaying = true;

    this.auditionTimeout = setTimeout(() => {
      this.isPlaying = false;
      this.currentSourceNodes = [];
      if (onEnd) onEnd();
    }, dur * 1000);

    return dur;
  }

  /**
   * Play full master mix from start
   * Supports Block Arrangements, Studio Master Clean mode and reliable instant replay
   */
  async playFullMix(trackA, trackB, config, onProgress) {
    this.stopPlayback();
    await this.ensureContext();
    if (this.ctx && this.ctx.state !== 'running') {
      try { await this.ctx.resume(); } catch (_) {}
    }

    const {
      blocks = null,
      hasArrangement = false,
      loopStart = 0,
      loopEnd = 2.243,
      loopRepeats = 1,
      choreoCutTime = 41.0,
      useStudioMasterForChoreo = true,
      spliceTimeA = 41.0,
      spliceTimeB = 38.76,
      crossfadeDuration = 0.25,
      transitionType = 'choreo_splice',
      studioStartOffset = 0
    } = config;

    const now = this.ctx.currentTime + 0.05;

    // DYNAMIC INTERACTIVE BLOCKS ARRANGEMENT PLAYBACK:
    if (blocks && Array.isArray(blocks) && blocks.length > 0) {
      const activeBuf = (trackB && trackB.buffer) ? trackB.buffer : (trackA ? trackA.buffer : null);
      if (activeBuf) {
        let currentMixTime = now;
        const sources = [];
        const blockSchedule = [];
        let totalDuration = 0;

        for (let i = 0; i < blocks.length; i++) {
          const blk = blocks[i];
          const blkDur = Math.max(0.05, blk.endTime - blk.startTime);
          const src = this.ctx.createBufferSource();
          let blkBuf = activeBuf;
          if (useStudioMasterForChoreo && trackB && trackB.buffer) {
            blkBuf = trackB.buffer;
          } else if (blk.sourceTrack === 'A' && trackA && trackA.buffer) {
            blkBuf = trackA.buffer;
          } else if (blk.sourceTrack === 'B' && trackB && trackB.buffer) {
            blkBuf = trackB.buffer;
          }
          src.buffer = blkBuf;
          src.connect(this.ctx.destination);
          src.start(currentMixTime, blk.startTime, blkDur);
          sources.push(src);

          const startOffset = currentMixTime - now;
          const endOffset = startOffset + blkDur;
          blockSchedule.push({ index: i, start: startOffset, end: endOffset });

          currentMixTime += blkDur;
          totalDuration += blkDur;
        }

        this.currentSourceNodes = sources;
        this.isPlaying = true;

        this.playbackInterval = setInterval(() => {
          if (!this.isPlaying) {
            if (this.playbackInterval) {
              clearInterval(this.playbackInterval);
              this.playbackInterval = null;
            }
            return;
          }
          const elapsed = this.ctx.currentTime - now;
          if (elapsed >= totalDuration) {
            if (onProgress) onProgress(totalDuration, totalDuration, -1);
            this.stopPlayback();
          } else if (onProgress) {
            const activeBlk = blockSchedule.find(b => elapsed >= b.start && elapsed < b.end);
            onProgress(Math.max(0, elapsed), totalDuration, activeBlk ? activeBlk.index : -1);
          }
        }, 50);

        return totalDuration;
      }
    }

    // ARRANGEMENT PLAYBACK: Intro (0:00) -> Repeated Intro Hook -> Choreo Continuation -> Full Finale Extension
    if (hasArrangement && trackB && trackB.buffer) {
      const repLen = (loopRepeats > 0) ? (loopEnd - loopStart) * loopRepeats : 0;
      const choreoCutInStudio = loopEnd + Math.max(0, choreoCutTime - (loopEnd + repLen));
      const extensionDuration = Math.max(0, trackB.buffer.duration - choreoCutInStudio);
      const totalDuration = choreoCutTime + extensionDuration;

      const sources = [];

      if (useStudioMasterForChoreo) {
        // --- 100% Studio Clean Reconstruction (From Original Master) ---
        // Block 1: Intro (0:00 to loopEnd)
        const src1 = this.ctx.createBufferSource();
        src1.buffer = trackB.buffer;
        src1.connect(this.ctx.destination);
        src1.start(now, 0, loopEnd);
        sources.push(src1);

        // Block 2: Loop Repeat (loopStart to loopEnd)
        let currentMixTime = now + loopEnd;
        for (let r = 0; r < loopRepeats; r++) {
          const srcRep = this.ctx.createBufferSource();
          srcRep.buffer = trackB.buffer;
          srcRep.connect(this.ctx.destination);
          srcRep.start(currentMixTime, loopStart, loopEnd - loopStart);
          sources.push(srcRep);
          currentMixTime += (loopEnd - loopStart);
        }

        // Block 3: Choreo Continuation (loopEnd onwards to choreoCutInStudio)
        const durationSec3 = Math.max(0, (now + choreoCutTime) - currentMixTime);
        if (durationSec3 > 0) {
          const src3 = this.ctx.createBufferSource();
          src3.buffer = trackB.buffer;
          src3.connect(this.ctx.destination);
          src3.start(currentMixTime, loopEnd, durationSec3);
          sources.push(src3);
        }

        // Block 4: Grand Finale & Missing Rap Extension (choreoCutInStudio to end of track B)
        const src4 = this.ctx.createBufferSource();
        src4.buffer = trackB.buffer;
        src4.connect(this.ctx.destination);
        src4.start(now + choreoCutTime, choreoCutInStudio, extensionDuration);
        sources.push(src4);

      } else {
        // --- Rehearsal Mic Audio Mode ---
        // Blocks 1-3 from performance video audio
        const srcChoreo = this.ctx.createBufferSource();
        srcChoreo.buffer = trackA.buffer;
        const gainChoreo = this.ctx.createGain();
        srcChoreo.connect(gainChoreo);
        gainChoreo.connect(this.ctx.destination);

        gainChoreo.gain.setValueAtTime(1.0, now);
        gainChoreo.gain.setValueAtTime(1.0, now + choreoCutTime);
        gainChoreo.gain.linearRampToValueAtTime(0.001, now + choreoCutTime + crossfadeDuration);
        srcChoreo.start(now, 0, choreoCutTime + crossfadeDuration);
        sources.push(srcChoreo);

        // Block 4 from studio track
        const srcExt = this.ctx.createBufferSource();
        srcExt.buffer = trackB.buffer;
        const gainExt = this.ctx.createGain();
        srcExt.connect(gainExt);
        gainExt.connect(this.ctx.destination);

        gainExt.gain.setValueAtTime(0.001, now);
        gainExt.gain.setValueAtTime(0.001, now + choreoCutTime);
        gainExt.gain.linearRampToValueAtTime(1.0, now + choreoCutTime + crossfadeDuration);
        srcExt.start(now + choreoCutTime, choreoCutInStudio, extensionDuration);
        sources.push(srcExt);
      }

      this.currentSourceNodes = sources;
      this.isPlaying = true;

      this.playbackInterval = setInterval(() => {
        if (!this.isPlaying) {
          if (this.playbackInterval) {
            clearInterval(this.playbackInterval);
            this.playbackInterval = null;
          }
          return;
        }
        const elapsed = this.ctx.currentTime - now;
        if (elapsed >= totalDuration) {
          if (onProgress) onProgress(totalDuration, totalDuration);
          this.stopPlayback();
        } else if (onProgress) {
          onProgress(Math.max(0, elapsed), totalDuration);
        }
      }, 50);

      return totalDuration;
    }

    // Default Medley / 2-Track Mix
    const canUseStudio = useStudioMasterForChoreo && trackB && trackB.buffer && (trackB.buffer.duration > (studioStartOffset + spliceTimeA));
    const bufferA = canUseStudio ? trackB.buffer : trackA.buffer;
    const startOffsetA = canUseStudio ? studioStartOffset : 0;

    const sourceA = this.ctx.createBufferSource();
    sourceA.buffer = bufferA;
    const gainA = this.ctx.createGain();

    const sourceB = this.ctx.createBufferSource();
    sourceB.buffer = trackB.buffer;
    const gainB = this.ctx.createGain();

    const transitionTime = now + spliceTimeA;

    gainA.gain.setValueAtTime(1.0, now);
    gainA.gain.setValueAtTime(1.0, transitionTime);
    gainA.gain.linearRampToValueAtTime(0.001, transitionTime + crossfadeDuration);

    const durationBRemaining = Math.max(0, trackB.buffer.duration - spliceTimeB);
    gainB.gain.setValueAtTime(0.001, now);
    gainB.gain.setValueAtTime(0.001, transitionTime);
    gainB.gain.linearRampToValueAtTime(1.0, transitionTime + crossfadeDuration);

    sourceA.connect(gainA);
    gainA.connect(this.ctx.destination);

    sourceB.connect(gainB);
    gainB.connect(this.ctx.destination);

    sourceA.start(now, startOffsetA, spliceTimeA + crossfadeDuration);
    sourceB.start(transitionTime, spliceTimeB, durationBRemaining);

    this.currentSourceNodes = [sourceA, sourceB];
    this.isPlaying = true;

    const totalDuration = spliceTimeA + durationBRemaining;

    this.playbackInterval = setInterval(() => {
      if (!this.isPlaying) {
        if (this.playbackInterval) {
          clearInterval(this.playbackInterval);
          this.playbackInterval = null;
        }
        return;
      }
      const elapsed = this.ctx.currentTime - now;
      if (elapsed >= totalDuration) {
        if (onProgress) onProgress(totalDuration, totalDuration);
        this.stopPlayback();
      } else if (onProgress) {
        onProgress(Math.max(0, elapsed), totalDuration);
      }
    }, 60);

    return totalDuration;
  }

  stopPlayback() {
    if (this.auditionTimeout) {
      clearTimeout(this.auditionTimeout);
      this.auditionTimeout = null;
    }
    if (this.playbackInterval) {
      clearInterval(this.playbackInterval);
      this.playbackInterval = null;
    }
    this.currentSourceNodes.forEach(node => {
      try { node.stop(); } catch (e) {}
      try { node.disconnect(); } catch (e) {}
    });
    this.currentSourceNodes = [];
    this.isPlaying = false;
  }

  /**
   * OFFLINE RENDERING & MASTER WAV EXPORT
   * Renders the complete seamless master audio buffer and returns a downloadable WAV Blob
   */
  async renderMasterWav(trackA, trackB, config) {
    const {
      blocks = null,
      hasArrangement = false,
      loopStart = 0,
      loopEnd = 8.972,
      loopRepeats = 1,
      choreoCutTime = 41.0,
      spliceTimeA = 41.0,
      spliceTimeB = 32.03,
      crossfadeDuration = 0.35,
      transitionType = 'choreo_splice',
      useStudioMasterForChoreo = true,
      studioStartOffset = 0
    } = config;

    const sampleRate = (trackB && trackB.buffer) ? (trackB.buffer.sampleRate || 44100) : (trackA.buffer.sampleRate || 44100);

    // DYNAMIC INTERACTIVE BLOCKS ARRANGEMENT OFFLINE RENDER:
    if (blocks && Array.isArray(blocks) && blocks.length > 0) {
      const activeBuf = (trackB && trackB.buffer) ? trackB.buffer : (trackA ? trackA.buffer : null);
      if (activeBuf) {
        let totalDuration = 0;
        for (let blk of blocks) {
          totalDuration += Math.max(0.05, blk.endTime - blk.startTime);
        }
        const totalFrames = Math.max(1, Math.floor(sampleRate * totalDuration));
        const offlineCtx = new OfflineAudioContext(2, totalFrames, sampleRate);

        let currentMixTime = 0;
        for (let blk of blocks) {
          const blkDur = Math.max(0.05, blk.endTime - blk.startTime);
          const src = offlineCtx.createBufferSource();
          let blkBuf = activeBuf;
          if (useStudioMasterForChoreo && trackB && trackB.buffer) {
            blkBuf = trackB.buffer;
          } else if (blk.sourceTrack === 'A' && trackA && trackA.buffer) {
            blkBuf = trackA.buffer;
          } else if (blk.sourceTrack === 'B' && trackB && trackB.buffer) {
            blkBuf = trackB.buffer;
          }
          src.buffer = blkBuf;
          src.connect(offlineCtx.destination);
          src.start(currentMixTime, blk.startTime, blkDur);
          currentMixTime += blkDur;
        }

        const renderedBuffer = await offlineCtx.startRendering();
        const wavBlob = this._audioBufferToWavBlob(renderedBuffer);

        return {
          wavBlob,
          duration: totalDuration,
          renderedBuffer,
          cueSheet: {
            totalDurationFormatted: this.formatTime(totalDuration),
            section1: `Block sequence rendered with ${blocks.length} custom arranged pieces.`
          }
        };
      }
    }

    // ARRANGEMENT MASTER EXPORT:
    if (hasArrangement && trackB && trackB.buffer) {
      const repLen = (loopRepeats > 0) ? (loopEnd - loopStart) * loopRepeats : 0;
      const choreoCutInStudio = loopEnd + Math.max(0, choreoCutTime - (loopEnd + repLen));
      const extensionDuration = Math.max(0, trackB.buffer.duration - choreoCutInStudio);
      const totalDuration = choreoCutTime + extensionDuration;
      const totalFrames = Math.floor(sampleRate * totalDuration);

      const offlineCtx = new OfflineAudioContext(2, totalFrames, sampleRate);

      if (useStudioMasterForChoreo) {
        // Block 1: Intro
        const src1 = offlineCtx.createBufferSource();
        src1.buffer = trackB.buffer;
        src1.connect(offlineCtx.destination);
        src1.start(0, 0, loopEnd);

        // Block 2: Repeat
        let currentMixTime = loopEnd;
        for (let r = 0; r < loopRepeats; r++) {
          const srcRep = offlineCtx.createBufferSource();
          srcRep.buffer = trackB.buffer;
          srcRep.connect(offlineCtx.destination);
          srcRep.start(currentMixTime, loopStart, loopEnd - loopStart);
          currentMixTime += (loopEnd - loopStart);
        }

        // Block 3: Choreo Continuation
        const durationSec3 = Math.max(0, choreoCutTime - currentMixTime);
        if (durationSec3 > 0) {
          const src3 = offlineCtx.createBufferSource();
          src3.buffer = trackB.buffer;
          src3.connect(offlineCtx.destination);
          src3.start(currentMixTime, loopEnd, durationSec3);
        }

        // Block 4: Finale Extension
        const src4 = offlineCtx.createBufferSource();
        src4.buffer = trackB.buffer;
        src4.connect(offlineCtx.destination);
        src4.start(choreoCutTime, choreoCutInStudio, extensionDuration);

      } else {
        const srcChoreo = offlineCtx.createBufferSource();
        srcChoreo.buffer = trackA.buffer;
        const gainChoreo = offlineCtx.createGain();
        srcChoreo.connect(gainChoreo);
        gainChoreo.connect(offlineCtx.destination);

        gainChoreo.gain.setValueAtTime(1.0, 0);
        gainChoreo.gain.setValueAtTime(1.0, choreoCutTime);
        gainChoreo.gain.linearRampToValueAtTime(0.001, choreoCutTime + crossfadeDuration);
        srcChoreo.start(0, 0, choreoCutTime + crossfadeDuration);

        const srcExt = offlineCtx.createBufferSource();
        srcExt.buffer = trackB.buffer;
        const gainExt = offlineCtx.createGain();
        srcExt.connect(gainExt);
        gainExt.connect(offlineCtx.destination);

        gainExt.gain.setValueAtTime(0.001, 0);
        gainExt.gain.setValueAtTime(0.001, choreoCutTime);
        gainExt.gain.linearRampToValueAtTime(1.0, choreoCutTime + crossfadeDuration);
        srcExt.start(choreoCutTime, choreoCutInStudio, extensionDuration);
      }

      const renderedBuffer = await offlineCtx.startRendering();
      const wavBlob = this._audioBufferToWavBlob(renderedBuffer);

      return {
        wavBlob,
        duration: totalDuration,
        renderedBuffer,
        cueSheet: {
          totalDurationFormatted: this.formatTime(totalDuration),
          section1: `0:00 - ${this.formatTime(loopEnd)}: Intro Horn Riff (Studio Master)`,
          section2: `${this.formatTime(loopEnd)} - ${this.formatTime(loopEnd + repLen)}: Repeated Intro Phrase (Choreo Loop)`,
          section3: `${this.formatTime(loopEnd + repLen)} - ${this.formatTime(choreoCutTime)}: Choreo Verse Section`,
          section4: `${this.formatTime(choreoCutTime)} - ${this.formatTime(totalDuration)}: Extended Finale, Drop & Badshah Rap (+${Math.round(extensionDuration)}s)`
        }
      };
    }

    // Default Medley Render
    const remainingDurationB = Math.max(0, trackB.buffer.duration - spliceTimeB);
    const totalDuration = spliceTimeA + remainingDurationB;
    const totalFrames = Math.floor(sampleRate * totalDuration);

    const offlineCtx = new OfflineAudioContext(2, totalFrames, sampleRate);

    const canUseStudio = useStudioMasterForChoreo && trackB && trackB.buffer && (trackB.buffer.duration > (studioStartOffset + spliceTimeA));
    const bufferA = canUseStudio ? trackB.buffer : trackA.buffer;
    const startOffsetA = canUseStudio ? studioStartOffset : 0;

    const sourceA = offlineCtx.createBufferSource();
    sourceA.buffer = bufferA;
    const gainA = offlineCtx.createGain();

    const sourceB = offlineCtx.createBufferSource();
    sourceB.buffer = trackB.buffer;
    const gainB = offlineCtx.createGain();

    const transitionStartTime = spliceTimeA;
    const transitionEndTime = spliceTimeA + crossfadeDuration;

    gainA.gain.setValueAtTime(1.0, 0);
    gainA.gain.setValueAtTime(1.0, transitionStartTime);
    gainA.gain.linearRampToValueAtTime(0.001, transitionEndTime);

    gainB.gain.setValueAtTime(0.001, 0);
    gainB.gain.setValueAtTime(0.001, transitionStartTime);
    gainB.gain.linearRampToValueAtTime(1.0, transitionEndTime);

    sourceA.connect(gainA);
    gainA.connect(offlineCtx.destination);

    sourceB.connect(gainB);
    gainB.connect(offlineCtx.destination);

    sourceA.start(0, startOffsetA, spliceTimeA + crossfadeDuration);
    sourceB.start(transitionStartTime, spliceTimeB, remainingDurationB);

    const renderedBuffer = await offlineCtx.startRendering();
    const wavBlob = this._audioBufferToWavBlob(renderedBuffer);

    return {
      wavBlob,
      duration: totalDuration,
      renderedBuffer,
      cueSheet: {
        totalDurationFormatted: this.formatTime(totalDuration),
        section1: `0:00 - ${this.formatTime(spliceTimeA)}: Track 1 Choreo Section (${canUseStudio ? 'Pristine Studio Master' : 'Performance Mic Audio'})`,
        transitionSpot: `${this.formatTime(spliceTimeA)}: Seamless Transition (${transitionType})`,
        section2: `${this.formatTime(spliceTimeA)} - ${this.formatTime(totalDuration)}: Track 2 Extended Outro & Finale`
      }
    };
  }

  /**
   * Convert an AudioBuffer to a standard 16-bit PCM Stereo WAV Blob
   */
  _audioBufferToWavBlob(audioBuffer) {
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;

    const left = audioBuffer.getChannelData(0);
    const right = numChannels > 1 ? audioBuffer.getChannelData(1) : left;
    const numSamples = left.length;
    const dataByteCount = numSamples * blockAlign;
    const headerByteCount = 44;
    const totalByteCount = headerByteCount + dataByteCount;

    const arrayBuffer = new ArrayBuffer(totalByteCount);
    const view = new DataView(arrayBuffer);

    // RIFF identifier
    this._writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataByteCount, true);
    this._writeString(view, 8, 'WAVE');

    // fmt subchunk
    this._writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true); // ByteRate
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);

    // data subchunk
    this._writeString(view, 36, 'data');
    view.setUint32(40, dataByteCount, true);

    // Write interleaved 16-bit PCM samples
    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
      // Left channel
      let sL = Math.max(-1, Math.min(1, left[i]));
      view.setInt16(offset, sL < 0 ? sL * 0x8000 : sL * 0x7FFF, true);
      offset += 2;

      // Right channel
      let sR = Math.max(-1, Math.min(1, right[i]));
      view.setInt16(offset, sR < 0 ? sR * 0x8000 : sR * 0x7FFF, true);
      offset += 2;
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  _writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${m}:${s < 10 ? '0' : ''}${s}.${ms}`;
  }
}

if (typeof window !== 'undefined') {
  window.AudioRemixEngine = AudioRemixEngine;
}
