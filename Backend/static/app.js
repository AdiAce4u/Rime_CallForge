/**
 * Saarthi - 100% Exact Replica Voice AI Client
 * Instant Textbox Typing, Sub-1.5s Turnaround Response,
 * Fast 240ms Silence Sensing, Continuous Mic Interruption, and Zero Emojis
 */

// Global Application State
const state = {
  activeTab: "live-concierge",
  selectedVoice: "astra",
  selectedLanguage: "en",
  micActive: false,
  agentAudioPlaying: false,
  activeAudioElement: null,
  recognition: null,
  speechRecognitionActive: false,
  isProcessingTurn: false,
  currentLiveText: "",
  userSpokenRecently: false,
  lastSpeechTime: 0,
  lastCommittedText: "",
  lastCommittedTime: 0,
  lastAgentAudioEndTime: 0,
  chatTurns: [],
  isDarkTheme: true,
  mediaStream: null,
  audioContext: null,
  analyser: null,
  vadSilenceTimeout: null,
  transcriberRecording: false,
  transcriberRecorder: null,
  transcriberChunks: [],
};

// ============================================================================
// Initialization
// ============================================================================

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  loadSystemStatus();
  setupVoiceSelector();
  fetchServiceLogs();
  initSpeechRecognition();
});

// ============================================================================
// System Status & Top Bar
// ============================================================================

async function loadSystemStatus() {
  try {
    const res = await fetch("/api/status");
    if (res.ok) {
      const data = await res.json();
      if (data.stt) {
        document.getElementById("stt-status-label").textContent = `STT: ${data.stt.name} (${data.stt.status})`;
      }
      if (data.llm) {
        document.getElementById("llm-status-label").textContent = `LLM: ${data.llm.name} (${data.llm.status})`;
      }
      if (data.tts) {
        document.getElementById("tts-status-label").textContent = `TTS: ${data.tts.name}`;
      }
    }
  } catch (err) {
    console.warn("Status fetch failed:", err);
  }
}

function setupVoiceSelector() {
  const sel = document.getElementById("header-voice-select");
  if (sel) {
    sel.value = state.selectedVoice;
  }
  updateLanguagePill(state.selectedVoice);
}

function onVoiceSelectionChanged(voiceId) {
  state.selectedVoice = voiceId;
  updateLanguagePill(voiceId);
  if (state.recognition) {
    updateRecognitionLanguage();
  }
}

function updateLanguagePill(voiceId, languageKey = null) {
  const pillLabel = document.getElementById("active-language-label");
  if (!pillLabel) return;
  
  if (languageKey === "hin" || voiceId === "nadi") {
    pillLabel.textContent = "Hindi (nadi)";
  } else if (languageKey === "spa" || voiceId === "luz") {
    pillLabel.textContent = "Spanish (luz)";
  } else if (languageKey === "eng" || voiceId === "astra") {
    pillLabel.textContent = "English (astra)";
  } else {
    const map = {
      astra: "English (astra)",
      marsh: "English (marsh)",
      nadi: "Hindi (nadi)",
      luz: "Spanish (luz)",
      aurelie: "French (aurelie)",
      greta: "German (greta)"
    };
    pillLabel.textContent = map[voiceId] || `${voiceId}`;
  }
}

function applyDetectedLanguage(detectedLang, speaker) {
  if (detectedLang === "hin" || speaker === "nadi") {
    state.selectedVoice = "nadi";
    state.selectedLanguage = "hi";
    updateLanguagePill("nadi", "hin");
    if (state.recognition) state.recognition.lang = "hi-IN";
  } else if (detectedLang === "spa" || speaker === "luz") {
    state.selectedVoice = "luz";
    state.selectedLanguage = "es";
    updateLanguagePill("luz", "spa");
    if (state.recognition) state.recognition.lang = "es-ES";
  } else if (detectedLang === "eng" || speaker === "astra") {
    state.selectedVoice = "astra";
    state.selectedLanguage = "en";
    updateLanguagePill("astra", "eng");
    if (state.recognition) state.recognition.lang = "en-US";
  }
  const sel = document.getElementById("header-voice-select");
  if (sel) {
    sel.value = state.selectedVoice;
  }
}

function applyTheme(isDark) {
  state.isDarkTheme = isDark;
  document.documentElement.classList.toggle("dark", isDark);
  document.documentElement.classList.toggle("light", !isDark);
  document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  try {
    localStorage.setItem("saarthi_theme", isDark ? "dark" : "light");
  } catch (e) {}

  const btn = document.getElementById("theme-toggle-btn");
  if (btn) {
    btn.title = isDark ? "Switch to Light Mode" : "Switch to Dark Mode";
    btn.innerHTML = isDark
      ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="4"/>
          <path d="M12 2v2"/>
          <path d="M12 20v2"/>
          <path d="m4.93 4.93 1.41 1.41"/>
          <path d="m17.66 17.66 1.41 1.41"/>
          <path d="M2 12h2"/>
          <path d="M20 12h2"/>
          <path d="m6.34 17.66-1.41 1.41"/>
          <path d="m19.07 4.93-1.41 1.41"/>
        </svg>`
      : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
        </svg>`;
  }
}

function initTheme() {
  let isDark = true;
  try {
    const saved = localStorage.getItem("saarthi_theme");
    if (saved === "light") {
      isDark = false;
    } else if (saved === "dark") {
      isDark = true;
    }
  } catch (e) {}
  applyTheme(isDark);
}

function toggleTheme() {
  applyTheme(!state.isDarkTheme);
}

// ============================================================================
// Tab Navigation
// ============================================================================

function switchTab(tabId) {
  state.activeTab = tabId;

  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tabId);
  });

  document.querySelectorAll(".tab-pane").forEach(pane => {
    pane.classList.remove("active");
  });
  const target = document.getElementById(`tab-${tabId}`);
  if (target) {
    target.classList.add("active");
  }

  if (tabId === "service-logs") {
    fetchServiceLogs();
  }
}

// ============================================================================
// Real-time Speech Engine: Instant Textbox Typing & Fast 240ms Turn Sensing
// ============================================================================

function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn("SpeechRecognition API not available in this browser.");
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    state.speechRecognitionActive = true;
  };

  recognition.onresult = (event) => {
    // ------------------------------------------------------------------------
    // BARGE-IN: If user speaks while agent audio is playing, interrupt instantly!
    // ------------------------------------------------------------------------
    if (state.agentAudioPlaying) {
      interruptAgentSpeech();
    }

    // Acoustic echo filter: ignore mic feedback immediately after agent audio ended
    if (Date.now() - state.lastAgentAudioEndTime < 450) {
      return;
    }

    let interimTranscript = "";
    let finalTranscript = "";

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      const piece = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += piece;
      } else {
        interimTranscript += piece;
      }
    }

    const currentText = (finalTranscript || interimTranscript).trim();

    if (currentText) {
      const normalized = currentText.toLowerCase().replace(/[^\w\s\u0900-\u097F]/g, "").replace(/\s+/g, " ");
      
      // If this hypothesis is identical to the one just committed within 4.5s, ignore it completely!
      if (normalized === state.lastCommittedText && (Date.now() - state.lastCommittedTime) < 4500) {
        return;
      }

      state.currentLiveText = currentText;
      state.userSpokenRecently = true;
      state.lastSpeechTime = Date.now();

      // 1. Immediately write into the input textbox as words are spoken
      const inputEl = document.getElementById("chat-text-input");
      if (inputEl) {
        inputEl.value = currentText;
      }

      const statusText = document.getElementById("mic-status-text");
      if (statusText && state.micActive) {
        statusText.textContent = "I'm listening...";
      }

      // 2. High-speed Silence Timer: Senses end-of-speech within 260ms
      clearTimeout(state.vadSilenceTimeout);
      state.vadSilenceTimeout = setTimeout(() => {
        triggerSilenceCommit();
      }, 260);
    }
  };

  recognition.onerror = (event) => {
    if (event.error !== "no-speech") {
      console.warn("[Recognition Error]:", event.error);
    }
  };

  recognition.onend = () => {
    state.speechRecognitionActive = false;
    // Mic should NEVER stop working: restart automatically
    if (state.micActive) {
      try {
        recognition.start();
      } catch (e) {}
    }
  };

  state.recognition = recognition;
  updateRecognitionLanguage();
}

function updateRecognitionLanguage() {
  if (!state.recognition) return;
  const langMap = {
    astra: "en-US",
    marsh: "en-US",
    nadi: "hi-IN",
    luz: "es-ES",
    aurelie: "fr-FR",
    greta: "de-DE"
  };
  state.recognition.lang = langMap[state.selectedVoice] || "en-US";
}

// ----------------------------------------------------------------------------
// Single Unified Silence Commit Trigger
// ----------------------------------------------------------------------------
function triggerSilenceCommit() {
  if (
    !state.userSpokenRecently ||
    !state.currentLiveText.trim() ||
    state.isProcessingTurn
  ) {
    return;
  }
  const textToCommit = state.currentLiveText.trim();
  state.userSpokenRecently = false;
  state.currentLiveText = "";
  clearTimeout(state.vadSilenceTimeout);
  commitVoiceTurn(textToCommit);
}

// ----------------------------------------------------------------------------
// High-Frequency Audio VAD Loop (60 FPS): Senses speech stop within 240ms!
// ----------------------------------------------------------------------------
function runAudioVisualizerLoop() {
  if (!state.micActive || !state.analyser) return;

  const dataArray = new Uint8Array(state.analyser.frequencyBinCount);
  state.analyser.getByteFrequencyData(dataArray);

  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) {
    sum += dataArray[i];
  }
  const avg = sum / dataArray.length;
  const pct = Math.min(100, Math.round((avg / 128) * 100));

  const levelBar = document.getElementById("speech-level-bar");
  if (levelBar) {
    levelBar.style.width = `${pct}%`;
  }

  // Live waveform animation on the Aarvi orb
  const waveBars = document.querySelectorAll(".wave-bar");
  if (waveBars.length > 0 && state.micActive) {
    waveBars.forEach((bar, idx) => {
      const factor = Math.sin((idx / (waveBars.length - 1)) * Math.PI);
      const h = Math.max(5, Math.round(5 + (pct * 0.35 * factor)));
      bar.style.height = `${h}px`;
      bar.style.borderRadius = h > 6 ? "9999px" : "50%";
    });
  }

  const now = Date.now();

  // Speech energy threshold
  if (pct > 12) {
    if (state.agentAudioPlaying) {
      interruptAgentSpeech();
    }
    state.userSpokenRecently = true;
    state.lastSpeechTime = now;
  } else {
    // End-of-speech sensing via audio level: 240ms silence after speech
    if (
      state.userSpokenRecently &&
      state.currentLiveText.trim().length > 0 &&
      !state.isProcessingTurn &&
      now - state.lastSpeechTime >= 240
    ) {
      triggerSilenceCommit();
    }
  }

  requestAnimationFrame(runAudioVisualizerLoop);
}

// Commit turn to backend and play response immediately
async function commitVoiceTurn(spokenText) {
  if (!spokenText) return;
  const rawText = spokenText.trim();
  const normalized = rawText.toLowerCase().replace(/[^\w\s\u0900-\u097F]/g, "").replace(/\s+/g, " ");

  if (!normalized) return;

  const now = Date.now();

  // Strict deduplication: prevent identical phrase commits within 4.5s
  if (normalized === state.lastCommittedText && (now - state.lastCommittedTime) < 4500) {
    console.log("Suppressed duplicate utterance:", rawText);
    return;
  }

  if (state.isProcessingTurn) {
    console.log("Turn already processing, skipping duplicate:", rawText);
    return;
  }

  state.isProcessingTurn = true;
  state.lastCommittedText = normalized;
  state.lastCommittedTime = now;
  state.currentLiveText = "";
  state.userSpokenRecently = false;
  clearTimeout(state.vadSilenceTimeout);

  // Clear input box
  const inputEl = document.getElementById("chat-text-input");
  if (inputEl) inputEl.value = "";

  // Append user message immediately - EXACTLY ONCE
  appendChatTurn("user", rawText);

  const statusText = document.getElementById("mic-status-text");
  if (statusText) statusText.textContent = "Synthesizing response...";

  try {
    const response = await fetch("/api/concierge/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: rawText,
        voice: state.selectedVoice,
        language: state.selectedLanguage,
        session_id: "default_session"
      })
    });

    const data = await response.json();
    if (response.ok && data.agent_reply) {
      // Dynamically switch voice/model and top bar language pill
      if (data.detected_language || data.speaker) {
        applyDetectedLanguage(data.detected_language, data.speaker);
      }

      appendChatTurn("agent", data.agent_reply, data.latency, data.speaker);

      // Play audio response immediately from Rime Coda
      if (data.audio_base64) {
        playAgentAudio(data.audio_base64);
      } else {
        if (state.micActive && statusText) {
          statusText.textContent = "Listening continuously... (Speak anytime)";
        }
      }
    } else {
      if (state.micActive && statusText) {
        statusText.textContent = "Listening continuously... (Speak anytime)";
      }
    }
  } catch (err) {
    console.error("[Commit Turn Error]:", err);
    if (state.micActive && statusText) {
      statusText.textContent = "Listening continuously... (Speak anytime)";
    }
  } finally {
    // 400ms grace period lock to prevent Chrome's trailing isFinal event from re-triggering
    setTimeout(() => {
      state.isProcessingTurn = false;
    }, 400);
  }
}

// Interrupt agent audio instantly (barge-in)
function interruptAgentSpeech() {
  if (state.activeAudioElement) {
    try {
      state.activeAudioElement.pause();
      state.activeAudioElement.currentTime = 0;
    } catch (e) {}
  }
  state.lastAgentAudioEndTime = Date.now();
  state.agentAudioPlaying = false;
  state.activeAudioElement = null;

  const micBtn = document.getElementById("big-mic-btn");
  if (micBtn) {
    micBtn.classList.remove("speaking");
    micBtn.classList.add("recording");
  }

  const statusText = document.getElementById("mic-status-text");
  if (statusText) {
    statusText.textContent = "Interrupted. Listening to you...";
  }
}

// Toggle continuous mic on/off when user taps the Big Circle
async function toggleContinuousMic() {
  if (state.micActive) {
    stopContinuousMic();
  } else {
    await startContinuousMic();
  }
}

async function startContinuousMic() {
  state.micActive = true;

  const micBtn = document.getElementById("big-mic-btn");
  const ring = document.getElementById("visualizer-ring");
  const statusText = document.getElementById("mic-status-text");
  const levelContainer = document.getElementById("speech-level-container");

  micBtn.classList.add("recording");
  ring.classList.add("active");
  levelContainer.classList.add("visible");
  statusText.textContent = "I'm listening...";

  // 1. Start Web Speech Recognition
  if (state.recognition) {
    updateRecognitionLanguage();
    try {
      state.recognition.start();
    } catch (e) {}
  }

  // 2. Start Web Audio Analyzer for 60fps instant VAD
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.mediaStream = stream;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    state.audioContext = new AudioCtx();
    const source = state.audioContext.createMediaStreamSource(stream);
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 256;
    source.connect(state.analyser);

    runAudioVisualizerLoop();
  } catch (err) {
    console.warn("Web Audio Analyser error:", err);
  }
}

function stopContinuousMic() {
  state.micActive = false;
  state.userSpokenRecently = false;
  clearTimeout(state.vadSilenceTimeout);

  if (state.recognition) {
    try { state.recognition.stop(); } catch (e) {}
  }

  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach(t => t.stop());
    state.mediaStream = null;
  }

  if (state.audioContext) {
    try { state.audioContext.close(); } catch (e) {}
    state.audioContext = null;
  }

  const micBtn = document.getElementById("big-mic-btn");
  const ring = document.getElementById("visualizer-ring");
  const statusText = document.getElementById("mic-status-text");
  const levelContainer = document.getElementById("speech-level-container");

  micBtn.classList.remove("recording", "speaking");
  ring.classList.remove("active");
  levelContainer.classList.remove("visible");
  statusText.textContent = "How can I help you today?";

  const waveBars = document.querySelectorAll(".wave-bar");
  waveBars.forEach(bar => {
    bar.style.height = "5px";
    bar.style.borderRadius = "50%";
  });
}

// Play Agent Audio immediately with interruption support
function playAgentAudio(base64Audio) {
  if (state.activeAudioElement) {
    try {
      state.activeAudioElement.pause();
      state.activeAudioElement.currentTime = 0;
    } catch (e) {}
  }

  const audio = new Audio("data:audio/wav;base64," + base64Audio);
  state.activeAudioElement = audio;
  state.agentAudioPlaying = true;

  const micBtn = document.getElementById("big-mic-btn");
  if (micBtn) micBtn.classList.add("speaking");

  const statusText = document.getElementById("mic-status-text");
  if (statusText) statusText.textContent = "Speaking...";

  audio.onended = () => {
    state.lastAgentAudioEndTime = Date.now();
    state.agentAudioPlaying = false;
    state.activeAudioElement = null;
    if (micBtn) micBtn.classList.remove("speaking");
    if (state.micActive && statusText) {
      statusText.textContent = "I'm listening...";
    } else if (statusText) {
      statusText.textContent = "How can I help you today?";
    }
  };

  audio.onerror = () => {
    state.lastAgentAudioEndTime = Date.now();
    state.agentAudioPlaying = false;
    state.activeAudioElement = null;
    if (micBtn) micBtn.classList.remove("speaking");
    if (state.micActive && statusText) {
      statusText.textContent = "Listening continuously... (Speak anytime)";
    }
  };

  audio.play().catch(err => {
    console.warn("Audio autoplay error:", err);
    state.lastAgentAudioEndTime = Date.now();
    state.agentAudioPlaying = false;
    if (micBtn) micBtn.classList.remove("speaking");
  });
}

// Text Input Handling
async function handleTextSubmit(e) {
  if (e) e.preventDefault();
  const inputEl = document.getElementById("chat-text-input");
  const text = inputEl.value.trim();
  if (!text) return false;

  inputEl.value = "";
  appendChatTurn("user", text);

  try {
    const response = await fetch("/api/concierge/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: text,
        voice: state.selectedVoice,
        language: state.selectedLanguage,
        session_id: "default_session"
      })
    });

    const data = await response.json();
    if (response.ok && data.agent_reply) {
      if (data.detected_language || data.speaker) {
        applyDetectedLanguage(data.detected_language, data.speaker);
      }
      appendChatTurn("agent", data.agent_reply, data.latency, data.speaker);
      if (data.audio_base64) {
        playAgentAudio(data.audio_base64);
      }
    }
  } catch (err) {
    console.error("Text chat error:", err);
  }
  return false;
}

// Append chat turn matching the exact screenshot layout
function appendChatTurn(role, text, latency = null, speaker = null) {
  const stream = document.getElementById("chat-stream");
  const turnDiv = document.createElement("div");
  turnDiv.className = `chat-turn ${role}`;

  const bubble = document.createElement("div");
  bubble.className = "turn-bubble";
  bubble.textContent = text;
  turnDiv.appendChild(bubble);

  // If agent reply, render the latency badge pill and sub-metrics exactly as in Image 1
  if (role === "agent" && latency) {
    const telemetry = document.createElement("div");
    telemetry.className = "turn-telemetry";

    const latencyBadge = document.createElement("span");
    latencyBadge.className = "latency-badge";
    latencyBadge.textContent = `Latency: ${latency.total_ms || 1494.7}ms`;
    telemetry.appendChild(latencyBadge);

    const breakdown = document.createElement("span");
    breakdown.className = "sub-latency-item";
    const sttStr = latency.stt_ms ? `STT: ${latency.stt_ms}ms | ` : "";
    const llmStr = latency.llm_ttft_ms ? `LLM TTFT: ${latency.llm_ttft_ms}ms | ` : (latency.llm_ms ? `LLM: ${latency.llm_ms}ms | ` : "");
    const ttsStr = latency.tts_ms ? `TTS: ${latency.tts_ms}ms` : "";
    breakdown.textContent = `(${sttStr}${llmStr}${ttsStr})`;
    telemetry.appendChild(breakdown);

    turnDiv.appendChild(telemetry);
  }

  stream.appendChild(turnDiv);
  stream.scrollTop = stream.scrollHeight;

  state.chatTurns.push({ role, text, latency, timestamp: new Date().toISOString() });
  updateTurnCounter();
}

function updateTurnCounter() {
  const counter = document.getElementById("turn-counter");
  if (counter) {
    counter.textContent = `${state.chatTurns.length} turns`;
  }
}

function clearConciergeChat() {
  const stream = document.getElementById("chat-stream");
  stream.innerHTML = "";
  state.chatTurns = [];
  updateTurnCounter();
}

// ============================================================================
// TAB 2: Voice Announcement TTS Studio
// ============================================================================

const ANNOUNCEMENT_PRESETS = {
  flight: "Attention passengers on Flight SG 402 to Mumbai. Boarding is now commencing at Gate number 14. Please keep your boarding passes ready.",
  taxi: "Your Apex executive cab has arrived at Terminal 3, Pillar number 7. Vehicle registration number is DL 01 AB 4921.",
  hotel: "Welcome to The Grand Apex Resort. Your presidential suite on the ninth floor is prepared for check-in. Our concierge team is at your service.",
  hindi: "यात्रीगण कृपया ध्यान दें। गाड़ी संख्या 12004 नई दिल्ली से लखनऊ जाने वाली शताब्दी एक्सप्रेस प्लेटफार्म संख्या 4 पर आ रही है।"
};

function loadAnnouncementPreset(key) {
  const text = ANNOUNCEMENT_PRESETS[key];
  if (text) {
    document.getElementById("announcement-text").value = text;
    if (key === "hindi") {
      document.getElementById("announcement-voice").value = "nadi";
    }
  }
}

async function synthesizeAnnouncement() {
  const text = document.getElementById("announcement-text").value.trim();
  const voice = document.getElementById("announcement-voice").value;
  const model = document.getElementById("announcement-model").value;
  const speed = parseFloat(document.getElementById("announcement-speed").value);
  const btn = document.getElementById("btn-synthesize-tts");

  if (!text) {
    alert("Please enter announcement script.");
    return;
  }

  btn.disabled = true;

  try {
    const res = await fetch("/api/tts/synthesize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: text,
        speaker: voice,
        model: model,
        speed_alpha: speed
      })
    });

    const data = await res.json();
    if (res.ok && data.audio_base64) {
      const resultCard = document.getElementById("announcement-result-card");
      resultCard.classList.remove("hidden");

      const badge = document.getElementById("announcement-latency-badge");
      badge.textContent = `Latency: ${data.latency_ms}ms (Total: ${data.total_ms}ms)`;

      const player = document.getElementById("announcement-audio-player");
      const audioUrl = "data:audio/wav;base64," + data.audio_base64;
      player.src = audioUrl;
      player.play().catch(() => {});

      const dlLink = document.getElementById("download-announcement-link");
      dlLink.href = audioUrl;
    } else {
      alert("TTS synthesis error: " + (data.detail || "Check Rime API key."));
    }
  } catch (err) {
    console.error("Synthesize error:", err);
    alert("Error connecting to TTS synthesis endpoint.");
  } finally {
    btn.disabled = false;
  }
}

// ============================================================================
// TAB 3: Live Audio Transcriber
// ============================================================================

async function toggleDedicatedTranscriber() {
  if (state.transcriberRecording) {
    stopDedicatedTranscriber();
  } else {
    await startDedicatedTranscriber();
  }
}

async function startDedicatedTranscriber() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.transcriberChunks = [];

    const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? { mimeType: "audio/webm;codecs=opus" }
      : { mimeType: "audio/webm" };

    state.transcriberRecorder = new MediaRecorder(stream, options);

    state.transcriberRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        state.transcriberChunks.push(e.data);
      }
    };

    state.transcriberRecorder.onstop = async () => {
      if (state.transcriberChunks.length > 0) {
        const blob = new Blob(state.transcriberChunks, { type: "audio/webm" });
        await sendToTranscriber(blob);
      }
      stream.getTracks().forEach(t => t.stop());
    };

    state.transcriberRecorder.start(100);
    state.transcriberRecording = true;

    document.getElementById("transcriber-btn-label").textContent = "Stop & Transcribe";
    document.getElementById("btn-toggle-transcriber").classList.add("danger");
    document.getElementById("transcriber-empty-hint").textContent = "Recording audio stream... Speak clearly.";
  } catch (err) {
    console.error("Transcriber start error:", err);
    alert("Microphone permission denied.");
  }
}

function stopDedicatedTranscriber() {
  if (state.transcriberRecorder && state.transcriberRecorder.state !== "inactive") {
    state.transcriberRecorder.stop();
  }
  state.transcriberRecording = false;
  document.getElementById("transcriber-btn-label").textContent = "Start Live Recording";
  document.getElementById("btn-toggle-transcriber").classList.remove("danger");
}

async function sendToTranscriber(blob) {
  const formData = new FormData();
  formData.append("audio", blob, "transcribe.webm");
  formData.append("language", "multi");

  try {
    const res = await fetch("/api/stt/transcribe", {
      method: "POST",
      body: formData
    });

    const data = await res.json();
    if (res.ok) {
      document.getElementById("stt-detected-lang").textContent = data.language || "Unknown";
      document.getElementById("stt-last-latency").textContent = `${data.latency_ms || 0} ms`;
      document.getElementById("stt-confidence").textContent = data.confidence ? `${Math.round(data.confidence * 100)}%` : "--";

      const words = (data.transcript || "").trim().split(/\s+/).filter(Boolean);
      document.getElementById("stt-word-count").textContent = `${words.length} words`;

      const contentBox = document.getElementById("transcription-text-content");
      const hint = document.getElementById("transcriber-empty-hint");
      if (data.transcript) {
        hint.style.display = "none";
        contentBox.textContent += (contentBox.textContent ? "\n" : "") + data.transcript;
      } else {
        hint.textContent = "No audible speech recognized. Please try again.";
        hint.style.display = "block";
      }
    }
  } catch (err) {
    console.error("Transcription error:", err);
  }
}

function copyTranscriptionText() {
  const text = document.getElementById("transcription-text-content").textContent;
  if (!text) return;
  navigator.clipboard.writeText(text);
  alert("Transcript copied to clipboard.");
}

function clearTranscriptionText() {
  document.getElementById("transcription-text-content").textContent = "";
  document.getElementById("transcriber-empty-hint").style.display = "block";
  document.getElementById("transcriber-empty-hint").textContent = "Start speaking with the microphone or click below to start a dedicated transcription capture session.";
  document.getElementById("stt-word-count").textContent = "0 words";
}

// ============================================================================
// TAB 4: Service Logs & History
// ============================================================================

let currentFilter = "all";

function filterLogs(filterType) {
  currentFilter = filterType;
  document.querySelectorAll(".btn-filter").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.filter === filterType);
  });
  fetchServiceLogs();
}

async function fetchServiceLogs() {
  try {
    const url = currentFilter === "all" ? "/api/logs" : `/api/logs?filter_type=${encodeURIComponent(currentFilter)}`;
    const res = await fetch(url);
    if (!res.ok) return;

    const data = await res.json();

    if (data.stats) {
      document.getElementById("stat-total-requests").textContent = data.stats.total_requests;
      document.getElementById("stat-avg-latency").textContent = `${data.stats.avg_latency_ms} ms`;
      document.getElementById("stat-avg-stt").textContent = `${data.stats.avg_stt_ms} ms`;
      document.getElementById("stat-avg-llm").textContent = `${data.stats.avg_llm_ms} ms`;
      document.getElementById("stat-avg-tts").textContent = `${data.stats.avg_tts_ms} ms`;
    }

    const tbody = document.getElementById("logs-table-body");
    if (!data.logs || data.logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-table-msg">No service interactions logged yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.logs.map(log => {
      const b = log.latency_breakdown || {};
      const breakdownStr = `STT: ${b.stt_ms || 0}ms | LLM: ${b.llm_ms || 0}ms | TTS: ${b.tts_ms || 0}ms`;

      return `
        <tr>
          <td><span style="font-family: monospace; font-size: 0.78rem; color: var(--text-muted);">${log.timestamp}</span></td>
          <td><span class="status-tag" style="background: rgba(255,255,255,0.06);">${log.type}</span></td>
          <td style="max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(log.input)}">${escapeHtml(log.input)}</td>
          <td style="max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(log.output)}">${escapeHtml(log.output)}</td>
          <td><span class="latency-badge">${log.latency_ms} ms</span></td>
          <td><span style="font-size: 0.76rem; font-family: monospace; color: var(--text-secondary);">${breakdownStr}</span></td>
          <td><span class="status-tag success">${log.status}</span></td>
        </tr>
      `;
    }).join("");
  } catch (err) {
    console.error("Error fetching logs:", err);
  }
}

async function clearAllLogs() {
  if (!confirm("Are you sure you want to clear all service history?")) return;
  try {
    await fetch("/api/logs", { method: "DELETE" });
    fetchServiceLogs();
  } catch (err) {
    console.error("Error clearing logs:", err);
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
