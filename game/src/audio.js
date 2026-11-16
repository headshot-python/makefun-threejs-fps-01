// Procedural sound: every effect is synthesized with WebAudio, so the game
// ships no audio files and makes no network request. Created lazily on the
// first user gesture (browsers require it).
let ctx = null;
let master = null;

export function ensureAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  } catch { ctx = null; }
}

function noiseBuffer(dur) {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function burst(dur, filterFreq, gain, type = 'lowpass') {
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(dur);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = filterFreq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t); src.stop(t + dur);
}

function tone(freq, dur, gain, slideTo) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'square';
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur);
}

export const sfx = {
  shot(kind) {
    if (kind === 'sniper') { burst(0.28, 900, 0.9); tone(160, 0.18, 0.25, 50); }
    else if (kind === 'shotgun') { burst(0.22, 1400, 0.85); }
    else if (kind === 'pistol') { burst(0.1, 2200, 0.55); }
    else { burst(0.12, 1800, 0.7); }
  },
  distantShot() { burst(0.14, 700, 0.18); },
  dry() { tone(1200, 0.04, 0.12); },
  reload() { tone(900, 0.05, 0.15); setTimeout(() => tone(650, 0.05, 0.15), 180); },
  hit(head) { tone(head ? 2400 : 1800, 0.06, 0.2); },
  kill() { tone(520, 0.09, 0.2); setTimeout(() => tone(780, 0.12, 0.2), 90); },
  hurt() { tone(220, 0.12, 0.25, 110); },
  explosion() { burst(0.7, 320, 1.0); tone(70, 0.6, 0.5, 30); },
  plant() { tone(880, 0.08, 0.2); setTimeout(() => tone(880, 0.08, 0.2), 140); },
  beep() { tone(1320, 0.07, 0.18); },
  roundWin() { [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.16, 0.2), i * 130)); },
  roundLose() { [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.18, 0.2), i * 150)); },
  buy() { tone(990, 0.06, 0.15); },
  denied() { tone(180, 0.12, 0.2); },
};
