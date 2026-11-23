// 효과음 (파일 없이 브라우저에서 직접 합성)
let ctx = null;
let master = null;
let noiseBuf = null;
let eng = null;
let lastMg = 0;

function now() { return ctx.currentTime; }

function noise(dur, { type = 'bandpass', freq = 1000, freqEnd, q = 1, vol = 0.5, attack = 0.003 } = {}) {
  if (!ctx || vol <= 0.01) return;
  const t = now();
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.05);
}

function tone(freq, dur, { type = 'sine', vol = 0.3, freqEnd, attack = 0.005, delay = 0 } = {}) {
  if (!ctx || vol <= 0.01) return;
  const t = now() + delay;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export const sfx = {
  unlock() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o1.type = 'sawtooth'; o2.type = 'sawtooth';
    o1.frequency.value = 70; o2.frequency.value = 72.5;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 380;
    const g = ctx.createGain();
    g.gain.value = 0;
    o1.connect(lp); o2.connect(lp); lp.connect(g).connect(master);
    o1.start(); o2.start();
    eng = { o1, o2, lp, g };
  },
  engine(speed, boosting) {
    if (!eng) return;
    const t = now();
    const f = speed > 0 ? 50 + speed * 0.42 : 50;
    eng.o1.frequency.setTargetAtTime(f, t, 0.15);
    eng.o2.frequency.setTargetAtTime(f * 1.035, t, 0.15);
    eng.lp.frequency.setTargetAtTime(boosting ? 900 : 380, t, 0.2);
    eng.g.gain.setTargetAtTime(speed > 0 ? (boosting ? 0.09 : 0.055) : 0, t, 0.25);
  },
  mg(vol = 1) {
    if (!ctx) return;
    if (vol < 0.9 && performance.now() - lastMg < 60) return;
    lastMg = performance.now();
    noise(0.07, { freq: 1800, q: 0.8, vol: 0.32 * vol });
    tone(140, 0.06, { type: 'square', vol: 0.1 * vol, freqEnd: 60 });
  },
  launch(vol = 1) {
    noise(0.9, { type: 'bandpass', freq: 600, freqEnd: 3000, q: 1.5, vol: 0.4 * vol, attack: 0.02 });
  },
  boom(vol = 1, big = false) {
    noise(big ? 1.6 : 0.9, { type: 'lowpass', freq: big ? 1400 : 2000, freqEnd: 80, vol: (big ? 0.9 : 0.6) * vol, attack: 0.005 });
    tone(big ? 70 : 90, big ? 0.9 : 0.5, { type: 'sine', vol: (big ? 0.6 : 0.4) * vol, freqEnd: 30 });
  },
  hit() { tone(1500, 0.05, { type: 'square', vol: 0.08 }); },
  hurt() {
    noise(0.18, { type: 'lowpass', freq: 600, vol: 0.5 });
    tone(110, 0.15, { type: 'square', vol: 0.15, freqEnd: 60 });
  },
  warn() {
    tone(1250, 0.09, { type: 'square', vol: 0.09 });
    tone(1250, 0.09, { type: 'square', vol: 0.09, delay: 0.14 });
  },
  whoosh(vol = 1) { noise(0.5, { type: 'bandpass', freq: 400, freqEnd: 2200, q: 2, vol: 0.4 * vol, attack: 0.05 }); },
  horn(vol = 1) {
    for (const d of [0, 0.26]) {
      tone(392, 0.2, { type: 'sawtooth', vol: 0.14 * vol, delay: d, attack: 0.01 });
      tone(494, 0.2, { type: 'sawtooth', vol: 0.12 * vol, delay: d, attack: 0.01 });
    }
  },
  ult(vol = 1) {
    tone(220, 0.8, { type: 'sawtooth', vol: 0.25 * vol, freqEnd: 40 });
    noise(1.0, { type: 'lowpass', freq: 3000, freqEnd: 100, vol: 0.7 * vol });
  },
  beep(freq = 660, dur = 0.15) { tone(freq, dur, { type: 'square', vol: 0.12 }); },
  kill() {
    tone(660, 0.12, { type: 'triangle', vol: 0.25 });
    tone(990, 0.2, { type: 'triangle', vol: 0.25, delay: 0.1 });
  },
  pickup(vol = 1) {
    [784, 988, 1319].forEach((f, i) => tone(f, 0.18, { type: 'triangle', vol: 0.2 * vol, delay: i * 0.06 }));
  },
  streak(n) {
    const base = [523, 587, 659, 784, 880][Math.min(4, n - 1)];
    [1, 1.25, 1.5, 2].forEach((m, i) => tone(base * m, 0.22, { type: 'square', vol: 0.11, delay: i * 0.08 }));
  },
  alert() {
    tone(880, 0.25, { type: 'triangle', vol: 0.2 });
    tone(1175, 0.35, { type: 'triangle', vol: 0.2, delay: 0.2 });
  },
  // 관중 함성
  cheer(vol = 1) {
    noise(1.6, { type: 'bandpass', freq: 900, freqEnd: 1400, q: 0.6, vol: 0.35 * vol, attack: 0.25 });
    noise(1.2, { type: 'bandpass', freq: 2200, q: 1.2, vol: 0.12 * vol, attack: 0.15 });
  },
  ready() { return !!ctx && ctx.state === 'running'; },
  fanfare() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.22, delay: i * 0.13 }));
  },
};

// ---------- 배경음악 (간단한 신시사이저 반복곡) ----------
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const SONGS = {
  // root: 기준음(MIDI), prog: 마디별 화음(기준음에서 반음 수), 나머지는 리듬 성격
  lobby: { bpm: 92, root: 57, prog: [[0, 3, 7], [-4, 0, 3], [-7, -3, 0], [-2, 2, 5]], kick: [0, 8], hat: [4, 12], snare: [], arp: 2, lead: 'triangle', vol: 0.8 },
  sumo: { bpm: 126, root: 60, prog: [[0, 4, 7], [5, 9, 12], [-3, 0, 4], [7, 11, 14]], kick: [0, 4, 8, 12], hat: [2, 6, 10, 14], snare: [4, 12], arp: 1, lead: 'square', bounce: true, vol: 1 },
  boat: { bpm: 148, root: 57, prog: [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [-5, -1, 2]], kick: [0, 4, 8, 12], hat: [2, 6, 10, 14, 15], snare: [4, 12], arp: 1, lead: 'sawtooth', vol: 0.9 },
  dash: { bpm: 168, root: 62, prog: [[0, 4, 7], [-3, 0, 4], [5, 9, 12], [7, 11, 14]], kick: [0, 4, 8, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], snare: [4, 12], arp: 1, lead: 'square', vol: 1 },
  maze: { bpm: 100, root: 64, prog: [[0, 4, 7, 11], [-3, 0, 4, 7], [5, 9, 12, 16], [2, 5, 9, 12]], kick: [0, 10], hat: [4, 12], snare: [], arp: 2, lead: 'triangle', vol: 0.8 },
};
let musicGain = null;
let song = null;
let step = 0;
let nextT = 0;
let timer = 0;

function mNote(t, f, dur, type, vol) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(musicGain);
  o.start(t); o.stop(t + dur + 0.05);
}
function mNoise(t, dur, freq, vol, type = 'highpass') {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(musicGain);
  src.start(t, Math.random()); src.stop(t + dur + 0.02);
}
function mKick(t, vol) {
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(140, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  o.connect(g).connect(musicGain);
  o.start(t); o.stop(t + 0.25);
}

function schedule() {
  if (!ctx || !song) return;
  const S = SONGS[song];
  const sp = 60 / S.bpm / 4; // 16분음표 길이
  while (nextT < ctx.currentTime + 0.2) {
    const t = nextT;
    const s16 = step % 16;
    const bar = Math.floor(step / 16) % S.prog.length;
    const chord = S.prog[bar];
    const v = S.vol;
    if (S.kick.includes(s16)) mKick(t, 0.5 * v);
    if (S.hat.includes(s16)) mNoise(t, 0.04, 7000, 0.07 * v);
    if (S.snare.includes(s16)) mNoise(t, 0.12, 1800, 0.16 * v, 'bandpass');
    // 베이스
    if (s16 % 4 === 0 || (S.bounce && s16 % 4 === 3)) {
      const n = S.root - 12 + chord[0] + (S.bounce && s16 % 8 === 4 ? 12 : 0);
      mNote(t, mtof(n), sp * 2.6, 'triangle', 0.22 * v);
    }
    // 아르페지오
    if (s16 % S.arp === 0) {
      const k = Math.floor(s16 / S.arp);
      const n = S.root + 12 + chord[k % chord.length] + (Math.floor(k / chord.length) % 2 ? 12 : 0);
      mNote(t, mtof(n), sp * (S.arp === 2 ? 2.2 : 1.1), S.lead, (S.lead === 'triangle' ? 0.09 : 0.035) * v);
    }
    nextT += sp;
    step++;
  }
}

export const music = {
  // name: lobby / sumo / boat / dash / maze, 또는 null(끄기)
  play(name) {
    if (!ctx || ctx.state !== 'running') return;
    if (name === song) return;
    song = name && SONGS[name] ? name : null;
    if (!musicGain) {
      musicGain = ctx.createGain();
      musicGain.gain.value = 0.5;
      musicGain.connect(master);
    }
    step = 0;
    nextT = ctx.currentTime + 0.1;
    if (!timer) timer = setInterval(schedule, 50);
  },
  get playing() { return song; },
};
