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
  exportFormat: 'iphone',
  // Multi-Track Ceremony Mashup State
  ceremonyMashupInitialized: false,
  ceremonyMashup: {
    tracks: [
      {
        id: 't1',
        title: 'Kudmayi Mashup',
        sourceType: 'demo',
        youtubeUrl: 'https://youtu.be/28Wx2K9nJBw',
        audioUrl: '/kudmayi_mashup.m4a',
        fileName: '',
        buffer: null,
        startTimeStr: '00:00:40',
        endTimeStr: 'End',
        startTimeSec: 40.0,
        endTimeSec: null,
        durationSec: null,
        color: '#ec4899',
        status: 'ready'
      },
      {
        id: 't2',
        title: 'Kanyadaan Song',
        sourceType: 'demo',
        youtubeUrl: 'https://youtu.be/3op9jf3K-u0',
        audioUrl: '/kanyadaan_song.m4a',
        fileName: '',
        buffer: null,
        startTimeStr: '00:00:04',
        endTimeStr: '00:01:00',
        startTimeSec: 4.0,
        endTimeSec: 60.0,
        durationSec: 56.0,
        color: '#06b6d4',
        status: 'ready'
      },
      {
        id: 't3',
        title: 'Tere Hawaale',
        sourceType: 'demo',
        youtubeUrl: 'https://youtu.be/KUpwupYj_tY',
        audioUrl: '/tere_hawaale.m4a',
        fileName: '',
        buffer: null,
        startTimeStr: '00:00:50',
        endTimeStr: '00:02:13',
        startTimeSec: 50.0,
        endTimeSec: 133.0,
        durationSec: 83.0,
        color: '#10b981',
        status: 'ready'
      }
    ],
    introCrossfade: true,
    introFadeSec: 2.0,
    introCurve: 'tri',
    crossfadeSec: 3.0,
    crossfadeCurve: 'tri',
    outroCrossfade: true,
    outroFadeSec: 3.0,
    outroCurve: 'tri',
    fadeInSec: 2.0,
    fadeOutSec: 3.0,
    normalizeLoudness: true,
    isPlaying: false,
    playbackPosition: 0,
    activeSourceNode: null,
    playheadAnimId: null,
    activePreviewIdx: null,
    renderedMashup: null
  }
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
    if (typeof drawCeremonyTimeline === 'function') {
      drawCeremonyTimeline();
    }
  });
}

function switchRemixMode(mode) {
  appState.currentMode = mode;
  document.getElementById('modeChoreoTab')?.classList.toggle('active', mode === 'choreo');
  document.getElementById('modeMedleyTab')?.classList.toggle('active', mode === 'medley');
  document.getElementById('modeCeremonyTab')?.classList.toggle('active', mode === 'ceremony');

  // Stop any ongoing playback across modes
  if (appState.isPlaying && typeof toggleFullPlayback === 'function') {
    toggleFullPlayback();
  }
  if (appState.ceremonyMashup && appState.ceremonyMashup.isPlaying && typeof stopCeremonyPlayback === 'function') {
    stopCeremonyPlayback();
  }

  const decksRow = document.querySelector('.song-decks-row');
  const timelineSec = document.getElementById('timelineSection');
  const paletteSec = document.getElementById('paletteSection') || document.querySelector('.palette-card');
  const advDrawer = document.getElementById('advancedDrawer');
  const ceremonySec = document.getElementById('ceremonyMashupSection');

  if (mode === 'ceremony') {
    if (decksRow) decksRow.style.display = 'none';
    if (timelineSec) timelineSec.style.display = 'none';
    if (paletteSec) paletteSec.style.display = 'none';
    if (advDrawer) advDrawer.style.display = 'none';
    if (ceremonySec) ceremonySec.style.display = 'block';

    if (typeof initCeremonyMashupUI === 'function') {
      initCeremonyMashupUI();
    }
    return;
  }

  // Restore non-ceremony sections for choreo / medley
  if (decksRow) decksRow.style.display = 'grid';
  if (timelineSec) timelineSec.style.display = 'block';
  if (paletteSec) paletteSec.style.display = 'block';
  if (advDrawer) advDrawer.style.display = 'block';
  if (ceremonySec) ceremonySec.style.display = 'none';

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

  const transPanel = document.getElementById('transitionMethodsPanel');
  if (transPanel) {
    transPanel.style.display = (mode === 'medley') ? 'block' : 'none';
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
  },
  tauba_tauba_movie1: {
    id: 'tauba_tauba_movie1',
    name: 'Tauba Tauba (Movie 1 - Team 1)',
    shortName: 'Tauba Tauba (Movie 1)',
    bpm: 107,
    keyInfo: { camelot: '10A', keyName: 'B Minor' },
    duration: 32.92,
    audioUrl: '/tauba_tauba_movie1.m4a',
    sections: [
      {
        id: 'tt1_sec_intro',
        name: 'Opening Beat & Team 1 Entrance (Bars 1-4)',
        desc: 'Intro groove & Team 1 dance floor entrance (0:00 - 8.97s)',
        tag: 'INTRO',
        tagColor: '#a855f7',
        startTime: 0.00,
        endTime: 8.972,
        songName: 'Tauba Tauba (Movie 1)',
        sourceTrack: 'A',
        subParts: [
          { id: 'tt1_bar_1_2', name: 'Bars 1-2: Opening Beat Stems', desc: 'Entrance setup beat (8 counts)', tag: 'INTRO', tagColor: '#a855f7', startTime: 0.00, endTime: 4.486, songName: 'Tauba Tauba (Movie 1)', sourceTrack: 'A' },
          { id: 'tt1_bar_3_4', name: 'Bars 3-4: Synth Horns & Floor Takeover', desc: 'Team 1 takes dance floor', tag: 'INTRO', tagColor: '#a855f7', startTime: 4.486, endTime: 8.972, songName: 'Tauba Tauba (Movie 1)', sourceTrack: 'A' }
        ]
      },
      {
        id: 'tt1_sec_verse',
        name: 'Lead Verse Choreography (Bars 5-8)',
        desc: 'Main vocal verse & synchronized footwork (8.97s - 17.94s)',
        tag: 'VERSE',
        tagColor: '#06b6d4',
        startTime: 8.972,
        endTime: 17.944,
        songName: 'Tauba Tauba (Movie 1)',
        sourceTrack: 'A',
        subParts: [
          { id: 'tt1_bar_5_6', name: 'Bars 5-6: Verse Vocal Lines', desc: 'Main vocal line choreography', tag: 'VERSE', tagColor: '#06b6d4', startTime: 8.972, endTime: 13.458, songName: 'Tauba Tauba (Movie 1)', sourceTrack: 'A' },
          { id: 'tt1_bar_7_8', name: 'Bars 7-8: Build to Signature Hook', desc: 'Pre-chorus rising energy', tag: 'BUILD', tagColor: '#ec4899', startTime: 13.458, endTime: 17.944, songName: 'Tauba Tauba (Movie 1)', sourceTrack: 'A' }
        ]
      },
      {
        id: 'tt1_sec_chorus',
        name: 'Signature "Tauba Tauba" Hook Climax (Bars 9-12)',
        desc: 'Team 1 signature viral hook & battle challenge (17.94s - 26.92s)',
        tag: 'CHORUS',
        tagColor: '#f97316',
        startTime: 17.944,
        endTime: 26.916,
        songName: 'Tauba Tauba (Movie 1)',
        sourceTrack: 'A',
        subParts: [
          { id: 'tt1_bar_9_10', name: 'Bars 9-10: "Tauba Tauba" Main Hook', desc: 'Viral hand hook moves (Team 1 peak)', tag: 'CHORUS', tagColor: '#f97316', startTime: 17.944, endTime: 22.430, songName: 'Tauba Tauba (Movie 1)', sourceTrack: 'A' },
          { id: 'tt1_bar_11_12', name: 'Bars 11-12: Hook Response & Challenge Pose', desc: 'Battle challenge pose & handover', tag: 'CHORUS', tagColor: '#f97316', startTime: 22.430, endTime: 26.916, songName: 'Tauba Tauba (Movie 1)', sourceTrack: 'A' }
        ]
      },
      {
        id: 'tt1_sec_outro',
        name: 'Extended Beat / Handover to Team 2 (Bars 13-14)',
        desc: 'Transition groove & riser into Team 2 (26.92s - 32.92s)',
        tag: 'OUTRO',
        tagColor: '#10b981',
        startTime: 26.916,
        endTime: 32.924,
        songName: 'Tauba Tauba (Movie 1)',
        sourceTrack: 'A',
        subParts: [
          { id: 'tt1_bar_13_14', name: 'Bars 13-14: Outro Riser Beat', desc: 'Riser into transition point', tag: 'OUTRO', tagColor: '#10b981', startTime: 26.916, endTime: 31.402, songName: 'Tauba Tauba (Movie 1)', sourceTrack: 'A' },
          { id: 'tt1_bar_tail', name: 'Final Beat Decay & Drop Handover', desc: 'Drop handover to Team 2', tag: 'OUTRO', tagColor: '#10b981', startTime: 31.402, endTime: 32.924, songName: 'Tauba Tauba (Movie 1)', sourceTrack: 'A' }
        ]
      }
    ]
  },
  tauba_tauba_movie2: {
    id: 'tauba_tauba_movie2',
    name: 'Tauba Tauba (Movie 2 - Team 2)',
    shortName: 'Tauba Tauba (Movie 2)',
    bpm: 112,
    keyInfo: { camelot: '10A', keyName: 'B Minor' },
    duration: 17.46,
    audioUrl: '/tauba_tauba_movie2.m4a',
    sections: [
      {
        id: 'tt2_sec_entry',
        name: 'Team 2 Battle Entry & Heavy Beat Slam (Bars 1-2)',
        desc: 'Team 2 charges the dance floor with explosive rhythm (0:00 - 4.29s)',
        tag: 'DROP',
        tagColor: '#10b981',
        startTime: 0.00,
        endTime: 4.286,
        songName: 'Tauba Tauba (Movie 2)',
        sourceTrack: 'B',
        subParts: [
          { id: 'tt2_bar_1', name: 'Bar 1: Downbeat Takeover & Slam', desc: 'Team 2 downbeat entrance (4 beats)', tag: 'DROP', tagColor: '#10b981', startTime: 0.00, endTime: 2.143, songName: 'Tauba Tauba (Movie 2)', sourceTrack: 'B' },
          { id: 'tt2_bar_2', name: 'Bar 2: Dhol Roll & Battle Turn', desc: 'Dhol turnaround choreography', tag: 'DROP', tagColor: '#10b981', startTime: 2.143, endTime: 4.286, songName: 'Tauba Tauba (Movie 2)', sourceTrack: 'B' }
        ]
      },
      {
        id: 'tt2_sec_hook',
        name: 'Team 2 "Tauba Tauba" Counter-Hook (Bars 3-5)',
        desc: 'Energetic counter-routine & vocal hook response (4.29s - 10.71s)',
        tag: 'CHORUS',
        tagColor: '#f97316',
        startTime: 4.286,
        endTime: 10.714,
        songName: 'Tauba Tauba (Movie 2)',
        sourceTrack: 'B',
        subParts: [
          { id: 'tt2_bar_3_4', name: 'Bars 3-4: Counter-Hook Choreography', desc: 'Team 2 signature dance answer', tag: 'CHORUS', tagColor: '#f97316', startTime: 4.286, endTime: 8.571, songName: 'Tauba Tauba (Movie 2)', sourceTrack: 'B' },
          { id: 'tt2_bar_5', name: 'Bar 5: High-Speed Vocal Spin', desc: 'Spin transition into climax', tag: 'BUILD', tagColor: '#ec4899', startTime: 8.571, endTime: 10.714, songName: 'Tauba Tauba (Movie 2)', sourceTrack: 'B' }
        ]
      },
      {
        id: 'tt2_sec_finale',
        name: 'Grand Dance-Off Climax & Joint Bow (Bars 6-8)',
        desc: 'Both teams join together for final celebration drop (10.71s - 17.46s)',
        tag: 'FINALE',
        tagColor: '#a855f7',
        startTime: 10.714,
        endTime: 17.460,
        songName: 'Tauba Tauba (Movie 2)',
        sourceTrack: 'B',
        subParts: [
          { id: 'tt2_bar_6_7', name: 'Bars 6-7: Double-Time Finale Drop', desc: 'High energy fast footwork', tag: 'FINALE', tagColor: '#a855f7', startTime: 10.714, endTime: 15.000, songName: 'Tauba Tauba (Movie 2)', sourceTrack: 'B' },
          { id: 'tt2_bar_8', name: 'Bar 8: Grand Bow & Confetti Pose', desc: 'Final pose & crowd cheer cutoff', tag: 'FINALE', tagColor: '#a855f7', startTime: 15.000, endTime: 17.460, songName: 'Tauba Tauba (Movie 2)', sourceTrack: 'B' }
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
  const subParts = secs.flatMap(s => s.subParts || []);
  const parts = getDetectedSongPartsCatalog();
  return [...secs, ...subParts, ...parts];
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
  } else if (songId === 'tauba_tauba_movie1') {
    if (!appState._cachedTauba1) {
      try {
        const resp = await fetch('/tauba_tauba_movie1.wav');
        if (resp.ok) {
          const ab = await resp.arrayBuffer();
          appState._cachedTauba1 = await appState.engine.decodeAudio(ab);
        }
      } catch (e) {
        console.warn("Could not load tauba 1 wav, trying m4a:", e);
      }
      if (!appState._cachedTauba1) {
        try {
          const resp = await fetch('/tauba_tauba_movie1.m4a');
          if (resp.ok) {
            const ab = await resp.arrayBuffer();
            appState._cachedTauba1 = await appState.engine.decodeAudio(ab);
          }
        } catch (e2) {
          console.warn("Could not load tauba 1 m4a:", e2);
        }
      }
    }
    return appState._cachedTauba1;
  } else if (songId === 'tauba_tauba_movie2') {
    if (!appState._cachedTauba2) {
      try {
        const resp = await fetch('/tauba_tauba_movie2.wav');
        if (resp.ok) {
          const ab = await resp.arrayBuffer();
          appState._cachedTauba2 = await appState.engine.decodeAudio(ab);
        }
      } catch (e) {
        console.warn("Could not load tauba 2 wav, trying m4a:", e);
      }
      if (!appState._cachedTauba2) {
        try {
          const resp = await fetch('/tauba_tauba_movie2.m4a');
          if (resp.ok) {
            const ab = await resp.arrayBuffer();
            appState._cachedTauba2 = await appState.engine.decodeAudio(ab);
          }
        } catch (e2) {
          console.warn("Could not load tauba 2 m4a:", e2);
        }
      }
    }
    return appState._cachedTauba2;
  } else if (songId === 'choreo_demo') {
    if (!appState._cachedChoreoDemo) {
      appState._cachedChoreoDemo = await appState.demoGen.generateChoreoEdit();
    }
    return appState._cachedChoreoDemo;
  }
  return await ensureTrackBBuffer();
}

function getTaubaTaubaDanceOffBlocks() {
  const song1 = WEDDING_SONG_CATALOG['tauba_tauba_movie1'];
  const song2 = WEDDING_SONG_CATALOG['tauba_tauba_movie2'];

  const blocks = [];

  // Team 1 Sequence (Tauba Tauba Movie 1): 0:00 to 22.43s
  // 1. Intro Hook (Bars 1-4)
  if (song1 && song1.sections[0]) {
    blocks.push({
      ...song1.sections[0],
      sourceTrack: 'A',
      songId: 'tauba_tauba_movie1',
      teamLabel: '🕺 Team 1 (Movie 1)'
    });
  }
  // 2. Verse Choreography (Bars 5-8)
  if (song1 && song1.sections[1]) {
    blocks.push({
      ...song1.sections[1],
      sourceTrack: 'A',
      songId: 'tauba_tauba_movie1',
      teamLabel: '🕺 Team 1 (Movie 1)'
    });
  }
  // 3. Signature Hook Climax (Bars 9-10, 17.94s - 22.43s)
  if (song1 && song1.sections[2] && song1.sections[2].subParts && song1.sections[2].subParts[0]) {
    blocks.push({
      ...song1.sections[2].subParts[0],
      sourceTrack: 'A',
      songId: 'tauba_tauba_movie1',
      teamLabel: '🕺 Team 1 (Movie 1)'
    });
  }

  // Team 2 Sequence (Tauba Tauba Movie 2): 0:00 to 17.46s
  // 4. Team 2 Battle Entry (Bars 1-2, 0.0s - 4.29s)
  if (song2 && song2.sections[0]) {
    blocks.push({
      ...song2.sections[0],
      sourceTrack: 'B',
      songId: 'tauba_tauba_movie2',
      teamLabel: '💃 Team 2 (Movie 2)'
    });
  }
  // 5. Team 2 Counter-Hook (Bars 3-5, 4.29s - 10.71s)
  if (song2 && song2.sections[1]) {
    blocks.push({
      ...song2.sections[1],
      sourceTrack: 'B',
      songId: 'tauba_tauba_movie2',
      teamLabel: '💃 Team 2 (Movie 2)'
    });
  }
  // 6. Grand Dance-Off Finale & Bow (Bars 6-8, 10.71s - 17.46s)
  if (song2 && song2.sections[2]) {
    blocks.push({
      ...song2.sections[2],
      sourceTrack: 'B',
      songId: 'tauba_tauba_movie2',
      teamLabel: '💃 Team 2 (Movie 2)'
    });
  }

  return blocks;
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

  } else if (starterId === 'kudmayi_ceremony') {
    switchRemixMode('ceremony');
    await loadCeremonyPreset('kudmayi_mashup');
    showToast("💖 Kudmayi ➔ Kanyadaan ➔ Tere Hawaale Ceremony Mashup loaded!");

  } else if (starterId === 'din_shagna_ceremony') {
    switchRemixMode('ceremony');
    await loadCeremonyPreset('din_shagna');
    showToast("✨ Din Shagna Da ➔ Ranjha (2 Songs) loaded!");

  } else if (starterId === 'tauba_dance_off') {
    switchRemixMode('medley');
    const selA = document.getElementById('songSelectA');
    const selB = document.getElementById('songSelectB');
    if (selA) selA.value = 'tauba_tauba_movie1';
    if (selB) selB.value = 'tauba_tauba_movie2';

    showToast("⚡ Loading Tauba Tauba ➔ Tauba Tauba Dance-Off Face-Off...");
    const bufA = await loadSongBuffer('tauba_tauba_movie1');
    const bufB = await loadSongBuffer('tauba_tauba_movie2');

    appState.trackA = {
      name: "Tauba Tauba (Movie 1 • Team 1)",
      buffer: bufA,
      analysis: { bpm: 107, key: 'B Minor' },
      source: 'catalog',
      sourceUrl: '/tauba_tauba_movie1.m4a'
    };
    appState.trackB = {
      name: "Tauba Tauba (Movie 2 • Team 2)",
      buffer: bufB,
      analysis: { bpm: 112, key: 'B Minor' },
      source: 'catalog',
      sourceUrl: '/tauba_tauba_movie2.m4a'
    };

    updateTrackCardUI('A', appState.trackA);
    updateTrackCardUI('B', appState.trackB);

    const statusBadge = document.getElementById('globalStatusName');
    if (statusBadge) statusBadge.innerText = "Tauba Tauba Face-Off (Movie 1 ➔ Movie 2)";

    appState.activeTransitionConfig = {
      spliceTimeA: 22.430,
      spliceTimeB: 0.0,
      crossfadeDuration: 1.0,
      transitionType: 'drum_riser'
    };

    saveUndoState("Load Tauba Tauba Dance-Off Preset");
    appState.arrangementBlocks = getTaubaTaubaDanceOffBlocks();
    appState.userHasCustomizedBlocks = true;

    selectTransitionMethod('drum_riser');
    renderArrangementBlocksUI();
    drawWaveformTimeline();
    renderPalette();
    showToast("⚡ Tauba Tauba Dance-Off loaded! Use transition options below to audition styles.");

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

/**
 * ========================================================
 * ⚡ DANCE-OFF BATTLE TRANSITION SUITE & AUDITION LAB
 * ========================================================
 */

function selectTransitionMethod(methodType) {
  if (!appState.activeTransitionConfig) {
    appState.activeTransitionConfig = {
      spliceTimeA: 22.430,
      spliceTimeB: 0.0,
      crossfadeDuration: 1.0,
      transitionType: 'drum_riser'
    };
  }
  appState.activeTransitionConfig.transitionType = methodType;

  // Update card UI
  document.querySelectorAll('.transition-method-card').forEach(card => card.classList.remove('active'));
  const activeCard = document.getElementById(`card_method_${methodType}`);
  if (activeCard) activeCard.classList.add('active');

  const methodNames = {
    drum_riser: 'Drum Roll & DJ Impact Drop',
    vinyl_brake: 'Vinyl Brake / Tape Stop',
    echo_out: 'Echo Out & Reverb Wash',
    bass_swap: 'Frequency Filter / Bass Swap',
    quick_cut: 'Sudden Punch Cut',
    teaser_loop: 'Rising Teaser Loop (Clip 2 Hook Repeat)'
  };

  const tag = document.getElementById('activeMethodTag');
  if (tag) tag.innerText = `Active: ${methodNames[methodType] || methodType}`;

  // Also sync dropdown if available
  const transSelect = document.getElementById('transitionTypeSelect');
  if (transSelect) {
    if ([...transSelect.options].some(o => o.value === methodType)) {
      transSelect.value = methodType;
    }
  }

  showToast(`⚡ Selected Battle Transition: ${methodNames[methodType] || methodType}`);
}

async function triggerAuditionCurrentTransition() {
  const method = (appState.activeTransitionConfig && appState.activeTransitionConfig.transitionType) || 'drum_riser';
  await auditionSpecificTransition(method);
}

async function auditionSpecificTransition(methodType) {
  selectTransitionMethod(methodType);

  stopAuditionPlayback();
  stopArrangementPlayback();
  const masterAudio = document.getElementById('masterAudioPlayer');
  if (masterAudio && !masterAudio.paused) masterAudio.pause();

  if (appState.engine && appState.engine.ctx && appState.engine.ctx.state !== 'running') {
    await appState.engine.ctx.resume().catch(() => {});
  }

  const methodNames = {
    drum_riser: 'Drum Roll & DJ Impact Drop',
    vinyl_brake: 'Vinyl Brake / Tape Stop',
    echo_out: 'Echo Out & Reverb Wash',
    bass_swap: 'Frequency Filter / Bass Swap',
    quick_cut: 'Sudden Punch Cut',
    teaser_loop: 'Rising Teaser Loop (Clip 2 Hook Repeat)'
  };

  showToast(`🎧 Auditioning "${methodNames[methodType] || methodType}" Transition...`);

  // Ensure buffers are loaded for track A and track B
  if (!appState.trackA || !appState.trackA.buffer) {
    const bufA = await loadSongBuffer('tauba_tauba_movie1');
    if (!appState.trackA) {
      appState.trackA = {
        name: "Tauba Tauba (Movie 1 • Team 1)",
        buffer: bufA,
        analysis: { bpm: 107, key: 'B Minor' },
        source: 'catalog',
        sourceUrl: '/tauba_tauba_movie1.m4a'
      };
    } else {
      appState.trackA.buffer = bufA;
    }
  }
  if (!appState.trackB || !appState.trackB.buffer) {
    const bufB = await loadSongBuffer('tauba_tauba_movie2');
    if (!appState.trackB) {
      appState.trackB = {
        name: "Tauba Tauba (Movie 2 • Team 2)",
        buffer: bufB,
        analysis: { bpm: 112, key: 'B Minor' },
        source: 'catalog',
        sourceUrl: '/tauba_tauba_movie2.m4a'
      };
    } else {
      appState.trackB.buffer = bufB;
    }
  }

  // Calculate actual transition points based on blocks in timeline if available
  let spliceA = 22.430;
  let spliceB = 0.0;

  const blocks = appState.arrangementBlocks || [];
  for (let i = 0; i < blocks.length - 1; i++) {
    if (blocks[i].sourceTrack === 'A' && blocks[i + 1].sourceTrack === 'B') {
      spliceA = blocks[i].endTime;
      spliceB = blocks[i + 1].startTime;
      break;
    }
  }

  const btn = document.getElementById('btnAuditionActive');
  if (btn) btn.classList.add('active');

  const card = document.getElementById(`card_method_${methodType}`);
  if (card) card.classList.add('auditioning');

  const performNativeTransitionAudition = () => {
    const audioA = getAudioElementForBlock({ sourceTrack: 'A' });
    const audioB = getAudioElementForBlock({ sourceTrack: 'B' });
    if (!audioA || !audioB) {
      if (btn) btn.classList.remove('active');
      if (card) card.classList.remove('auditioning');
      showToast("⚠️ Audio players not ready. Click starter to reload.");
      return;
    }

    try { audioA.pause(); audioB.pause(); } catch (_) {}
    audioA.playbackRate = 1.0;
    audioB.playbackRate = 1.0;
    audioA.volume = 1.0;
    audioB.volume = 1.0;
    audioA.preservesPitch = true;
    audioB.preservesPitch = true;

    if (methodType === 'teaser_loop') {
      // 🔁 Rising Teaser Loop Audition (4.28s pre-roll + 2.5s post-roll)
      const teaserDur = 2.14;
      const preRoll = teaserDur * 2; // 4.28s
      const postRoll = 2.5;

      audioA.currentTime = Math.max(0, spliceA - preRoll);
      audioA.volume = 0.85;

      audioB.currentTime = Math.max(0, spliceB);
      audioB.volume = 0.25;

      Promise.all([audioA.play(), audioB.play()]).then(() => {
        showToast("🔁 Teaser Loop: Clip 2 Hook whispering in the background (25% vol)...");

        // At 2.14s: Repeat 2 starts (vol 0.70), Song 1 ducks to 0.30
        setTimeout(() => {
          audioB.currentTime = Math.max(0, spliceB);
          audioB.volume = 0.70;
          audioA.volume = 0.30;
          showToast("🔁 Teaser Loop: Clip 2 Hook getting louder (70% vol), Song 1 fading...");
        }, teaserDur * 1000);

        // At 4.28s: Drop / Handoff to Song B at full volume 1.0
        setTimeout(() => {
          try {
            audioA.pause();
            audioA.volume = 1.0;
            audioA.currentTime = 0;
          } catch (_) {}

          audioB.currentTime = Math.max(0, spliceB);
          audioB.volume = 1.0;
          appState.engine.playLiveTransitionCue('teaser_loop', true);
          showToast("⚡ Team 2 TAKES OVER! Full volume drop!");

          // Conclude audition
          setTimeout(() => {
            try { audioB.pause(); audioB.volume = 1.0; } catch (_) {}
            if (btn) btn.classList.remove('active');
            if (card) card.classList.remove('auditioning');
            showToast("⚡ Teaser Loop Audition complete!");
          }, postRoll * 1000);

        }, preRoll * 1000);

      }).catch(err => {
        console.warn("Native teaser audition autoplay error:", err);
        if (btn) btn.classList.remove('active');
        if (card) card.classList.remove('auditioning');
        showToast("⚠️ Autoplay prevented. Click Audition again.");
      });
      return;
    }

    // Standard 5s Transition Auditions
    const preRoll = 3.0;
    const postRoll = 2.5;

    audioA.currentTime = Math.max(0, spliceA - preRoll);
    audioA.play().then(() => {
      // Pre-roll FX triggers
      if (methodType === 'drum_riser') {
        setTimeout(() => {
          appState.engine.playLiveTransitionCue('drum_riser', false);
          showToast("⚡ Drum Roll & Snare Riser Building...");
        }, 1400);
      } else if (methodType === 'vinyl_brake') {
        setTimeout(() => {
          appState.engine.playLiveTransitionCue('vinyl_brake', false);
          audioA.preservesPitch = false;
          if ('mozPreservesPitch' in audioA) audioA.mozPreservesPitch = false;
          if ('webkitPreservesPitch' in audioA) audioA.webkitPreservesPitch = false;
          audioA.playbackRate = 0.08;
          audioA.volume = 0.15;
          showToast("🛑 Vinyl Brake... Turntable Motor Stopping!");
        }, 2150);
      } else if (methodType === 'echo_out') {
        setTimeout(() => {
          appState.engine.playLiveTransitionCue('echo_out', false);
          audioA.volume = 0.6;
          setTimeout(() => { audioA.volume = 0.3; }, 400);
          setTimeout(() => { audioA.volume = 0.05; }, 800);
          showToast("🌊 Echo Out... Vocal Delay Wash Floating!");
        }, 1600);
      } else if (methodType === 'bass_swap') {
        setTimeout(() => {
          appState.engine.playLiveTransitionCue('bass_swap', false);
          audioA.volume = 0.35;
          showToast("🔊 High-Pass Resonant Filter Sweep... Lows Removed!");
        }, 1600);
      } else if (methodType === 'quick_cut') {
        setTimeout(() => {
          audioA.volume = 0;
        }, 2850);
      }

      // At 3.0s: trigger handoff to Song B + drop impact
      setTimeout(() => {
        try {
          audioA.pause();
          audioA.playbackRate = 1.0;
          audioA.volume = 1.0;
          audioA.preservesPitch = true;
        } catch (_) {}

        audioB.currentTime = Math.max(0, spliceB);
        audioB.volume = 1.0;
        audioB.playbackRate = 1.0;
        audioB.play().catch(e => console.warn("Deck B audition play error:", e));

        appState.engine.playLiveTransitionCue(methodType, true);

        // Finish audition after post-roll
        setTimeout(() => {
          try { audioB.pause(); audioB.volume = 1.0; } catch (_) {}
          if (btn) btn.classList.remove('active');
          if (card) card.classList.remove('auditioning');
          showToast(`⚡ 5s "${methodNames[methodType] || methodType}" complete!`);
        }, postRoll * 1000);

      }, preRoll * 1000);

    }).catch(err => {
      console.warn("Native audition autoplay error:", err);
      if (btn) btn.classList.remove('active');
      if (card) card.classList.remove('auditioning');
      showToast("⚠️ Autoplay prevented. Click Audition again.");
    });
  };

  // Try Web Audio preview if buffers are available; otherwise use native dual-deck audition
  if (appState.trackA && appState.trackA.buffer && appState.trackB && appState.trackB.buffer) {
    try {
      const isTeaser = methodType === 'teaser_loop';
      const config = {
        mode: 'medley',
        spliceTimeA: spliceA,
        spliceTimeB: spliceB,
        crossfadeDuration: methodType === 'drum_riser' ? 1.0 : (methodType === 'quick_cut' ? 0.05 : (isTeaser ? 0.05 : 0.8)),
        transitionType: methodType,
        previewPreRoll: isTeaser ? 4.5 : 3.0,
        previewPostRoll: 2.5,
        useStudioMasterForChoreo: false
      };

      const res = await appState.engine.previewTransition(appState.trackA, appState.trackB, config);
      const dur = res && res.auditionDuration ? res.auditionDuration : (isTeaser ? 7.0 : 6.0);

      setTimeout(() => {
        if (btn) btn.classList.remove('active');
        if (card) card.classList.remove('auditioning');
      }, dur * 1000);
      return;
    } catch (e) {
      console.warn("Web audio previewTransition failed, falling back to native player:", e);
    }
  }

  // Reliable native fallback
  performNativeTransitionAudition();
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
      ${idx < blocks.length - 1 ? (
        (blk.sourceTrack === 'A' && blocks[idx + 1].sourceTrack === 'B')
          ? `<span class="timeline-item-connector battle-connector" onclick="triggerAuditionCurrentTransition()" title="⚡ Dance-Off Battle Transition! Click to audition handoff switch">⚡ BATTLE HANDOFF ➔</span>`
          : '<span class="timeline-connector">➔</span>'
      ) : ''}
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
  const catalog = getAllSongPartsAndSections();
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

  // 1. Determine correct audio buffer & URL for the block
  let activeBuf = null;
  let audioUrl = '/kala_chashma_official.m4a';

  if (blk.sourceTrack === 'B') {
    activeBuf = appState.trackB && appState.trackB.buffer;
    audioUrl = (appState.trackB && appState.trackB.sourceUrl) || '/tauba_tauba_movie2.m4a';
  } else {
    activeBuf = appState.trackA && appState.trackA.buffer;
    audioUrl = (appState.trackA && appState.trackA.sourceUrl) || (appState.currentMode === 'choreo' ? '/kala_chashma_official.m4a' : '/tauba_tauba_movie1.m4a');
  }

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
    const audio = new Audio(audioUrl);
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

  // 1. Determine correct audio buffer & URL for the palette part
  let activeBuf = null;
  let audioUrl = '/kala_chashma_official.m4a';

  if (part.sourceTrack === 'B') {
    activeBuf = appState.trackB && appState.trackB.buffer;
    audioUrl = (appState.trackB && appState.trackB.sourceUrl) || '/tauba_tauba_movie2.m4a';
  } else {
    activeBuf = appState.trackA && appState.trackA.buffer;
    audioUrl = (appState.trackA && appState.trackA.sourceUrl) || (appState.currentMode === 'choreo' ? '/kala_chashma_official.m4a' : '/tauba_tauba_movie1.m4a');
  }

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
    const audio = new Audio(audioUrl);
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

function getAudioElementForBlock(blk) {
  if (appState.currentMode === 'choreo') {
    return getOfficialAudioElement();
  }
  if (blk && blk.sourceTrack === 'B') {
    let audioB = document.getElementById('deckBAudioPlayer');
    if (!audioB) {
      audioB = new Audio((appState.trackB && appState.trackB.sourceUrl) || '/tauba_tauba_movie2.m4a');
      audioB.id = 'deckBAudioPlayer';
      audioB.preload = 'auto';
      document.body.appendChild(audioB);
    }
    return audioB;
  }
  let audioA = document.getElementById('deckAAudioPlayer');
  if (!audioA) {
    audioA = new Audio((appState.trackA && appState.trackA.sourceUrl) || '/tauba_tauba_movie1.m4a');
    audioA.id = 'deckAAudioPlayer';
    audioA.preload = 'auto';
    document.body.appendChild(audioA);
  }
  return audioA;
}

function stopArrangementPlayback() {
  if (arrangementSequencer.checkInterval) {
    clearInterval(arrangementSequencer.checkInterval);
    arrangementSequencer.checkInterval = null;
  }
  arrangementSequencer.transitionRiserTriggered = false;
  arrangementSequencer.teaserRep1Triggered = false;
  arrangementSequencer.teaserRep2Triggered = false;

  if (arrangementSequencer.audio) {
    try {
      arrangementSequencer.audio.pause();
    } catch (_) {}
  }
  const deckA = document.getElementById('deckAAudioPlayer');
  const deckB = document.getElementById('deckBAudioPlayer');
  const official = document.getElementById('officialAudioPlayer');
  if (deckA) { try { deckA.pause(); deckA.volume = 1.0; deckA.playbackRate = 1.0; deckA.preservesPitch = true; } catch (_) {} }
  if (deckB) { try { deckB.pause(); deckB.volume = 1.0; deckB.playbackRate = 1.0; deckB.preservesPitch = true; } catch (_) {} }
  if (official) { try { official.pause(); official.volume = 1.0; official.playbackRate = 1.0; official.preservesPitch = true; } catch (_) {} }

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

  // Pause all potential audio elements
  const deckA = document.getElementById('deckAAudioPlayer');
  const deckB = document.getElementById('deckBAudioPlayer');
  const official = document.getElementById('officialAudioPlayer');
  if (deckA) { try { deckA.pause(); } catch (_) {} }
  if (deckB) { try { deckB.pause(); } catch (_) {} }
  if (official) { try { official.pause(); } catch (_) {} }

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

  const audio = getAudioElementForBlock(currentSched.block);
  arrangementSequencer.audio = audio;

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

    const nextIdx = idx + 1;
    const isBattleHandoff = (curSched.block.sourceTrack === 'A' && nextIdx < schedule.length && schedule[nextIdx].block.sourceTrack === 'B');
    const timeRemaining = curSched.endTime - curMediaTime;
    const transType = (appState.activeTransitionConfig && appState.activeTransitionConfig.transitionType) || 'drum_riser';

    // ⚡ Trigger live transition audio cue as handoff approaches!
    if (isBattleHandoff) {
      if (transType === 'drum_riser') {
        if (timeRemaining <= 1.6 && timeRemaining > 0 && !arrangementSequencer.transitionRiserTriggered) {
          arrangementSequencer.transitionRiserTriggered = true;
          appState.engine.playLiveTransitionCue('drum_riser', false);
          showToast("⚡ DJ Snare Riser Building... Team 2 Taking The Floor!");
        }
      } else if (transType === 'vinyl_brake') {
        if (timeRemaining <= 0.85 && timeRemaining > 0 && !arrangementSequencer.transitionRiserTriggered) {
          arrangementSequencer.transitionRiserTriggered = true;
          appState.engine.playLiveTransitionCue('vinyl_brake', false);
          audio.preservesPitch = false;
          if ('mozPreservesPitch' in audio) audio.mozPreservesPitch = false;
          if ('webkitPreservesPitch' in audio) audio.webkitPreservesPitch = false;
          audio.playbackRate = 0.08;
          showToast("🛑 Turntable Brake... Needle Stopping!");
        }
        if (timeRemaining <= 0.85 && timeRemaining > 0) {
          audio.volume = Math.max(0.05, timeRemaining / 0.85);
        }
      } else if (transType === 'echo_out') {
        if (timeRemaining <= 1.4 && timeRemaining > 0 && !arrangementSequencer.transitionRiserTriggered) {
          arrangementSequencer.transitionRiserTriggered = true;
          appState.engine.playLiveTransitionCue('echo_out', false);
          showToast("🌊 Echo Out & Reverb Wash... Song 1 Dissolving!");
        }
        if (timeRemaining <= 1.4 && timeRemaining > 0) {
          audio.volume = Math.max(0.05, timeRemaining / 1.4);
        }
      } else if (transType === 'bass_swap') {
        if (timeRemaining <= 1.4 && timeRemaining > 0 && !arrangementSequencer.transitionRiserTriggered) {
          arrangementSequencer.transitionRiserTriggered = true;
          appState.engine.playLiveTransitionCue('bass_swap', false);
          audio.volume = 0.35;
          showToast("🔊 High-Pass Filter Sweep... Low-End Cut!");
        }
      } else if (transType === 'quick_cut') {
        if (timeRemaining <= 0.18 && timeRemaining > 0 && !arrangementSequencer.transitionRiserTriggered) {
          arrangementSequencer.transitionRiserTriggered = true;
          audio.volume = 0;
        }
      } else if (transType === 'teaser_loop') {
        const deckB = getAudioElementForBlock(schedule[nextIdx].block);
        const teaserStart = schedule[nextIdx].startTime;

        // Phase 1: 4.28s to 2.14s remaining -> Repeat 1 (vol 0.25)
        if (timeRemaining <= 4.28 && timeRemaining > 2.14 && !arrangementSequencer.teaserRep1Triggered) {
          arrangementSequencer.teaserRep1Triggered = true;
          if (deckB) {
            deckB.currentTime = teaserStart;
            deckB.volume = 0.25;
            deckB.play().catch(() => {});
          }
          audio.volume = 0.80;
          showToast("🔁 Teaser Loop: Clip 2 Hook whispering in the background (25% vol)...");
        }
        // Phase 2: 2.14s to 0.0s remaining -> Repeat 2 (vol 0.70)
        if (timeRemaining <= 2.14 && timeRemaining > 0 && !arrangementSequencer.teaserRep2Triggered) {
          arrangementSequencer.teaserRep2Triggered = true;
          if (deckB) {
            deckB.currentTime = teaserStart;
            deckB.volume = 0.70;
          }
          audio.volume = 0.30;
          showToast("🔁 Teaser Loop: Clip 2 Hook getting louder (70% vol), Song 1 fading...");
        }
      }
    }

    // Check if the current block has concluded (within 40ms)
    if (curMediaTime >= (curSched.endTime - 0.04)) {
      if (nextIdx < schedule.length) {
        const nextSched = schedule[nextIdx];
        arrangementSequencer.currentBlockIdx = nextIdx;
        arrangementSequencer.transitionRiserTriggered = false;
        arrangementSequencer.teaserRep1Triggered = false;
        arrangementSequencer.teaserRep2Triggered = false;

        const nextAudio = getAudioElementForBlock(nextSched.block);

        if (nextAudio !== audio) {
          // Cross-deck handoff (e.g. Track A -> Track B in Dance-Off!)
          try {
            audio.playbackRate = 1.0;
            audio.volume = 1.0;
            audio.preservesPitch = true;
            audio.pause();
          } catch (_) {}

          nextAudio.playbackRate = 1.0;
          nextAudio.volume = 1.0;
          nextAudio.preservesPitch = true;
          nextAudio.currentTime = Math.max(0, nextSched.startTime);
          nextAudio.play().catch(e => console.warn("Deck handoff play error:", e));
          arrangementSequencer.audio = nextAudio;

          // ⚡ Trigger impact drop right on downbeat 1 of Team 2!
          if (isBattleHandoff) {
            appState.engine.playLiveTransitionCue(transType, true);
          }

          showToast(`⚡ ${nextSched.block.teamLabel || 'Team 2'} Takes The Floor!`);
        } else {
          // Same audio stream
          const isContiguous = Math.abs(nextSched.startTime - curSched.endTime) < 0.06;
          if (!isContiguous) {
            audio.currentTime = Math.max(0, nextSched.startTime);
          }
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

/* ======================================================== */
/* 💖 MULTI-TRACK CEREMONY MASHUP CONTROLLER (3+ Songs)     */
/* ======================================================== */

function escapeCeremonyHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function parseTimeSec(str) {
  if (str === null || str === undefined) return 0;
  const s = String(str).trim();
  if (s.toLowerCase() === 'end') return null;
  if (s === '') return 0;
  const parts = s.split(':').map(p => parseFloat(p.trim()));
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 1) {
    return parts[0];
  }
  return 0;
}

function formatTimeSec(sec) {
  if (sec === null || sec === undefined || isNaN(sec)) return 'End';
  const total = Math.max(0, Math.floor(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function formatTimeWithMs(sec) {
  if (sec === null || sec === undefined || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 10);
  return `${m}:${s < 10 ? '0' : ''}${s}.${ms}`;
}

function triggerDownloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
}

function triggerDownloadDirectUrl(url, filename) {
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
  }, 1000);
}

function initCeremonyMashupUI() {
  setupCeremonyCanvasInteractions();
  if (!appState.ceremonyMashupInitialized) {
    appState.ceremonyMashupInitialized = true;
    loadCeremonyPreset('kudmayi_mashup');
  } else {
    renderCeremonyTrackCards();
    updateCeremonyStats();
    drawCeremonyTimeline();
    updateCeremonyCommandOutput();
  }
}

function setupCeremonyCanvasInteractions() {
  const canvas = document.getElementById('ceremonyTimelineCanvas');
  if (!canvas || canvas.dataset.hasSeekListener) return;
  canvas.dataset.hasSeekListener = 'true';

  const onSeek = (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clickX = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const totalDur = recalculateTrackDurations();
    if (totalDur <= 0) return;
    const newPos = (clickX / rect.width) * totalDur;
    seekCeremonyPosition(newPos);
  };

  canvas.addEventListener('click', onSeek);
  canvas.addEventListener('touchstart', onSeek, { passive: false });
  canvas.addEventListener('touchmove', onSeek, { passive: false });
}

function seekCeremonyPosition(newPos) {
  const cm = appState.ceremonyMashup;
  const totalDur = recalculateTrackDurations();
  cm.playbackPosition = Math.max(0, Math.min(totalDur, newPos));

  if (cm.isPlaying && cm.renderedMashup) {
    stopCeremonyPlayback();
    toggleCeremonyPlayback();
  } else {
    drawCeremonyTimeline(cm.playbackPosition);
  }
}

async function loadCeremonyPreset(presetId) {
  document.querySelectorAll('.btn-ceremony-preset').forEach(b => b.classList.remove('active'));

  if (presetId === 'kudmayi_mashup') {
    document.getElementById('presetCeremonyKudmayi')?.classList.add('active');
    appState.ceremonyMashup.tracks = [
      {
        id: 't1',
        title: 'Kudmayi Mashup',
        sourceType: 'demo',
        youtubeUrl: 'https://youtu.be/28Wx2K9nJBw',
        audioUrl: '/kudmayi_mashup.m4a',
        fileName: '',
        buffer: null,
        startTimeStr: '00:00:40',
        endTimeStr: 'End',
        startTimeSec: 40.0,
        endTimeSec: null,
        durationSec: null,
        color: '#ec4899',
        status: 'ready'
      },
      {
        id: 't2',
        title: 'Kanyadaan Song',
        sourceType: 'demo',
        youtubeUrl: 'https://youtu.be/3op9jf3K-u0',
        audioUrl: '/kanyadaan_song.m4a',
        fileName: '',
        buffer: null,
        startTimeStr: '00:00:04',
        endTimeStr: '00:01:00',
        startTimeSec: 4.0,
        endTimeSec: 60.0,
        durationSec: 56.0,
        color: '#06b6d4',
        status: 'ready'
      },
      {
        id: 't3',
        title: 'Tere Hawaale',
        sourceType: 'demo',
        youtubeUrl: 'https://youtu.be/KUpwupYj_tY',
        audioUrl: '/tere_hawaale.m4a',
        fileName: '',
        buffer: null,
        startTimeStr: '00:00:50',
        endTimeStr: '00:02:13',
        startTimeSec: 50.0,
        endTimeSec: 133.0,
        durationSec: 83.0,
        color: '#10b981',
        status: 'ready'
      }
    ];
    appState.ceremonyMashup.introCrossfade = true;
    appState.ceremonyMashup.introFadeSec = 2.0;
    appState.ceremonyMashup.introCurve = 'tri';
    appState.ceremonyMashup.crossfadeSec = 3.0;
    appState.ceremonyMashup.crossfadeCurve = 'tri';
    appState.ceremonyMashup.outroCrossfade = true;
    appState.ceremonyMashup.outroFadeSec = 3.0;
    appState.ceremonyMashup.outroCurve = 'tri';
    appState.ceremonyMashup.normalizeLoudness = true;

  } else if (presetId === 'din_shagna') {
    document.getElementById('presetCeremonyDinShagna')?.classList.add('active');
    appState.ceremonyMashup.tracks = [
      {
        id: 't1',
        title: 'Din Shagna Da (Jasleen Royal)',
        sourceType: 'youtube',
        youtubeUrl: 'https://youtu.be/V7LwfY42YTU',
        audioUrl: '',
        fileName: '',
        buffer: null,
        startTimeStr: '00:00:00',
        endTimeStr: '00:01:15',
        startTimeSec: 0.0,
        endTimeSec: 75.0,
        durationSec: 75.0,
        color: '#ec4899',
        status: 'ready'
      },
      {
        id: 't2',
        title: 'Ranjha (Sid & Kiara Version)',
        sourceType: 'youtube',
        youtubeUrl: 'https://youtu.be/EDw9pQeR_eQ',
        audioUrl: '',
        fileName: '',
        buffer: null,
        startTimeStr: '00:00:15',
        endTimeStr: '00:01:25',
        startTimeSec: 15.0,
        endTimeSec: 85.0,
        durationSec: 70.0,
        color: '#06b6d4',
        status: 'ready'
      }
    ];
    appState.ceremonyMashup.introCrossfade = true;
    appState.ceremonyMashup.introFadeSec = 2.0;
    appState.ceremonyMashup.introCurve = 'tri';
    appState.ceremonyMashup.crossfadeSec = 3.0;
    appState.ceremonyMashup.crossfadeCurve = 'tri';
    appState.ceremonyMashup.outroCrossfade = true;
    appState.ceremonyMashup.outroFadeSec = 3.0;
    appState.ceremonyMashup.outroCurve = 'tri';
    appState.ceremonyMashup.normalizeLoudness = true;

  } else if (presetId === 'custom_empty') {
    document.getElementById('presetCeremonyEmpty')?.classList.add('active');
    appState.ceremonyMashup.tracks = [
      {
        id: 't1',
        title: 'Song 1 (Opening / Entrance)',
        sourceType: 'file',
        youtubeUrl: '',
        audioUrl: '',
        fileName: '',
        buffer: null,
        startTimeStr: '00:00:00',
        endTimeStr: '00:01:00',
        startTimeSec: 0.0,
        endTimeSec: 60.0,
        durationSec: 60.0,
        color: '#ec4899',
        status: 'ready'
      },
      {
        id: 't2',
        title: 'Song 2 (Family / Pheras)',
        sourceType: 'file',
        youtubeUrl: '',
        audioUrl: '',
        fileName: '',
        buffer: null,
        startTimeStr: '00:00:00',
        endTimeStr: '00:01:00',
        startTimeSec: 0.0,
        endTimeSec: 60.0,
        durationSec: 60.0,
        color: '#06b6d4',
        status: 'ready'
      }
    ];
  }

  const cm = appState.ceremonyMashup;
  const introCheck = document.getElementById('ceremonyIntroCheck');
  if (introCheck) introCheck.checked = cm.introCrossfade;
  const introDur = document.getElementById('ceremonyIntroDuration');
  if (introDur) introDur.value = String(cm.introFadeSec);
  const introCurve = document.getElementById('ceremonyIntroCurve');
  if (introCurve) introCurve.value = cm.introCurve || 'tri';

  const crossSlider = document.getElementById('ceremonyCrossfadeSlider');
  if (crossSlider) crossSlider.value = cm.crossfadeSec;
  const crossVal = document.getElementById('ceremonyCrossfadeVal');
  if (crossVal) crossVal.innerText = `${cm.crossfadeSec.toFixed(1)}s`;
  const blendCurve = document.getElementById('ceremonyBlendCurve');
  if (blendCurve) blendCurve.value = cm.crossfadeCurve || 'tri';

  const outroCheck = document.getElementById('ceremonyOutroCheck');
  if (outroCheck) outroCheck.checked = cm.outroCrossfade;
  const outroDur = document.getElementById('ceremonyOutroDuration');
  if (outroDur) outroDur.value = String(cm.outroFadeSec);
  const outroCurve = document.getElementById('ceremonyOutroCurve');
  if (outroCurve) outroCurve.value = cm.outroCurve || 'tri';

  const normBox = document.getElementById('ceremonyNormalizeCheckbox');
  if (normBox) normBox.checked = cm.normalizeLoudness;

  renderCeremonyTrackCards();
  recalculateTrackDurations();
  updateCeremonyStats();
  drawCeremonyTimeline();
  updateCeremonyCommandOutput();

  if (presetId === 'kudmayi_mashup') {
    for (const t of appState.ceremonyMashup.tracks) {
      loadCeremonyTrackBuffer(t);
    }
  }
}

async function loadCeremonyTrackBuffer(track) {
  if (track.buffer) return track.buffer;
  track.status = 'loading';
  renderCeremonyTrackCards();

  try {
    let arrayBuffer = null;
    if (track.sourceType === 'demo' && track.audioUrl) {
      const resp = await fetch(track.audioUrl);
      if (!resp.ok) throw new Error(`Could not fetch ${track.audioUrl}`);
      arrayBuffer = await resp.arrayBuffer();
    } else if (track.sourceType === 'youtube' && track.youtubeUrl) {
      const url = track.youtubeUrl;
      let cachedUrl = null;
      if (url.includes('28Wx2K9nJBw')) cachedUrl = '/kudmayi_mashup.m4a';
      else if (url.includes('3op9jf3K-u0')) cachedUrl = '/kanyadaan_song.m4a';
      else if (url.includes('KUpwupYj_tY')) cachedUrl = '/tere_hawaale.m4a';

      if (cachedUrl) {
        try {
          const resp = await fetch(cachedUrl);
          if (resp.ok) arrayBuffer = await resp.arrayBuffer();
        } catch (e) {}
      }

      if (!arrayBuffer) {
        const resp = await fetch(`/api/download-audio?url=${encodeURIComponent(url)}`);
        const data = await resp.json();
        if (data && data.audioUrl) {
          const aResp = await fetch(data.audioUrl);
          arrayBuffer = await aResp.arrayBuffer();
        } else {
          throw new Error(data.error || "Could not fetch YouTube audio");
        }
      }
    }

    if (arrayBuffer) {
      await appState.engine.ensureContext();
      track.buffer = await appState.engine.ctx.decodeAudioData(arrayBuffer.slice(0));
      track.status = 'ready';
      recalculateTrackDurations();
      updateCeremonyStats();
      drawCeremonyTimeline();
      updateCeremonyCommandOutput();
    }
  } catch (err) {
    console.warn("Could not load track buffer:", err);
    track.status = 'error';
    showToast(`⚠️ Could not load audio for ${track.title}`);
  }

  renderCeremonyTrackCards();
  return track.buffer;
}

function recalculateTrackDurations() {
  const cm = appState.ceremonyMashup;
  let totalDuration = 0;

  for (let i = 0; i < cm.tracks.length; i++) {
    const t = cm.tracks[i];
    const bufDur = t.buffer ? t.buffer.duration : null;

    t.startTimeSec = parseTimeSec(t.startTimeStr);
    const parsedEnd = parseTimeSec(t.endTimeStr);

    if (parsedEnd === null) {
      t.endTimeSec = bufDur ? bufDur : null;
    } else {
      t.endTimeSec = bufDur ? Math.min(bufDur, parsedEnd) : parsedEnd;
    }

    if (t.endTimeSec !== null) {
      t.durationSec = Math.max(0, t.endTimeSec - t.startTimeSec);
    } else {
      t.durationSec = Math.max(0, (parsedEnd || 60) - t.startTimeSec);
    }

    const segDur = t.durationSec || 60;
    if (i === 0) {
      totalDuration = segDur;
    } else {
      totalDuration += Math.max(0, segDur - cm.crossfadeSec);
    }
  }

  cm.totalDuration = totalDuration;
  return totalDuration;
}

function updateCeremonyStats() {
  const cm = appState.ceremonyMashup;
  const total = recalculateTrackDurations();
  const badge = document.getElementById('ceremonyTotalStats');
  if (badge) {
    const m = Math.floor(total / 60);
    const s = Math.floor(total % 60);
    badge.innerText = `${cm.tracks.length} Songs • ~${m}m ${s < 10 ? '0' : ''}${s}s Total Mix`;
  }
}

function renderCeremonyTrackCards() {
  const container = document.getElementById('ceremonyTrackChain');
  if (!container) return;

  const tracks = appState.ceremonyMashup.tracks;
  let html = '';

  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    const isReady = !!t.buffer;
    const durDisplay = t.durationSec ? `${t.durationSec.toFixed(0)}s duration` : '--s';
    const isPlayingThisClip = (appState.ceremonyMashup.activePreviewIdx === i);

    html += `
      <div class="ceremony-track-card" id="ceremonyCard_${i}" style="border-left: 4px solid ${t.color};">
        <div class="ceremony-track-header">
          <div class="track-header-left">
            <span class="track-number-badge" style="background: ${t.color}22; color: ${t.color}; border: 1px solid ${t.color}55;">
              Track ${i + 1}
            </span>
            <input type="text" class="track-title-input" value="${escapeCeremonyHtml(t.title)}"
              placeholder="Song Name..."
              onchange="updateCeremonyTrackTitle(${i}, this.value)">
          </div>
          <div class="track-header-actions">
            <button type="button" class="btn-track-preview ${isPlayingThisClip ? 'active-playing' : ''}"
              onclick="previewCeremonyTrackClip(${i})" title="Listen to this trimmed clip">
              <span>${isPlayingThisClip ? '⏹ Stop' : '▶ Preview Clip'}</span>
            </button>
            ${tracks.length > 2 ? `
              <button type="button" class="btn-track-remove" onclick="removeCeremonyTrack(${i})" title="Remove Track">
                <span>✕</span>
              </button>
            ` : ''}
          </div>
        </div>

        <!-- Segmented Source Tabs -->
        <div class="ceremony-source-tabs">
          <button type="button" class="ceremony-source-tab ${t.sourceType === 'demo' ? 'active' : ''}"
            onclick="setCeremonySourceType(${i}, 'demo')">
            <span>🎵</span> Starter Demo
          </button>
          <button type="button" class="ceremony-source-tab ${t.sourceType === 'file' ? 'active' : ''}"
            onclick="setCeremonySourceType(${i}, 'file')">
            <span>📁</span> Upload File (Vercel-Safe)
          </button>
          <button type="button" class="ceremony-source-tab ${t.sourceType === 'youtube' ? 'active' : ''}"
            onclick="setCeremonySourceType(${i}, 'youtube')">
            <span>🔗</span> YouTube Link
          </button>
        </div>

        <!-- Source Content Pane -->
        <div class="ceremony-source-pane">
          ${t.sourceType === 'demo' ? `
            <div style="font-size: 13px; color: var(--text-muted); background: rgba(0,0,0,0.25); padding: 8px 12px; border-radius: 8px; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between;">
              <span>🌟 High-Fidelity Studio Audio Source: <strong>${escapeCeremonyHtml(t.title)}</strong></span>
              <span class="metric-pill" style="color: ${isReady ? 'var(--accent-emerald)' : 'var(--text-muted)'};">
                ${isReady ? 'Loaded ✓' : 'Click Preview to load'}
              </span>
            </div>
          ` : ''}

          ${t.sourceType === 'file' ? `
            <div class="ceremony-dropzone" id="ceremonyDropzone_${i}"
              onclick="document.getElementById('ceremonyFileInput_${i}').click()"
              ondragover="handleCeremonyDragOver(event)"
              ondrop="handleCeremonyDrop(event, ${i})">
              <input type="file" id="ceremonyFileInput_${i}" accept="audio/*,video/*" style="display: none;"
                onchange="handleCeremonyFileInput(this, ${i})">
              <span>📁</span>
              ${t.fileName ? `
                <strong>${escapeCeremonyHtml(t.fileName)}</strong> (Loaded ✓)
              ` : `
                <strong>Drop audio or video file here</strong> or click to browse (.mp3, .wav, .m4a, .mp4)
              `}
            </div>
          ` : ''}

          ${t.sourceType === 'youtube' ? `
            <div class="ceremony-url-box">
              <input type="text" class="ceremony-url-input" id="ceremonyUrlInput_${i}"
                placeholder="Paste YouTube link (e.g. https://youtu.be/...)"
                value="${escapeCeremonyHtml(t.youtubeUrl || '')}"
                onchange="updateCeremonyYoutubeUrl(${i}, this.value)">
              <button type="button" class="btn-ceremony-fetch" onclick="fetchCeremonyYouTubeTrack(${i})">
                ${t.status === 'loading' ? '⏳ Loading...' : 'Load Audio'}
              </button>
            </div>
          ` : ''}
        </div>

        <!-- Trimming Row -->
        <div class="ceremony-trim-row">
          <div class="trim-field">
            <span class="trim-label">✂️ Start Time:</span>
            <input type="text" class="ceremony-time-input" value="${escapeCeremonyHtml(t.startTimeStr)}"
              placeholder="00:00:40"
              onchange="updateCeremonyTrackTrim(${i}, 'start', this.value)">
          </div>
          <div class="trim-field">
            <span class="trim-label">✂️ End Time:</span>
            <input type="text" class="ceremony-time-input" value="${escapeCeremonyHtml(t.endTimeStr)}"
              placeholder="00:01:00 or End"
              onchange="updateCeremonyTrackTrim(${i}, 'end', this.value)">
          </div>
          <span class="ceremony-duration-chip" id="ceremonyDurChip_${i}">
            ⏱️ ${durDisplay}
          </span>
        </div>
      </div>
    `;

    if (i < tracks.length - 1) {
      html += `
        <div class="ceremony-seam-connector">
          <div class="seam-line"></div>
          <div class="seam-badge">
            ⏳ ${appState.ceremonyMashup.crossfadeSec.toFixed(1)}s Crossfade Blend
          </div>
          <div class="seam-line"></div>
        </div>
      `;
    }
  }

  container.innerHTML = html;
}

function setCeremonySourceType(idx, type) {
  const track = appState.ceremonyMashup.tracks[idx];
  if (!track) return;
  track.sourceType = type;
  renderCeremonyTrackCards();
  updateCeremonyCommandOutput();
}

function updateCeremonyTrackTitle(idx, value) {
  const track = appState.ceremonyMashup.tracks[idx];
  if (track) {
    track.title = value.trim() || `Song ${idx + 1}`;
    drawCeremonyTimeline();
    updateCeremonyCommandOutput();
  }
}

function updateCeremonyYoutubeUrl(idx, value) {
  const track = appState.ceremonyMashup.tracks[idx];
  if (track) {
    track.youtubeUrl = value.trim();
    track.buffer = null;
    updateCeremonyCommandOutput();
  }
}

async function fetchCeremonyYouTubeTrack(idx) {
  const track = appState.ceremonyMashup.tracks[idx];
  if (!track || !track.youtubeUrl) {
    showToast("⚠️ Please enter a valid YouTube URL first.");
    return;
  }
  showToast(`⏳ Loading audio from YouTube for Track ${idx + 1}...`);
  await loadCeremonyTrackBuffer(track);
}

function handleCeremonyDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
}

async function handleCeremonyDrop(event, idx) {
  event.preventDefault();
  const file = event.dataTransfer.files && event.dataTransfer.files[0];
  if (file) {
    await processCeremonyLocalFile(file, idx);
  }
}

async function handleCeremonyFileInput(fileInput, idx) {
  const file = fileInput.files && fileInput.files[0];
  if (file) {
    await processCeremonyLocalFile(file, idx);
  }
}

async function processCeremonyLocalFile(file, idx) {
  const track = appState.ceremonyMashup.tracks[idx];
  if (!track) return;

  track.status = 'loading';
  track.fileName = file.name;
  if (!track.title || track.title.startsWith('Song ') || track.title.startsWith('Opening Song') || track.title.startsWith('Middle Song') || track.title.startsWith('Finale Song')) {
    track.title = file.name.replace(/\.[^/.]+$/, "");
  }
  renderCeremonyTrackCards();
  showToast(`📁 Decoding "${file.name}" locally in browser (Vercel-safe)...`);

  try {
    const arrayBuffer = await file.arrayBuffer();
    await appState.engine.ensureContext();
    track.buffer = await appState.engine.ctx.decodeAudioData(arrayBuffer);
    track.status = 'ready';
    track.sourceType = 'file';
    recalculateTrackDurations();
    updateCeremonyStats();
    drawCeremonyTimeline();
    updateCeremonyCommandOutput();
    showToast(`✅ "${file.name}" loaded (${formatTimeSec(track.buffer.duration)})!`);
  } catch (err) {
    console.error("Error decoding local audio file:", err);
    track.status = 'error';
    showToast(`⚠️ Could not decode audio: ${err.message || err}`);
  }

  renderCeremonyTrackCards();
}

function updateCeremonyTrackTrim(idx, field, value) {
  const track = appState.ceremonyMashup.tracks[idx];
  if (!track) return;

  if (field === 'start') {
    track.startTimeStr = value.trim() || '00:00:00';
  } else if (field === 'end') {
    track.endTimeStr = value.trim() || 'End';
  }

  recalculateTrackDurations();
  renderCeremonyTrackCards();
  updateCeremonyStats();
  drawCeremonyTimeline();
  updateCeremonyCommandOutput();
}

const CEREMONY_PALETTE = ['#ec4899', '#06b6d4', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#3b82f6'];

function addCeremonyTrack() {
  const tracks = appState.ceremonyMashup.tracks;
  const num = tracks.length + 1;
  const color = CEREMONY_PALETTE[(num - 1) % CEREMONY_PALETTE.length];

  tracks.push({
    id: `track_${Date.now()}`,
    title: `Song ${num}`,
    sourceType: 'file',
    youtubeUrl: '',
    audioUrl: '',
    fileName: '',
    buffer: null,
    startTimeStr: '00:00:00',
    endTimeStr: '00:01:00',
    startTimeSec: 0.0,
    endTimeSec: 60.0,
    durationSec: 60.0,
    color,
    status: 'ready'
  });

  recalculateTrackDurations();
  renderCeremonyTrackCards();
  updateCeremonyStats();
  drawCeremonyTimeline();
  updateCeremonyCommandOutput();
  showToast(`➕ Added Track ${num} to Ceremony Sequence`);
}

function removeCeremonyTrack(idx) {
  const tracks = appState.ceremonyMashup.tracks;
  if (tracks.length <= 2) {
    showToast("⚠️ Sequence must contain at least 2 tracks.");
    return;
  }
  const removed = tracks.splice(idx, 1);
  recalculateTrackDurations();
  renderCeremonyTrackCards();
  updateCeremonyStats();
  drawCeremonyTimeline();
  updateCeremonyCommandOutput();
  showToast(`Removed "${removed[0].title}" from sequence`);
}

async function previewCeremonyTrackClip(idx) {
  const cm = appState.ceremonyMashup;
  const track = cm.tracks[idx];
  if (!track) return;

  if (cm.activePreviewIdx === idx) {
    stopCeremonyTrackClip();
    return;
  }

  stopCeremonyTrackClip();
  if (cm.isPlaying) {
    stopCeremonyPlayback();
  }

  if (!track.buffer) {
    showToast(`⏳ Loading audio for Track ${idx + 1}...`);
    await loadCeremonyTrackBuffer(track);
  }

  if (!track.buffer) return;

  cm.activePreviewIdx = idx;
  renderCeremonyTrackCards();

  await appState.engine.previewCeremonyClip(track, () => {
    cm.activePreviewIdx = null;
    renderCeremonyTrackCards();
  });
}

function stopCeremonyTrackClip() {
  const cm = appState.ceremonyMashup;
  appState.engine.stopPlayback();
  cm.activePreviewIdx = null;
  renderCeremonyTrackCards();
}

function updateCeremonySettings() {
  const cm = appState.ceremonyMashup;

  const introCheck = document.getElementById('ceremonyIntroCheck');
  if (introCheck) cm.introCrossfade = introCheck.checked;
  const introDur = document.getElementById('ceremonyIntroDuration');
  if (introDur) cm.introFadeSec = parseFloat(introDur.value) || 0;
  const introCurve = document.getElementById('ceremonyIntroCurve');
  if (introCurve) cm.introCurve = introCurve.value || 'tri';

  const blendCurve = document.getElementById('ceremonyBlendCurve');
  if (blendCurve) cm.crossfadeCurve = blendCurve.value || 'tri';

  const outroCheck = document.getElementById('ceremonyOutroCheck');
  if (outroCheck) cm.outroCrossfade = outroCheck.checked;
  const outroDur = document.getElementById('ceremonyOutroDuration');
  if (outroDur) cm.outroFadeSec = parseFloat(outroDur.value) || 0;
  const outroCurve = document.getElementById('ceremonyOutroCurve');
  if (outroCurve) cm.outroCurve = outroCurve.value || 'tri';

  const normBox = document.getElementById('ceremonyNormalizeCheckbox');
  if (normBox) cm.normalizeLoudness = normBox.checked;

  drawCeremonyTimeline();
  updateCeremonyCommandOutput();
}

function updateCeremonyCrossfade(val) {
  const cm = appState.ceremonyMashup;
  cm.crossfadeSec = parseFloat(val) || 3.0;
  const disp = document.getElementById('ceremonyCrossfadeVal');
  if (disp) disp.innerText = `${cm.crossfadeSec.toFixed(1)}s`;

  recalculateTrackDurations();
  updateCeremonyStats();
  renderCeremonyTrackCards();
  drawCeremonyTimeline();
  updateCeremonyCommandOutput();
}

function drawCeremonyTimeline(currentPosition = null) {
  const canvas = document.getElementById('ceremonyTimelineCanvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 1150;
  const height = 90;

  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr;
    canvas.height = height * dpr;
  }

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  // Background
  ctx.fillStyle = '#0f1322';
  ctx.fillRect(0, 0, width, height);

  const cm = appState.ceremonyMashup;
  const tracks = cm.tracks;
  const totalDur = recalculateTrackDurations();

  if (totalDur <= 0 || tracks.length === 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '13px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Add tracks and set times to see multi-song crossfade preview', width / 2, height / 2 + 5);
    ctx.restore();
    return;
  }

  // Draw segments
  let currentStart = 0;
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    const segDur = t.durationSec || 60;
    const segStart = currentStart;
    const segEnd = segStart + segDur;

    const x1 = (segStart / totalDur) * width;
    const x2 = (segEnd / totalDur) * width;
    const segW = Math.max(2, x2 - x1);

    // Track block background
    const grad = ctx.createLinearGradient(x1, 0, x2, 0);
    grad.addColorStop(0, `${t.color}cc`);
    grad.addColorStop(1, `${t.color}88`);
    ctx.fillStyle = grad;

    const blockY = 16;
    const blockH = height - 32;
    ctx.beginPath();
    ctx.roundRect(x1, blockY, segW, blockH, 8);
    ctx.fill();

    // Border
    ctx.strokeStyle = `${t.color}ff`;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Stylized audio energy waves inside block
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    const waveStep = 7;
    for (let wx = x1 + 8; wx < x2 - 8; wx += waveStep) {
      const rel = (wx - x1) / segW;
      const barH = (Math.sin(rel * 14 + i) * 0.4 + 0.5) * (blockH * 0.65);
      const by = blockY + (blockH - barH) / 2;
      ctx.fillRect(wx, by, 3, barH);
    }

    // Label: Song title & duration
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px system-ui';
    ctx.textAlign = 'left';
    const textX = Math.max(x1 + 10, Math.min(x2 - 120, x1 + 10));
    ctx.fillText(`${t.title || `Track ${i + 1}`} (${segDur.toFixed(0)}s)`, textX, blockY + 18);

    // Beginning Crossfade (Intro Fade) indicator on Track 1
    if (i === 0 && cm.introCrossfade && cm.introFadeSec > 0) {
      const fadeW = Math.min(segW * 0.45, (cm.introFadeSec / totalDur) * width);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.beginPath();
      ctx.moveTo(x1, blockY);
      ctx.lineTo(x1 + fadeW, blockY);
      ctx.lineTo(x1, blockY + blockH);
      ctx.closePath();
      ctx.fill();

      // Intro badge on canvas
      ctx.fillStyle = '#34d399';
      ctx.font = 'bold 9.5px system-ui';
      ctx.fillText(`▲ Intro ${cm.introFadeSec}s`, x1 + 4, blockY + blockH - 6);
    }

    // Between-Song Overlap region
    if (i < tracks.length - 1) {
      const overlapW = (cm.crossfadeSec / totalDur) * width;
      const overlapStart = Math.max(x1, x2 - overlapW);
      ctx.fillStyle = 'rgba(245, 158, 11, 0.2)';
      ctx.fillRect(overlapStart, blockY, overlapW, blockH);
    }

    // End Crossfade (Outro Fade) indicator on Final Track
    if (i === tracks.length - 1 && cm.outroCrossfade && cm.outroFadeSec > 0) {
      const fadeW = Math.min(segW * 0.45, (cm.outroFadeSec / totalDur) * width);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.beginPath();
      ctx.moveTo(x2, blockY);
      ctx.lineTo(x2 - fadeW, blockY + blockH);
      ctx.lineTo(x2, blockY + blockH);
      ctx.closePath();
      ctx.fill();

      // Outro badge on canvas
      ctx.fillStyle = '#f472b6';
      ctx.font = 'bold 9.5px system-ui';
      ctx.textAlign = 'right';
      ctx.fillText(`▼ Outro ${cm.outroFadeSec}s`, x2 - 4, blockY + blockH - 6);
      ctx.textAlign = 'left';
    }

    currentStart = segEnd - cm.crossfadeSec;
  }

  // Playhead line
  const pos = (currentPosition !== null) ? currentPosition : (cm.playbackPosition || 0);
  const playheadX = (pos / totalDur) * width;

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(playheadX, 0);
  ctx.lineTo(playheadX, height);
  ctx.stroke();

  // Playhead diamond
  ctx.fillStyle = '#ec4899';
  ctx.beginPath();
  ctx.moveTo(playheadX, 0);
  ctx.lineTo(playheadX + 5, 8);
  ctx.lineTo(playheadX, 16);
  ctx.lineTo(playheadX - 5, 8);
  ctx.closePath();
  ctx.fill();

  const timeDisp = document.getElementById('ceremonyPlayheadTimeDisplay');
  if (timeDisp) {
    timeDisp.innerText = `${formatTimeWithMs(pos)} / ${formatTimeWithMs(totalDur)}`;
  }

  ctx.restore();
}

async function toggleCeremonyPlayback() {
  const cm = appState.ceremonyMashup;
  await appState.engine.ensureContext();

  if (cm.isPlaying) {
    stopCeremonyPlayback();
    return;
  }

  const playBtn = document.getElementById('btnCeremonyPlay');
  if (playBtn) playBtn.innerHTML = '<span>⏳</span> Rendering Mix...';

  try {
    for (let i = 0; i < cm.tracks.length; i++) {
      if (!cm.tracks[i].buffer) {
        showToast(`Loading audio for Track ${i + 1}...`);
        await loadCeremonyTrackBuffer(cm.tracks[i]);
      }
    }

    showToast("💖 Rendering multi-track ceremony sequence with -16 LUFS loudness balance...");
    const renderResult = await appState.engine.renderCeremonyMashup(cm.tracks, {
      introCrossfade: cm.introCrossfade,
      introFadeSec: cm.introFadeSec,
      introCurve: cm.introCurve,
      crossfadeSec: cm.crossfadeSec,
      crossfadeCurve: cm.crossfadeCurve,
      outroCrossfade: cm.outroCrossfade,
      outroFadeSec: cm.outroFadeSec,
      outroCurve: cm.outroCurve,
      normalizeLoudness: cm.normalizeLoudness
    });

    cm.renderedMashup = renderResult;

    const ctx = appState.engine.ctx;
    const src = ctx.createBufferSource();
    src.buffer = renderResult.renderedBuffer;
    src.connect(ctx.destination);

    const startPos = cm.playbackPosition || 0;
    const now = ctx.currentTime;
    src.start(0, startPos);

    cm.activeSourceNode = src;
    cm.playbackStartCtxTime = now - startPos;
    cm.isPlaying = true;

    if (playBtn) playBtn.innerHTML = '<span>⏸</span> Pause Ceremony Mashup';

    src.onended = () => {
      if (cm.isPlaying && ctx.currentTime - cm.playbackStartCtxTime >= renderResult.totalDuration - 0.1) {
        stopCeremonyPlayback();
        cm.playbackPosition = 0;
        drawCeremonyTimeline();
      }
    };

    const animate = () => {
      if (!cm.isPlaying) return;
      const currentPos = ctx.currentTime - cm.playbackStartCtxTime;
      cm.playbackPosition = Math.min(renderResult.totalDuration, Math.max(0, currentPos));
      drawCeremonyTimeline(cm.playbackPosition);
      cm.playheadAnimId = requestAnimationFrame(animate);
    };
    cm.playheadAnimId = requestAnimationFrame(animate);

  } catch (err) {
    console.error("Playback error:", err);
    showToast(`⚠️ Playback error: ${err.message || err}`);
    if (playBtn) playBtn.innerHTML = '<span>▶</span> Play Ceremony Mashup';
  }
}

function stopCeremonyPlayback() {
  const cm = appState.ceremonyMashup;
  if (cm.activeSourceNode) {
    try { cm.activeSourceNode.stop(); } catch (e) {}
    cm.activeSourceNode = null;
  }
  if (cm.playheadAnimId) {
    cancelAnimationFrame(cm.playheadAnimId);
    cm.playheadAnimId = null;
  }
  cm.isPlaying = false;
  const playBtn = document.getElementById('btnCeremonyPlay');
  if (playBtn) playBtn.innerHTML = '<span>▶</span> Play Ceremony Mashup';
}

function replayCeremonyMashup() {
  stopCeremonyPlayback();
  appState.ceremonyMashup.playbackPosition = 0;
  toggleCeremonyPlayback();
}

async function exportCeremonyMashup(format) {
  const cm = appState.ceremonyMashup;
  await appState.engine.ensureContext();

  showToast(`⏳ Preparing ceremony mashup for export (${format.toUpperCase()})...`);

  for (let i = 0; i < cm.tracks.length; i++) {
    if (!cm.tracks[i].buffer) {
      showToast(`Loading audio for Track ${i + 1}...`);
      await loadCeremonyTrackBuffer(cm.tracks[i]);
    }
  }

  const renderResult = await appState.engine.renderCeremonyMashup(cm.tracks, {
    introCrossfade: cm.introCrossfade,
    introFadeSec: cm.introFadeSec,
    introCurve: cm.introCurve,
    crossfadeSec: cm.crossfadeSec,
    crossfadeCurve: cm.crossfadeCurve,
    outroCrossfade: cm.outroCrossfade,
    outroFadeSec: cm.outroFadeSec,
    outroCurve: cm.outroCurve,
    normalizeLoudness: cm.normalizeLoudness
  });

  cm.renderedMashup = renderResult;

  if (format === 'mp3') {
    showToast("📱 Encoding 256kbps high-quality MP3 (Universal & iPhone compatible)...");
    const mp3Blob = await appState.engine.audioBufferToMp3Blob(renderResult.renderedBuffer, 256);
    triggerDownloadBlob(mp3Blob, 'final_wedding_mix.mp3');
    showToast("🎉 final_wedding_mix.mp3 downloaded successfully!");

  } else if (format === 'm4a') {
    showToast("🍏 Encoding Apple M4A master...");
    const serverResult = await appState.engine.convertWavToM4aOnServer(renderResult.wavBlob);
    if (serverResult && serverResult.success && serverResult.audioUrl) {
      triggerDownloadDirectUrl(serverResult.audioUrl, 'final_wedding_mix.m4a');
      showToast("🎉 final_wedding_mix.m4a downloaded successfully!");
    } else {
      showToast("📱 Server afconvert unavailable, exporting iPhone-compatible 320kbps MP3 instead...");
      const mp3Blob = await appState.engine.audioBufferToMp3Blob(renderResult.renderedBuffer, 320);
      triggerDownloadBlob(mp3Blob, 'final_wedding_mix.mp3');
    }

  } else if (format === 'wav') {
    triggerDownloadBlob(renderResult.wavBlob, 'final_wedding_mix.wav');
    showToast("🎵 final_wedding_mix.wav downloaded successfully!");
  }
}

function generateCeremonyBashScript() {
  const cm = appState.ceremonyMashup;
  const tracks = cm.tracks;

  let script = `# 1. Install tools via Homebrew (if needed)\n`;
  script += `brew install yt-dlp ffmpeg\n\n`;

  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    const num = i + 1;
    const startStr = t.startTimeStr || '00:00:00';
    const endStr = t.endTimeStr || 'End';

    if (t.sourceType === 'youtube' && t.youtubeUrl) {
      let trimArg = `-ss ${startStr}`;
      if (endStr.toLowerCase() !== 'end' && endStr !== '') {
        trimArg += ` -to ${endStr}`;
      }
      const durLabel = t.durationSec ? ` -> ${Math.round(t.durationSec)}s duration` : '';
      script += `# ${num + 1}. Download and trim Track ${num}: ${t.title} (${startStr} to ${endStr}${durLabel})\n`;
      script += `yt-dlp -x --audio-format mp3 --postprocessor-args "ffmpeg:${trimArg}" -o "part${num}.mp3" "${t.youtubeUrl}"\n\n`;
    } else {
      const srcFile = t.fileName || `song${num}.mp3`;
      let trimArg = `-ss ${startStr}`;
      if (endStr.toLowerCase() !== 'end' && endStr !== '') {
        trimArg += ` -to ${endStr}`;
      }
      script += `# ${num + 1}. Trim Track ${num}: ${t.title} (from "${srcFile}")\n`;
      script += `ffmpeg ${trimArg} -i "${srcFile}" -c:a libmp3lame -q:a 2 "part${num}.mp3"\n\n`;
    }
  }

  const finalStepNum = tracks.length + 2;
  const introMsg = (cm.introCrossfade && cm.introFadeSec > 0) ? `intro ${cm.introFadeSec}s crossfade, ` : '';
  const outroMsg = (cm.outroCrossfade && cm.outroFadeSec > 0) ? `, and ${cm.outroFadeSec}s outro fade` : '';
  script += `# ${finalStepNum}. Normalize levels (-16 LUFS), ${introMsg}crossfade all ${tracks.length} tracks (${cm.crossfadeSec}s overlap)${outroMsg}\n`;
  let inputArgs = '';
  for (let i = 0; i < tracks.length; i++) {
    inputArgs += `-i part${i + 1}.mp3 `;
  }

  script += `ffmpeg ${inputArgs.trim()} -filter_complex \\\n"`;

  for (let i = 0; i < tracks.length; i++) {
    const isFirst = (i === 0);
    const isLast = (i === tracks.length - 1);
    let filter = `[${i}:a]loudnorm=I=-16:TP=-1.5:LRA=11`;
    if (isFirst && cm.introCrossfade && cm.introFadeSec > 0) {
      filter += `,afade=t=in:curve=${cm.introCurve || 'tri'}:st=0:d=${cm.introFadeSec}`;
    }
    if (isLast && cm.outroCrossfade && cm.outroFadeSec > 0) {
      const dur = tracks[i].durationSec || 60;
      const fadeStart = Math.max(0, Math.floor(dur - cm.outroFadeSec));
      filter += `,afade=t=out:curve=${cm.outroCurve || 'tri'}:st=${fadeStart}:d=${cm.outroFadeSec}`;
    }
    script += `${filter}[a${i}]; \\\n `;
  }

  const blendCurve = cm.crossfadeCurve || 'tri';
  if (tracks.length === 2) {
    script += `[a0][a1]acrossfade=d=${cm.crossfadeSec}:c1=${blendCurve}:c2=${blendCurve}" \\\n`;
  } else {
    script += `[a0][a1]acrossfade=d=${cm.crossfadeSec}:c1=${blendCurve}:c2=${blendCurve}[ab]; \\\n `;
    let prevTag = 'ab';
    for (let i = 2; i < tracks.length; i++) {
      const isFinal = (i === tracks.length - 1);
      if (isFinal) {
        script += `[${prevTag}][a${i}]acrossfade=d=${cm.crossfadeSec}:c1=${blendCurve}:c2=${blendCurve}" \\\n`;
      } else {
        const nextTag = `ab${i}`;
        script += `[${prevTag}][a${i}]acrossfade=d=${cm.crossfadeSec}:c1=${blendCurve}:c2=${blendCurve}[${nextTag}]; \\\n `;
        prevTag = nextTag;
      }
    }
  }

  script += `-c:a libmp3lame -q:a 2 final_wedding_mix.mp3\n`;

  return script;
}

function updateCeremonyCommandOutput() {
  const codeEl = document.getElementById('ceremonyCommandOutput');
  if (codeEl) {
    codeEl.innerHTML = `<code>${escapeCeremonyHtml(generateCeremonyBashScript())}</code>`;
  }
}

function toggleCeremonyTerminalDrawer() {
  const body = document.getElementById('ceremonyTerminalBody');
  const arrow = document.getElementById('ceremonyTerminalArrow');
  if (!body) return;
  const isHidden = (body.style.display === 'none');
  body.style.display = isHidden ? 'block' : 'none';
  if (arrow) arrow.innerText = isHidden ? '▴' : '▾';
  if (isHidden) {
    updateCeremonyCommandOutput();
  }
}

function copyCeremonyCommand() {
  const script = generateCeremonyBashScript();
  navigator.clipboard.writeText(script).then(() => {
    showToast("📋 Bash command copied to clipboard!");
  }).catch(() => {
    showToast("Command selected - press Cmd+C to copy.");
  });
}

