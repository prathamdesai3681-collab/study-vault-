// --- AUDIO SYNTHESIS & SFX ENGINE (Web Audio API) ---
let audioCtx = null;
let solfeggioOsc = null, brownNode = null, gammaOsc = null, masterGainNode = null;

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGainNode = audioCtx.createGain();
    masterGainNode.gain.value = 0.5;
    masterGainNode.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playBeep(freq = 440, type = 'sine', duration = 0.1) {
  if (state.sfxMuted) return;
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(g);
    g.connect(masterGainNode);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch(e){}
}

function playSuccessChime() {
  if (state.sfxMuted) return;
  [523.25, 659.25, 783.99, 1046.50].forEach((freq, idx) => {
    setTimeout(() => playBeep(freq, 'triangle', 0.25), idx * 80);
  });
}

function toggleSFX() {
  state.sfxMuted = !state.sfxMuted;
  saveState();
  const sfxIcon = document.getElementById('sfxIcon');
  if (state.sfxMuted) {
    sfxIcon.setAttribute('data-lucide', 'volume-x');
  } else {
    sfxIcon.setAttribute('data-lucide', 'volume-2');
    playBeep(600, 'sine', 0.1);
  }
  lucide.createIcons();
}

// --- SYNTH CONTROL TOGGLES ---
function toggleAudioSynth(type) {
  const ctx = getAudioCtx();
  const btn = document.getElementById(`btn-${type}`);
  const dot = btn.querySelector('.toggle-dot');
  
  if (type === 'solfeggio') {
    if (solfeggioOsc) {
      solfeggioOsc.stop(); solfeggioOsc = null;
      btn.classList.remove('accent-bg'); dot.style.transform = 'translateX(0)';
    } else {
      solfeggioOsc = ctx.createOscillator();
      const g = ctx.createGain();
      solfeggioOsc.frequency.value = 174;
      g.gain.value = 0.15;
      solfeggioOsc.connect(g); g.connect(masterGainNode);
      solfeggioOsc.start();
      btn.classList.add('accent-bg'); dot.style.transform = 'translateX(24px)';
    }
  } else if (type === 'brown') {
    if (brownNode) {
      brownNode.stop(); brownNode = null;
      btn.classList.remove('accent-bg'); dot.style.transform = 'translateX(0)';
    } else {
      const bufferSize = ctx.sampleRate * 2;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let lastOut = 0.0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        data[i] = (lastOut + (0.02 * white)) / 1.02;
        lastOut = data[i];
        data[i] *= 3.5;
      }
      brownNode = ctx.createBufferSource();
      brownNode.buffer = buffer;
      brownNode.loop = true;
      const g = ctx.createGain();
      g.gain.value = 0.1;
      brownNode.connect(g); g.connect(masterGainNode);
      brownNode.start();
      btn.classList.add('accent-bg'); dot.style.transform = 'translateX(24px)';
    }
  } else if (type === 'gamma') {
    if (gammaOsc) {
      gammaOsc.stop(); gammaOsc = null;
      btn.classList.remove('accent-bg'); dot.style.transform = 'translateX(0)';
    } else {
      gammaOsc = ctx.createOscillator();
      const g = ctx.createGain();
      gammaOsc.frequency.value = 40;
      g.gain.value = 0.12;
      gammaOsc.connect(g); g.connect(masterGainNode);
      gammaOsc.start();
      btn.classList.add('accent-bg'); dot.style.transform = 'translateX(24px)';
    }
  }
}

function setMasterVolume(val) {
  if (masterGainNode) masterGainNode.gain.value = parseFloat(val);
  document.getElementById('volumeValue').textContent = Math.round(val * 100) + '%';
}

function muteAllAudio() {
  if (solfeggioOsc) toggleAudioSynth('solfeggio');
  if (brownNode) toggleAudioSynth('brown');
  if (gammaOsc) toggleAudioSynth('gamma');
}
