const $ = (id) => document.getElementById(id);

const textEl = $('text');
const voiceEl = $('voice');
const languageEl = $('language');
const totalStepsEl = $('totalSteps');
const totalStepsValueEl = $('totalStepsValue');
const speedEl = $('speed');
const speedValueEl = $('speedValue');
const generateBtn = $('generate');
const muteEl = $('mute');
const statusEl = $('status');
const canvas = $('wave');
const ctx = canvas.getContext('2d');

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let currentSource = null;
let animationHandle = null;

totalStepsEl.addEventListener('input', () => {
  totalStepsValueEl.textContent = totalStepsEl.value;
});
speedEl.addEventListener('input', () => {
  const v = Number.parseFloat(speedEl.value).toFixed(2);
  speedValueEl.textContent = `${v}x`;
});

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

function fitCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
}

function drawIdle() {
  fitCanvas();
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = '#2a3445';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();
}

function startVisualisation(analyser) {
  const buffer = new Uint8Array(analyser.fftSize);

  function tick() {
    fitCanvas();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    analyser.getByteTimeDomainData(buffer);

    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#6ee7ff';
    ctx.beginPath();
    const step = w / buffer.length;
    for (let i = 0; i < buffer.length; i++) {
      const v = buffer[i] / 128.0;
      const y = (v * h) / 2;
      const x = i * step;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    animationHandle = requestAnimationFrame(tick);
  }

  tick();
}

function stopVisualisation() {
  if (animationHandle !== null) {
    cancelAnimationFrame(animationHandle);
    animationHandle = null;
  }
  drawIdle();
}

async function generate() {
  const text = textEl.value.trim();
  if (text.length < 10) {
    setStatus('text must be at least 10 characters', true);
    return;
  }

  const payload = {
    text,
    voice: voiceEl.value,
    language: languageEl.value,
    totalSteps: Number.parseInt(totalStepsEl.value, 10),
    speed: Number.parseFloat(speedEl.value),
  };

  generateBtn.disabled = true;
  setStatus('synthesising...');

  try {
    const res = await fetch('/synthesize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }

    const wavBytes = await res.arrayBuffer();
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
    const audioBuf = await audioCtx.decodeAudioData(wavBytes);

    if (currentSource) {
      try {
        currentSource.stop();
      } catch {}
      currentSource.disconnect();
    }

    const source = audioCtx.createBufferSource();
    source.buffer = audioBuf;

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.6;

    source.connect(analyser);
    if (muteEl.checked) {
      const silent = audioCtx.createGain();
      silent.gain.value = 0;
      analyser.connect(silent).connect(audioCtx.destination);
    } else {
      analyser.connect(audioCtx.destination);
    }

    source.onended = () => {
      stopVisualisation();
      setStatus(`done · ${audioBuf.duration.toFixed(2)}s`);
    };

    currentSource = source;
    startVisualisation(analyser);
    source.start();
    setStatus(`playing · ${audioBuf.duration.toFixed(2)}s`);
  } catch (err) {
    setStatus(err.message ?? String(err), true);
    stopVisualisation();
  } finally {
    generateBtn.disabled = false;
  }
}

generateBtn.addEventListener('click', generate);
window.addEventListener('resize', () => {
  if (animationHandle === null) {
    drawIdle();
  }
});

drawIdle();
