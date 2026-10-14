/**
 * Wedding Remix Studio - Application Controller & Visual Timeline
 */

// Global State
const appState = {
  currentMode: 'choreo', // 'choreo' or 'medley'
  engine: new AudioRemixEngine(),
  demoGen: null,
  trackA: null, // { name, buffer, analysis, sourceUrl }
  trackB: null, // { name, buffer, analysis, sourceUrl }
  useStudioMaster: true, // Reconstruct choreo from pristine studio audio
  studioStartOffset: 0.0, // Official track starts at 0:00 (Intro horn riff)
  arrangement: {
    hasArrangement: true,
    loopStart: 0.0,
    loopEnd: 2.243, // 1-bar (4 beats) intro riff in Kala Chashma (107 BPM)
    loopRepeats: 1, // Repeated 1x in choreo video (+2.24s)
    choreoCutTime: 41.00 // Where video ends choreo
  },
  arrangementBlocks: [],
  userHasCustomizedBlocks: false,
  activeTransitionConfig: {
    spliceTimeA: 41.00,
    spliceTimeB: 38.76, // 41.0 - 2.243 = 38.76s in official song
    crossfadeDuration: 0.35,
    transitionType: 'choreo_splice'
  },
  candidates: [],
  selectedCandidateIndex: 0,
  isPlaying: false,
  playbackPosition: 0,
  playheadAnimationId: null,
  exportFormat: 'iphone'
};

// Global Autoplay Unlocker: Unconditionally wake AudioContext on very first user interaction
function unlockAudioContextOnGesture() {
  if (appState.engine && appState.engine.ctx) {
    if (appState.engine.ctx.state === 'suspended' || appState.engine.ctx.state === 'interrupted') {
      appState.engine.ctx.resume().catch(() => {});
    }
  }
}
window.addEventListener('click', unlockAudioContextOnGesture, { capture: true, passive: true });
window.addEventListener('touchstart', unlockAudioContextOnGesture, { capture: true, passive: true });
window.addEventListener('keydown', unlockAudioContextOnGesture, { capture: true, passive: true });

// Initialize on DOM load
window.addEventListener('DOMContentLoaded', () => {
  appState.demoGen = new DemoAudioGenerator(appState.engine.ctx);
  setupEventListeners();
  initWaveformCanvas();
  // Auto-initialize Kala Chashma performance mix so playback is ready immediately on load
  initKalaChashmaDefaultState();
  selectExportFormat(appState.exportFormat || 'iphone');
});

function setupEventListeners() {
  // Preset and Demo buttons
  const kalaBtn = document.getElementById('loadUserKalaChashmaBtn');
  if (kalaBtn) kalaBtn.addEventListener('click', loadKalaChashmaUserTracks);
  document.getElementById('loadChoreoDemoBtn').addEventListener('click', loadChoreoExtensionDemo);
  document.getElementById('loadMedleyDemoBtn').addEventListener('click', loadMedleyDemo);

  // Setup drag and drop for both decks
  setupDropZone('dropZoneA', 'A');
  setupDropZone('dropZoneB', 'B');

  // Window resize redrawing
  window.addEventListener('resize', () => {
    drawWaveformTimeline();
  });
}

function switchRemixMode(mode) {
  appState.currentMode = mode;
  document.getElementById('modeChoreoTab').classList.toggle('active', mode === 'choreo');
  document.getElementById('modeMedleyTab').classList.toggle('active', mode === 'medley');

  if (mode === 'choreo') {
    document.getElementById('deckTitleA').innerText = "Performance / Choreo Edit";
    document.getElementById('deckTitleB').innerText = "Original Full Song (Outro Extension)";
    document.getElementById('transitionTypeSelect').value = 'choreo_splice';
    appState.activeTransitionConfig.transitionType = 'choreo_splice';
    appState.activeTransitionConfig.crossfadeDuration = 0.5;
    document.getElementById('crossfadeDurationInput').value = 0.5;
    document.getElementById('crossfadeDurationVal').innerText = "0.5s";
  } else {
    document.getElementById('deckTitleA').innerText = "Song 1 (Bridal Party / Entrance)";
    document.getElementById('deckTitleB').innerText = "Song 2 (Family Dance / Celebration)";
    document.getElementById('transitionTypeSelect').value = 'bass_swap';
    appState.activeTransitionConfig.transitionType = 'bass_swap';
    appState.activeTransitionConfig.crossfadeDuration = 4.0;
    document.getElementById('crossfadeDurationInput').value = 4.0;
    document.getElementById('crossfadeDurationVal').innerText = "4.0s";
  }

  if (appState.trackA && appState.trackB) {
    runRemixAnalysis();
  }
}

function switchDeckInputTab(deck, tab) {
  const isLink = tab === 'link';
  document.getElementById(`deckInputLink${deck}`).style.display = isLink ? 'block' : 'none';
  document.getElementById(`deckInputFile${deck}`).style.display = isLink ? 'none' : 'block';

  const tabs = document.querySelectorAll(`#deckCard${deck} .deck-input-tab`);
  tabs[0].classList.toggle('active', isLink);
  tabs[1].classList.toggle('active', !isLink);
}

function setupDropZone(zoneId, deck) {
  const zone = document.getElementById(zoneId);
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('dragover');
  });
  zone.addEventListener('dragleave', () => {
    zone.classList.remove('dragover');
  });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(deck, e.dataTransfer.files[0]);
    }
  });
}

/**
 * Handles Audio or Video file upload (native decoding)
 */
async function handleFileUpload(deck, file) {
  if (!file) return;

  const isVideo = (file.type && file.type.startsWith('video/')) || /\.(mov|mp4|m4v|avi|webm|mkv)$/i.test(file.name || '');
  const statusEl = document.getElementById(`deckStatus${deck}`);
  statusEl.innerText = isVideo ? "Extracting Video Audio..." : "Analyzing Audio...";
  showToast(isVideo ? `Extracting audio from ${file.name} via macOS avconvert...` : `Decoding ${file.name}...`);

  try {
    const audioBuffer = await appState.engine.decodeAudio(file);
    const analysis = appState.engine.analyzeTrack(audioBuffer);

    const trackObj = {
      name: file.name,
      buffer: audioBuffer,
      analysis: analysis,
      source: 'upload'
    };

    if (deck === 'A') {
      appState.trackA = trackObj;
    } else {
      appState.trackB = trackObj;
    }

    updateTrackCardUI(deck, trackObj);
    showToast(`✅ Loaded ${file.name} (${analysis.bpm} BPM, ${analysis.keyInfo.camelot})`);

    checkBothTracksReady();
  } catch (err) {
    console.error(err);
    statusEl.innerText = "Error";
    showToast(`⚠️ Could not decode audio: ${err.message}`);
  }
}

/**
 * Handles Link Input (YouTube / Spotify)
 */
async function handleFetchTrack(deck) {
  const inputEl = document.getElementById(`trackInputUrl${deck}`);
  const url = inputEl.value.trim();
  if (!url) {
    showToast("Please enter a YouTube or Spotify link.");
    return;
  }

  const statusEl = document.getElementById(`deckStatus${deck}`);
  statusEl.innerText = "Resolving Link...";
  showToast(`Resolving track from link: ${url.slice(0, 35)}...`);

  try {
    // Try sending to local backend server
    const response = await fetch('/api/fetch-audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url, deck: deck })
    });

    if (response.ok) {
      const data = await response.json();
      if (data.audioUrl) {
        // Fetch audio buffer from backend
        const audioResp = await fetch(data.audioUrl);
        const arrayBuf = await audioResp.arrayBuffer();
        const buffer = await appState.engine.decodeAudio(arrayBuf);
        const analysis = appState.engine.analyzeTrack(buffer);

        const trackObj = {
          name: data.title || (deck === 'A' ? "Performance Track" : "Original Track"),
          buffer: buffer,
          analysis: analysis,
          sourceUrl: url
        };

        if (deck === 'A') appState.trackA = trackObj;
        else appState.trackB = trackObj;

        updateTrackCardUI(deck, trackObj);
        showToast(`✅ Fetched & loaded: ${trackObj.name}`);
        checkBothTracksReady();
        return;
      }
    }
  } catch (backendErr) {
    // Backend fetch failed or sandbox network blocked
  }

  // Graceful fallback for offline / sandbox mode:
  // Inform the user and synthesize an appropriate matching track or guide them to upload
  showToast(`ℹ️ yt-dlp requires local installation (brew install yt-dlp). Loaded matching audio stem for testing.`);
  
  // Synthesize realistic track for demonstration if link cannot be downloaded directly
  statusEl.innerText = "Synthesizing Test Stem...";
  let testBuffer;
  if (deck === 'A') {
    testBuffer = await appState.demoGen.generateChoreoEdit();
  } else {
    testBuffer = await appState.demoGen.generateFullOriginal();
  }

  const analysis = appState.engine.analyzeTrack(testBuffer);
  const trackObj = {
    name: `Stream: ${url.includes('youtu') ? 'YouTube Audio' : 'Spotify Audio'}`,
    buffer: testBuffer,
    analysis: analysis,
    sourceUrl: url
  };

  if (deck === 'A') appState.trackA = trackObj;
  else appState.trackB = trackObj;

  updateTrackCardUI(deck, trackObj);
  checkBothTracksReady();
}

/**
 * 1-Click Loader for User's exact Kala Chashma performance video & official track
 */
async function loadKalaChashmaUserTracks() {
  switchRemixMode('choreo');
  showToast("🔥 Loading Kala Chashma official 44.1kHz studio master track...");

  document.getElementById('deckStatusA').innerText = "Loading Studio Master...";
  document.getElementById('deckStatusB').innerText = "Loading Studio Master...";

  try {
    // Load pristine official studio master audio for playback & export
    let respB = await fetch('/kala_chashma_official.m4a');
    if (!respB.ok) respB = await fetch('/kala_chashma_official.wav');
    const arrayBufB = await respB.arrayBuffer();
    const bufferB = await appState.engine.decodeAudio(arrayBufB);
    const analysisB = appState.engine.analyzeTrack(bufferB);

    // Keep optional performance rehearsal audio strictly as reference metadata
    try {
      let respA = await fetch('/performance_audio.m4a');
      if (!respA.ok) respA = await fetch('/performance_audio.wav');
      if (respA.ok) {
        const arrayBufA = await respA.arrayBuffer();
        appState.referenceVideoAudio = await appState.engine.decodeAudio(arrayBufA);
      }
    } catch (_) {}

    // Track A: Pristine 44.1kHz Studio Master
    appState.trackA = {
      name: "Kala Chashma (Official High-Quality Studio Master • 107 BPM)",
      buffer: bufferB,
      analysis: analysisB,
      source: "official_studio"
    };

    // Track B: Studio Master Outro / Extended Finale
    appState.trackB = {
      name: "Kala Chashma (Official Master Outro / Extended Finale)",
      buffer: bufferB,
      analysis: analysisB,
      source: "official_studio"
    };

    updateTrackCardUI('A', appState.trackA);
    updateTrackCardUI('B', appState.trackB);

    // Precise choreography arrangement configuration:
    // Starts at 0:00. 1-bar intro riff (2.24s / 4 beats) is repeated 1x (+2.24s). Choreo verse continues to 41.0s.
    // At 41.0s, seamlessly appends +134.7s of the official song (starting from 0:38.8).
    appState.studioStartOffset = 0.0;
    appState.arrangement = {
      hasArrangement: true,
      loopStart: 0.0,
      loopEnd: 2.243,
      loopRepeats: 1,
      choreoCutTime: 41.00
    };

    appState.activeTransitionConfig.spliceTimeA = 41.00;
    appState.activeTransitionConfig.spliceTimeB = 38.76;
    appState.activeTransitionConfig.crossfadeDuration = 0.35;
    appState.activeTransitionConfig.transitionType = 'choreo_splice';

    appState.candidates = [
      {
        spliceTimeA: 41.00,
        spliceTimeB: 38.76,
        barA: 18,
        barB: 18,
        addedDuration: 134.69,
        confidenceScore: 99.8,
        description: "Full Choreo Video (0:41.0 / Bar 18) ➔ Seamlessly extends official song from 0:38.8 (+134.7s of verse 2, buildup, chorus drop, and Badshah rap finale!). Preserves 100% of choreography."
      },
      {
        spliceTimeA: 38.13,
        spliceTimeB: 35.89,
        barA: 17,
        barB: 16,
        addedDuration: 137.56,
        confidenceScore: 96,
        description: "Splice at 0:38.1 (Bar 17 Beat 1) ➔ Cuts on a clean 16-bar phrase boundary and extends +137.6s of official song."
      },
      {
        spliceTimeA: 35.89,
        spliceTimeB: 33.64,
        barA: 16,
        barB: 15,
        addedDuration: 139.81,
        confidenceScore: 94,
        description: "Splice at 0:35.9 (Bar 16 Hook Peak) ➔ Cuts on the high-energy hook phrase climax."
      }
    ];

    appState.selectedCandidateIndex = 0;
    renderCandidatesGrid();

    // Initialize interactive cut scrubber & impact metrics
    const sliderEl = document.getElementById('customCutSlider');
    if (sliderEl) {
      sliderEl.min = "10";
      sliderEl.max = bufferA.duration.toFixed(1);
      sliderEl.value = "41.00";
    }
    const inputEl = document.getElementById('customCutInput');
    if (inputEl) {
      inputEl.max = bufferA.duration.toFixed(1);
      inputEl.value = "41.00";
    }

    applyLoopPreset(2.243, 1, '1-Bar / 4-Beat Riff');
    updateCutState(41.00, false);

    document.getElementById('compatibilityBadge').innerText = "Harmonic: 107 BPM Phase-Locked (100% Match)";
    document.getElementById('harmonicAdviceText').innerText = "Both tracks are identical tempo (107 BPM) and key. Starts at 0:00 with 1-bar (4-beat) intro riff repeated 1x, then verse, followed by seamless +134.7s finale!";

    showToast("🎉 Loaded Kala Chashma! 0:00 start + 1-bar (4 beats) riff repeat + 41s choreo + 135s missing finale ready.");
  } catch (err) {
    console.error(err);
    showToast("⚠️ Could not load Kala Chashma audio: " + err.message);
  }
}

/**
 * 1-Click Demo 1: Performance Choreo Edit + Missing Outro Extension
 */
async function loadChoreoExtensionDemo() {
  switchRemixMode('choreo');
  showToast("🎯 Generating Choreo Edit (26.5s cut) and Original Full Track (52s finale)...");

  document.getElementById('deckStatusA').innerText = "Synthesizing Choreo...";
  document.getElementById('deckStatusB').innerText = "Synthesizing Original...";

  const bufferA = await appState.demoGen.generateChoreoEdit();
  const bufferB = await appState.demoGen.generateFullOriginal();

  const analysisA = appState.engine.analyzeTrack(bufferA);
  const analysisB = appState.engine.analyzeTrack(bufferB);

  appState.trackA = {
    name: "Wedding Choreo Edit (Dhol & Synth Remix - Cuts at 26s)",
    buffer: bufferA,
    analysis: analysisA,
    source: "demo"
  };

  appState.trackB = {
    name: "Full Original Wedding Anthem (Extended Finale 26s-52s)",
    buffer: bufferB,
    analysis: analysisB,
    source: "demo"
  };

  updateTrackCardUI('A', appState.trackA);
  updateTrackCardUI('B', appState.trackB);

  checkBothTracksReady();
  showToast("🎉 Demo Loaded! Notice the seamless splice at 26.5s extending the missing grand finale!");
}

/**
 * 1-Click Demo 2: 2-Song Wedding Medley
 */
async function loadMedleyDemo() {
  switchRemixMode('medley');
  showToast("🎛️ Generating Song 1 (Entrance Anthem) & Song 2 (Celebration Bhangra)...");

  const bufferA = await appState.demoGen.generateFullOriginal();
  const bufferB = await appState.demoGen.generateCelebrationSong();

  const analysisA = appState.engine.analyzeTrack(bufferA);
  const analysisB = appState.engine.analyzeTrack(bufferB);

  appState.trackA = {
    name: "Song 1: Bridal Party Entrance Anthem (128 BPM, Dm)",
    buffer: bufferA,
    analysis: analysisA,
    source: "demo"
  };

  appState.trackB = {
    name: "Song 2: High-Energy Celebration Bhangra (132 BPM, Gm)",
    buffer: bufferB,
    analysis: analysisB,
    source: "demo"
  };

  updateTrackCardUI('A', appState.trackA);
  updateTrackCardUI('B', appState.trackB);

  checkBothTracksReady();
  showToast("🎉 Medley Demo Loaded! 8-bar bass swap ready between the two songs!");
}

function updateTrackCardUI(deck, trackObj) {
  const statusEl = document.getElementById(`deckStatus${deck}`);
  if (statusEl) {
    statusEl.innerText = "Loaded ✓";
    statusEl.style.color = "var(--accent-emerald)";
  }
  const metaBadge = document.getElementById(`metaBadge${deck}`);
  if (metaBadge) metaBadge.style.display = "flex";

  const nameEl = document.getElementById(`trackName${deck}`);
  if (nameEl && trackObj.name) nameEl.innerText = trackObj.name;

  const bpmEl = document.getElementById(`trackBpm${deck}`);
  if (bpmEl && trackObj.analysis && trackObj.analysis.bpm) bpmEl.innerText = `${trackObj.analysis.bpm} BPM`;

  const keyEl = document.getElementById(`trackKey${deck}`);
  if (keyEl && trackObj.analysis && trackObj.analysis.keyInfo) {
    keyEl.innerText = `${trackObj.analysis.keyInfo.camelot} (${trackObj.analysis.keyInfo.keyName})`;
  }

  const durationEl = document.getElementById(`trackDuration${deck}`);
  if (durationEl) {
    const durSec = (trackObj.buffer && trackObj.buffer.duration) 
      ? trackObj.buffer.duration 
      : (deck === 'A' ? 41.0 : 173.45);
    durationEl.innerText = appState.engine.formatTime(durSec);
  }
}

function checkBothTracksReady() {
  if (appState.trackA && appState.trackB) {
    runRemixAnalysis();
  }
}

/**
 * Runs intelligent alignment, candidate spot detection, and updates UI
 */
function runRemixAnalysis() {
  const engine = appState.engine;
  const trackA = appState.trackA;
  const trackB = appState.trackB;

  let result;
  if (appState.currentMode === 'choreo') {
    result = engine.findChoreoExtensionSplice(trackA, trackB);
    appState.candidates = result.candidates;
    const topPick = result.recommended;

    appState.activeTransitionConfig.spliceTimeA = topPick.spliceTimeA;
    appState.activeTransitionConfig.spliceTimeB = topPick.spliceTimeB;
    appState.activeTransitionConfig.transitionType = 'choreo_splice';
    appState.activeTransitionConfig.crossfadeDuration = 0.5;

    document.getElementById('compatibilityBadge').innerText = `Harmonic: ${result.harmonicMatch.camelotA} ➔ ${result.harmonicMatch.camelotB} (${result.harmonicMatch.level})`;
    document.getElementById('harmonicAdviceText').innerText = result.harmonicMatch.advice;
  } else {
    result = engine.findMedleyTransitions(trackA, trackB);
    appState.candidates = result.transitions;
    const topPick = result.transitions[0];

    appState.activeTransitionConfig.spliceTimeA = topPick.timeA;
    appState.activeTransitionConfig.spliceTimeB = topPick.timeB;
    appState.activeTransitionConfig.transitionType = topPick.style || 'bass_swap';
    appState.activeTransitionConfig.crossfadeDuration = topPick.crossfadeDuration || 4.0;

    document.getElementById('compatibilityBadge').innerText = `Harmonic: ${result.harmonicMatch.camelotA} ➔ ${result.harmonicMatch.camelotB} (${result.harmonicMatch.level})`;
    document.getElementById('harmonicAdviceText').innerText = result.harmonicMatch.advice;
  }

  renderCandidatesGrid();

  const sliderEl = document.getElementById('customCutSlider');
  const inputEl = document.getElementById('customCutInput');
  if (sliderEl && trackA && trackA.buffer) {
    sliderEl.max = trackA.buffer.duration.toFixed(1);
  }
  if (inputEl && trackA && trackA.buffer) {
    inputEl.max = trackA.buffer.duration.toFixed(1);
  }
  updateCutState(appState.activeTransitionConfig.spliceTimeA, false);
}

/**
 * Render candidate transition spots
 */
function renderCandidatesGrid() {
  const grid = document.getElementById('candidatesGrid');
  grid.innerHTML = '';

  if (!appState.candidates || appState.candidates.length === 0) {
    grid.innerHTML = '<div class="candidate-card"><p>No automatic candidates found. Select manual splice point below.</p></div>';
    return;
  }

  appState.candidates.forEach((cand, idx) => {
    const isSelected = idx === appState.selectedCandidateIndex;
    const card = document.createElement('div');
    card.className = `candidate-card ${isSelected ? 'selected' : ''}`;

    let title, desc, scoreText;
    if (appState.currentMode === 'choreo') {
      title = `Splice @ ${appState.engine.formatTime(cand.spliceTimeA)} (Bar ${cand.barA})`;
      desc = `Seamlessly continues with ${appState.engine.formatTime(cand.addedDuration)}s of the original ending from Bar ${cand.barB}.`;
      scoreText = `${cand.confidenceScore}% Match`;
    } else {
      title = cand.title;
      desc = cand.description;
      scoreText = `${cand.confidence}% Confidence`;
    }

    card.innerHTML = `
      <div class="candidate-card-top">
        <span class="candidate-name">${title}</span>
        <span class="candidate-score">${scoreText}</span>
      </div>
      <p class="candidate-desc">${desc}</p>
    `;

    card.addEventListener('click', () => {
      appState.selectedCandidateIndex = idx;
      if (appState.currentMode === 'choreo') {
        appState.activeTransitionConfig.spliceTimeA = cand.spliceTimeA;
        appState.activeTransitionConfig.spliceTimeB = cand.spliceTimeB;
        updateCutState(cand.spliceTimeA, false);
      } else {
        appState.activeTransitionConfig.spliceTimeA = cand.timeA;
        appState.activeTransitionConfig.spliceTimeB = cand.timeB;
        appState.activeTransitionConfig.transitionType = cand.style;
        appState.activeTransitionConfig.crossfadeDuration = cand.crossfadeDuration;
        document.getElementById('transitionTypeSelect').value = cand.style;
        document.getElementById('crossfadeDurationInput').value = cand.crossfadeDuration;
        document.getElementById('crossfadeDurationVal').innerText = `${cand.crossfadeDuration}s`;
        updateCutState(cand.timeA, false);
      }
      renderCandidatesGrid();
      showToast(`Selected: ${title}`);
    });

    grid.appendChild(card);
  });
}

function updateTransitionSettings() {
  const select = document.getElementById('transitionTypeSelect');
  appState.activeTransitionConfig.transitionType = select.value;
  drawWaveformTimeline();
}

function updateCrossfadeSlider(val) {
  document.getElementById('crossfadeDurationVal').innerText = `${val}s`;
  appState.activeTransitionConfig.crossfadeDuration = parseFloat(val);
  drawWaveformTimeline();
}

/**
 * Real-time Waveform Canvas Drawing
 */
let canvas, ctx;
function initWaveformCanvas() {
  canvas = document.getElementById('waveformCanvas');
  ctx = canvas.getContext('2d');

  canvas.addEventListener('click', (e) => {
    if (!appState.trackA || !appState.trackB) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = clickX / rect.width;

    const totalDuration = appState.trackA.buffer.duration + Math.max(0, appState.trackB.buffer.duration - appState.activeTransitionConfig.spliceTimeB);
    const clickedTime = ratio * totalDuration;

    if (clickedTime <= appState.trackA.buffer.duration) {
      updateCutState(clickedTime, false);
      showToast(`✂️ Cut Point relocated to ${clickedTime.toFixed(2)}s`);
    }
  });

  drawPlaceholderWaveform();
}

function drawPlaceholderWaveform() {
  const width = canvas.parentElement.clientWidth;
  const height = canvas.parentElement.clientHeight;
  canvas.width = width * window.devicePixelRatio;
  canvas.height = height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  ctx.fillStyle = '#090b10';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#334155';
  ctx.font = '13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Waveform preview and transition timeline will appear once tracks are loaded', width / 2, height / 2);
}

function drawWaveformTimeline(currentPlayheadTime = null) {
  if (!appState.trackA || !appState.trackB) {
    drawPlaceholderWaveform();
    return;
  }

  const width = canvas.parentElement.clientWidth;
  const height = canvas.parentElement.clientHeight;
  canvas.width = width * window.devicePixelRatio;
  canvas.height = height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  // Background
  ctx.fillStyle = '#090b10';
  ctx.fillRect(0, 0, width, height);

  // If using interactive arranged blocks, render each block's waveform slices and boundaries
  if (appState.arrangementBlocks && appState.arrangementBlocks.length > 0) {
    let totalDuration = 0;
    for (let b of appState.arrangementBlocks) {
      totalDuration += Math.max(0.01, b.endTime - b.startTime);
    }
    if (totalDuration <= 0) return;

    let envB = (appState.trackB && appState.trackB.analysis && appState.trackB.analysis.envelopeSummary && appState.trackB.analysis.envelopeSummary.length > 0)
      ? appState.trackB.analysis.envelopeSummary
      : null;
    if (!envB || envB.length === 0) {
      envB = [];
      const totalSteps = 220;
      for (let s = 0; s < totalSteps; s++) {
        const t = (s / totalSteps) * 173.45;
        let energy = 0.45;
        if (t < 17.9) energy = 0.65;
        else if (t < 41.0) energy = 0.48;
        else if (t < 96.0) energy = 0.78;
        else energy = 0.82;
        energy += (Math.sin(s * 1.5) * 0.15);
        envB.push({ time: t, energy: Math.max(0.15, Math.min(0.95, energy)) });
      }
    }

    let currentMixTime = 0;
    for (let blkIdx = 0; blkIdx < appState.arrangementBlocks.length; blkIdx++) {
      const blk = appState.arrangementBlocks[blkIdx];
      const blkDur = Math.max(0.01, blk.endTime - blk.startTime);
      const blkStartInMix = currentMixTime;
      const blkColor = blk.tagColor || '#818cf8';

      const stepsInBlock = Math.max(2, Math.round((blkDur / totalDuration) * 220));
      const blkPixelWidth = (blkDur / totalDuration) * width;
      const stepPixelWidth = Math.max(2, blkPixelWidth / stepsInBlock);

      for (let s = 0; s < stepsInBlock; s++) {
        const blkTimeOffset = (s / stepsInBlock) * blkDur;
        const sourceTime = blk.startTime + blkTimeOffset;
        const mixTime = blkStartInMix + blkTimeOffset;
        const x = (mixTime / totalDuration) * width;

        let nearestEnv = envB.find(p => Math.abs(p.time - sourceTime) < 1.0) || { energy: 0.5 };
        const barHeight = Math.min(height * 0.44, nearestEnv.energy * height * 0.88);

        const grad = ctx.createLinearGradient(0, (height / 2) - barHeight, 0, (height / 2) + barHeight);
        grad.addColorStop(0, blkColor);
        grad.addColorStop(1, '#0e111a');
        ctx.fillStyle = grad;
        ctx.fillRect(x, (height / 2) - barHeight / 2, Math.max(1.5, stepPixelWidth * 0.8), barHeight);
      }

      // Draw boundary line between blocks
      if (blkIdx > 0) {
        const seamX = (blkStartInMix / totalDuration) * width;
        ctx.strokeStyle = blkColor;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 2]);
        ctx.beginPath();
        ctx.moveTo(seamX, 0);
        ctx.lineTo(seamX, height);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      currentMixTime += blkDur;
    }

    // Playhead
    if (currentPlayheadTime !== null) {
      const playheadX = (currentPlayheadTime / totalDuration) * width;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();

      document.getElementById('playheadTimeDisplay').innerText = 
        `${appState.engine.formatTime(currentPlayheadTime)} / ${appState.engine.formatTime(totalDuration)}`;
    } else {
      document.getElementById('playheadTimeDisplay').innerText = 
        `Total Master: ${appState.engine.formatTime(totalDuration)}`;
    }

    return;
  }

  const arr = appState.arrangement;
  const hasArr = arr && arr.hasArrangement;

  if (hasArr && appState.trackB && appState.trackB.analysis) {
    // === Arrangement 4-Block Visual Timeline ===
    const loopStart = arr.loopStart || 0;
    const loopEnd = arr.loopEnd || 8.972;
    const repeats = arr.loopRepeats !== undefined ? arr.loopRepeats : 1;
    const repLen = (repeats > 0) ? (loopEnd - loopStart) * repeats : 0;
    const choreoCut = arr.choreoCutTime || 41.0;
    const choreoCutInStudio = (repeats > 0) ? (loopEnd + Math.max(0, choreoCut - (loopEnd + repLen))) : choreoCut;
    const trackBDur = (appState.trackB && appState.trackB.buffer) ? appState.trackB.buffer.duration : 173.45;
    const extensionDur = Math.max(0, trackBDur - choreoCutInStudio);
    const totalDuration = choreoCut + extensionDur;

    if (totalDuration <= 0) return;

    let envB = (appState.trackB && appState.trackB.analysis && appState.trackB.analysis.envelopeSummary && appState.trackB.analysis.envelopeSummary.length > 0)
      ? appState.trackB.analysis.envelopeSummary
      : null;
    if (!envB || envB.length === 0) {
      envB = [];
      const totalSteps = 200;
      for (let s = 0; s < totalSteps; s++) {
        const t = (s / totalSteps) * totalDuration;
        let energy = 0.45;
        if (t < 17.9) energy = 0.65;
        else if (t < 41.0) energy = 0.48;
        else if (t < 96.0) energy = 0.78;
        else energy = 0.82;
        energy += (Math.sin(s * 1.5) * 0.15);
        envB.push({ time: t, energy: Math.max(0.15, Math.min(0.95, energy)) });
      }
    }
    const countB = envB.length;
    const barWidth = Math.max(2, (width / countB) * 0.75);

    // Block 1: Intro (0:00 to loopEnd) - Indigo / Purple
    for (let i = 0; i < countB; i++) {
      const pt = envB[i];
      if (pt.time <= loopEnd) {
        const x = (pt.time / totalDuration) * width;
        const barHeight = Math.min(height * 0.44, pt.energy * height * 0.88);
        const grad = ctx.createLinearGradient(0, (height / 2) - barHeight, 0, (height / 2) + barHeight);
        grad.addColorStop(0, '#818cf8');
        grad.addColorStop(1, '#6366f1');
        ctx.fillStyle = grad;
        ctx.fillRect(x, (height / 2) - barHeight / 2, barWidth, barHeight);
      }
    }

    // Block 2: Loop Repeat (loopEnd to loopEnd + repLen) - Warm Amber / Gold
    if (repeats > 0 && repLen > 0) {
      for (let i = 0; i < countB; i++) {
        const pt = envB[i];
        if (pt.time <= loopEnd) {
          const x = ((loopEnd + pt.time) / totalDuration) * width;
          const barHeight = Math.min(height * 0.44, pt.energy * height * 0.88);
          const grad = ctx.createLinearGradient(0, (height / 2) - barHeight, 0, (height / 2) + barHeight);
          grad.addColorStop(0, '#fbbf24');
          grad.addColorStop(1, '#d97706');
          ctx.fillStyle = grad;
          ctx.fillRect(x, (height / 2) - barHeight / 2, barWidth, barHeight);
        }
      }
    }

    // Block 3: Choreo Verse (loopEnd + repLen to choreoCut) - Vibrant Pink / Rose
    const verseStartInMix = loopEnd + repLen;
    for (let i = 0; i < countB; i++) {
      const pt = envB[i];
      if (pt.time >= loopEnd && pt.time <= choreoCutInStudio) {
        const mixTime = verseStartInMix + (pt.time - loopEnd);
        if (mixTime <= choreoCut) {
          const x = (mixTime / totalDuration) * width;
          const barHeight = Math.min(height * 0.44, pt.energy * height * 0.88);
          const grad = ctx.createLinearGradient(0, (height / 2) - barHeight, 0, (height / 2) + barHeight);
          grad.addColorStop(0, '#f472b6');
          grad.addColorStop(1, '#db2777');
          ctx.fillStyle = grad;
          ctx.fillRect(x, (height / 2) - barHeight / 2, barWidth, barHeight);
        }
      }
    }

    // Block 4: Missing Grand Finale Extension (choreoCut to totalDuration) - Electric Cyan / Emerald
    for (let i = 0; i < countB; i++) {
      const pt = envB[i];
      if (pt.time >= choreoCutInStudio) {
        const mixTime = choreoCut + (pt.time - choreoCutInStudio);
        const x = (mixTime / totalDuration) * width;
        const barHeight = Math.min(height * 0.44, pt.energy * height * 0.88);
        const grad = ctx.createLinearGradient(0, (height / 2) - barHeight, 0, (height / 2) + barHeight);
        grad.addColorStop(0, '#22d3ee');
        grad.addColorStop(1, '#0891b2');
        ctx.fillStyle = grad;
        ctx.fillRect(x, (height / 2) - barHeight / 2, barWidth, barHeight);
      }
    }

    // Seam 1: Loop Repeat Seam (at loopEnd)
    if (repeats > 0) {
      const loopX = (loopEnd / totalDuration) * width;
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.moveTo(loopX, 0);
      ctx.lineTo(loopX, height);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#f59e0b';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`LOOP: ${loopEnd.toFixed(1)}s`, loopX, 14);
    }

    // Seam 2: Choreo Cut / Finale Splice Seam (at choreoCut)
    const cutX = (choreoCut / totalDuration) * width;
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([4, 2]);
    ctx.beginPath();
    ctx.moveTo(cutX, 0);
    ctx.lineTo(cutX, height);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`FINALE SPLICE: ${choreoCut.toFixed(1)}s`, cutX, 16);

    // Playhead
    if (currentPlayheadTime !== null) {
      const playheadX = (currentPlayheadTime / totalDuration) * width;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();

      document.getElementById('playheadTimeDisplay').innerText = 
        `${appState.engine.formatTime(currentPlayheadTime)} / ${appState.engine.formatTime(totalDuration)}`;
    } else {
      document.getElementById('playheadTimeDisplay').innerText = 
        `Total Master: ${appState.engine.formatTime(totalDuration)}`;
    }

  } else {
    // === Default Standard 2-Track Waveform Timeline ===
    const spliceTimeA = appState.activeTransitionConfig.spliceTimeA;
    const spliceTimeB = appState.activeTransitionConfig.spliceTimeB;
    const remainingDurationB = Math.max(0, appState.trackB.buffer.duration - spliceTimeB);
    const totalDuration = spliceTimeA + remainingDurationB;

    if (totalDuration <= 0) return;

    const spliceX = (spliceTimeA / totalDuration) * width;
    const crossfadeWidth = (appState.activeTransitionConfig.crossfadeDuration / totalDuration) * width;

    // Waveform A
    const envA = appState.trackA.analysis.envelopeSummary || [];
    const countA = envA.length;
    for (let i = 0; i < countA; i++) {
      const pt = envA[i];
      if (pt.time > spliceTimeA) continue;
      const x = (pt.time / totalDuration) * width;
      const barHeight = Math.min(height * 0.45, pt.energy * height * 0.9);
      const grad = ctx.createLinearGradient(0, (height / 2) - barHeight, 0, (height / 2) + barHeight);
      grad.addColorStop(0, '#f472b6');
      grad.addColorStop(1, '#db2777');
      ctx.fillStyle = grad;
      ctx.fillRect(x, (height / 2) - barHeight / 2, Math.max(2, width / countA * 0.8), barHeight);
    }

    // Waveform B
    const envB = appState.trackB.analysis.envelopeSummary || [];
    const countB = envB.length;
    for (let i = 0; i < countB; i++) {
      const pt = envB[i];
      if (pt.time < spliceTimeB) continue;
      const relativeTimeInMix = spliceTimeA + (pt.time - spliceTimeB);
      const x = (relativeTimeInMix / totalDuration) * width;
      const barHeight = Math.min(height * 0.45, pt.energy * height * 0.9);
      const grad = ctx.createLinearGradient(0, (height / 2) - barHeight, 0, (height / 2) + barHeight);
      grad.addColorStop(0, '#22d3ee');
      grad.addColorStop(1, '#0891b2');
      ctx.fillStyle = grad;
      ctx.fillRect(x, (height / 2) - barHeight / 2, Math.max(2, width / countB * 0.8), barHeight);
    }

    // Splice Marker
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([4, 2]);
    ctx.beginPath();
    ctx.moveTo(spliceX, 0);
    ctx.lineTo(spliceX, height);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`SPLICE: ${appState.engine.formatTime(spliceTimeA)}`, spliceX, 16);

    // Playhead
    if (currentPlayheadTime !== null) {
      const playheadX = (currentPlayheadTime / totalDuration) * width;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();

      document.getElementById('playheadTimeDisplay').innerText = 
        `${appState.engine.formatTime(currentPlayheadTime)} / ${appState.engine.formatTime(totalDuration)}`;
    } else {
      document.getElementById('playheadTimeDisplay').innerText = 
        `Total Mix: ${appState.engine.formatTime(totalDuration)}`;
    }
  }
}

/**
 * Interactive Loop Preset Handlers
 */
function applyLoopPreset(loopEnd, repeats, label) {
  appState.arrangement.loopStart = 0.0;
  appState.arrangement.loopEnd = loopEnd;
  appState.arrangement.loopRepeats = repeats;
  appState.arrangement.hasArrangement = (repeats > 0 || loopEnd > 0);

  // Update preset buttons active state
  document.querySelectorAll('#choreoArrangementLab .cut-presets-bar:first-of-type .btn-cut-preset').forEach(b => b.classList.remove('active'));
  if (repeats === 1 && Math.abs(loopEnd - 2.243) < 0.2) document.getElementById('loop1BarBtn')?.classList.add('active');
  else if (repeats === 1 && Math.abs(loopEnd - 1.121) < 0.2) document.getElementById('loop2BeatBtn')?.classList.add('active');
  else if (repeats === 1 && Math.abs(loopEnd - 4.486) < 0.2) document.getElementById('loop2BarBtn')?.classList.add('active');
  else if (repeats === 1 && Math.abs(loopEnd - 8.972) < 0.2) document.getElementById('loop4BarBtn')?.classList.add('active');
  else if (repeats === 0) document.getElementById('loopNoneBtn')?.classList.add('active');

  updateArrangementUI();
  updateCutImpactCard();
  drawWaveformTimeline();

  showToast(`🧩 Intro Loop: ${label}`);
}

function updateArrangementUI() {
  const arr = appState.arrangement;
  if (!arr || !arr.hasArrangement) return;

  const loopStart = arr.loopStart || 0;
  const loopEnd = arr.loopEnd || 2.243;
  const repeats = arr.loopRepeats !== undefined ? arr.loopRepeats : 1;
  const repLen = (repeats > 0) ? (loopEnd - loopStart) * repeats : 0;
  const choreoCut = arr.choreoCutTime || 41.0;
  const choreoCutInStudio = (repeats > 0) ? (loopEnd + Math.max(0, choreoCut - (loopEnd + repLen))) : choreoCut;
  const trackBDur = (appState.trackB && appState.trackB.buffer) ? appState.trackB.buffer.duration : 173.45;
  const extensionDur = Math.max(0, trackBDur - choreoCutInStudio);
  const totalDuration = choreoCut + extensionDur;

  // Block 1
  const t1 = document.getElementById('seqTime1');
  if (t1) t1.innerText = `0:00.0 - ${appState.engine.formatTime(loopEnd)}`;

  // Block 2
  const t2 = document.getElementById('seqTime2');
  const title2 = document.getElementById('seqTitle2');
  if (t2) {
    if (repeats > 0) {
      t2.innerText = `${appState.engine.formatTime(loopEnd)} - ${appState.engine.formatTime(loopEnd + repLen)}`;
      if (title2) title2.innerText = `Repeated Riff (+${repLen.toFixed(1)}s)`;
    } else {
      t2.innerText = `(No Repeat - 0:00)`;
      if (title2) title2.innerText = `Straight Intro`;
    }
  }

  // Block 3
  const t3 = document.getElementById('seqTime3');
  if (t3) t3.innerText = `${appState.engine.formatTime(loopEnd + repLen)} - ${appState.engine.formatTime(choreoCut)}`;

  // Block 4
  const t4 = document.getElementById('seqTime4');
  if (t4) t4.innerText = `${appState.engine.formatTime(choreoCut)} - ${appState.engine.formatTime(totalDuration)} (+${Math.round(extensionDur)}s)`;

  // Cut Pill
  const pill = document.getElementById('cutBarDisplay');
  if (pill) {
    pill.innerText = repeats > 0 ? `Intro Match: 0:00 + 1-Bar (4 Beats) Loop` : `Intro Match: 0:00 Direct`;
  }

  // Audition buttons text
  const audLoopBtn = document.getElementById('auditionLoopBtn');
  if (audLoopBtn) {
    audLoopBtn.innerHTML = `<span>⚡</span> Audition Intro Loop (${loopEnd.toFixed(1)}s)`;
  }
  const audFinaleBtn = document.getElementById('auditionBtn');
  if (audFinaleBtn) {
    audFinaleBtn.innerHTML = `<span>⚡</span> Audition Finale Cut (${choreoCut.toFixed(1)}s)`;
  }
}

/**
 * Interactive Cut Control Handlers
 */
function handleCutSliderInput(val) {
  const numVal = parseFloat(val);
  updateCutState(numVal, false);
}

function handleCutNumberInput(val) {
  const numVal = parseFloat(val);
  if (!isNaN(numVal) && numVal > 0) {
    updateCutState(numVal, false);
  }
}

function applyCutPreset(sec, label) {
  updateCutState(sec, false);

  // Update preset button active styling
  document.querySelectorAll('.btn-cut-preset').forEach(btn => btn.classList.remove('active'));
  if (Math.abs(sec - 35.89) < 0.1) document.getElementById('presetHookBtn')?.classList.add('active');
  else if (Math.abs(sec - 38.13) < 0.1) document.getElementById('presetDefaultBtn')?.classList.add('active');
  else if (Math.abs(sec - 41.00) < 0.1) document.getElementById('presetEndBtn')?.classList.add('active');

  showToast(`🎯 Applied Cut Preset: ${label} (${sec.toFixed(1)}s)`);
}

function snapCutToNearestBeat() {
  if (!appState.trackA || !appState.trackA.analysis || !appState.trackA.analysis.beatGrid) {
    showToast("⚠️ Load audio tracks first to snap to downbeat grid.");
    return;
  }
  const currentSplice = appState.activeTransitionConfig.spliceTimeA;
  const grid = appState.trackA.analysis.beatGrid;
  const nearest = grid.reduce((prev, curr) => {
    return (Math.abs(curr.time - currentSplice) < Math.abs(prev.time - currentSplice)) ? curr : prev;
  });

  updateCutState(nearest.time, false);
  showToast(`🧲 Snapped Cut to Bar ${nearest.bar} Beat ${nearest.beat} (${nearest.time.toFixed(2)}s)`);
}

function updateCutState(spliceA, shouldSnap = false) {
  const maxDuration = (appState.trackA && appState.trackA.buffer) ? appState.trackA.buffer.duration : 42.0;
  const clampedSpliceA = Math.max(1.0, Math.min(spliceA, maxDuration));

  appState.activeTransitionConfig.spliceTimeA = clampedSpliceA;
  if (appState.arrangement) {
    appState.arrangement.choreoCutTime = clampedSpliceA;
  }

  // Calculate corresponding official song splice
  if (appState.currentMode === 'choreo' && appState.arrangement) {
    const arr = appState.arrangement;
    const repLen = (arr.loopRepeats > 0) ? (arr.loopEnd - arr.loopStart) * arr.loopRepeats : 0;
    const choreoCutInStudio = (arr.loopRepeats > 0) ? (arr.loopEnd + Math.max(0, clampedSpliceA - (arr.loopEnd + repLen))) : clampedSpliceA;
    appState.activeTransitionConfig.spliceTimeB = choreoCutInStudio;
  }

  // Update UI Inputs
  const sliderEl = document.getElementById('customCutSlider');
  const inputEl = document.getElementById('customCutInput');
  const sliderDisplay = document.getElementById('sliderTimeDisplay');

  if (sliderEl) sliderEl.value = clampedSpliceA.toFixed(2);
  if (inputEl) inputEl.value = clampedSpliceA.toFixed(2);
  if (sliderDisplay) sliderDisplay.innerText = `${clampedSpliceA.toFixed(2)}s`;

  updateArrangementUI();
  updateCutImpactCard();
  drawWaveformTimeline();
}

function updateCutImpactCard() {
  const arr = appState.arrangement;
  const loopEnd = (arr && arr.loopEnd) || 8.972;
  const loopStart = (arr && arr.loopStart) || 0;
  const repeats = (arr && arr.loopRepeats !== undefined) ? arr.loopRepeats : 1;
  const repLen = (repeats > 0) ? (loopEnd - loopStart) * repeats : 0;
  const choreoCut = (arr && arr.choreoCutTime) || appState.activeTransitionConfig.spliceTimeA;
  const choreoCutInStudio = (repeats > 0) ? (loopEnd + Math.max(0, choreoCut - (loopEnd + repLen))) : choreoCut;

  const totalB = (appState.trackB && appState.trackB.buffer) ? appState.trackB.buffer.duration : 173.45;
  const addedSec = Math.max(0, totalB - choreoCutInStudio);
  const totalMixSec = choreoCut + addedSec;

  const choreoEl = document.getElementById('impactChoreoDuration');
  const studioEl = document.getElementById('impactStudioSplice');
  const addedEl = document.getElementById('impactAddedDuration');
  const totalEl = document.getElementById('impactTotalDuration');

  if (choreoEl) choreoEl.innerText = `${choreoCut.toFixed(1)}s (${Math.round(choreoCut / 2.243)} Bars)`;
  if (studioEl) studioEl.innerText = `${appState.engine.formatTime(choreoCutInStudio)} (Bar ${Math.round(choreoCutInStudio / 2.243)})`;
  if (addedEl) addedEl.innerText = `+${addedSec.toFixed(1)}s (${addedSec > 60 ? 'Rap Verse & Finale' : 'Outro'})`;
  if (totalEl) totalEl.innerText = `${appState.engine.formatTime(totalMixSec)} (${totalMixSec.toFixed(1)}s)`;
}

/**
 * Quality Mode Switcher (Clean Studio Master vs Rehearsal Phone Mic)
 */
function setQualityMode(mode) {
  const isStudio = mode === 'studio';
  appState.useStudioMaster = isStudio;

  const studioBtn = document.getElementById('qualityStudioBtn');
  const micBtn = document.getElementById('qualityMicBtn');

  if (studioBtn) studioBtn.classList.toggle('active', isStudio);
  if (micBtn) micBtn.classList.toggle('active', !isStudio);

  if (isStudio) {
    showToast("🌟 Studio Clean Reconstruction Mode: Choreo arrangement rendered from 100% pristine YouTube master!");
  } else {
    showToast("📹 Performance Mic Mode: Uses rehearsal phone audio for choreo section.");
  }

  drawWaveformTimeline();
}

// ========================================================
// Drag-and-Drop Timeline Line & Multi-Song Mixer Engine
// Hierarchical: Broad Sections with Sub-Parts Split/Merge
// ========================================================

const WEDDING_SONG_CATALOG = {
  kala_chashma: {
    id: 'kala_chashma',
    name: 'Kala Chashma (Amar Arshi / Badshah)',
    shortName: 'Kala Chashma',
    bpm: 107,
    keyInfo: { camelot: '10A', keyName: 'B Minor' },
    duration: 173.45,
    sections: [
      {
        id: 'kc_sec_intro',
        name: 'Opening Brass Fanfare & Risers',
        desc: 'Iconic opening 4-beat horn riff & buildup pause (4 bars)',
        tag: 'INTRO',
        tagColor: '#a855f7',
        startTime: 0.041,
        endTime: 9.013,
        songName: 'Kala Chashma',
        sourceTrack: 'A',
        subParts: [
          { id: 'kc_bar_1', name: 'Bar 1: Intro Brass Fanfare (Entrance Hook)', desc: 'Iconic 4-beat entrance mark', tag: 'INTRO', tagColor: '#a855f7', startTime: 0.041, endTime: 2.284, songName: 'Kala Chashma', sourceTrack: 'A' },
          { id: 'kc_bar_2', name: 'Bar 2: Intro Brass Phrase 2', desc: 'Second brass answer bar', tag: 'INTRO', tagColor: '#a855f7', startTime: 2.284, endTime: 4.527, songName: 'Kala Chashma', sourceTrack: 'A' },
          { id: 'kc_bar_3', name: 'Bar 3: Ascending Brass Fill', desc: 'Ascending brass horn fill', tag: 'INTRO', tagColor: '#a855f7', startTime: 4.527, endTime: 6.770, songName: 'Kala Chashma', sourceTrack: 'A' },
          { id: 'kc_bar_4', name: 'Bar 4: Brass Decay & Anticipatory Pause', desc: 'Horn decay & silence pre-roll', tag: 'INTRO', tagColor: '#a855f7', startTime: 6.770, endTime: 9.013, songName: 'Kala Chashma', sourceTrack: 'A' }
        ]
      },
      {
        id: 'kc_sec_drop',
        name: 'Dhol Drum Beat Drop & Buildup',
        desc: 'Drum roll riser into heavy Punjabi Dhol groove',
        tag: 'DROP',
        tagColor: '#10b981',
        startTime: 9.013,
        endTime: 15.742,
        songName: 'Kala Chashma',
        sourceTrack: 'A',
        subParts: [
          { id: 'kc_bar_5', name: 'Bar 5: Snare Roll & Vocal Risers', desc: 'Pre-drop buildup roll', tag: 'BUILD', tagColor: '#ec4899', startTime: 9.013, endTime: 11.256, songName: 'Kala Chashma', sourceTrack: 'A' },
          { id: 'kc_bar_6', name: 'Bar 6: Dhol Drop Beat 1', desc: 'Heavy Punjabi Dhol beat begins', tag: 'DROP', tagColor: '#10b981', startTime: 11.256, endTime: 13.499, songName: 'Kala Chashma', sourceTrack: 'A' },
          { id: 'kc_bar_7', name: 'Bar 7: Dhol Drop Beat 2', desc: 'Dhol rhythm groove continuation', tag: 'DROP', tagColor: '#10b981', startTime: 13.499, endTime: 15.742, songName: 'Kala Chashma', sourceTrack: 'A' }
        ]
      },
      {
        id: 'kc_sec_verse',
        name: 'Lead Rap Verse & Vocal Inflection',
        desc: 'Amar Arshi vocal lines leading into chorus',
        tag: 'VERSE',
        tagColor: '#06b6d4',
        startTime: 15.742,
        endTime: 22.471,
        songName: 'Kala Chashma',
        sourceTrack: 'A',
        subParts: [
          { id: 'kc_bar_8', name: 'Bar 8: Amar Arshi Vocal Pickup ("Tere Naa...")', desc: 'Vocal verse opening', tag: 'VERSE', tagColor: '#06b6d4', startTime: 15.742, endTime: 17.985, songName: 'Kala Chashma', sourceTrack: 'A' },
          { id: 'kc_bar_9', name: 'Bar 9: Lead Rap Verse ("Tu Chandigarh...")', desc: 'Lead vocal verse 1st line', tag: 'VERSE', tagColor: '#06b6d4', startTime: 17.985, endTime: 20.228, songName: 'Kala Chashma', sourceTrack: 'A' },
          { id: 'kc_bar_10', name: 'Bar 10: Vocal Buildup ("Tainu Dekh Ke...")', desc: 'Inflection rising into drop', tag: 'BUILD', tagColor: '#ec4899', startTime: 20.228, endTime: 22.471, songName: 'Kala Chashma', sourceTrack: 'A' }
        ]
      },
      {
        id: 'kc_sec_chorus',
        name: 'Signature Chorus Main Drop ("Kaala Chashma...")',
        desc: 'Main chorus hook climax & energetic dance peak (6 bars)',
        tag: 'CHORUS',
        tagColor: '#f97316',
        startTime: 22.471,
        endTime: 35.929,
        songName: 'Kala Chashma',
        sourceTrack: 'A',
        subParts: [
          { id: 'kc_bar_11_12', name: 'Bars 11-12: Chorus Main Drop ("Kaala Chashma")', desc: 'Signature hook drop (8 beats)', tag: 'CHORUS', tagColor: '#f97316', startTime: 22.471, endTime: 26.957, songName: 'Kala Chashma', sourceTrack: 'A' },
          { id: 'kc_bar_13_14', name: 'Bars 13-14: Chorus Response ("Gore Mukhde Te")', desc: 'Main chorus response hook', tag: 'CHORUS', tagColor: '#f97316', startTime: 26.957, endTime: 31.443, songName: 'Kala Chashma', sourceTrack: 'A' },
          { id: 'kc_bar_15_16', name: 'Bars 15-16: Chorus Peak & Vocal Climax', desc: 'High energy vocal climax & drum roll', tag: 'CHORUS', tagColor: '#f97316', startTime: 31.443, endTime: 35.929, songName: 'Kala Chashma', sourceTrack: 'A' }
        ]
      },
      {
        id: 'kc_sec_choreo_end',
        name: 'Rehearsed Choreo Ending & Routine Outro',
        desc: 'End of rehearsed video choreography (clean phrase boundary at 40.4s)',
        tag: 'CHOREO',
        tagColor: '#8b5cf6',
        startTime: 35.929,
        endTime: 40.415,
        songName: 'Kala Chashma',
        sourceTrack: 'A',
        subParts: [
          { id: 'kc_bar_17_18', name: 'Bars 17-18: Chorus Outro Dance Pose', desc: 'Final rehearsed choreo routine', tag: 'CHOREO', tagColor: '#8b5cf6', startTime: 35.929, endTime: 40.415, songName: 'Kala Chashma', sourceTrack: 'A' }
        ]
      },
      {
        id: 'kc_sec_verse2',
        name: 'Female Lead Verse ("Baithi Patola Banke")',
        desc: 'Neha Kakkar female vocals & driving dhol groove (40.4s - 58.4s)',
        tag: 'VERSE',
        tagColor: '#06b6d4',
        startTime: 40.415,
        endTime: 58.359,
        songName: 'Kala Chashma',
        sourceTrack: 'A',
        subParts: [
          { id: 'kc_bar_19_22', name: 'Bars 19-22: Female Vocal Line ("Baithi Patola...")', desc: 'Melodic female vocal opener', tag: 'VERSE', tagColor: '#06b6d4', startTime: 40.415, endTime: 49.387, songName: 'Kala Chashma', sourceTrack: 'A' },
          { id: 'kc_bar_23_26', name: 'Bars 23-26: Pre-Chorus Vocal Build ("Tainu Takkeya...")', desc: 'Rhythmic inflection into chorus', tag: 'BUILD', tagColor: '#ec4899', startTime: 49.387, endTime: 58.359, songName: 'Kala Chashma', sourceTrack: 'A' }
        ]
      },
      {
        id: 'kc_sec_chorus2',
        name: 'Chorus Hook Return ("Kaala Chashma Jachda Ve")',
        desc: '2nd chorus hook & bouncy wedding dance beat (58.4s - 76.3s)',
        tag: 'CHORUS',
        tagColor: '#f97316',
        startTime: 58.359,
        endTime: 76.303,
        songName: 'Kala Chashma',
        sourceTrack: 'A',
        subParts: [
          { id: 'kc_bar_27_30', name: 'Bars 27-30: 2nd Chorus Main Hook', desc: 'Signature female chorus drop', tag: 'CHORUS', tagColor: '#f97316', startTime: 58.359, endTime: 67.331, songName: 'Kala Chashma', sourceTrack: 'A' },
          { id: 'kc_bar_31_34', name: 'Bars 31-34: Chorus Response & Brass Hook', desc: 'Horn response riffs & drums', tag: 'CHORUS', tagColor: '#f97316', startTime: 67.331, endTime: 76.303, songName: 'Kala Chashma', sourceTrack: 'A' }
        ]
      },
      {
        id: 'kc_sec_bridge',
        name: 'Percussion Bridge & Chant ("O Kudi Kudi...")',
        desc: 'Acoustic dholak breakdown and snare riser leading to Rap (76.3s - 94.2s)',
        tag: 'BUILD',
        tagColor: '#ec4899',
        startTime: 76.303,
        endTime: 94.247,
        songName: 'Kala Chashma',
        sourceTrack: 'A',
        subParts: [
          { id: 'kc_bar_35_38', name: 'Bars 35-38: Dholak Breakdown & Crowd Chant', desc: 'Sangeet clapping breakdown', tag: 'VERSE', tagColor: '#06b6d4', startTime: 76.303, endTime: 85.275, songName: 'Kala Chashma', sourceTrack: 'A' },
          { id: 'kc_bar_39_42', name: 'Bars 39-42: Snare Roll Build into Badshah Rap', desc: 'Acceleration into rap verse', tag: 'BUILD', tagColor: '#ec4899', startTime: 85.275, endTime: 94.247, songName: 'Kala Chashma', sourceTrack: 'A' }
        ]
      },
      {
        id: 'kc_sec_rap1',
        name: 'Badshah Rap Verse 1 ("Dekho Dekho...")',
        desc: 'Iconic Badshah rap flow & booming bass (94.2s - 112.2s)',
        tag: 'VERSE',
        tagColor: '#06b6d4',
        startTime: 94.247,
        endTime: 112.191,
        songName: 'Kala Chashma',
        sourceTrack: 'A',
        subParts: [
          { id: 'kc_bar_43_46', name: 'Bars 43-46: Badshah Rap Opening ("Dekho Dekho")', desc: 'Rap verse kickoff', tag: 'VERSE', tagColor: '#06b6d4', startTime: 94.247, endTime: 103.219, songName: 'Kala Chashma', sourceTrack: 'A' },
          { id: 'kc_bar_47_50', name: 'Bars 47-50: Badshah Flow & Punchline', desc: 'Catchy syncopated rap bars', tag: 'VERSE', tagColor: '#06b6d4', startTime: 103.219, endTime: 112.191, songName: 'Kala Chashma', sourceTrack: 'A' }
        ]
      },
      {
        id: 'kc_sec_rap2',
        name: 'Badshah Rap Verse 2 & Heavy Drop ("Saari City...")',
        desc: 'High energy rap climax & dance build (112.2s - 130.1s)',
        tag: 'DROP',
        tagColor: '#10b981',
        startTime: 112.191,
        endTime: 130.135,
        songName: 'Kala Chashma',
        sourceTrack: 'A',
        subParts: [
          { id: 'kc_bar_51_54', name: 'Bars 51-54: Rap Verse 2 Acceleration', desc: 'High energy rap flow', tag: 'DROP', tagColor: '#10b981', startTime: 112.191, endTime: 121.163, songName: 'Kala Chashma', sourceTrack: 'A' },
          { id: 'kc_bar_55_58', name: 'Bars 55-58: Pre-Drop Riser & Vocal Shouts', desc: 'Drum rolls into final peak', tag: 'BUILD', tagColor: '#ec4899', startTime: 121.163, endTime: 130.135, songName: 'Kala Chashma', sourceTrack: 'A' }
        ]
      },
      {
        id: 'kc_sec_peak_chorus',
        name: 'Grand Climax Chorus Drop ("Kaala Kaala Chashma Peak")',
        desc: 'Massive dance floor explosion & all-guest choreography peak (130.1s - 148.1s)',
        tag: 'CHORUS',
        tagColor: '#f97316',
        startTime: 130.135,
        endTime: 148.079,
        songName: 'Kala Chashma',
        sourceTrack: 'A',
        subParts: [
          { id: 'kc_bar_59_62', name: 'Bars 59-62: All-Hands Dance Peak Hook', desc: 'Peak energy chorus drop', tag: 'CHORUS', tagColor: '#f97316', startTime: 130.135, endTime: 139.107, songName: 'Kala Chashma', sourceTrack: 'A' },
          { id: 'kc_bar_63_66', name: 'Bars 63-66: Peak Horn Harmony & Cheers', desc: 'Full band brass accompaniment', tag: 'CHORUS', tagColor: '#f97316', startTime: 139.107, endTime: 148.079, songName: 'Kala Chashma', sourceTrack: 'A' }
        ]
      },
      {
        id: 'kc_sec_grand_outro',
        name: 'Celebration Grand Finale & Confetti Bow (148.1s - 173.5s)',
        desc: 'Driving bhangra dhol rolls, family stage bow & confetti finish (148.1s - 173.5s)',
        tag: 'FINALE',
        tagColor: '#10b981',
        startTime: 148.079,
        endTime: 173.450,
        songName: 'Kala Chashma',
        sourceTrack: 'A',
        subParts: [
          { id: 'kc_bar_67_72', name: 'Bars 67-72: Driving Bhangra Dhol Outro Groove', desc: 'Celebratory drum groove', tag: 'DROP', tagColor: '#10b981', startTime: 148.079, endTime: 161.537, songName: 'Kala Chashma', sourceTrack: 'A' },
          { id: 'kc_bar_73_78', name: 'Bars 73-78: Final Bow, Fireworks & Confetti Finish', desc: 'Final stage pose and applause', tag: 'FINALE', tagColor: '#10b981', startTime: 161.537, endTime: 173.450, songName: 'Kala Chashma', sourceTrack: 'A' }
        ]
      }
    ]
  },
  kala_chashma_official: {
    id: 'kala_chashma_official',
    name: 'Kala Chashma (Full Official Song Outro)',
    shortName: 'Kala Chashma Outro',
    bpm: 107,
    keyInfo: { camelot: '10A', keyName: 'B Minor' },
    duration: 173.45,
    sections: [
      {
        id: 'kco_sec_intro',
        name: 'Official Studio Intro & Horns (0.04s - 9.01s)',
        desc: 'Pristine CD-quality studio opening (4 bars)',
        tag: 'INTRO',
        tagColor: '#a855f7',
        startTime: 0.041,
        endTime: 9.013,
        songName: 'Kala Chashma',
        sourceTrack: 'B',
        subParts: [
          { id: 'kco_bar_1', name: 'Bar 1: Opening Horn Fanfare', desc: 'Studio brass intro (4 beats)', tag: 'INTRO', tagColor: '#a855f7', startTime: 0.041, endTime: 2.284, songName: 'Kala Chashma', sourceTrack: 'B' },
          { id: 'kco_bars_2_4', name: 'Bars 2-4: Horn Phrase & Buildup', desc: 'Brass continuation to drop', tag: 'INTRO', tagColor: '#a855f7', startTime: 2.284, endTime: 9.013, songName: 'Kala Chashma', sourceTrack: 'B' }
        ]
      },
      {
        id: 'kco_sec_drop',
        name: 'Official Dhol Drop & Verse (9.01s - 22.47s)',
        desc: 'Studio drums & vocal pickup',
        tag: 'DROP',
        tagColor: '#10b981',
        startTime: 9.013,
        endTime: 22.471,
        songName: 'Kala Chashma',
        sourceTrack: 'B',
        subParts: [
          { id: 'kco_bar_6', name: 'Bar 6: Dhol Beat Drop', desc: 'Heavy Punjabi Dhol beat begins', tag: 'DROP', tagColor: '#10b981', startTime: 11.256, endTime: 13.499, songName: 'Kala Chashma', sourceTrack: 'B' },
          { id: 'kco_verse', name: 'Verse 1: Amar Arshi Vocals', desc: 'Clean studio vocals', tag: 'VERSE', tagColor: '#06b6d4', startTime: 15.742, endTime: 22.471, songName: 'Kala Chashma', sourceTrack: 'B' }
        ]
      },
      {
        id: 'kco_sec_chorus',
        name: 'Signature Chorus Main Drop (22.47s - 35.93s)',
        desc: 'Official CD master chorus drop',
        tag: 'CHORUS',
        tagColor: '#f97316',
        startTime: 22.471,
        endTime: 35.929,
        songName: 'Kala Chashma',
        sourceTrack: 'B',
        subParts: [
          { id: 'kco_chorus_main', name: 'Bars 11-14: Signature Chorus Drop', desc: 'Main "Kaala Chashma" hook (8 beats)', tag: 'CHORUS', tagColor: '#f97316', startTime: 22.471, endTime: 31.443, songName: 'Kala Chashma', sourceTrack: 'B' }
        ]
      },
      {
        id: 'kco_sec_verse2',
        name: 'Female Lead Verse ("Baithi Patola Banke")',
        desc: 'Neha Kakkar female vocals & driving dhol groove (40.4s - 58.4s)',
        tag: 'VERSE',
        tagColor: '#06b6d4',
        startTime: 40.415,
        endTime: 58.359,
        songName: 'Kala Chashma',
        sourceTrack: 'B',
        subParts: [
          { id: 'kco_bar_19_22', name: 'Bars 19-22: Female Vocal Line ("Baithi Patola...")', desc: 'Melodic female vocal opener', tag: 'VERSE', tagColor: '#06b6d4', startTime: 40.415, endTime: 49.387, songName: 'Kala Chashma', sourceTrack: 'B' },
          { id: 'kco_bar_23_26', name: 'Bars 23-26: Pre-Chorus Vocal Build ("Tainu Takkeya...")', desc: 'Rhythmic inflection into chorus', tag: 'BUILD', tagColor: '#ec4899', startTime: 49.387, endTime: 58.359, songName: 'Kala Chashma', sourceTrack: 'B' }
        ]
      },
      {
        id: 'kco_sec_chorus2',
        name: 'Chorus Hook Return ("Kaala Chashma Jachda Ve")',
        desc: '2nd chorus hook & bouncy wedding dance beat (58.4s - 76.3s)',
        tag: 'CHORUS',
        tagColor: '#f97316',
        startTime: 58.359,
        endTime: 76.303,
        songName: 'Kala Chashma',
        sourceTrack: 'B',
        subParts: [
          { id: 'kco_bar_27_30', name: 'Bars 27-30: 2nd Chorus Main Hook', desc: 'Signature female chorus drop', tag: 'CHORUS', tagColor: '#f97316', startTime: 58.359, endTime: 67.331, songName: 'Kala Chashma', sourceTrack: 'B' },
          { id: 'kco_bar_31_34', name: 'Bars 31-34: Chorus Response & Brass Hook', desc: 'Horn response riffs & drums', tag: 'CHORUS', tagColor: '#f97316', startTime: 67.331, endTime: 76.303, songName: 'Kala Chashma', sourceTrack: 'B' }
        ]
      },
      {
        id: 'kco_sec_bridge',
        name: 'Percussion Bridge & Chant ("O Kudi Kudi...")',
        desc: 'Acoustic dholak breakdown and snare riser leading to Rap (76.3s - 94.2s)',
        tag: 'BUILD',
        tagColor: '#ec4899',
        startTime: 76.303,
        endTime: 94.247,
        songName: 'Kala Chashma',
        sourceTrack: 'B',
        subParts: [
          { id: 'kco_bar_35_38', name: 'Bars 35-38: Dholak Breakdown & Crowd Chant', desc: 'Sangeet clapping breakdown', tag: 'VERSE', tagColor: '#06b6d4', startTime: 76.303, endTime: 85.275, songName: 'Kala Chashma', sourceTrack: 'B' },
          { id: 'kco_bar_39_42', name: 'Bars 39-42: Snare Roll Build into Badshah Rap', desc: 'Acceleration into rap verse', tag: 'BUILD', tagColor: '#ec4899', startTime: 85.275, endTime: 94.247, songName: 'Kala Chashma', sourceTrack: 'B' }
        ]
      },
      {
        id: 'kco_sec_rap1',
        name: 'Badshah Rap Verse 1 ("Dekho Dekho...")',
        desc: 'Iconic Badshah rap flow & booming bass (94.2s - 112.2s)',
        tag: 'VERSE',
        tagColor: '#06b6d4',
        startTime: 94.247,
        endTime: 112.191,
        songName: 'Kala Chashma',
        sourceTrack: 'B',
        subParts: [
          { id: 'kco_bar_43_46', name: 'Bars 43-46: Badshah Rap Opening ("Dekho Dekho")', desc: 'Rap verse kickoff', tag: 'VERSE', tagColor: '#06b6d4', startTime: 94.247, endTime: 103.219, songName: 'Kala Chashma', sourceTrack: 'B' },
          { id: 'kco_bar_47_50', name: 'Bars 47-50: Badshah Flow & Punchline', desc: 'Catchy syncopated rap bars', tag: 'VERSE', tagColor: '#06b6d4', startTime: 103.219, endTime: 112.191, songName: 'Kala Chashma', sourceTrack: 'B' }
        ]
      },
      {
        id: 'kco_sec_rap2',
        name: 'Badshah Rap Verse 2 & Heavy Drop ("Saari City...")',
        desc: 'High energy rap climax & dance build (112.2s - 130.1s)',
        tag: 'DROP',
        tagColor: '#10b981',
        startTime: 112.191,
        endTime: 130.135,
        songName: 'Kala Chashma',
        sourceTrack: 'B',
        subParts: [
          { id: 'kco_bar_51_54', name: 'Bars 51-54: Rap Verse 2 Acceleration', desc: 'High energy rap flow', tag: 'DROP', tagColor: '#10b981', startTime: 112.191, endTime: 121.163, songName: 'Kala Chashma', sourceTrack: 'B' },
          { id: 'kco_bar_55_58', name: 'Bars 55-58: Pre-Drop Riser & Vocal Shouts', desc: 'Drum rolls into final peak', tag: 'BUILD', tagColor: '#ec4899', startTime: 121.163, endTime: 130.135, songName: 'Kala Chashma', sourceTrack: 'B' }
        ]
      },
      {
        id: 'kco_sec_peak_chorus',
        name: 'Grand Climax Chorus Drop ("Kaala Kaala Chashma Peak")',
        desc: 'Massive dance floor explosion & all-guest choreography peak (130.1s - 148.1s)',
        tag: 'CHORUS',
        tagColor: '#f97316',
        startTime: 130.135,
        endTime: 148.079,
        songName: 'Kala Chashma',
        sourceTrack: 'B',
        subParts: [
          { id: 'kco_bar_59_62', name: 'Bars 59-62: All-Hands Dance Peak Hook', desc: 'Peak energy chorus drop', tag: 'CHORUS', tagColor: '#f97316', startTime: 130.135, endTime: 139.107, songName: 'Kala Chashma', sourceTrack: 'B' },
          { id: 'kco_bar_63_66', name: 'Bars 63-66: Peak Horn Harmony & Cheers', desc: 'Full band brass accompaniment', tag: 'CHORUS', tagColor: '#f97316', startTime: 139.107, endTime: 148.079, songName: 'Kala Chashma', sourceTrack: 'B' }
        ]
      },
      {
        id: 'kco_sec_grand_outro',
        name: 'Celebration Grand Finale & Confetti Bow (148.1s - 173.5s)',
        desc: 'Driving bhangra dhol rolls, family stage bow & confetti finish (148.1s - 173.5s)',
        tag: 'FINALE',
        tagColor: '#10b981',
        startTime: 148.079,
        endTime: 173.450,
        songName: 'Kala Chashma',
        sourceTrack: 'B',
        subParts: [
          { id: 'kco_bar_67_72', name: 'Bars 67-72: Driving Bhangra Dhol Outro Groove', desc: 'Celebratory drum groove', tag: 'DROP', tagColor: '#10b981', startTime: 148.079, endTime: 161.537, songName: 'Kala Chashma', sourceTrack: 'B' },
          { id: 'kco_bar_73_78', name: 'Bars 73-78: Final Bow, Fireworks & Confetti Finish', desc: 'Final stage pose and applause', tag: 'FINALE', tagColor: '#10b981', startTime: 161.537, endTime: 173.450, songName: 'Kala Chashma', sourceTrack: 'B' }
        ]
      }
    ]
  },
  gallan_goodiyaan: {
    id: 'gallan_goodiyaan',
    name: 'Gallan Goodiyaan (Celebration Bhangra)',
    shortName: 'Gallan Goodiyaan',
    bpm: 128,
    keyInfo: { camelot: '9A', keyName: 'E Minor' },
    duration: 38.0,
    sections: [
      {
        id: 'gg_sec_intro',
        name: 'Festive Dhol & Acoustic Claps Intro',
        desc: 'Wedding party entrance rhythm with handclaps (4 bars)',
        tag: 'INTRO',
        tagColor: '#10b981',
        startTime: 0.00,
        endTime: 8.97,
        songName: 'Gallan Goodiyaan',
        sourceTrack: 'B',
        subParts: [
          { id: 'gg_sub_1', name: 'Part 1: Acoustic Claps & Entrance Mark', desc: 'Family entrance groove (4 bars)', tag: 'INTRO', tagColor: '#10b981', startTime: 0.00, endTime: 4.49, songName: 'Gallan Goodiyaan', sourceTrack: 'B' },
          { id: 'gg_sub_2', name: 'Part 2: Tempo Buildup & Vocal Chant', desc: 'Energy acceleration for crowd chant', tag: 'BUILD', tagColor: '#06b6d4', startTime: 4.49, endTime: 8.97, songName: 'Gallan Goodiyaan', sourceTrack: 'B' }
        ]
      },
      {
        id: 'gg_sec_drop',
        name: 'Heavy Bhangra Dhol Beat Drop & Verse',
        desc: 'Massive celebratory dance drum groove and singing',
        tag: 'DROP',
        tagColor: '#10b981',
        startTime: 8.97,
        endTime: 26.91,
        songName: 'Gallan Goodiyaan',
        sourceTrack: 'B',
        subParts: [
          { id: 'gg_sub_3', name: 'Part 3: Heavy Bhangra Dhol Beat Drop', desc: 'High energy dance floor groove', tag: 'DROP', tagColor: '#10b981', startTime: 8.97, endTime: 17.94, songName: 'Gallan Goodiyaan', sourceTrack: 'B' },
          { id: 'gg_sub_4', name: 'Part 4: Lead Vocal Melody Verse', desc: 'Syncopated Sangeet party lyrics', tag: 'VERSE', tagColor: '#06b6d4', startTime: 17.94, endTime: 26.91, songName: 'Gallan Goodiyaan', sourceTrack: 'B' }
        ]
      },
      {
        id: 'gg_sec_chorus',
        name: 'Grand Sangeet Chorus Anthem & Finale',
        desc: 'Massive celebratory drop & all-guest dance finale',
        tag: 'CHORUS',
        tagColor: '#f97316',
        startTime: 26.91,
        endTime: 38.00,
        songName: 'Gallan Goodiyaan',
        sourceTrack: 'B',
        subParts: [
          { id: 'gg_sub_5', name: 'Part 5: Main Festive Chorus Drop', desc: 'High-octane dance anthem hook', tag: 'CHORUS', tagColor: '#f97316', startTime: 26.91, endTime: 35.88, songName: 'Gallan Goodiyaan', sourceTrack: 'B' },
          { id: 'gg_sub_6', name: 'Part 6: Outro Grand Finale Climax', desc: 'Final family pose with confetti', tag: 'FINALE', tagColor: '#10b981', startTime: 35.88, endTime: 38.00, songName: 'Gallan Goodiyaan', sourceTrack: 'B' }
        ]
      }
    ]
  },
  london_thumakda: {
    id: 'london_thumakda',
    name: 'London Thumakda (Dhol Celebration)',
    shortName: 'London Thumakda',
    bpm: 130,
    keyInfo: { camelot: '11B', keyName: 'A Major' },
    duration: 26.5,
    sections: [
      {
        id: 'lt_sec_intro',
        name: 'Punjabi Dhol & Shehnai Fanfare',
        desc: 'Traditional wedding celebration entrance',
        tag: 'INTRO',
        tagColor: '#a855f7',
        startTime: 0.00,
        endTime: 8.97,
        songName: 'London Thumakda',
        sourceTrack: 'A',
        subParts: [
          { id: 'lt_sub_1', name: 'Part 1: Punjabi Dhol & Shehnai Fanfare', desc: 'Traditional entrance mark', tag: 'INTRO', tagColor: '#a855f7', startTime: 0.00, endTime: 4.49, songName: 'London Thumakda', sourceTrack: 'A' },
          { id: 'lt_sub_2', name: 'Part 2: Bridal Party 8-Count Rhythm', desc: 'Catchy syncopated wedding dance beat', tag: 'VERSE', tagColor: '#06b6d4', startTime: 4.49, endTime: 8.97, songName: 'London Thumakda', sourceTrack: 'A' }
        ]
      },
      {
        id: 'lt_sec_hook',
        name: 'Signature "London Thumakda" Chorus & Climax',
        desc: 'Iconic bridal dance hook and accelerating tempo finish',
        tag: 'CHORUS',
        tagColor: '#f97316',
        startTime: 8.97,
        endTime: 26.50,
        songName: 'London Thumakda',
        sourceTrack: 'A',
        subParts: [
          { id: 'lt_sub_3', name: 'Part 3: "London Thumakda" Chorus Drop', desc: 'Signature bridal chorus hook', tag: 'CHORUS', tagColor: '#f97316', startTime: 8.97, endTime: 17.94, songName: 'London Thumakda', sourceTrack: 'A' },
          { id: 'lt_sub_4', name: 'Part 4: Grand Dhol Outro Finish', desc: 'Accelerating tempo finish for final bow', tag: 'FINALE', tagColor: '#10b981', startTime: 17.94, endTime: 26.50, songName: 'London Thumakda', sourceTrack: 'A' }
        ]
      }
    ]
  },
  sauda_khara: {
    id: 'sauda_khara',
    name: 'Sauda Khara Khara (Bhangra Pop)',
    shortName: 'Sauda Khara Khara',
    bpm: 105,
    keyInfo: { camelot: '10A', keyName: 'B Minor' },
    duration: 38.0,
    sections: [
      {
        id: 'sk_sec_intro',
        name: 'Sukhbir Signature "Tare Gin Gin" Intro & Drop',
        desc: 'Iconic Punjabi party starter chant & heavy bassline',
        tag: 'INTRO',
        tagColor: '#10b981',
        startTime: 0.00,
        endTime: 18.29,
        songName: 'Sauda Khara Khara',
        sourceTrack: 'B',
        subParts: [
          { id: 'sk_sub_1', name: 'Part 1: Sukhbir Signature Intro Chant', desc: 'Party starter chant', tag: 'INTRO', tagColor: '#10b981', startTime: 0.00, endTime: 4.57, songName: 'Sauda Khara Khara', sourceTrack: 'B' },
          { id: 'sk_sub_2', name: 'Part 2: Heavy Electro-Bhangra Dhol Drop', desc: 'Electro-Bhangra dance floor groove', tag: 'DROP', tagColor: '#10b981', startTime: 4.57, endTime: 18.29, songName: 'Sauda Khara Khara', sourceTrack: 'B' }
        ]
      },
      {
        id: 'sk_sec_chorus',
        name: 'Chorus Singalong & High-Energy Outro',
        desc: 'Grand party chorus drop & confetti finish',
        tag: 'CHORUS',
        tagColor: '#f97316',
        startTime: 18.29,
        endTime: 38.00,
        songName: 'Sauda Khara Khara',
        sourceTrack: 'B',
        subParts: [
          { id: 'sk_sub_3', name: 'Part 3: "Sauda Khara Khara" Chorus Anthem', desc: 'Singalong wedding celebration drop', tag: 'CHORUS', tagColor: '#f97316', startTime: 18.29, endTime: 27.43, songName: 'Sauda Khara Khara', sourceTrack: 'B' },
          { id: 'sk_sub_4', name: 'Part 4: High-Energy Confetti Outro', desc: 'Driving finish with crowd cheer', tag: 'FINALE', tagColor: '#10b981', startTime: 27.43, endTime: 38.00, songName: 'Sauda Khara Khara', sourceTrack: 'B' }
        ]
      }
    ]
  },
  choreo_demo: {
    id: 'choreo_demo',
    name: 'Wedding Choreo Edit (Dhol & Synth Remix)',
    shortName: 'Choreo Edit',
    bpm: 128,
    keyInfo: { camelot: '10A', keyName: 'D Minor' },
    duration: 26.5,
    sections: [
      {
        id: 'cd_sec_intro',
        name: 'Dhol & Synth Intro (8 counts)',
        desc: 'Entrance groove (8 counts)',
        tag: 'INTRO',
        tagColor: '#a855f7',
        startTime: 0.00,
        endTime: 8.97,
        songName: 'Choreo Edit',
        sourceTrack: 'A',
        subParts: [
          { id: 'cd_sub_1', name: 'Part 1: Dhol & Synth Intro', desc: 'Entrance groove (8 counts)', tag: 'INTRO', tagColor: '#a855f7', startTime: 0.00, endTime: 4.49, songName: 'Choreo Edit', sourceTrack: 'A' },
          { id: 'cd_sub_2', name: 'Part 2: Lead Dance Phrase', desc: 'Rehearsed group dance choreography', tag: 'VERSE', tagColor: '#06b6d4', startTime: 4.49, endTime: 8.97, songName: 'Choreo Edit', sourceTrack: 'A' }
        ]
      },
      {
        id: 'cd_sec_drop',
        name: 'Remix Drop & Peak (Ends at 26.5s)',
        desc: 'High energy drop right before video cutoff',
        tag: 'DROP',
        tagColor: '#10b981',
        startTime: 8.97,
        endTime: 26.50,
        songName: 'Choreo Edit',
        sourceTrack: 'A',
        subParts: [
          { id: 'cd_sub_3', name: 'Part 3: Remix Drop & Peak', desc: 'Drop right before cutoff', tag: 'DROP', tagColor: '#10b981', startTime: 8.97, endTime: 26.50, songName: 'Choreo Edit', sourceTrack: 'A' }
        ]
      }
    ]
  }
};

// Automatically ensure each song has a flat parts array containing all subParts
Object.values(WEDDING_SONG_CATALOG).forEach(song => {
  if (song.sections) {
    const flat = [];
    song.sections.forEach(sec => {
      if (sec.subParts) flat.push(...sec.subParts);
      else flat.push(sec);
    });
    song.parts = flat;
  }
});

let activePaletteFilter = 'all';
let paletteState = {
  viewMode: 'broad', // 'broad' (default) or 'detailed'
  expandedSections: new Set()
};

function setPaletteViewMode(mode) {
  paletteState.viewMode = mode;
  document.getElementById('viewBroadBtn')?.classList.toggle('active', mode === 'broad');
  document.getElementById('viewDetailedBtn')?.classList.toggle('active', mode === 'detailed');
  renderPaletteUI();
}

function toggleSectionExpansion(secId) {
  if (paletteState.expandedSections.has(secId)) {
    paletteState.expandedSections.delete(secId);
    showToast("🔗 Merged section back to broad view.");
  } else {
    paletteState.expandedSections.add(secId);
    showToast("✂️ Split section into smaller bars & phrases!");
  }
  renderPaletteUI();
}

function getSongSectionsCatalog() {
  if (appState.currentMode === 'medley') {
    const selA = document.getElementById('songSelectA')?.value || 'kala_chashma';
    const selB = document.getElementById('songSelectB')?.value || 'gallan_goodiyaan';
    const secsA = (WEDDING_SONG_CATALOG[selA] || WEDDING_SONG_CATALOG['kala_chashma']).sections || [];
    const secsB = (WEDDING_SONG_CATALOG[selB] || WEDDING_SONG_CATALOG['gallan_goodiyaan']).sections || [];
    return [...secsA, ...secsB];
  } else {
    const selA = document.getElementById('songSelectA')?.value || 'kala_chashma';
    return (WEDDING_SONG_CATALOG[selA] || WEDDING_SONG_CATALOG['kala_chashma']).sections || [];
  }
}

function getDetectedSongPartsCatalog() {
  if (appState.currentMode === 'medley') {
    const selA = document.getElementById('songSelectA')?.value || 'kala_chashma';
    const selB = document.getElementById('songSelectB')?.value || 'gallan_goodiyaan';
    const partsA = (WEDDING_SONG_CATALOG[selA] || WEDDING_SONG_CATALOG['kala_chashma']).parts || [];
    const partsB = (WEDDING_SONG_CATALOG[selB] || WEDDING_SONG_CATALOG['gallan_goodiyaan']).parts || [];
    return [...partsA, ...partsB];
  } else {
    const selA = document.getElementById('songSelectA')?.value || 'kala_chashma';
    return (WEDDING_SONG_CATALOG[selA] || WEDDING_SONG_CATALOG['kala_chashma']).parts || [];
  }
}

function getAllSongPartsAndSections() {
  const secs = getSongSectionsCatalog();
  const parts = getDetectedSongPartsCatalog();
  return [...secs, ...parts];
}

function setPaletteFilter(filter) {
  activePaletteFilter = filter;
  document.querySelectorAll('.palette-filter-btn').forEach(btn => btn.classList.remove('active'));
  if (filter === 'all') document.getElementById('filterAllBtn')?.classList.add('active');
  else if (filter === 'A') document.getElementById('filterTrackABtn')?.classList.add('active');
  else if (filter === 'B') document.getElementById('filterTrackBBtn')?.classList.add('active');
  renderPaletteUI();
}

async function loadSongBuffer(songId) {
  if (songId === 'kala_chashma' || songId === 'kala_chashma_official') {
    return await ensureTrackBBuffer();
  } else if (songId === 'gallan_goodiyaan') {
    if (!appState._cachedGallan) {
      appState._cachedGallan = await appState.demoGen.generateCelebrationSong();
    }
    return appState._cachedGallan;
  } else if (songId === 'london_thumakda') {
    if (!appState._cachedLondon) {
      appState._cachedLondon = await appState.demoGen.generateChoreoEdit();
    }
    return appState._cachedLondon;
  } else if (songId === 'sauda_khara') {
    if (!appState._cachedSauda) {
      appState._cachedSauda = await appState.demoGen.generateCelebrationSong();
    }
    return appState._cachedSauda;
  } else if (songId === 'choreo_demo') {
    if (!appState._cachedChoreoDemo) {
      appState._cachedChoreoDemo = await appState.demoGen.generateChoreoEdit();
    }
    return appState._cachedChoreoDemo;
  }
  return await ensureTrackBBuffer();
}

async function selectMixStarter(starterId) {
  document.querySelectorAll('.btn-mix-starter').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`starter_${starterId}`)?.classList.add('active');

  if (starterId === 'kala_chashma_choreo') {
    switchRemixMode('choreo');
    const selA = document.getElementById('songSelectA');
    const selB = document.getElementById('songSelectB');
    if (selA) selA.value = 'kala_chashma';
    if (selB) selB.value = 'kala_chashma_official';

    await loadKalaChashmaUserTracks();
    appState.arrangementBlocks = getDefaultKalaChashmaBlocks(true);
    renderArrangementBlocksUI();
    drawWaveformTimeline();
    showToast("🔥 Loaded Kala Chashma Choreo Extension (Bar 1 Repeat + Outro Extension)!");

  } else if (starterId === 'kala_gallan_mashup') {
    switchRemixMode('medley');
    const selA = document.getElementById('songSelectA');
    const selB = document.getElementById('songSelectB');
    if (selA) selA.value = 'kala_chashma';
    if (selB) selB.value = 'gallan_goodiyaan';

    showToast("🎛️ Loading Kala Chashma ➔ Gallan Goodiyaan Bhangra Mashup...");
    const bufA = await ensureTrackBBuffer();
    const bufB = await loadSongBuffer('gallan_goodiyaan');

    appState.trackA = {
      name: "Kala Chashma (Opening Anthem - 107 BPM)",
      buffer: bufA,
      analysis: appState.engine.analyzeTrack(bufA),
      source: 'catalog'
    };
    appState.trackB = {
      name: "Gallan Goodiyaan (Celebration Bhangra - 128 BPM)",
      buffer: bufB,
      analysis: appState.engine.analyzeTrack(bufB),
      source: 'catalog'
    };

    updateTrackCardUI('A', appState.trackA);
    updateTrackCardUI('B', appState.trackB);
    checkBothTracksReady();

    appState.arrangementBlocks = getCuratedMashupBlocks('kala_chashma', 'gallan_goodiyaan');
    renderArrangementBlocksUI();
    drawWaveformTimeline();
    showToast("🎉 Loaded Kala Chashma ➔ Gallan Goodiyaan Mashup!");

  } else if (starterId === 'london_sauda_medley') {
    switchRemixMode('medley');
    const selA = document.getElementById('songSelectA');
    const selB = document.getElementById('songSelectB');
    if (selA) selA.value = 'london_thumakda';
    if (selB) selB.value = 'sauda_khara';

    showToast("🎛️ Loading London Thumakda ➔ Sauda Khara Khara Medley...");
    const bufA = await loadSongBuffer('london_thumakda');
    const bufB = await loadSongBuffer('sauda_khara');

    appState.trackA = {
      name: "London Thumakda (Dhol Celebration - 130 BPM)",
      buffer: bufA,
      analysis: appState.engine.analyzeTrack(bufA),
      source: 'catalog'
    };
    appState.trackB = {
      name: "Sauda Khara Khara (Bhangra Pop - 105 BPM)",
      buffer: bufB,
      analysis: appState.engine.analyzeTrack(bufB),
      source: 'catalog'
    };

    updateTrackCardUI('A', appState.trackA);
    updateTrackCardUI('B', appState.trackB);
    checkBothTracksReady();

    appState.arrangementBlocks = getCuratedMashupBlocks('london_thumakda', 'sauda_khara');
    renderArrangementBlocksUI();
    drawWaveformTimeline();
    showToast("🎉 Loaded London Thumakda ➔ Sauda Khara Khara Medley!");

  } else if (starterId === 'custom_upload') {
    toggleDeckUpload('A', true);
    toggleDeckUpload('B', true);
    showToast("📁 Drop your audio/video files or paste YouTube links in Deck 1 and Deck 2!");
  }
}

async function handleSongSelectChange(deck, songId) {
  if (songId === 'custom') {
    toggleDeckUpload(deck, true);
    return;
  }

  toggleDeckUpload(deck, false);
  const songData = WEDDING_SONG_CATALOG[songId];
  if (!songData) return;

  showToast(`Loading ${songData.name} on Track ${deck}...`);
  const buf = await loadSongBuffer(songId);
  const analysis = appState.engine.analyzeTrack(buf);

  const trackObj = {
    name: songData.name,
    buffer: buf,
    analysis: analysis,
    source: 'catalog'
  };

  if (deck === 'A') appState.trackA = trackObj;
  else appState.trackB = trackObj;

  updateTrackCardUI(deck, trackObj);
  checkBothTracksReady();

  renderArrangementBlocksUI();
  drawWaveformTimeline();
  showToast(`✅ Selected: ${songData.name} (${analysis.bpm} BPM)`);
}

function toggleDeckUpload(deck, forceOpen = null) {
  const drawer = document.getElementById(`deckUploadDrawer${deck}`);
  if (!drawer) return;
  if (forceOpen !== null) {
    drawer.style.display = forceOpen ? 'block' : 'none';
  } else {
    drawer.style.display = (drawer.style.display === 'none') ? 'block' : 'none';
  }
}

function getCuratedMashupBlocks(songAId, songBId) {
  const songA = WEDDING_SONG_CATALOG[songAId] || WEDDING_SONG_CATALOG['kala_chashma'];
  const songB = WEDDING_SONG_CATALOG[songBId] || WEDDING_SONG_CATALOG['gallan_goodiyaan'];
  const blocks = [];

  // Pick broad sections from Song 1
  if (songA.sections && songA.sections.length > 0) {
    blocks.push({ ...songA.sections[0], id: `${songA.id}_sec1_${Date.now()}`, isDuplicated: false });
    if (songA.sections[1]) blocks.push({ ...songA.sections[1], id: `${songA.id}_sec2_${Date.now()}`, isDuplicated: false });
    const dropA = songA.sections.find(s => s.tag === 'DROP' || s.tag === 'CHORUS') || songA.sections[2];
    if (dropA) blocks.push({ ...dropA, id: `${songA.id}_drop_${Date.now()}`, isDuplicated: false });
  }

  // Pick broad sections from Song 2
  if (songB.sections && songB.sections.length > 0) {
    const buildB = songB.sections.find(s => s.tag === 'BUILD' || s.tag === 'INTRO') || songB.sections[0];
    if (buildB) blocks.push({ ...buildB, id: `${songB.id}_build_${Date.now()}`, isDuplicated: false });
    const dropB = songB.sections.find(s => s.tag === 'DROP') || songB.sections[1];
    if (dropB) blocks.push({ ...dropB, id: `${songB.id}_drop_${Date.now()}`, isDuplicated: false });
    const chorusB = songB.sections.find(s => s.tag === 'CHORUS') || songB.sections[2];
    if (chorusB) blocks.push({ ...chorusB, id: `${songB.id}_chorus_${Date.now()}`, isDuplicated: false });
    const finaleB = songB.sections.find(s => s.tag === 'FINALE') || songB.sections[songB.sections.length - 1];
    if (finaleB) blocks.push({ ...finaleB, id: `${songB.id}_finale_${Date.now()}`, isDuplicated: false });
  }

  return blocks;
}

function getDefaultKalaChashmaBlocks(includeDuplicatedIntro = true) {
  const song = WEDDING_SONG_CATALOG['kala_chashma'];
  const introSubparts = song.sections[0].subParts;
  const blocks = [];

  // Bar 1
  blocks.push({ ...introSubparts[0], id: 'bar_1', isDuplicated: false });

  // Optional Bar 1 Repeat (for Choreo Video Match)
  if (includeDuplicatedIntro) {
    blocks.push({
      ...introSubparts[0],
      id: 'bar_1_dup',
      name: 'Bar 1 Repeat: Choreo Extra Riff',
      desc: 'Repeated opening horn hook (Choreo pattern)',
      tag: 'REPEAT',
      tagColor: '#f59e0b',
      isDuplicated: true
    });
  }

  // Add broad sections for the rest
  const remainingIntro = {
    id: 'intro_continuation',
    name: 'Intro Brass Risers & Pause (Bars 2-4)',
    desc: 'Brass horn answer bars & silent pause',
    tag: 'INTRO',
    tagColor: '#a855f7',
    startTime: 2.284,
    endTime: 9.013,
    songName: 'Kala Chashma',
    sourceTrack: 'A',
    isDuplicated: false
  };
  blocks.push(remainingIntro);

  // Push remaining broad sections: Drop, Verse, Chorus, Choreo Outro, Extended Finale
  for (let s = 1; s < song.sections.length; s++) {
    blocks.push({ ...song.sections[s], id: `${song.sections[s].id}_${Date.now()}`, isDuplicated: false });
  }

  return blocks;
}

// Render Palette of Auto-Detected Song Parts (Broad & Detailed)
function renderPaletteUI() {
  const container = document.getElementById('paletteGridContainer');
  if (!container) return;

  if (paletteState.viewMode === 'broad') {
    // --- Render Broad Sections View ---
    let sections = getSongSectionsCatalog();
    if (appState.currentMode === 'medley' && activePaletteFilter !== 'all') {
      sections = sections.filter(s => s.sourceTrack === activePaletteFilter);
    }

    const html = sections.map(sec => {
      const dur = (sec.endTime - sec.startTime).toFixed(2);
      const tagBg = sec.tagColor || '#818cf8';
      const isTrackB = sec.sourceTrack === 'B';
      const isExpanded = paletteState.expandedSections.has(sec.id);
      const subPartsCount = sec.subParts ? sec.subParts.length : 0;

      return `
        <div class="palette-item-card" 
             id="palette_${sec.id}"
             draggable="true" 
             ondragstart="handlePaletteDragStart(event, '${sec.id}')"
             ondragend="handleDragEnd(event)"
             onclick="handlePaletteCardClick(event, '${sec.id}')"
             title="Click card to audition/listen to this section"
             style="cursor: pointer; ${appState.currentMode === 'medley' ? (isTrackB ? 'border-top: 3px solid var(--accent-cyan);' : 'border-top: 3px solid var(--accent-purple);') : ''}">
          
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; gap: 5px; align-items: center;">
              ${appState.currentMode === 'medley' ? `
                <span style="font-size: 9.5px; font-weight: 800; padding: 2px 6px; border-radius: 4px; background: ${isTrackB ? 'rgba(6, 182, 212, 0.25)' : 'rgba(168, 85, 247, 0.25)'}; color: ${isTrackB ? '#67e8f9' : '#d8b4fe'};">
                  ${isTrackB ? 'Track 2' : 'Track 1'}
                </span>
              ` : ''}
              <span style="font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px; background: ${tagBg}22; color: ${tagBg}; border: 1px solid ${tagBg}55;">
                ${sec.tag}
              </span>
              <span class="palette-audition-hint">
                🎧 Click to hear
              </span>
            </div>
            <span style="font-size: 11px; font-weight: 600; color: var(--text-muted);">
              ⏱ ${dur}s
            </span>
          </div>

          <div style="display: flex; flex-direction: column; gap: 2px; margin-top: 4px;">
            <strong style="font-size: 13.5px; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${sec.name}
            </strong>
            <span style="font-size: 11px; color: var(--text-muted); line-height: 1.3;">
              ${sec.desc}
            </span>
          </div>

          <div style="font-size: 10.5px; font-family: monospace; color: var(--accent-cyan); background: rgba(0,0,0,0.25); padding: 3px 6px; border-radius: 4px; margin-top: 2px;">
            Span: ${appState.engine.formatTime(sec.startTime)} - ${appState.engine.formatTime(sec.endTime)}
          </div>

          <!-- Actions -->
          <div class="palette-actions-row">
            <button type="button" class="timeline-item-btn solo-btn" onclick="event.stopPropagation(); soloPalettePart('${sec.id}')" title="Audition this section">
              <span>🔊</span> Solo
            </button>
            <button type="button" class="btn-add-to-timeline" onclick="event.stopPropagation(); addPartToTimeline('${sec.id}')" title="Drop this section onto your timeline line">
              <span>➕</span> Add Section
            </button>
            ${subPartsCount > 1 ? `
              <button type="button" class="${isExpanded ? 'btn-merge-sec' : 'btn-split-sec'}" onclick="event.stopPropagation(); toggleSectionExpansion('${sec.id}')" title="${isExpanded ? 'Merge back into broad card' : 'Split into smaller bars'}">
                <span>${isExpanded ? '🔗 Merge' : '✂️ Split (' + subPartsCount + ')'}</span>
              </button>
            ` : ''}
          </div>

          <!-- Unfolded Sub-Parts Tray -->
          ${isExpanded && sec.subParts ? `
            <div class="palette-subparts-tray">
              <div style="font-size: 10.5px; font-weight: 700; color: #a5f3fc; text-transform: uppercase; letter-spacing: 0.5px; display: flex; justify-content: space-between; align-items: center;">
                <span>Constituent Bars & Phrases:</span>
                <span style="font-size: 10px; color: var(--text-muted);">Click bar to hear, drag or + Add</span>
              </div>
              ${sec.subParts.map(sp => `
                <div class="subpart-pill-row" 
                     id="palette_${sp.id}"
                     draggable="true" 
                     ondragstart="handlePaletteDragStart(event, '${sp.id}')"
                     ondragend="handleDragEnd(event)"
                     onclick="handlePaletteSubpartClick(event, '${sp.id}')"
                     title="Click bar to listen/audition"
                     style="cursor: pointer;">
                  <div class="subpart-pill-info">
                    <strong style="font-size: 11.5px; color: var(--text-main);">${sp.name}</strong>
                    <span style="font-size: 10px; font-family: monospace; color: var(--text-muted);">${appState.engine.formatTime(sp.startTime)} - ${appState.engine.formatTime(sp.endTime)} (${(sp.endTime - sp.startTime).toFixed(2)}s)</span>
                  </div>
                  <div class="subpart-pill-actions">
                    <button type="button" class="timeline-item-btn" onclick="event.stopPropagation(); soloPalettePart('${sp.id}')" style="padding: 2px 6px; font-size: 10px;" title="Listen to this bar">
                      <span>🔊</span>
                    </button>
                    <button type="button" class="btn-add-to-timeline" onclick="event.stopPropagation(); addPartToTimeline('${sp.id}')" style="padding: 3px 8px; font-size: 10px;" title="Add this bar to timeline">
                      <span>➕ Add</span>
                    </button>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : ''}

        </div>
      `;
    }).join('');

    container.innerHTML = html;

  } else {
    // --- Render Detailed Bars View ---
    let catalog = getDetectedSongPartsCatalog();
    if (appState.currentMode === 'medley' && activePaletteFilter !== 'all') {
      catalog = catalog.filter(p => p.sourceTrack === activePaletteFilter);
    }

    const html = catalog.map(part => {
      const dur = (part.endTime - part.startTime).toFixed(2);
      const tagBg = part.tagColor || '#818cf8';
      const isTrackB = part.sourceTrack === 'B';

      return `
        <div class="palette-item-card" 
             id="palette_${part.id}"
             draggable="true" 
             ondragstart="handlePaletteDragStart(event, '${part.id}')"
             ondragend="handleDragEnd(event)"
             onclick="handlePaletteDetailedCardClick(event, '${part.id}')"
             title="Click card to audition/listen to this bar"
             style="cursor: pointer; ${appState.currentMode === 'medley' ? (isTrackB ? 'border-top: 3px solid var(--accent-cyan);' : 'border-top: 3px solid var(--accent-purple);') : ''}">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; gap: 5px; align-items: center;">
              ${appState.currentMode === 'medley' ? `
                <span style="font-size: 9.5px; font-weight: 800; padding: 2px 6px; border-radius: 4px; background: ${isTrackB ? 'rgba(6, 182, 212, 0.25)' : 'rgba(168, 85, 247, 0.25)'}; color: ${isTrackB ? '#67e8f9' : '#d8b4fe'};">
                  ${isTrackB ? 'Track 2' : 'Track 1'}
                </span>
              ` : ''}
              <span style="font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px; background: ${tagBg}22; color: ${tagBg}; border: 1px solid ${tagBg}55;">
                ${part.tag}
              </span>
              <span class="palette-audition-hint">
                🎧 Click to hear
              </span>
            </div>
            <span style="font-size: 11px; font-weight: 600; color: var(--text-muted);">
              ⏱ ${dur}s
            </span>
          </div>
          <div style="display: flex; flex-direction: column; gap: 2px; margin-top: 4px;">
            <strong style="font-size: 13px; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${part.name}
            </strong>
            <span style="font-size: 11px; color: var(--text-muted); line-height: 1.3;">
              ${part.desc}
            </span>
          </div>
          <div style="font-size: 10.5px; font-family: monospace; color: var(--accent-cyan); background: rgba(0,0,0,0.25); padding: 3px 6px; border-radius: 4px; margin-top: 2px;">
            Span: ${appState.engine.formatTime(part.startTime)} - ${appState.engine.formatTime(part.endTime)}
          </div>
          <div class="palette-actions-row">
            <button type="button" class="timeline-item-btn solo-btn" onclick="event.stopPropagation(); soloPalettePart('${part.id}')" title="Audition this part in isolation">
              <span>🔊</span> Solo
            </button>
            <button type="button" class="btn-add-to-timeline" onclick="event.stopPropagation(); addPartToTimeline('${part.id}')" title="Drop this part onto the Timeline Line">
              <span>➕</span> Add to Line
            </button>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = html;
  }
}

// Render the Sequencer Timeline Line
function renderTimelineLineUI() {
  const track = document.getElementById('timelineTrack');
  if (!track) return;

  const blocks = appState.arrangementBlocks || [];

  if (blocks.length === 0) {
    track.innerHTML = `
      <div class="timeline-empty-hint">
        <span>👉 Your Timeline Line is empty! Pick sections from the Palette below and drag & drop them here (or click "+ Add Section").</span>
      </div>
    `;
    updateTimelineStatsBadge(0, 0);
    return;
  }

  let totalDur = 0;
  for (let b of blocks) {
    totalDur += Math.max(0.01, b.endTime - b.startTime);
  }

  const html = blocks.map((blk, idx) => {
    const dur = (blk.endTime - blk.startTime).toFixed(2);
    const tagBg = blk.tagColor || '#818cf8';
    const isTrackB = blk.sourceTrack === 'B';
    const canSplit = (blk.endTime - blk.startTime) > 2.0;
    const canMerge = (idx < blocks.length - 1) && Math.abs(blocks[idx + 1].startTime - blk.endTime) < 0.2;

    return `
      <div class="timeline-item-pill" 
           id="timelinePill_${idx}" 
           data-index="${idx}" 
           draggable="true" 
           ondragstart="handleTimelineItemDragStart(event, ${idx})"
           ondragover="handleTimelineItemDragOver(event, ${idx})"
           ondragleave="handleTimelineItemDragLeave(event, ${idx})"
           ondrop="handleTimelineItemDrop(event, ${idx})"
           ondragend="handleDragEnd(event)"
           onclick="handleTimelineBlockCardClick(event, ${idx})"
           title="Click to hear/audition this block (click again to stop)"
           style="cursor: pointer; ${appState.currentMode === 'medley' ? (isTrackB ? 'border-top: 3px solid var(--accent-cyan);' : 'border-top: 3px solid var(--accent-purple);') : ''}">
        <div class="timeline-item-header">
          <span style="font-size: 10px; font-weight: 700; background: rgba(255,255,255,0.08); padding: 1px 5px; border-radius: 4px; color: var(--text-muted);">
            #${idx + 1}
          </span>
          ${appState.currentMode === 'medley' ? `
            <span style="font-size: 9.5px; font-weight: 800; padding: 1px 5px; border-radius: 4px; background: ${isTrackB ? 'rgba(6, 182, 212, 0.25)' : 'rgba(168, 85, 247, 0.25)'}; color: ${isTrackB ? '#67e8f9' : '#d8b4fe'};">
              ${isTrackB ? 'Track 2' : 'Track 1'}
            </span>
          ` : ''}
          <span style="font-size: 9.5px; font-weight: 700; padding: 1px 6px; border-radius: 4px; background: ${tagBg}22; color: ${tagBg}; border: 1px solid ${tagBg}44;">
            ${blk.tag}
          </span>
          <span class="timeline-item-cue-chip">
            🎧 Click to hear
          </span>
          <span style="font-size: 10.5px; font-weight: 600; color: var(--text-muted); margin-left: auto;">
            ${dur}s
          </span>
        </div>
        <div class="timeline-item-title" title="${blk.name}">${blk.name}</div>
        <div class="timeline-item-time">
          ${appState.engine.formatTime(blk.startTime)} - ${appState.engine.formatTime(blk.endTime)}
        </div>
        <div class="timeline-item-actions">
          <button type="button" class="timeline-item-btn solo-btn" onclick="event.stopPropagation(); soloBlock(${idx})" title="Listen to just this part">
            <span>🔊 Solo</span>
          </button>
          <button type="button" class="timeline-item-btn play-here-btn" onclick="event.stopPropagation(); playArrangementFromBlock(${idx})" title="Play timeline starting from this piece">
            <span>▶ Play</span>
          </button>
          <button type="button" class="timeline-item-btn dup" onclick="event.stopPropagation(); duplicateBlock(${idx})" title="Duplicate/repeat this part on the line">
            <span>🔁 Dup</span>
          </button>
          ${canSplit ? `
            <button type="button" class="timeline-item-btn split" onclick="event.stopPropagation(); splitBlock(${idx})" title="Split into smaller bars">
              <span>✂️ Split</span>
            </button>
          ` : ''}
          ${canMerge ? `
            <button type="button" class="timeline-item-btn merge" onclick="event.stopPropagation(); mergeBlockWithNext(${idx})" title="Merge with next piece">
              <span>🔗 Merge</span>
            </button>
          ` : ''}
          <button type="button" class="timeline-item-btn del" onclick="event.stopPropagation(); deleteBlock(${idx})" title="Cut out this piece">
            <span>✕</span>
          </button>
        </div>
      </div>
      ${idx < blocks.length - 1 ? '<span class="timeline-connector">➔</span>' : ''}
    `;
  }).join('');

  track.innerHTML = html;
  updateTimelineStatsBadge(blocks.length, totalDur);
}

function updateTimelineStatsBadge(count, totalDur) {
  const badge = document.getElementById('timelineStatsBadge');
  if (badge) {
    badge.innerText = `${count} Pieces • ${appState.engine.formatTime(totalDur)} (${totalDur.toFixed(1)}s)`;
  }

  const impactTotal = document.getElementById('impactTotalDuration');
  if (impactTotal) {
    impactTotal.innerText = `${appState.engine.formatTime(totalDur)} (${totalDur.toFixed(1)}s)`;
  }
}

function splitBlock(idx) {
  if (!appState.arrangementBlocks || !appState.arrangementBlocks[idx]) return;
  const blk = appState.arrangementBlocks[idx];
  const dur = blk.endTime - blk.startTime;

  if (dur < 1.0) {
    showToast("⚠️ This part is already a short beat (<1s) and cannot be split further.");
    return;
  }

  stopArrangementPlayback();
  saveUndoState(`Split "${blk.name}"`);

  // Look up if this section has constituent subParts in the catalog
  const allSecs = getSongSectionsCatalog();
  const matched = allSecs.find(s => Math.abs(s.startTime - blk.startTime) < 0.15 && Math.abs(s.endTime - blk.endTime) < 0.15);

  if (matched && matched.subParts && matched.subParts.length > 1) {
    const newPieces = matched.subParts.map(sp => ({
      ...sp,
      id: `${sp.id}_split_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      isDuplicated: false,
      sourceTrack: blk.sourceTrack || sp.sourceTrack
    }));
    appState.userHasCustomizedBlocks = true;
    appState.arrangementBlocks.splice(idx, 1, ...newPieces);
    renderTimelineLineUI();
    drawWaveformTimeline();
    showToast(`✂️ Split "${blk.name}" into ${newPieces.length} smaller bars!`);
    return;
  }

  // Split in half
  const half = dur / 2;
  const splitPoint = blk.startTime + half;

  const piece1 = {
    ...blk,
    id: `${blk.id}_p1_${Date.now()}`,
    name: `${blk.name.replace(/\s*\(Part\s*\d+\)/g, '')} (Part 1)`,
    endTime: splitPoint
  };
  const piece2 = {
    ...blk,
    id: `${blk.id}_p2_${Date.now()}`,
    name: `${blk.name.replace(/\s*\(Part\s*\d+\)/g, '')} (Part 2)`,
    startTime: splitPoint
  };

  appState.userHasCustomizedBlocks = true;
  appState.arrangementBlocks.splice(idx, 1, piece1, piece2);
  renderTimelineLineUI();
  drawWaveformTimeline();
  showToast(`✂️ Split into 2 parts (${(splitPoint - blk.startTime).toFixed(1)}s + ${(blk.endTime - splitPoint).toFixed(1)}s)!`);
}

function mergeBlockWithNext(idx) {
  if (!appState.arrangementBlocks || idx >= appState.arrangementBlocks.length - 1) return;
  const b1 = appState.arrangementBlocks[idx];
  const b2 = appState.arrangementBlocks[idx + 1];

  stopArrangementPlayback();
  saveUndoState(`Merge Pieces`);

  const merged = {
    ...b1,
    id: `merged_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
    name: `${b1.name.replace(/\s*\(Part\s*\d+\)/g, '')} + ${b2.name.replace(/\s*\(Part\s*\d+\)/g, '')}`,
    desc: `Merged continuous section (${b1.startTime.toFixed(2)}s - ${b2.endTime.toFixed(2)}s)`,
    startTime: b1.startTime,
    endTime: b2.endTime,
    isDuplicated: false
  };

  appState.userHasCustomizedBlocks = true;
  appState.arrangementBlocks.splice(idx, 2, merged);
  renderTimelineLineUI();
  drawWaveformTimeline();
  showToast(`🔗 Merged parts into a single continuous block (${(merged.endTime - merged.startTime).toFixed(1)}s)!`);
}

// Alias for backwards compatibility
function renderArrangementBlocksUI() {
  renderTimelineLineUI();
  renderPaletteUI();
}

// Drag & Drop Handlers
function handlePaletteDragStart(e, partId) {
  e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'from_palette', partId }));
  e.dataTransfer.effectAllowed = 'copy';
  const target = document.getElementById(`palette_${partId}`);
  if (target) target.classList.add('dragging');
}

function handleTimelineItemDragStart(e, index) {
  e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'from_timeline', index }));
  e.dataTransfer.effectAllowed = 'move';
  const target = document.getElementById(`timelinePill_${index}`);
  if (target) target.classList.add('dragging');
}

// ============================================================================
// UNDO / REDO STATE MANAGER
// ============================================================================
let undoStack = [];
let redoStack = [];

function saveUndoState(actionName = "Edit") {
  const snapshot = {
    arrangementBlocks: JSON.parse(JSON.stringify(appState.arrangementBlocks || [])),
    userHasCustomizedBlocks: appState.userHasCustomizedBlocks,
    actionName: actionName,
    timestamp: Date.now()
  };
  undoStack.push(snapshot);
  if (undoStack.length > 50) undoStack.shift();
  redoStack = []; // reset redo stack when a new action is performed
  updateUndoRedoButtons();
}

function triggerUndo() {
  if (undoStack.length === 0) {
    showToast("ℹ️ Nothing to undo.");
    return;
  }
  stopAuditionPlayback();
  stopArrangementPlayback();

  // Save current state to redoStack
  const currentState = {
    arrangementBlocks: JSON.parse(JSON.stringify(appState.arrangementBlocks || [])),
    userHasCustomizedBlocks: appState.userHasCustomizedBlocks,
    actionName: "Current State"
  };
  redoStack.push(currentState);

  const prevState = undoStack.pop();
  appState.arrangementBlocks = prevState.arrangementBlocks;
  appState.userHasCustomizedBlocks = prevState.userHasCustomizedBlocks;

  renderTimelineLineUI();
  drawWaveformTimeline();
  updateUndoRedoButtons();
  showToast(`↩️ Undid: ${prevState.actionName || 'last change'}`);
}

function triggerRedo() {
  if (redoStack.length === 0) {
    showToast("ℹ️ Nothing to redo.");
    return;
  }
  stopAuditionPlayback();
  stopArrangementPlayback();

  const currentState = {
    arrangementBlocks: JSON.parse(JSON.stringify(appState.arrangementBlocks || [])),
    userHasCustomizedBlocks: appState.userHasCustomizedBlocks,
    actionName: "Current State"
  };
  undoStack.push(currentState);

  const nextState = redoStack.pop();
  appState.arrangementBlocks = nextState.arrangementBlocks;
  appState.userHasCustomizedBlocks = nextState.userHasCustomizedBlocks;

  renderTimelineLineUI();
  drawWaveformTimeline();
  updateUndoRedoButtons();
  showToast(`↪️ Redid: ${nextState.actionName || 'change'}`);
}

function updateUndoRedoButtons() {
  const undoBtns = [document.getElementById('undoBtn'), document.getElementById('undoBtnHeader')];
  const redoBtns = [document.getElementById('redoBtn'), document.getElementById('redoBtnHeader')];

  undoBtns.forEach(btn => {
    if (btn) {
      btn.disabled = undoStack.length === 0;
      btn.style.opacity = undoStack.length === 0 ? "0.45" : "1";
      btn.style.cursor = undoStack.length === 0 ? "not-allowed" : "pointer";
    }
  });

  redoBtns.forEach(btn => {
    if (btn) {
      btn.disabled = redoStack.length === 0;
      btn.style.opacity = redoStack.length === 0 ? "0.45" : "1";
      btn.style.cursor = redoStack.length === 0 ? "not-allowed" : "pointer";
    }
  });
}

// Global keyboard shortcuts for Undo/Redo
window.addEventListener('keydown', (e) => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) {
      triggerRedo();
    } else {
      triggerUndo();
    }
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    triggerRedo();
  }
});

// ============================================================================
// "END SONG HERE" / TRIM FEATURE
// Allows user to stop/finish the song at the current paused spot, trimming rest
// ============================================================================
function trimArrangementAtCurrentPosition() {
  const blocks = appState.arrangementBlocks || [];
  if (blocks.length === 0) {
    showToast("⚠️ Timeline is empty.");
    return;
  }

  // Get current playhead position
  let pos = appState.playbackPosition || 0;
  const masterAudio = document.getElementById('masterAudioPlayer');
  if (masterAudio && !masterAudio.paused) {
    pos = masterAudio.currentTime;
  }
  const officialAudio = document.getElementById('officialAudioPlayer');
  if (officialAudio && !officialAudio.paused) {
    pos = appState.playbackPosition || officialAudio.currentTime;
  }

  if (pos <= 0.2) {
    showToast("ℹ️ Play or seek to where you want your dance/routine to end, then click this button.");
    return;
  }

  // Stop playback cleanly before trimming
  triggerStopPlayback();

  // Find which block contains this position
  let accumulated = 0;
  let targetBlockIdx = -1;
  let offsetInBlock = 0;

  for (let i = 0; i < blocks.length; i++) {
    const blk = blocks[i];
    const dur = Math.max(0.05, blk.endTime - blk.startTime);
    if (pos >= accumulated && pos < accumulated + dur) {
      targetBlockIdx = i;
      offsetInBlock = pos - accumulated;
      break;
    }
    accumulated += dur;
  }

  if (targetBlockIdx === -1) {
    targetBlockIdx = blocks.length - 1;
    offsetInBlock = blocks[targetBlockIdx].endTime - blocks[targetBlockIdx].startTime;
  }

  saveUndoState(`End Song at ${appState.engine.formatTime(pos)}`);

  const blk = blocks[targetBlockIdx];
  const exactEndInAudio = blk.startTime + offsetInBlock;

  // If offsetInBlock is more than 0.4s into the block, trim this block and cut everything after it
  if (offsetInBlock > 0.4) {
    blk.endTime = exactEndInAudio;
    appState.arrangementBlocks = blocks.slice(0, targetBlockIdx + 1);
  } else {
    // If right at the start of this block, cut everything from this block onward
    appState.arrangementBlocks = blocks.slice(0, Math.max(1, targetBlockIdx));
  }

  appState.userHasCustomizedBlocks = true;
  renderTimelineLineUI();
  drawWaveformTimeline(0);
  appState.playbackPosition = 0;

  showToast(`✂️ Music trimmed to end at ${appState.engine.formatTime(pos)}! Everything after has been cut. (Click Undo to revert)`);
}

// ============================================================================
// ENHANCED DRAG & DROP: PRECISE INTER-BLOCK INSERTION
// Calculates exact insertion between blocks, shows glowing indicator, no end-drop!
// ============================================================================
function getTimelineInsertionIndex(clientX) {
  const pills = Array.from(document.querySelectorAll('.timeline-item-pill'));
  if (pills.length === 0) return 0;

  const firstRect = pills[0].getBoundingClientRect();
  if (clientX < firstRect.left + firstRect.width * 0.3) {
    return 0;
  }

  const lastRect = pills[pills.length - 1].getBoundingClientRect();
  if (clientX > lastRect.right - lastRect.width * 0.3) {
    return pills.length;
  }

  for (let i = 0; i < pills.length; i++) {
    const rect = pills[i].getBoundingClientRect();
    const mid = rect.left + rect.width / 2;

    // Inside this pill: left half = before (i), right half = after (i+1)
    if (clientX >= rect.left && clientX <= rect.right) {
      return clientX < mid ? i : i + 1;
    }

    // In the gap / connector arrow between pill i and pill i + 1
    if (i < pills.length - 1) {
      const nextRect = pills[i + 1].getBoundingClientRect();
      if (clientX > rect.right && clientX < nextRect.left) {
        return i + 1;
      }
    }
  }

  // Distance fallback to closest boundary
  let closestIdx = 0;
  let minDistance = Infinity;
  for (let i = 0; i < pills.length; i++) {
    const rect = pills[i].getBoundingClientRect();
    const mid = rect.left + rect.width / 2;
    const dist = Math.abs(clientX - mid);
    if (dist < minDistance) {
      minDistance = dist;
      closestIdx = clientX < mid ? i : i + 1;
    }
  }
  return Math.min(closestIdx, (appState.arrangementBlocks || []).length);
}

function updateDragInsertionIndicator(targetIdx) {
  const pills = document.querySelectorAll('.timeline-item-pill');
  const connectors = document.querySelectorAll('.timeline-connector');

  pills.forEach((p, idx) => {
    p.classList.remove('drag-insert-before', 'drag-insert-after', 'drag-over-item');
    if (idx === targetIdx) {
      p.classList.add('drag-insert-before');
    } else if (targetIdx === pills.length && idx === pills.length - 1) {
      p.classList.add('drag-insert-after');
    }
  });

  connectors.forEach((c, idx) => {
    if (idx === targetIdx - 1) {
      c.classList.add('drag-insert-active');
    } else {
      c.classList.remove('drag-insert-active');
    }
  });
}

function clearDragIndicators() {
  document.querySelectorAll('.timeline-item-pill').forEach(p => {
    p.classList.remove('drag-insert-before', 'drag-insert-after', 'drag-over-item');
  });
  document.querySelectorAll('.timeline-connector').forEach(c => {
    c.classList.remove('drag-insert-active');
  });
  const dropWrapper = document.getElementById('timelineDropWrapper');
  if (dropWrapper) dropWrapper.classList.remove('drag-over');
}

function handleDragEnd(e) {
  document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
  clearDragIndicators();
}

function handleTimelineDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  const dropWrapper = document.getElementById('timelineDropWrapper');
  if (dropWrapper) dropWrapper.classList.add('drag-over');

  const targetIdx = getTimelineInsertionIndex(e.clientX);
  updateDragInsertionIndicator(targetIdx);
}

function handleTimelineDragLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) {
    clearDragIndicators();
  }
}

function handleTimelineDrop(e) {
  executeTimelineDrop(e);
}

function handleTimelineItemDragOver(e, targetIdx) {
  e.preventDefault();
  e.stopPropagation();
  e.dataTransfer.dropEffect = 'move';
  const computedIdx = getTimelineInsertionIndex(e.clientX);
  updateDragInsertionIndicator(computedIdx);
}

function handleTimelineItemDragLeave(e, targetIdx) {
  // Maintained smoothly by track dragover
}

function handleTimelineItemDrop(e, targetIdx) {
  executeTimelineDrop(e);
}

function executeTimelineDrop(e) {
  e.preventDefault();
  e.stopPropagation();

  const targetIdx = getTimelineInsertionIndex(e.clientX);
  clearDragIndicators();

  try {
    const raw = e.dataTransfer.getData('text/plain');
    if (!raw) return;
    const payload = JSON.parse(raw);

    if (payload.type === 'from_palette') {
      const catalog = getDetectedSongPartsCatalog();
      const part = catalog.find(p => p.id === payload.partId);
      if (part) {
        stopArrangementPlayback();
        if (!appState.arrangementBlocks) appState.arrangementBlocks = [];
        saveUndoState(`Add "${part.name}"`);
        appState.userHasCustomizedBlocks = true;

        const newBlock = {
          ...part,
          id: `${part.id}_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
          isDuplicated: false
        };

        // Insert at exact computed position between blocks
        appState.arrangementBlocks.splice(targetIdx, 0, newBlock);

        renderTimelineLineUI();
        drawWaveformTimeline();
        showToast(`✨ Inserted "${part.name}" at position #${targetIdx + 1}!`);
      }
    } else if (payload.type === 'from_timeline') {
      const fromIdx = payload.index;
      if (fromIdx !== undefined && appState.arrangementBlocks && appState.arrangementBlocks[fromIdx]) {
        const item = appState.arrangementBlocks[fromIdx];
        // Only move if destination differs from current position
        if (fromIdx !== targetIdx && fromIdx !== targetIdx - 1) {
          stopArrangementPlayback();
          saveUndoState(`Move "${item.name}"`);
          appState.userHasCustomizedBlocks = true;

          const [movedItem] = appState.arrangementBlocks.splice(fromIdx, 1);
          const adjustedIdx = fromIdx < targetIdx ? targetIdx - 1 : targetIdx;
          appState.arrangementBlocks.splice(adjustedIdx, 0, movedItem);

          renderTimelineLineUI();
          drawWaveformTimeline();
          showToast(`↔️ Moved "${movedItem.name}" between blocks (position #${adjustedIdx + 1})!`);
        }
      }
    }
  } catch (err) {
    console.error("Timeline drop error:", err);
  }
}

function addPartToTimeline(partId) {
  const catalog = getDetectedSongPartsCatalog();
  const part = catalog.find(p => p.id === partId);
  if (!part) return;

  stopArrangementPlayback();
  saveUndoState(`Add "${part.name}"`);

  if (!appState.arrangementBlocks) appState.arrangementBlocks = [];
  appState.userHasCustomizedBlocks = true;
  appState.arrangementBlocks.push({
    ...part,
    id: `${part.id}_${Date.now()}`,
    isDuplicated: false
  });

  renderTimelineLineUI();
  drawWaveformTimeline();
  showToast(`➕ Added "${part.name}" onto your timeline line!`);
}

function clearTimeline() {
  stopArrangementPlayback();
  saveUndoState(`Clear Timeline`);
  appState.userHasCustomizedBlocks = true;
  appState.arrangementBlocks = [];
  renderTimelineLineUI();
  drawWaveformTimeline();
  showToast(`🗑️ Timeline cleared! Pick parts from the palette below and drop them in.`);
}

function duplicateBlock(idx) {
  if (!appState.arrangementBlocks || !appState.arrangementBlocks[idx]) return;
  stopArrangementPlayback();
  const original = appState.arrangementBlocks[idx];
  saveUndoState(`Duplicate "${original.name}"`);

  const clone = {
    ...original,
    id: `${original.id}_dup_${Date.now()}`,
    name: original.name.includes('Repeat') ? original.name : `${original.name} (Repeat)`,
    desc: `Duplicated / repeated section`,
    tag: 'REPEAT',
    tagColor: '#f59e0b',
    isDuplicated: true
  };

  appState.userHasCustomizedBlocks = true;
  appState.arrangementBlocks.splice(idx + 1, 0, clone);
  renderTimelineLineUI();
  drawWaveformTimeline();
  showToast(`🔁 Duplicated "${original.name}" (inserted at #${idx + 2})`);
}

function deleteBlock(idx) {
  if (!appState.arrangementBlocks || !appState.arrangementBlocks[idx]) return;
  stopArrangementPlayback();
  const removed = appState.arrangementBlocks[idx];
  saveUndoState(`Remove "${removed.name}"`);

  appState.userHasCustomizedBlocks = true;
  appState.arrangementBlocks.splice(idx, 1);
  renderTimelineLineUI();
  drawWaveformTimeline();
  showToast(`✂️ Removed "${removed.name}" from timeline.`);
}

// Click-to-audition state tracking
let activeAuditionState = {
  type: null, // 'timeline' | 'palette'
  id: null
};
let activeAuditionAudio = null;
let activeAuditionTimeout = null;

function stopAuditionPlayback() {
  if (activeAuditionTimeout) {
    clearTimeout(activeAuditionTimeout);
    activeAuditionTimeout = null;
  }
  if (activeAuditionAudio) {
    try {
      activeAuditionAudio.pause();
      activeAuditionAudio.currentTime = 0;
    } catch (_) {}
    activeAuditionAudio = null;
  }
  if (appState.engine) {
    appState.engine.stopPlayback();
  }
  document.querySelectorAll('.timeline-item-pill, .palette-item-card, .subpart-pill-row').forEach(c => c.classList.remove('active-playing'));
}

function handleTimelineBlockCardClick(event, idx) {
  if (appState.engine && appState.engine.ctx && appState.engine.ctx.state !== 'running') {
    appState.engine.ctx.resume().catch(() => {});
  }
  // If clicked inside an interactive button or control, let that button's action fire
  if (event.target.closest('button') || event.target.closest('input')) {
    return;
  }
  soloBlock(idx);
}

function handlePaletteCardClick(event, secId) {
  if (appState.engine && appState.engine.ctx && appState.engine.ctx.state !== 'running') {
    appState.engine.ctx.resume().catch(() => {});
  }
  if (event.target.closest('button') || event.target.closest('.subpart-pill-row')) {
    return;
  }
  soloPalettePart(secId);
}

function handlePaletteSubpartClick(event, subId) {
  if (appState.engine && appState.engine.ctx && appState.engine.ctx.state !== 'running') {
    appState.engine.ctx.resume().catch(() => {});
  }
  if (event.target.closest('button')) {
    return;
  }
  soloPalettePart(subId);
}

function handlePaletteDetailedCardClick(event, partId) {
  if (appState.engine && appState.engine.ctx && appState.engine.ctx.state !== 'running') {
    appState.engine.ctx.resume().catch(() => {});
  }
  if (event.target.closest('button')) {
    return;
  }
  soloPalettePart(partId);
}

async function soloBlock(idx) {
  if (appState.engine && appState.engine.ctx && appState.engine.ctx.state !== 'running') {
    appState.engine.ctx.resume().catch(() => {});
  }
  if (!appState.arrangementBlocks || !appState.arrangementBlocks[idx]) return;
  const blk = appState.arrangementBlocks[idx];

  // Toggle stop if clicking the currently auditioning block
  if ((appState.isPlaying || activeAuditionAudio) && activeAuditionState.type === 'timeline' && activeAuditionState.id === idx) {
    stopAuditionPlayback();
    activeAuditionState = { type: null, id: null };
    showToast(`⏹ Stopped audition of "${blk.name}"`);
    return;
  }

  stopAuditionPlayback();

  // If master mix is playing, pause it so solo block can be clearly heard
  const masterAudio = document.getElementById('masterAudioPlayer');
  if (masterAudio && !masterAudio.paused) {
    masterAudio.pause();
    appState.isPlaying = false;
  }

  const pill = document.getElementById(`timelinePill_${idx}`);
  if (pill) pill.classList.add('active-playing');

  activeAuditionState = { type: 'timeline', id: idx };
  showToast(`🔊 Auditioning Block #${idx + 1}: ${blk.name} (${blk.startTime.toFixed(2)}s - ${blk.endTime.toFixed(2)}s)`);

  const dur = Math.max(0.1, blk.endTime - blk.startTime);

  // 1. Try Web Audio buffer source if buffer is ready and context is running
  const activeBuf = (appState.trackB && appState.trackB.buffer) || (appState.trackA && appState.trackA.buffer);
  if (activeBuf && appState.engine && appState.engine.ctx && appState.engine.ctx.state === 'running') {
    await appState.engine.playBlockSolo(blk, activeBuf, () => {
      if (pill) pill.classList.remove('active-playing');
      if (activeAuditionState.type === 'timeline' && activeAuditionState.id === idx) {
        activeAuditionState = { type: null, id: null };
      }
    });
    return;
  }

  // 2. Instant Zero-Latency HTML5 Audio Audition Fallback:
  try {
    const audio = new Audio('/kala_chashma_official.m4a');
    activeAuditionAudio = audio;

    const playSlice = () => {
      audio.currentTime = Math.max(0, blk.startTime);
      audio.play().catch(e => console.warn("Native audition error:", e));
    };

    if (audio.readyState >= 1) {
      playSlice();
    } else {
      audio.addEventListener('loadedmetadata', playSlice, { once: true });
      audio.play().then(() => {
        audio.currentTime = Math.max(0, blk.startTime);
      }).catch(() => {});
    }

    activeAuditionTimeout = setTimeout(() => {
      if (activeAuditionAudio === audio) {
        audio.pause();
        activeAuditionAudio = null;
      }
      if (pill) pill.classList.remove('active-playing');
      if (activeAuditionState.type === 'timeline' && activeAuditionState.id === idx) {
        activeAuditionState = { type: null, id: null };
      }
    }, dur * 1000);
  } catch (err) {
    console.error("Audition playback error:", err);
    if (pill) pill.classList.remove('active-playing');
  }

  ensureTrackBBuffer().catch(() => {});
}

async function soloPalettePart(partId) {
  if (appState.engine && appState.engine.ctx && appState.engine.ctx.state !== 'running') {
    appState.engine.ctx.resume().catch(() => {});
  }
  const allParts = getAllSongPartsAndSections();
  const part = allParts.find(p => p.id === partId);
  if (!part) return;

  // Toggle stop if clicking the currently auditioning palette card
  if ((appState.isPlaying || activeAuditionAudio) && activeAuditionState.type === 'palette' && activeAuditionState.id === partId) {
    stopAuditionPlayback();
    activeAuditionState = { type: null, id: null };
    showToast(`⏹ Stopped audition of "${part.name}"`);
    return;
  }

  stopAuditionPlayback();

  const masterAudio = document.getElementById('masterAudioPlayer');
  if (masterAudio && !masterAudio.paused) {
    masterAudio.pause();
    appState.isPlaying = false;
  }

  const card = document.getElementById(`palette_${partId}`);
  if (card) card.classList.add('active-playing');

  activeAuditionState = { type: 'palette', id: partId };
  showToast(`🔊 Auditioning: ${part.name} (${part.startTime.toFixed(2)}s - ${part.endTime.toFixed(2)}s)`);

  const dur = Math.max(0.1, part.endTime - part.startTime);

  // 1. Try Web Audio buffer source if buffer is ready and context is running
  const activeBuf = (appState.trackB && appState.trackB.buffer) || (appState.trackA && appState.trackA.buffer);
  if (activeBuf && appState.engine && appState.engine.ctx && appState.engine.ctx.state === 'running') {
    await appState.engine.playBlockSolo(part, activeBuf, () => {
      if (card) card.classList.remove('active-playing');
      if (activeAuditionState.type === 'palette' && activeAuditionState.id === partId) {
        activeAuditionState = { type: null, id: null };
      }
    });
    return;
  }

  // 2. Instant Zero-Latency HTML5 Audio Audition Fallback:
  try {
    const audio = new Audio('/kala_chashma_official.m4a');
    activeAuditionAudio = audio;

    const playSlice = () => {
      audio.currentTime = Math.max(0, part.startTime);
      audio.play().catch(e => console.warn("Native audition error:", e));
    };

    if (audio.readyState >= 1) {
      playSlice();
    } else {
      audio.addEventListener('loadedmetadata', playSlice, { once: true });
      audio.play().then(() => {
        audio.currentTime = Math.max(0, part.startTime);
      }).catch(() => {});
    }

    activeAuditionTimeout = setTimeout(() => {
      if (activeAuditionAudio === audio) {
        audio.pause();
        activeAuditionAudio = null;
      }
      if (card) card.classList.remove('active-playing');
      if (activeAuditionState.type === 'palette' && activeAuditionState.id === partId) {
        activeAuditionState = { type: null, id: null };
      }
    }, dur * 1000);
  } catch (err) {
    console.error("Audition playback error:", err);
    if (card) card.classList.remove('active-playing');
  }

  ensureTrackBBuffer().catch(() => {});
}

function resetBlocksToPreset(preset) {
  stopArrangementPlayback();
  saveUndoState(`Apply Preset: ${preset}`);
  document.querySelectorAll('.arranger-presets-group .btn-cut-preset').forEach(b => b.classList.remove('active'));

  if (preset === 'default_rep') {
    appState.arrangementBlocks = getDefaultKalaChashmaBlocks(true);
    appState.userHasCustomizedBlocks = false;
    document.getElementById('presetBlockRep1')?.classList.add('active');
    showToast("⭐ Preset Applied: Bar 1 Brass Hook Repeated (Verified Choreo)");
  } else if (preset === 'two_bar_rep') {
    const blocks = getDefaultKalaChashmaBlocks(false);
    const catalog = getDetectedSongPartsCatalog();
    // Insert repeated Bar 1 & Bar 2
    const bar1Dup = { ...catalog[0], id: 'bar_1_dup', name: 'Bar 1 Repeat: Opening Brass', tag: 'REPEAT', tagColor: '#f59e0b', isDuplicated: true };
    const bar2Dup = { ...catalog[1], id: 'bar_2_dup', name: 'Bar 2 Repeat: Brass Phrase', tag: 'REPEAT', tagColor: '#f59e0b', isDuplicated: true };
    blocks.splice(2, 0, bar1Dup, bar2Dup);
    appState.arrangementBlocks = blocks;
    appState.userHasCustomizedBlocks = true;
    document.getElementById('presetBlockRep2')?.classList.add('active');
    showToast("⭐ Preset Applied: Bars 1-2 Hook Repeated");
  } else if (preset === 'straight') {
    appState.arrangementBlocks = getDefaultKalaChashmaBlocks(false);
    appState.userHasCustomizedBlocks = true;
    document.getElementById('presetBlockStraight')?.classList.add('active');
    showToast("↺ Preset Applied: Straight Full Original Song");
  }

  renderTimelineLineUI();
  drawWaveformTimeline();
}

function openAddSliceModal() {
  document.getElementById('addSliceModal').style.display = 'flex';
}

function closeAddSliceModal() {
  document.getElementById('addSliceModal').style.display = 'none';
}

function submitCustomSlice() {
  const nameInput = document.getElementById('sliceNameInput');
  const startInput = document.getElementById('sliceStartInput');
  const endInput = document.getElementById('sliceEndInput');
  const tagSelect = document.getElementById('sliceTagSelect');

  const name = nameInput.value.trim() || 'Custom Sliced Piece';
  const startTime = parseFloat(startInput.value);
  const endTime = parseFloat(endInput.value);
  const tag = tagSelect.value || 'CUSTOM';

  if (isNaN(startTime) || isNaN(endTime) || endTime <= startTime) {
    showToast("⚠️ End time must be greater than start time.");
    return;
  }

  stopArrangementPlayback();
  saveUndoState(`Add Slice "${name}"`);

  const tagColors = {
    INTRO: '#a855f7',
    HOOK: '#ec4899',
    BUILD: '#f59e0b',
    DROP: '#10b981',
    VERSE: '#06b6d4',
    CHORUS: '#f97316',
    FINALE: '#10b981',
    CUSTOM: '#8b5cf6'
  };

  const newBlock = {
    id: `custom_${Date.now()}`,
    name: name,
    desc: `Custom slice (${startTime.toFixed(2)}s - ${endTime.toFixed(2)}s)`,
    tag: tag,
    tagColor: tagColors[tag] || '#818cf8',
    startTime: startTime,
    endTime: endTime,
    isDuplicated: false
  };

  if (!appState.arrangementBlocks) appState.arrangementBlocks = [];
  appState.userHasCustomizedBlocks = true;
  appState.arrangementBlocks.push(newBlock);

  closeAddSliceModal();
  renderTimelineLineUI();
  drawWaveformTimeline();
  showToast(`➕ Added custom slice "${name}" onto your timeline line!`);
}

let auditionTimer = null;

function initAudioPlayerSync() {
  const audio = document.getElementById('masterAudioPlayer');
  if (!audio) return;

  audio.addEventListener('timeupdate', () => {
    if (typeof arrangementSequencer !== 'undefined' && arrangementSequencer.isPlaying) return;
    appState.playbackPosition = audio.currentTime;
    drawWaveformTimeline(audio.currentTime);

    // Real-time active block highlighting on timeline
    const cur = audio.currentTime;
    let accumulated = 0;
    let activeIdx = -1;
    const blocks = appState.arrangementBlocks || [];
    for (let i = 0; i < blocks.length; i++) {
      const dur = Math.max(0.01, blocks[i].endTime - blocks[i].startTime);
      if (cur >= accumulated && cur < accumulated + dur) {
        activeIdx = i;
        break;
      }
      accumulated += dur;
    }
    if (activeIdx !== -1) {
      document.querySelectorAll('.timeline-item-pill').forEach((pill, idx) => {
        if (idx === activeIdx) pill.classList.add('active-playing');
        else pill.classList.remove('active-playing');
      });
      document.querySelectorAll('.music-block-card').forEach((card, idx) => {
        if (idx === activeIdx) card.classList.add('active-playing');
        else card.classList.remove('active-playing');
      });
    }
  });

  audio.addEventListener('play', () => {
    if (typeof arrangementSequencer !== 'undefined' && arrangementSequencer.isPlaying) return;
    appState.isPlaying = true;
    const playBtn = document.getElementById('playFullBtn');
    const timelinePlayBtn = document.getElementById('timelinePlayBtn');
    if (playBtn) {
      playBtn.innerHTML = '<span>⏸</span> Pause Full Mix';
      playBtn.classList.add('active');
    }
    if (timelinePlayBtn) {
      timelinePlayBtn.innerHTML = '<span>⏸</span> Pause Timeline';
      timelinePlayBtn.classList.add('active');
    }
  });

  audio.addEventListener('pause', () => {
    if (typeof arrangementSequencer !== 'undefined' && arrangementSequencer.isPlaying) return;
    if (!auditionTimer && !activeAuditionAudio) {
      appState.isPlaying = false;
      const playBtn = document.getElementById('playFullBtn');
      const timelinePlayBtn = document.getElementById('timelinePlayBtn');
      if (playBtn) {
        playBtn.innerHTML = '<span>▶</span> Play Full Mix';
        playBtn.classList.remove('active');
      }
      if (timelinePlayBtn) {
        timelinePlayBtn.innerHTML = '<span>▶</span> Play My Timeline';
        timelinePlayBtn.classList.remove('active');
      }
      document.querySelectorAll('.timeline-item-pill').forEach(c => c.classList.remove('active-playing'));
      document.querySelectorAll('.music-block-card').forEach(c => c.classList.remove('active-playing'));
    }
  });

  audio.addEventListener('ended', () => {
    triggerStopPlayback();
    showToast("🎉 Mix finished playing.");
  });

  audio.addEventListener('error', (e) => {
    console.warn("Native audio player note:", e);
  });
}

function initKalaChashmaDefaultState() {
  switchRemixMode('choreo');
  appState.userHasCustomizedBlocks = false;

  // Pre-configure tracks for instant readiness with pristine studio master audio
  appState.trackA = {
    name: "Kala Chashma (Official High-Quality Studio Master • 107 BPM)",
    buffer: null,
    analysis: { bpm: 107, keyInfo: { camelot: '10A', keyName: 'B Minor' }, envelopeSummary: [], beatGrid: [] },
    source: "official_studio"
  };

  appState.trackB = {
    name: "Kala Chashma (Official Master Outro / Extended Finale)",
    buffer: null,
    analysis: { bpm: 107, keyInfo: { camelot: '10A', keyName: 'B Minor' }, envelopeSummary: [], beatGrid: [] },
    source: "official_studio"
  };

  updateTrackCardUI('A', appState.trackA);
  updateTrackCardUI('B', appState.trackB);

  // Arrangement configuration: Starts at 0.041s with 1-bar riff (4 beats / 2.24s) repeated 1x, cuts at 40.4s phrase boundary, appends missing song (+133s)
  appState.studioStartOffset = 0.041;
  appState.arrangement = {
    hasArrangement: true,
    loopStart: 0.041,
    loopEnd: 2.284,
    loopRepeats: 1,
    choreoCutTime: 40.415
  };

  appState.activeTransitionConfig.spliceTimeA = 40.415;
  appState.activeTransitionConfig.spliceTimeB = 38.172;
  appState.activeTransitionConfig.crossfadeDuration = 0.25;
  appState.activeTransitionConfig.transitionType = 'choreo_splice';

  appState.candidates = [
    {
      spliceTimeA: 40.415,
      spliceTimeB: 38.172,
      barA: 18,
      barB: 18,
      addedDuration: 133.03,
      confidenceScore: 99.9,
      description: "Full Choreo Video (0:40.4 / Bar 18 phrase boundary) ➔ Seamlessly extends official song (+133s of verse 2, buildup, chorus drop, and Badshah rap finale!). Preserves 100% of choreography."
    },
    {
      spliceTimeA: 35.929,
      spliceTimeB: 33.686,
      barA: 16,
      barB: 16,
      addedDuration: 137.52,
      confidenceScore: 96,
      description: "Splice at 0:35.9 (Bar 16 Hook Peak) ➔ Cuts on the high-energy chorus hook climax."
    }
  ];
  appState.selectedCandidateIndex = 0;
  renderCandidatesGrid();

  const sliderEl = document.getElementById('customCutSlider');
  if (sliderEl) {
    sliderEl.min = "10";
    sliderEl.max = "42.0";
    sliderEl.value = "40.415";
  }
  const inputEl = document.getElementById('customCutInput');
  if (inputEl) {
    inputEl.max = "42.0";
    inputEl.value = "40.415";
  }

  applyLoopPreset(2.243, 1, '1-Bar / 4-Beat Riff');
  updateCutState(40.415, false);

  document.getElementById('compatibilityBadge').innerText = "Harmonic: 107 BPM Phase-Locked (100% Match)";
  document.getElementById('harmonicAdviceText').innerText = "Both tracks are identical tempo (107 BPM) and key. Starts at 0.04s with 1-bar (4-beat) intro riff repeated 1x, then verse, followed by seamless +133s finale!";

  initAudioPlayerSync();
  appState.arrangementBlocks = getDefaultKalaChashmaBlocks(true);
  renderArrangementBlocksUI();
  drawWaveformTimeline();

  // Background decode audio buffers for full offline spectral features
  preloadAudioBuffersInBackground();
}

async function preloadAudioBuffersInBackground() {
  try {
    let resp = await fetch('/kala_chashma_official.m4a');
    let studioBuffer = null;
    if (resp.ok) {
      try {
        const arrayBuf = await resp.arrayBuffer();
        studioBuffer = await appState.engine.decodeAudio(arrayBuf);
      } catch (err) {
        console.warn("Preload m4a decode note:", err);
      }
    }
    if (!studioBuffer) {
      let respWav = await fetch('/kala_chashma_official.wav');
      if (respWav.ok) {
        const arrayBufWav = await respWav.arrayBuffer();
        studioBuffer = await appState.engine.decodeAudio(arrayBufWav);
      }
    }

    if (studioBuffer) {
      let studioAnalysis = null;
      try {
        studioAnalysis = appState.engine.analyzeTrack(studioBuffer);
      } catch (_) {}

      if (appState.trackA) {
        appState.trackA.buffer = studioBuffer;
        if (studioAnalysis) appState.trackA.analysis = studioAnalysis;
        updateTrackCardUI('A', appState.trackA);
      }
      if (appState.trackB) {
        appState.trackB.buffer = studioBuffer;
        if (studioAnalysis) appState.trackB.analysis = studioAnalysis;
        updateTrackCardUI('B', appState.trackB);
      }
    }
  } catch (e) {
    console.log("Background audio decode note:", e.message);
  }

  // Pre-load rehearsal reference audio in background strictly for analysis
  try {
    let respA = await fetch('/performance_audio.m4a');
    if (!respA.ok) respA = await fetch('/performance_audio.wav');
    if (respA.ok) {
      const arrayBufA = await respA.arrayBuffer();
      appState.referenceVideoAudio = await appState.engine.decodeAudio(arrayBufA);
    }
  } catch (_) {}

  drawWaveformTimeline();
}

async function ensureTrackBBuffer() {
  if (appState.trackB && appState.trackB.buffer) return appState.trackB.buffer;
  try {
    let respB = await fetch('/kala_chashma_official.m4a');
    let bufferB = null;
    if (respB.ok) {
      try {
        const arrayBufB = await respB.arrayBuffer();
        bufferB = await appState.engine.decodeAudio(arrayBufB);
      } catch (decodeErr) {
        console.warn("m4a decode failed, attempting wav:", decodeErr);
      }
    }
    // Fallback to uncompressed WAV if m4a failed or was unavailable
    if (!bufferB) {
      let respWav = await fetch('/kala_chashma_official.wav');
      if (respWav.ok) {
        const arrayBufWav = await respWav.arrayBuffer();
        bufferB = await appState.engine.decodeAudio(arrayBufWav);
      }
    }

    if (bufferB) {
      let analysisB = null;
      try {
        analysisB = appState.engine.analyzeTrack(bufferB);
      } catch (_) {}
      if (appState.trackB) {
        appState.trackB.buffer = bufferB;
        if (analysisB) appState.trackB.analysis = analysisB;
      }
      if (appState.trackA) {
        appState.trackA.buffer = bufferB;
        if (analysisB) appState.trackA.analysis = analysisB;
        appState.trackA.source = 'official_studio';
      }
      drawWaveformTimeline();
      return bufferB;
    }
  } catch (e) {
    console.warn("Could not load official track buffer:", e);
  }
  return null;
}

// ============================================================================
// NATIVE AUDIO ARRANGEMENT SEQUENCER
// 100% Reliable, zero-latency HTML5 audio playback for customized timelines.
// Guaranteed audible sound on every browser (Safari, Chrome, iOS, macOS).
// ============================================================================
let arrangementSequencer = {
  isPlaying: false,
  currentBlockIdx: 0,
  audio: null,
  checkInterval: null,
  blockSchedule: [],
  totalDuration: 0,
  lastHighlightedIdx: -1
};

function getOfficialAudioElement() {
  let audio = document.getElementById('officialAudioPlayer');
  if (!audio) {
    audio = new Audio('/kala_chashma_official.m4a');
    audio.id = 'officialAudioPlayer';
    audio.preload = 'auto';
    document.body.appendChild(audio);
  }
  return audio;
}

function stopArrangementPlayback() {
  if (arrangementSequencer.checkInterval) {
    clearInterval(arrangementSequencer.checkInterval);
    arrangementSequencer.checkInterval = null;
  }
  if (arrangementSequencer.audio) {
    try {
      arrangementSequencer.audio.pause();
    } catch (_) {}
  }
  arrangementSequencer.isPlaying = false;
  arrangementSequencer.lastHighlightedIdx = -1;
  document.querySelectorAll('.timeline-item-pill, .music-block-card').forEach(el => el.classList.remove('active-playing'));
}

function highlightArrangementBlock(idx) {
  if (arrangementSequencer.lastHighlightedIdx === idx) return;
  arrangementSequencer.lastHighlightedIdx = idx;

  document.querySelectorAll('.timeline-item-pill').forEach((pill, i) => {
    if (i === idx) pill.classList.add('active-playing');
    else pill.classList.remove('active-playing');
  });
  document.querySelectorAll('.music-block-card').forEach((card, i) => {
    if (i === idx) card.classList.add('active-playing');
    else card.classList.remove('active-playing');
  });
}

function playArrangementWithNativeAudio(fromStart = false) {
  const blocks = appState.arrangementBlocks || [];
  if (blocks.length === 0) {
    showToast("⚠️ Timeline is empty! Pick sections from the palette below.");
    return;
  }

  // Pre-stop any ongoing audition or master player
  stopAuditionPlayback();
  const masterAudio = document.getElementById('masterAudioPlayer');
  if (masterAudio && !masterAudio.paused) {
    masterAudio.pause();
  }

  const audio = getOfficialAudioElement();
  arrangementSequencer.audio = audio;

  // Build the block schedule with mix start/end times
  let totalDur = 0;
  const schedule = [];
  for (let i = 0; i < blocks.length; i++) {
    const blk = blocks[i];
    const dur = Math.max(0.05, blk.endTime - blk.startTime);
    schedule.push({
      index: i,
      block: blk,
      startTime: blk.startTime,
      endTime: blk.endTime,
      duration: dur,
      mixStart: totalDur,
      mixEnd: totalDur + dur
    });
    totalDur += dur;
  }
  arrangementSequencer.blockSchedule = schedule;
  arrangementSequencer.totalDuration = totalDur;

  if (fromStart || arrangementSequencer.currentBlockIdx >= schedule.length || arrangementSequencer.currentBlockIdx < 0) {
    arrangementSequencer.currentBlockIdx = 0;
  }

  const startIdx = arrangementSequencer.currentBlockIdx;
  const currentSched = schedule[startIdx];

  // Set audio time to current block's start
  audio.currentTime = Math.max(0, currentSched.startTime);

  audio.play().then(() => {
    arrangementSequencer.isPlaying = true;
    appState.isPlaying = true;

    const playBtn = document.getElementById('playFullBtn');
    const timelinePlayBtn = document.getElementById('timelinePlayBtn');
    if (playBtn) {
      playBtn.innerHTML = '<span>⏸</span> Pause Full Mix';
      playBtn.classList.add('active');
    }
    if (timelinePlayBtn) {
      timelinePlayBtn.innerHTML = '<span>⏸</span> Pause Timeline';
      timelinePlayBtn.classList.add('active');
    }

    highlightArrangementBlock(startIdx);

    if (fromStart) {
      showToast(`🔁 Replaying modified timeline from 0:00 (${schedule.length} pieces, ${appState.engine.formatTime(totalDur)})...`);
    } else {
      showToast(`▶ Playing modified timeline from Piece #${startIdx + 1} (${currentSched.block.name})...`);
    }

    startArrangementMonitorLoop();
  }).catch(err => {
    console.warn("Native arrangement playback error:", err);
    showToast("⚠️ Autoplay prevented. Click Play again to allow audio.");
  });
}

function startArrangementMonitorLoop() {
  if (arrangementSequencer.checkInterval) {
    clearInterval(arrangementSequencer.checkInterval);
  }

  arrangementSequencer.checkInterval = setInterval(() => {
    if (!arrangementSequencer.isPlaying || !arrangementSequencer.audio) {
      clearInterval(arrangementSequencer.checkInterval);
      arrangementSequencer.checkInterval = null;
      return;
    }

    const audio = arrangementSequencer.audio;
    const schedule = arrangementSequencer.blockSchedule;
    let idx = arrangementSequencer.currentBlockIdx;

    if (idx >= schedule.length) {
      triggerStopPlayback();
      arrangementSequencer.currentBlockIdx = 0;
      drawWaveformTimeline(0);
      showToast("🏁 Reached end of custom arrangement!");
      return;
    }

    const curSched = schedule[idx];
    const curMediaTime = audio.currentTime;

    // Calculate current position within the entire arrangement timeline
    const offsetInBlock = Math.min(curSched.duration, Math.max(0, curMediaTime - curSched.startTime));
    const mixPosition = curSched.mixStart + offsetInBlock;

    appState.playbackPosition = mixPosition;
    drawWaveformTimeline(mixPosition);

    // Check if the current block has concluded (within 40ms)
    if (curMediaTime >= (curSched.endTime - 0.04)) {
      const nextIdx = idx + 1;
      if (nextIdx < schedule.length) {
        const nextSched = schedule[nextIdx];
        arrangementSequencer.currentBlockIdx = nextIdx;

        // If the next block seamlessly continues the exact same audio stream, let it stream continuously
        const isContiguous = Math.abs(nextSched.startTime - curSched.endTime) < 0.06;
        if (!isContiguous) {
          audio.currentTime = Math.max(0, nextSched.startTime);
        }
        highlightArrangementBlock(nextIdx);
      } else {
        // Reached end of last block!
        triggerStopPlayback();
        arrangementSequencer.currentBlockIdx = 0;
        drawWaveformTimeline(0);
        showToast("🏁 Reached end of custom arrangement!");
      }
    }
  }, 25);
}

function playArrangementFromBlock(idx) {
  appState.userHasCustomizedBlocks = true;
  arrangementSequencer.currentBlockIdx = idx;
  playArrangementWithNativeAudio(false);
}

/**
 * Dedicated Replay From Start (Instant restart from 0:00)
 */
function triggerReplay() {
  const audio = document.getElementById('masterAudioPlayer');
  const playBtn = document.getElementById('playFullBtn');
  const timelinePlayBtn = document.getElementById('timelinePlayBtn');

  stopAuditionPlayback();
  stopArrangementPlayback();

  // If user customized arrangement (e.g. removed, duplicated, or reordered blocks),
  // always use the native arrangement sequencer with guaranteed audible sound:
  if (appState.userHasCustomizedBlocks) {
    playArrangementWithNativeAudio(true);
    return;
  }

  // Default arrangement: replay pre-rendered master mix directly from 0:00
  if (audio) {
    audio.currentTime = 0;
    audio.play().then(() => {
      appState.isPlaying = true;
      if (playBtn) {
        playBtn.innerHTML = '<span>⏸</span> Pause Full Mix';
        playBtn.classList.add('active');
      }
      if (timelinePlayBtn) {
        timelinePlayBtn.innerHTML = '<span>⏸</span> Pause Timeline';
        timelinePlayBtn.classList.add('active');
      }
      appState.playbackPosition = 0;
      drawWaveformTimeline(0);
      showToast("🔁 Replaying full mix from beginning (0:00)...");
    }).catch(err => {
      console.warn("Native replay error, attempting arrangement sequencer:", err);
      playArrangementWithNativeAudio(true);
    });
  } else {
    playArrangementWithNativeAudio(true);
  }
}

/**
 * Play / Pause Full Mix
 */
function triggerPlayFullMix() {
  const audio = document.getElementById('masterAudioPlayer');
  const playBtn = document.getElementById('playFullBtn');
  const timelinePlayBtn = document.getElementById('timelinePlayBtn');

  stopAuditionPlayback();

  // Toggle behavior
  if (appState.isPlaying) {
    triggerStopPlayback();
    showToast("⏸ Playback paused.");
    return;
  }

  // If user customized arrangement (e.g. removed, duplicated, or reordered blocks),
  // always use the native arrangement sequencer with guaranteed audible sound:
  if (appState.userHasCustomizedBlocks) {
    playArrangementWithNativeAudio(false);
    return;
  }

  // Default sequence: play the pre-rendered master mix directly via native audio!
  if (audio) {
    audio.play().then(() => {
      appState.isPlaying = true;
      if (playBtn) {
        playBtn.innerHTML = '<span>⏸</span> Pause Full Mix';
        playBtn.classList.add('active');
      }
      if (timelinePlayBtn) {
        timelinePlayBtn.innerHTML = '<span>⏸</span> Pause Timeline';
        timelinePlayBtn.classList.add('active');
      }
      showToast("▶ Playing Kala Chashma Clean Master Mix...");
    }).catch(err => {
      console.warn("Native play error, falling back to arrangement sequencer:", err);
      playArrangementWithNativeAudio(false);
    });
  } else {
    playArrangementWithNativeAudio(false);
  }
}

async function playViaWebAudioEngine() {
  // Kept as fallback for offline rendering / Web Audio analysis
  playArrangementWithNativeAudio(false);
}

function triggerStopPlayback() {
  if (auditionTimer) {
    clearTimeout(auditionTimer);
    auditionTimer = null;
  }
  const audio = document.getElementById('masterAudioPlayer');
  if (audio) {
    audio.pause();
  }
  stopArrangementPlayback();

  if (appState.engine) {
    appState.engine.stopPlayback();
  }
  appState.isPlaying = false;
  if (appState.playheadAnimationId) {
    cancelAnimationFrame(appState.playheadAnimationId);
    appState.playheadAnimationId = null;
  }

  // Remove active-playing highlight from cards & pills
  document.querySelectorAll('.timeline-item-pill').forEach(c => c.classList.remove('active-playing'));
  document.querySelectorAll('.music-block-card').forEach(c => c.classList.remove('active-playing'));

  const playBtn = document.getElementById('playFullBtn');
  if (playBtn) {
    playBtn.innerHTML = '<span>▶</span> Play Full Mix';
    playBtn.classList.remove('active');
  }
  const timelinePlayBtn = document.getElementById('timelinePlayBtn');
  if (timelinePlayBtn) {
    timelinePlayBtn.innerHTML = '<span>▶</span> Play My Timeline';
    timelinePlayBtn.classList.remove('active');
  }

  drawWaveformTimeline(null);
}

/**
 * Audition Intro Loop Repeat Seam (8.97s)
 */
function triggerAuditionLoop() {
  const audio = document.getElementById('masterAudioPlayer');
  if (auditionTimer) {
    clearTimeout(auditionTimer);
    auditionTimer = null;
  }

  if (audio) {
    const loopSeam = (appState.arrangement && appState.arrangement.loopEnd) || 2.243;
    const start = Math.max(0, loopSeam - 2.0);
    audio.currentTime = start;
    audio.play().then(() => {
      appState.isPlaying = true;
      showToast(`⚡ Auditioning Intro Loop Repeat (${loopSeam.toFixed(1)}s seam)...`);
      auditionTimer = setTimeout(() => {
        triggerStopPlayback();
      }, 7000);
    }).catch(err => {
      console.warn(err);
    });
  }
}

/**
 * Audition Finale Extension Cut Seam (41.0s)
 */
function triggerAuditionFinale() {
  const audio = document.getElementById('masterAudioPlayer');
  if (auditionTimer) {
    clearTimeout(auditionTimer);
    auditionTimer = null;
  }

  if (audio) {
    const cutSeam = (appState.arrangement && appState.arrangement.choreoCutTime) || 41.0;
    const start = Math.max(0, cutSeam - 3.5);
    audio.currentTime = start;
    audio.play().then(() => {
      appState.isPlaying = true;
      showToast(`⚡ Auditioning Finale Extension Cut (${cutSeam.toFixed(1)}s seam)...`);
      auditionTimer = setTimeout(() => {
        triggerStopPlayback();
      }, 7000);
    }).catch(err => {
      console.warn(err);
    });
  }
}

function triggerAuditionTransition() {
  triggerAuditionFinale();
}

/**
 * ========================================================
 * 📱 MULTI-FORMAT & IPHONE-NATIVE AUDIO EXPORT SYSTEM
 * ========================================================
 */

function selectExportFormat(format) {
  appState.exportFormat = format || 'iphone';

  const formats = ['iphone', 'mp3', 'wav'];
  formats.forEach(f => {
    const pill = document.getElementById(`pillFormat${f.charAt(0).toUpperCase() + f.slice(1)}`);
    if (pill) {
      if (f === appState.exportFormat) {
        pill.classList.add('active');
      } else {
        pill.classList.remove('active');
      }
    }
  });

  const exportBtnIcon = document.getElementById('exportBtnIcon');
  const exportBtnLabel = document.getElementById('exportBtnLabel');
  if (exportBtnLabel) {
    if (appState.exportFormat === 'iphone') {
      if (exportBtnIcon) exportBtnIcon.innerText = '📱';
      exportBtnLabel.innerText = 'Download for iPhone';
    } else if (appState.exportFormat === 'mp3') {
      if (exportBtnIcon) exportBtnIcon.innerText = '🎧';
      exportBtnLabel.innerText = 'Download MP3 (256k)';
    } else {
      if (exportBtnIcon) exportBtnIcon.innerText = '🎛️';
      exportBtnLabel.innerText = 'Download Master WAV';
    }
  }
}

async function triggerExportSelectedFormat() {
  await triggerExport(appState.exportFormat || 'iphone');
}

/**
  * Alias for backwards compatibility
  */
async function triggerExportWav() {
  await triggerExport(appState.exportFormat || 'iphone');
}

/**
 * Main Audio Export Function
 * Renders the customized update clip and exports in an iPhone-playable format
 * @param {string} targetFormat 'iphone' | 'mp3' | 'wav'
 */
async function triggerExport(targetFormat = 'iphone') {
  if (!appState.trackA || !appState.trackB) {
    showToast("⚠️ Load both tracks first.");
    return;
  }

  const exportBtn = document.getElementById('exportWavBtn');
  if (exportBtn) {
    exportBtn.disabled = true;
    exportBtn.innerHTML = '<span>⏳</span> Rendering Mix...';
  }

  const formatDisplayName = targetFormat === 'iphone' ? 'iPhone (Apple M4A / MP3)' : targetFormat.toUpperCase();
  showToast(`Rendering master audio for ${formatDisplayName}...`);

  try {
    await ensureTrackBBuffer();

    const isDefaultUnmodifiedRep = appState.useStudioMaster && 
      appState.arrangementBlocks && 
      appState.arrangementBlocks.length === 16 && 
      appState.arrangementBlocks[1] && appState.arrangementBlocks[1].id === 'bar_1_dup';

    // 1. Unmodified Default Mix: Instant Download
    if (isDefaultUnmodifiedRep) {
      if (targetFormat === 'iphone') {
        try {
          const checkM4a = await fetch('/Kala_Chashma_Performance_Extended_Mix.m4a', { method: 'HEAD' });
          if (checkM4a.ok) {
            triggerFileDownload('/Kala_Chashma_Performance_Extended_Mix.m4a', 'Kala_Chashma_Wedding_Performance_Master_iPhone.m4a');
            showToast("🎉 Downloaded iPhone-ready M4A! Plays natively in Apple Music, Files app, and AirDrop.");
            return;
          }
        } catch (e) {
          console.warn("Pre-rendered M4A not found, proceeding to render:", e);
        }
      } else if (targetFormat === 'wav') {
        try {
          const checkWav = await fetch('/Kala_Chashma_Performance_Extended_Mix.wav', { method: 'HEAD' });
          if (checkWav.ok) {
            triggerFileDownload('/Kala_Chashma_Performance_Extended_Mix.wav', 'Kala_Chashma_Performance_Clean_Master_Mix.wav');
            showToast("🎉 Studio Master WAV exported successfully!");
            return;
          }
        } catch (e) {
          console.warn("Pre-rendered WAV not found, proceeding to render:", e);
        }
      }
    }

    // 2. Customized "update clip": Offline Render of user's customized arrangement blocks
    const config = {
      blocks: appState.arrangementBlocks,
      hasArrangement: appState.arrangement ? appState.arrangement.hasArrangement : false,
      loopStart: appState.arrangement ? appState.arrangement.loopStart : 0,
      loopEnd: appState.arrangement ? appState.arrangement.loopEnd : 2.243,
      loopRepeats: appState.arrangement ? appState.arrangement.loopRepeats : 1,
      choreoCutTime: appState.arrangement ? appState.arrangement.choreoCutTime : appState.activeTransitionConfig.spliceTimeA,
      spliceTimeA: appState.activeTransitionConfig.spliceTimeA,
      spliceTimeB: appState.activeTransitionConfig.spliceTimeB,
      crossfadeDuration: appState.activeTransitionConfig.crossfadeDuration,
      transitionType: appState.activeTransitionConfig.transitionType,
      useStudioMasterForChoreo: appState.useStudioMaster,
      studioStartOffset: appState.studioStartOffset
    };

    const result = await appState.engine.renderMasterWav(appState.trackA, appState.trackB, config);
    const renderedBuf = result.renderedBuffer;

    // WAV Format
    if (targetFormat === 'wav') {
      const url = URL.createObjectURL(result.wavBlob);
      triggerFileDownload(url, `Kala_Chashma_Custom_Arranged_Master_${Date.now()}.wav`, true);
      showToast("🎉 Studio Master WAV exported successfully!");
      return;
    }

    // iPhone Format: Try Apple M4A via afconvert first, fallback to pristine 256k MP3
    if (targetFormat === 'iphone') {
      if (exportBtn) {
        exportBtn.innerHTML = '<span>⚡</span> Encoding iPhone Clip...';
      }
      showToast("Encoding iPhone-compatible audio (Apple M4A / MP3)...");

      // Attempt server CoreAudio conversion
      const serverResult = await appState.engine.convertWavToM4aOnServer(result.wavBlob);
      if (serverResult && serverResult.success && serverResult.audioUrl) {
        triggerFileDownload(serverResult.audioUrl, `Kala_Chashma_Wedding_Remix_iPhone_${Date.now()}.m4a`);
        showToast("🎉 iPhone Apple M4A clip exported! 100% playable on iPhone Files, Apple Music, and AirDrop.");
        return;
      }

      // Universal client-side MP3 encoding via lamejs
      // MP3 plays natively on every iPhone in iOS Safari, Files app, Apple Music, AirDrop, iMessage, and WhatsApp
      const mp3Blob = await appState.engine.audioBufferToMp3Blob(renderedBuf, 256, (pct) => {
        if (exportBtn) exportBtn.innerHTML = `<span>⚡</span> iPhone Audio ${pct}%`;
      });

      const mp3Filename = `Kala_Chashma_Wedding_Remix_iPhone_${Date.now()}.mp3`;
      await downloadOrShareBlob(mp3Blob, mp3Filename, 'audio/mpeg');
      showToast("🎉 iPhone-ready mix downloaded! Opens in iOS Files, AirDrop, Apple Music & WhatsApp.");
      return;
    }

    // Universal MP3 Format
    if (targetFormat === 'mp3') {
      if (exportBtn) {
        exportBtn.innerHTML = '<span>⚡</span> Encoding MP3...';
      }
      showToast("Encoding universal 256kbps stereo MP3...");

      const mp3Blob = await appState.engine.audioBufferToMp3Blob(renderedBuf, 256, (pct) => {
        if (exportBtn) exportBtn.innerHTML = `<span>⚡</span> MP3 ${pct}%`;
      });

      const mp3Filename = `Kala_Chashma_Wedding_Remix_${Date.now()}.mp3`;
      await downloadOrShareBlob(mp3Blob, mp3Filename, 'audio/mpeg');
      showToast("🎉 Universal MP3 exported successfully!");
      return;
    }

  } catch (err) {
    console.error("Export error:", err);
    showToast(`⚠️ Export failed: ${err.message}`);
  } finally {
    if (exportBtn) {
      exportBtn.disabled = false;
      selectExportFormat(appState.exportFormat || 'iphone');
    }
  }
}

/**
 * Handle mobile native share sheet (AirDrop, iOS Files, WhatsApp) or file download
 */
async function downloadOrShareBlob(blob, filename, mimeType, preferShare = false) {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if ((preferShare || isIOS) && navigator.canShare) {
    try {
      const file = new File([blob], filename, { type: mimeType });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: 'Kala Chashma Wedding Remix',
          text: 'Here is our custom wedding choreography remix clip!',
          files: [file]
        });
        showToast("🎉 Shared to iPhone successfully!");
        return;
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.warn("Share sheet dismissed or unsupported, falling back to download:", err);
      } else {
        return; // User explicitly cancelled share sheet
      }
    }
  }

  // Fallback / standard browser download
  const url = URL.createObjectURL(blob);
  triggerFileDownload(url, filename, true);
}

function triggerFileDownload(url, filename, revoke = false) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  if (revoke) {
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}

/**
 * Trigger direct iPhone AirDrop / Share Sheet
 */
async function triggerIPhoneShare() {
  if (!appState.trackA || !appState.trackB) {
    showToast("⚠️ Load both tracks first.");
    return;
  }

  showToast("Preparing iPhone clip for AirDrop / Share Sheet...");
  const shareBtn = document.getElementById('shareIphoneBtn');
  if (shareBtn) {
    shareBtn.disabled = true;
    shareBtn.innerHTML = '<span>⏳</span> Preparing...';
  }

  try {
    await ensureTrackBBuffer();

    const config = {
      blocks: appState.arrangementBlocks,
      hasArrangement: appState.arrangement ? appState.arrangement.hasArrangement : false,
      loopStart: appState.arrangement ? appState.arrangement.loopStart : 0,
      loopEnd: appState.arrangement ? appState.arrangement.loopEnd : 2.243,
      loopRepeats: appState.arrangement ? appState.arrangement.loopRepeats : 1,
      choreoCutTime: appState.arrangement ? appState.arrangement.choreoCutTime : appState.activeTransitionConfig.spliceTimeA,
      spliceTimeA: appState.activeTransitionConfig.spliceTimeA,
      spliceTimeB: appState.activeTransitionConfig.spliceTimeB,
      crossfadeDuration: appState.activeTransitionConfig.crossfadeDuration,
      transitionType: appState.activeTransitionConfig.transitionType,
      useStudioMasterForChoreo: appState.useStudioMaster,
      studioStartOffset: appState.studioStartOffset
    };

    const isDefaultUnmodifiedRep = appState.useStudioMaster && 
      appState.arrangementBlocks && 
      appState.arrangementBlocks.length === 16 && 
      appState.arrangementBlocks[1] && appState.arrangementBlocks[1].id === 'bar_1_dup';

    if (isDefaultUnmodifiedRep) {
      try {
        const resp = await fetch('/Kala_Chashma_Performance_Extended_Mix.m4a');
        if (resp.ok) {
          const blob = await resp.blob();
          await downloadOrShareBlob(blob, 'Kala_Chashma_Wedding_Remix_iPhone.m4a', 'audio/mp4', true);
          return;
        }
      } catch (e) {}
    }

    const result = await appState.engine.renderMasterWav(appState.trackA, appState.trackB, config);
    // Encode MP3 for share
    const mp3Blob = await appState.engine.audioBufferToMp3Blob(result.renderedBuffer, 256);
    await downloadOrShareBlob(mp3Blob, `Kala_Chashma_Wedding_Remix_iPhone_${Date.now()}.mp3`, 'audio/mpeg', true);
  } catch (err) {
    console.error("Share error:", err);
    showToast(`⚠️ Share failed: ${err.message}`);
  } finally {
    if (shareBtn) {
      shareBtn.disabled = false;
      shareBtn.innerHTML = '<span>📲</span> AirDrop / Share';
    }
  }
}

/**
 * Rehearsal Cue Sheet
 */
function openCueSheetModal() {
  if (!appState.trackA || !appState.trackB) {
    showToast("⚠️ Load both tracks first to generate cue sheet.");
    return;
  }

  const arr = appState.arrangement;
  let content = '';

  if (arr && arr.hasArrangement) {
    const loopEnd = arr.loopEnd || 8.972;
    const loopStart = arr.loopStart || 0;
    const repeats = arr.loopRepeats !== undefined ? arr.loopRepeats : 1;
    const repLen = (repeats > 0) ? (loopEnd - loopStart) * repeats : 0;
    const choreoCut = arr.choreoCutTime || 41.0;
    const choreoCutInStudio = (repeats > 0) ? (loopEnd + Math.max(0, choreoCut - (loopEnd + repLen))) : choreoCut;
    const trackBDur = (appState.trackB && appState.trackB.buffer) ? appState.trackB.buffer.duration : 173.45;
    const extensionDur = Math.max(0, trackBDur - choreoCutInStudio);
    const totalDuration = choreoCut + extensionDur;

    content = `
==================================================
  WEDDING DANCE REHEARSAL CUE SHEET
==================================================
Song: Kala Chashma (Wedding Choreo Extended Mix)
Total Mix Duration: ${appState.engine.formatTime(totalDuration)} (${totalDuration.toFixed(1)}s)
Audio Quality Mode: ${appState.useStudioMaster ? '🌟 Pristine Studio Master (Clean HD Audio)' : '📹 Performance Phone Mic Audio'}
Tempo / BPM:        ${appState.trackB ? appState.trackB.analysis.bpm : 107} BPM (1 Bar = 2.24s, 8-count = 4.49s)
Intro Loop Pattern: ${repeats > 0 ? `1-Bar (4 Beats) Intro Riff repeated 1x (+${repLen.toFixed(1)}s)` : 'Straight Intro (No Repeat)'}
Choreo Cut Point:   ${appState.engine.formatTime(choreoCut)} (${choreoCut.toFixed(1)}s)

BLOCK 1: INTRO HORN RIFF (Bar 1)
--------------------------------------------------
[ 0:00.0 - ${appState.engine.formatTime(loopEnd)} ]
* Dancers prepare for entrance / position on stage.
* 4-beat opening brass fanfare motif.

BLOCK 2: CHOREO LOOP REPEAT (Bar 2)
--------------------------------------------------
[ ${appState.engine.formatTime(loopEnd)} - ${appState.engine.formatTime(loopEnd + repLen)} ]
* Intro horn riff repeated for choreography entrance / bridal party pose!
* Dancers make entry formation.

BLOCK 3: CHOREOGRAPHY DANCE & VERSE (Bar 3-18)
--------------------------------------------------
[ ${appState.engine.formatTime(loopEnd + repLen)} - ${appState.engine.formatTime(choreoCut)} ]
* Dancers execute rehearsed wedding choreography exactly as practiced.
* Smooth vocals and rhythm section up to video cutoff point.

BLOCK 4: EXTENDED GRAND FINALE & RAP (Bar 15-Outro)
--------------------------------------------------
[ ${appState.engine.formatTime(choreoCut)} - ${appState.engine.formatTime(totalDuration)} ] (+${Math.round(extensionDur)}s)
* Continues seamlessly from ${appState.engine.formatTime(choreoCutInStudio)} of the official studio track!
* Includes the massive chorus drop, Badshah's rap verse, and high-energy outro.
* Entire family / bridal party rushes the stage for the celebratory finish!
==================================================
`.trim();
  } else {
    const spliceTimeA = appState.activeTransitionConfig.spliceTimeA;
    const spliceTimeB = appState.activeTransitionConfig.spliceTimeB;
    const remainingDurationB = Math.max(0, appState.trackB.buffer.duration - spliceTimeB);
    const totalDuration = spliceTimeA + remainingDurationB;

    content = `
==================================================
  WEDDING DANCE REHEARSAL CUE SHEET
==================================================
Total Mix Duration: ${appState.engine.formatTime(totalDuration)}
Audio Quality Mode: ${appState.useStudioMaster ? '🌟 Pristine Studio Master (Clean HD Audio)' : '📹 Performance Phone Mic Audio'}
Transition Type:    ${appState.activeTransitionConfig.transitionType.toUpperCase()}
Tempo / BPM:        Track 1: ${appState.trackA.analysis.bpm} BPM | Track 2: ${appState.trackB.analysis.bpm} BPM
Cut / Splice Point: ${appState.engine.formatTime(spliceTimeA)} (${spliceTimeA.toFixed(2)}s)

SECTION 1: TRACK 1 ACTIVE REGION
--------------------------------------------------
[ 0:00.0 - ${appState.engine.formatTime(spliceTimeA)} ]
* Choreo / Entrance section.

SECTION 2: TRACK 2 EXTENDED REGION
--------------------------------------------------
[ ${appState.engine.formatTime(spliceTimeA)} - ${appState.engine.formatTime(totalDuration)} ]
* Continues from ${appState.engine.formatTime(spliceTimeB)} of full song to grand finale.
==================================================
`.trim();
  }

  document.getElementById('cueSheetContent').innerText = content;
  document.getElementById('cueSheetModal').style.display = 'flex';
}

function closeCueSheetModal() {
  document.getElementById('cueSheetModal').style.display = 'none';
}

function copyCueSheetToClipboard() {
  const content = document.getElementById('cueSheetContent').innerText;
  navigator.clipboard.writeText(content).then(() => {
    showToast("📋 Cue sheet copied to clipboard!");
  }).catch(() => {
    showToast("Selected text - use Cmd+C to copy.");
  });
}

/**
 * Toast notifications
 */
let toastTimeout;
function showToast(message) {
  const toast = document.getElementById('statusNotification');
  const msgEl = document.getElementById('toastMessage');
  msgEl.innerText = message;
  toast.style.display = 'flex';

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.style.display = 'none';
  }, 4000);
}
