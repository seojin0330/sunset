// 노을 파티 게임 · 공통 화면 (로비, 입력, 네트워크, 결과)
import * as THREE from 'three';
import { COLOR_CSS, COLOR_NAMES, clamp } from '/shared/sim.js';
import { GAMES } from '/shared/party.js';
import * as IN from '/input.js';
import { sfx, music } from '/audio.js';
import { createWorld } from '/world.js';
import { initEscQuit } from '/esc-quit.js';
import { initKiosk } from '/kiosk.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const TV = params.has('tv');
// 배경음악은 TV(관전 화면)에서만 (노트북 4대가 같이 틀면 시끄러워서). 노트북도 켜려면 주소에 &music
const MUSIC = TV || params.has('music');
if (TV) document.body.classList.add('tv');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* */ } }

// ---------- 3D 공통 ----------
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, params.has('low') ? 1 : 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const world = createWorld();
const scene = world.scene;
const lobbyCam = new THREE.PerspectiveCamera(60, 1, 0.5, 14000);
function resize() { renderer.setSize(innerWidth, innerHeight, false); }
addEventListener('resize', resize);
resize();

// ---------- 상태 ----------
const S = {
  slot: -1, phase: 'lobby', lobby: null, ready: false, game: null, names: [],
  endsAt: 0, results: null, snaps: [],
};
let current = null;          // 지금 실행 중인 게임 화면
let currentKey = null;
const modules = {};

// ---------- 네트워크 ----------
let ws = null;
function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }
function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/party`);
  ws.onopen = () => {
    $('conn').classList.add('hidden');
    let want = -1;
    if (params.has('p')) want = parseInt(params.get('p'), 10) - 1;
    else if (lsGet('sd_slot') !== null) want = parseInt(lsGet('sd_slot'), 10);
    send({ t: 'hello', spectate: TV, want: Number.isInteger(want) ? want : -1, name: lsGet('sd_name') || '' });
  };
  ws.onmessage = (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    onMsg(m);
  };
  ws.onclose = () => {
    $('conn').textContent = '서버 연결이 끊겼어요 · 다시 연결하는 중…';
    $('conn').classList.remove('hidden');
    setTimeout(connect, 1500);
  };
}

function onMsg(m) {
  switch (m.t) {
    case 'welcome':
      S.slot = m.slot;
      if (S.slot >= 0) lsSet('sd_slot', String(S.slot));
      renderLobby();
      break;
    case 'lobby':
      S.lobby = m;
      if (m.phase === 'lobby' && $('lobby').classList.contains('hidden')) setPhase('lobby');
      else renderLobby();
      break;
    case 'phase':
      if (m.names) S.names = m.names;
      setPhase(m.phase, m.game, m.tl);
      break;
    case 'snap':
      S.snaps.push({ at: performance.now(), s: m });
      if (S.snaps.length > 30) S.snaps.shift();
      if (!current && m.g) ensureGame(m.g);
      break;
    case 'ev':
      if (current) current.event(m);
      break;
    case 'results':
      S.results = m;
      renderResults();
      break;
    case 'goto':
      if (typeof m.url === 'string' && m.url.startsWith('/')) location.href = m.url + location.search;
      break;
    default:
  }
}

async function loadModule(key) {
  if (!modules[key]) modules[key] = await import(`/party/${key}.js`);
  return modules[key];
}
let loading = null;
async function ensureGame(key) {
  if (currentKey === key && current) return;
  if (loading === key) return;
  loading = key;
  const mod = await loadModule(key);
  loading = null;
  if (current) { current.dispose(); current = null; }
  $('ghud').innerHTML = '';
  currentKey = key;
  current = mod.create(core);
}
function stopGame() {
  if (current) current.dispose();
  current = null;
  currentKey = null;
  $('ghud').innerHTML = '';
  S.snaps.length = 0;
}

function setPhase(ph, game, tl) {
  const prev = S.phase;
  S.phase = ph;
  S.game = game || S.game;
  S.endsAt = performance.now() + (tl || 0);
  document.body.dataset.phase = ph;
  $('lobby').classList.toggle('hidden', ph !== 'lobby');
  $('results').classList.toggle('hidden', ph !== 'results');
  $('ghud').classList.toggle('hidden', ph === 'lobby' || ph === 'results');
  if (ph === 'lobby') { stopGame(); renderLobby(); }
  $('howcard').classList.toggle('hidden', ph !== 'countdown');
  if (ph === 'countdown') {
    showHowCard(game);
    S.snaps.length = 0;
    ensureGame(game);
    sfx.unlock();
  }
  if (ph === 'playing' && prev === 'countdown') {
    IN.zeroNow();
    sfx.beep(1320, 0.35);
    showCenter('시작', 'good', 900);
  }
}

// ---------- 스냅샷 보간 ----------
const DELAY = 70;
function sample() {
  const sn = S.snaps;
  if (!sn.length) return null;
  const t = performance.now() - DELAY;
  for (let i = sn.length - 1; i > 0; i--) {
    if (sn[i - 1].at <= t) {
      const a = sn[i - 1], b = sn[i];
      const f = clamp((t - a.at) / Math.max(1, b.at - a.at), 0, 1);
      return { a: a.s, b: b.s, f };
    }
  }
  return { a: sn[0].s, b: sn[0].s, f: 1 };
}
const lerpAng = (a, b, f) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * f; };
// key: 배열 이름, lerp: 보간할 칸, ang: 각도 칸
function rows(sm, key, lerp, ang = []) {
  const out = new Map();
  if (!sm) return out;
  const A = new Map((sm.a[key] || []).map((r) => [r[0], r]));
  for (const rb of sm.b[key] || []) {
    const ra = A.get(rb[0]) || rb;
    const r = rb.slice();
    for (const i of lerp) r[i] = ra[i] + (rb[i] - ra[i]) * sm.f;
    for (const i of ang) r[i] = lerpAng(ra[i], rb[i], sm.f);
    out.set(rb[0], r);
  }
  return out;
}

// ---------- 입력 ----------
const keys = new Set();
const keyEdge = new Set();
addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT') return;
  if (!keys.has(e.code)) keyEdge.add(e.code);
  keys.add(e.code);
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  sfx.unlock();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
addEventListener('pointerdown', () => sfx.unlock());
const has = (...c) => c.some((k) => keys.has(k));
const edge = (...c) => c.some((k) => keyEdge.has(k));
const BTN_KEYS = [['Space', 'KeyJ'], ['KeyK'], ['KeyL', 'ShiftLeft', 'ShiftRight'], ['KeyB', 'Semicolon']];
const curve = (x) => { x = clamp(x, -1, 1); return x * (0.5 + 0.5 * Math.abs(x)); };
const dead = (v, d) => Math.sign(v) * Math.max(0, Math.abs(v) - d);

const inp = { x: 0, y: 0, h: [false, false, false, false], c: [0, 0, 0, 0], s: 0, anyEdge: false, ctrlEdge: false };
const prevBtn = [false, false, false, false];
let prevShake = false;
const kb = { x: 0, y: 0 };
function pollInput(dt) {
  const live = IN.isLive();
  const kx = (has('ArrowRight', 'KeyD') ? 1 : 0) - (has('ArrowLeft', 'KeyA') ? 1 : 0);
  const ky = (has('ArrowUp', 'KeyW') ? 1 : 0) - (has('ArrowDown', 'KeyS') ? 1 : 0);
  kb.x += (kx - kb.x) * Math.min(1, dt * 8);
  kb.y += (ky - kb.y) * Math.min(1, dt * 8);
  let x = kb.x, y = kb.y;
  if (live && IN.ctrl.cal) {
    const t = IN.tiltDeg();
    x += curve(dead(t.bank, 2.5) / 24);
    y += curve(dead(t.fwd, 2.5) / 22);
  }
  inp.x = clamp(x, -1, 1);
  inp.y = clamp(y, -1, 1);
  const b = live ? IN.ctrl.btn : [false, false, false, false];
  inp.anyEdge = false;
  inp.ctrlEdge = false;
  for (let i = 0; i < 4; i++) {
    const held = has(...BTN_KEYS[i]) || b[i];
    const press = edge(...BTN_KEYS[i]) || (b[i] && !prevBtn[i]);
    if (press) { inp.c[i]++; inp.anyEdge = true; }
    if (b[i] && !prevBtn[i]) inp.ctrlEdge = true;
    inp.h[i] = held;
    prevBtn[i] = b[i];
  }
  const sh = live && IN.ctrl.shake;
  if (edge('KeyU') || (sh && !prevShake)) inp.s++;
  prevShake = sh;
  inp.enter = edge('Enter', 'NumpadEnter');
  keyEdge.clear();
}
let sendAcc = 0;
function sendInput(dt) {
  sendAcc += dt;
  if (sendAcc < 1 / 30) return;
  sendAcc = 0;
  if (S.slot < 0 || TV) return;
  if (S.phase !== 'playing' && S.phase !== 'countdown') return;
  send({ t: 'in', x: Math.round(inp.x * 100) / 100, y: Math.round(inp.y * 100) / 100, h: inp.h, c: inp.c, s: inp.s });
}

// ---------- 화면 가운데 글자 ----------
let centerTimer = 0;
function showCenter(text, cls = '', ms = 1500) {
  const el = $('center');
  el.textContent = text;
  el.className = `show ${cls}`;
  clearTimeout(centerTimer);
  centerTimer = setTimeout(() => { el.className = ''; }, ms);
}

// 게임 화면들이 쓰는 도구
const core = {
  THREE, renderer, scene, world, TV, sfx, esc,
  COLOR_CSS, COLOR_NAMES,
  get slot() { return S.slot; },
  get phase() { return S.phase; },
  get names() { return S.names; },
  get settings() { return S.lobby ? S.lobby.settings : {}; },
  get countdownLeft() { return S.phase === 'countdown' ? Math.max(0, S.endsAt - performance.now()) : 0; },
  inp,
  sample, rows, lerpAng,
  latest: () => (S.snaps.length ? S.snaps[S.snaps.length - 1].s : null),
  nameOf: (s) => (S.names[s] ? S.names[s].n : COLOR_NAMES[s]),
  isHuman: (s) => !!(S.names[s] && S.names[s].h),
  hud: $('ghud'),
  center: showCenter,
  // 4분할 화면 그리기
  renderSplit(cams) {
    const W = innerWidth, H = innerHeight, hw = Math.floor(W / 2), hh = Math.floor(H / 2);
    renderer.setScissorTest(true);
    for (let i = 0; i < 4; i++) {
      const x = (i % 2) * hw, y = i < 2 ? H - hh : 0;
      renderer.setViewport(x, y, hw, hh);
      renderer.setScissor(x, y, hw, hh);
      const c = cams[i];
      if (!c) { renderer.setClearColor(0x120c18); renderer.clear(); continue; }
      if (Math.abs(c.aspect - hw / hh) > 1e-3) { c.aspect = hw / hh; c.updateProjectionMatrix(); }
      renderer.render(scene, c);
    }
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
  },
  render(cam) {
    const a = innerWidth / innerHeight;
    if (Math.abs(cam.aspect - a) > 1e-3) { cam.aspect = a; cam.updateProjectionMatrix(); }
    renderer.render(scene, cam);
  },
  // 버튼 안내 (색 캡)
  capsHtml(list) {
    return `<div class="pcaps">${list.map(([c, label]) => `<span>${c === 'tilt' ? '<i class="tilt">↻</i>' : c === 'shake' ? '<i class="tilt">〰</i>' : `<i class="cap ${c}"></i>`}${label}</span>`).join('')}</div>`;
  },
  fmtTime(t) { return `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`; },
};

// 게임 시작 전 카운트다운 동안 보여주는 설명 카드
const GOALS = {
  sumo: '상대를 판 밖으로 밀어내기. 마지막까지 남으면 승리, 번개를 먹으면 잠깐 무거워짐',
  boat: '부표 사이 물길을 따라 결승선까지. 주황 발판을 밟으면 가속',
  dash: '위쪽 두 버튼 번갈아 연타, 허들 앞에서 점프',
  maze: '다 같이 기울여 공을 골까지. 구멍에 빠지면 +5초, 별은 -3초',
};
function showHowCard(g) {
  if (!GAMES[g]) return;
  $('howcard').innerHTML = `<div class="hc-title">${GAMES[g].name}</div><div class="hc-goal">${GOALS[g]}</div>${core.capsHtml(HOWTO[g])}`;
}

// 게임별 조작 설명
const HOWTO = {
  sumo: [['tilt', '기울여서 굴리기'], ['red', '대시'], ['blue', '무거워지기'], ['white', '점프'], ['black', '브레이크(꾹)'], ['shake', '흔들면 충격파']],
  boat: [['tilt', '좌우=조종 · 앞=빠르게'], ['red', '부스터'], ['blue', '물길로 복귀'], ['white', '드리프트(꾹)'], ['black', '경적'], ['shake', '흔들면 물보라']],
  dash: [['white', '+'], ['red', '번갈아 연타 = 달리기'], ['blue', '점프 (검정도 OK)'], ['shake', '흔들면 스퍼트 1번']],
  maze: [['tilt', '다 같이 판 기울이기'], ['red', '아무 버튼 = 함께 점프'], ['shake', '흔들어도 점프']],
};
core.HOWTO = HOWTO;

// ---------- 로비 ----------
function renderGames() {
  const L = S.lobby;
  const sel = L ? L.settings.game : 'sumo';
  const cards = Object.entries(GAMES).map(([k, g], i) => `
    <button class="gcard ${k === sel ? 'on' : ''}" data-g="${k}">
      <span class="gi">${String(i + 2).padStart(2, '0')}</span><b>${g.name}</b><small>${g.desc}</small><em>${g.time}</em>
    </button>`).join('');
  $('games').innerHTML = `<button class="gcard" data-g="dogfight"><span class="gi">01</span><b>노을 공중전</b><small>기울여 조종하는 비행 대전</small><em>1~5분</em></button>${cards}`;
  $('games').querySelectorAll('.gcard').forEach((el) => {
    el.onclick = () => {
      sfx.unlock();
      if (el.dataset.g === 'dogfight') send({ t: 'goto', to: 'dogfight' });
      else send({ t: 'settings', game: el.dataset.g });
    };
  });
}

function renderLobby() {
  const L = S.lobby;
  if (!L) return;
  renderGames();
  const g = L.settings.game;
  $('slots').innerHTML = L.slots.map((s, i) => {
    const mine = i === S.slot;
    const cls = ['slot', mine ? 'mine' : '', s ? (s.ready ? 'ready' : '') : 'empty'].join(' ');
    const name = s ? esc(s.name) + (mine ? ' (나)' : '') : '비어 있음';
    const st = !s ? (S.slot >= 0 ? '클릭해서 이동' : (L.settings.bots && g !== 'maze' ? 'AI' : '')) : s.ready ? '준비 완료' : '대기 중';
    return `<div class="${cls}" data-i="${i}"><div class="top"><i class="dot" style="background:${COLOR_CSS[i]}"></i>${name}</div><div class="st">${st}</div></div>`;
  }).join('');
  $('slots').querySelectorAll('.slot.empty').forEach((el) => { el.onclick = () => send({ t: 'pick', slot: +el.dataset.i }); });
  const mine = S.slot >= 0 ? L.slots[S.slot] : null;
  S.ready = !!(mine && mine.ready);
  const rb = $('btn-ready');
  rb.textContent = S.ready ? '준비 완료 (누르면 취소)' : '준비 완료';
  rb.classList.toggle('on', S.ready);
  rb.disabled = S.slot < 0;
  $('me-slot').innerHTML = S.slot >= 0 ? `<i class="dot" style="background:${COLOR_CSS[S.slot]}"></i>${S.slot + 1}번 · ${COLOR_NAMES[S.slot]}` : '자리 없음 (관전)';
  if (mine && document.activeElement !== $('name')) $('name').value = mine.name;

  $('opt-rounds').classList.toggle('hidden', g !== 'sumo');
  $('opt-laps').classList.toggle('hidden', g !== 'boat');
  $('bots-wrap').classList.toggle('hidden', g === 'maze');
  document.querySelectorAll('#opt-rounds button').forEach((b) => b.classList.toggle('on', +b.dataset.v === L.settings.rounds));
  document.querySelectorAll('#opt-laps button').forEach((b) => b.classList.toggle('on', +b.dataset.v === L.settings.laps));
  $('bots').checked = L.settings.bots;
  $('howto').innerHTML = `<h3>${GAMES[g].name} 조작</h3>${core.capsHtml(HOWTO[g])}${g === 'maze' ? '<p class="hint">사람끼리만. 4명 기울기의 평균만큼 판이 기울어짐</p>' : ''}`;

  $('rank-title').textContent = `오늘의 기록 · ${GAMES[g].name}`;
  const list = (L.boards && L.boards[g]) || [];
  $('rank').innerHTML = list.length
    ? list.map((r, i) => `<li><span>${i + 1}. ${esc(r.name)}</span><b>${esc(r.label)}</b></li>`).join('')
    : '<li class="empty">기록 없음</li>';
}

function renderResults() {
  const R = S.results;
  if (!R) return;
  const g = GAMES[R.game];
  const medals = [];
  const top = R.ranking[0];
  let head = '';
  if (R.game === 'maze' && R.team) {
    head = R.team.done
      ? `<div class="win">성공 · ${R.team.total.toFixed(1)}초</div><p class="sub">걸린 시간 ${R.team.time.toFixed(1)}초 + 떨어짐 벌점 ${R.team.pen}초 − 별 보너스 ${R.team.bonus || 0}초 (별 ${R.team.stars || 0}개)</p>`
      : `<div class="win">시간 종료 · ${R.team.cleared}/${R.team.levels}단계</div>`;
  } else if (top) head = `<div class="win">${esc(top.name)} 우승</div>`;
  const list = R.game === 'maze' ? '' : `<ol>${R.ranking.map((r, i) => `<li class="${r.slot === S.slot ? 'me' : ''}">
      <span class="m">${medals[i] || i + 1}</span><i class="dot" style="background:${COLOR_CSS[r.slot]}"></i>
      <span class="n">${esc(r.name)}${r.human ? '' : ' (AI)'}</span><b>${esc(r.main)}</b><small>${esc(r.sub)}</small></li>`).join('')}</ol>`;
  const team = R.game === 'maze' ? `<div class="team">${R.ranking.map((r) => `<span style="border-color:${COLOR_CSS[r.slot]}">${esc(r.name)}</span>`).join('')}</div>` : '';
  const board = (R.board || []).length
    ? `<div class="today"><h3>오늘의 기록</h3>${R.board.map((r, i) => `<div><span>${i + 1}. ${esc(r.name)}</span><b>${esc(r.label)}</b></div>`).join('')}</div>` : '';
  $('results').innerHTML = `<h1>${g.name} 결과</h1>${head}${team}${list}${board}<p>잠시 후 로비로</p>`;
  const iWon = (top && top.slot === S.slot) || (R.game === 'maze' && R.team && R.team.done);
  if (iWon || TV) sfx.fanfare();
}

let nameTimer = 0;
$('name').addEventListener('input', () => {
  clearTimeout(nameTimer);
  nameTimer = setTimeout(() => {
    const v = $('name').value.trim();
    lsSet('sd_name', v);
    send({ t: 'name', name: v });
  }, 300);
});
$('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
$('btn-ready').onclick = () => send({ t: 'ready', v: !S.ready });
$('btn-start').onclick = () => send({ t: 'start' });
$('bots').onchange = (e) => send({ t: 'settings', bots: e.target.checked });
document.querySelectorAll('#opt-rounds button').forEach((b) => { b.onclick = () => send({ t: 'settings', rounds: +b.dataset.v }); });
document.querySelectorAll('#opt-laps button').forEach((b) => { b.onclick = () => send({ t: 'settings', laps: +b.dataset.v }); });
$('btn-serial').onclick = async () => {
  sfx.unlock();
  if (!IN.ctrl.supported) {
    $('help-origin').textContent = location.origin;
    $('help').classList.remove('hidden');
    return;
  }
  try { await IN.connectSerial(); } catch { /* 취소 */ }
};
$('help-close').onclick = () => $('help').classList.add('hidden');
$('btn-calib').onclick = () => openCalib();

function updateCtrlStatus() {
  const el = $('ctrl-status');
  const c = IN.ctrl;
  if (!c.supported) { el.textContent = '이 주소에서는 컨트롤러 연결이 막혀 있어요 (버튼을 눌러 해결 방법 보기)'; el.className = 'err'; return; }
  if (c.error) { el.textContent = c.error; el.className = 'err'; return; }
  if (IN.isLive()) { el.textContent = c.cal ? '컨트롤러 연결됨' : '연결됨 (기울기 설정 필요)'; el.className = 'ok'; return; }
  if (c.connected) { el.textContent = '연결됨 · 신호 기다리는 중…'; el.className = ''; return; }
  el.textContent = '컨트롤러 없음 · 키보드로 할 수 있어요';
  el.className = '';
}

// ---------- 기울기 보정 (비행기 게임과 같은 설정을 씀) ----------
const calib = { open: false, step: 0 };
const CALIB_TEXT = [
  '컨트롤러를 평평하게 든 채로 아무 버튼이나 누르세요',
  '오른쪽으로 크게 기울인 채로 버튼을 누르세요 ↘',
  '앞쪽(화면 쪽)으로 숙인 채로 버튼을 누르세요 ⤵',
];
function openCalib() { calib.open = true; calib.step = 0; $('calib').classList.remove('hidden'); renderCalib(''); }
function renderCalib(msg) {
  $('calib-steps').innerHTML = [0, 1, 2].map((i) => `<i class="${i <= calib.step ? 'on' : ''}"></i>`).join('');
  $('calib-text').textContent = IN.isLive() ? CALIB_TEXT[calib.step] : '컨트롤러를 먼저 연결해 주세요';
  $('calib-msg').textContent = msg || '';
}
$('calib-cancel').onclick = () => { calib.open = false; $('calib').classList.add('hidden'); };
IN.ctrl.onConnect = () => { if (!IN.ctrl.cal) setTimeout(openCalib, 400); };

function handleUi() {
  if (calib.open) {
    if (inp.ctrlEdge) {
      const r = IN.calibCapture(calib.step);
      if (r.ok) {
        sfx.beep(880, 0.1);
        if (r.done) { calib.open = false; $('calib').classList.add('hidden'); showCenter('기울기 설정 완료', 'good', 1500); }
        else { calib.step++; renderCalib(''); }
      } else renderCalib(r.msg);
    }
    const raw = IN.ctrl.raw;
    const t = IN.ctrl.cal ? IN.tiltDeg() : { bank: raw.r, fwd: raw.p };
    $('calib-dot').style.transform = `translate(${clamp(t.bank, -60, 60) * 1.2}px, ${clamp(-t.fwd, -60, 60) * 1.2}px)`;
    return;
  }
  if (S.phase === 'lobby' && !TV && S.slot >= 0) {
    if (inp.enter && document.activeElement !== $('name')) send({ t: 'ready', v: !S.ready });
    if (inp.ctrlEdge && !S.ready) send({ t: 'ready', v: true });
  }
}

// ---------- 메인 루프 ----------
let lastT = performance.now();
let simT = 0;
let statusT = 0;
let lastCount = -1;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  simT += dt;
  pollInput(dt);
  handleUi();
  sendInput(dt);

  // 카운트다운 숫자
  const bc = $('bigcount');
  if (S.phase === 'countdown') {
    const n = Math.ceil(core.countdownLeft / 1000);
    bc.textContent = n > 0 ? n : '';
    if (n !== lastCount && n > 0) { sfx.beep(660, 0.15); lastCount = n; }
  } else { bc.textContent = ''; lastCount = -1; }

  if (current && (S.phase === 'countdown' || S.phase === 'playing' || S.phase === 'results')) {
    current.frame(dt, simT);
    world.update(dt, simT, current.camera || lobbyCam);
  } else {
    // 로비 배경: 천천히 도는 하늘
    const a = simT * 0.03;
    lobbyCam.position.set(Math.cos(a) * 900, 220, Math.sin(a) * 900);
    lobbyCam.lookAt(0, 90, 0);
    world.update(dt, simT, lobbyCam);
    core.render(lobbyCam);
  }

  // 배경음악
  if (MUSIC) {
    const want = S.phase === 'countdown' || S.phase === 'playing' ? (currentKey || S.game) : 'lobby';
    if (music.playing !== want) music.play(want);
    $('sound-hint').classList.toggle('hidden', sfx.ready());
  }

  statusT -= dt;
  if (statusT <= 0) { statusT = 0.5; updateCtrlStatus(); }
}

IN.autoConnect();
connect();
requestAnimationFrame(frame);

// 무료 호스팅(Render)은 HTTP 요청이 없으면 서버를 재우므로, 4분마다 작은 파일을 하나 받아 깨워 둠
setInterval(() => { fetch('/games.css', { cache: 'no-store' }).catch(() => {}); }, 4 * 60 * 1000);

// ESC를 1.5초 꾹 누르면 게임 종료 → 모두 로비로
initEscQuit({ active: () => S.phase === 'countdown' || S.phase === 'playing', onQuit: () => send({ t: 'quit' }) });
initKiosk();
