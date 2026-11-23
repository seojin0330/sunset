// 노을 공중전 - 게임 클라이언트
import * as THREE from 'three';
import {
  CFG, COLORS, COLOR_CSS, COLOR_NAMES, ITEM_INFO, ISLANDS, STACKS, ARCHES, forwardOf, stepPlane, newPlane, wrapAngle, clamp, segSphere,
} from '/shared/sim.js';
import { createWorld } from './world.js';
import { Items } from './items.js';
import { buildPlane, makeTag, setTagText } from './planes.js';
import { FX } from './fx.js';
import { sfx } from './audio.js';
import { GAMES } from '/shared/party.js';
import * as IN from './input.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const TV = params.has('tv') || params.has('spectate');
if (TV) document.body.classList.add('tv');

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* */ } }
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = (v) => Math.round(v * 100) / 100;

// ---------- 렌더러 ----------
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, params.has('low') ? 1 : 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const camera = new THREE.PerspectiveCamera(68, 1, 0.5, 14000);
const world = createWorld();
const scene = world.scene;
const fx = new FX(scene);
const items = new Items(scene);

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------- 상태 ----------
const S = {
  slot: -1, phase: 'lobby', endsAt: 0,
  settings: { mode: 'easy', roundTime: 180, bots: true },
  lobby: null, ready: false, results: null, lastCount: -1,
  leader: -1, announced30: false, lastTen: -1,
};
const ents = new Map();
const me = {
  plane: newPlane(), alive: false,
  mgT: 0, msCd: 0, evCd: 0, hornCd: 0, ult: 0, sendT: 0, rapidUntil: 0,
  deathAt: 0, deathPos: new THREE.Vector3(), msCount: 0, gunSide: 1, lockSlot: -1, warnT: 0,
  leadPos: new THREE.Vector3(), hasLead: false,
};
const demo = { plane: newPlane(), obj: null };

const V = () => new THREE.Vector3();
const tmp = V(), tmp2 = V(), tmp3 = V();
const UP = new THREE.Vector3(0, 1, 0);

function ensureEnt(slot) {
  let e = ents.get(slot);
  if (e) return e;
  const obj = buildPlane(COLORS[slot]);
  scene.add(obj);
  const tag = makeTag(COLOR_CSS[slot]);
  scene.add(tag);
  e = {
    slot, name: '', human: true, obj, tag, buf: [],
    alive: false, hp: CFG.HP, kills: 0, deaths: 0,
    inv: false, firing: false, evading: false, boosting: false,
    evadeStart: 0, evadeDir: 1, fireAcc: 0, smokeT: 0, exploded: false,
    pos: V(), fwd: new THREE.Vector3(0, 0, 1), yaw: 0, pitch: 0, roll: 0, speed: CFG.SPEED,
    vel: V(), trailT: 0,
    tv: { pos: new THREE.Vector3(0, 300, 0), up: new THREE.Vector3(0, 1, 0), snap: true },
  };
  ents.set(slot, e);
  return e;
}

function removeEnt(slot) {
  const e = ents.get(slot);
  if (!e) return;
  scene.remove(e.obj);
  scene.remove(e.tag);
  ents.delete(slot);
}

function setPose(e, x, y, z, yaw, pitch, roll) {
  e.pos.set(x, y, z);
  e.yaw = yaw; e.pitch = pitch; e.roll = roll;
  const f = forwardOf(e);
  e.fwd.set(f.x, f.y, f.z);
  e.obj.position.copy(e.pos);
  e.obj.rotation.set(-pitch, yaw, roll, 'YXZ');
}

const volAt = (pos) => (TV ? 0.3 : Math.pow(clamp(1 - camera.position.distanceTo(pos) / 1500, 0, 1), 1.5));

const _warnV = new THREE.Vector3();

// ---------- 네트워크 ----------
let ws = null;
function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }

function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
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
      S.settings = m.settings;
      if (S.slot >= 0) lsSet('sd_slot', String(S.slot));
      setPhase(m.phase, m.tl);
      renderLobby();
      break;
    case 'lobby':
      S.lobby = m;
      S.settings = m.settings;
      renderLobby();
      break;
    case 'phase':
      S.settings = m.settings || S.settings;
      setPhase(m.phase, m.tl);
      break;
    case 'snap': onSnap(m); break;
    case 'spawn': onSpawn(m); break;
    case 'dmg': onDmg(m); break;
    case 'kill': onKill(m); break;
    case 'fx': onFx(m); break;
    case 'results':
      S.results = m;
      if (S.lobby) S.lobby.leaderboard = m.leaderboard;
      renderResults();
      break;
    case 'items': items.sync(m.items || []); break;
    case 'pick': onPick(m); break;
    case 'goto':
      // 다른 게임으로 다 같이 이동 (?p=, ?tv 등은 그대로)
      if (typeof m.url === 'string' && m.url.startsWith('/')) location.href = m.url + location.search;
      break;
    case 'leave': {
      const e = ents.get(m.slot);
      if (e) { e.alive = false; e.obj.visible = false; e.tag.visible = false; }
      break;
    }
    default:
  }
}

function setPhase(ph, tl) {
  const prev = S.phase;
  S.phase = ph;
  S.endsAt = performance.now() + (tl || 0);
  document.body.dataset.phase = ph;
  $('lobby').classList.toggle('hidden', ph !== 'lobby');
  $('hud').classList.toggle('hidden', !(ph === 'countdown' || ph === 'playing'));
  $('results').classList.toggle('hidden', ph !== 'results');
  $('bigcount').textContent = '';
  if (ph === 'countdown' && prev !== 'countdown') {
    fx.clearAll();
    me.ult = 0;
    me.msCd = 0;
    me.evCd = 0;
    me.rapidUntil = 0;
    $('feed').innerHTML = '';
    S.lastCount = -1;
    S.leader = -1;
    S.announced30 = false;
    S.lastTen = -1;
    for (const e of ents.values()) e.tv.snap = true;
    showCenter('편하게 잡은 자세가 수평입니다', '', 4000);
  }
  if (ph === 'playing' && prev === 'countdown') {
    IN.zeroNow();
    sfx.beep(1046, 0.5);
    showCenter('GO!', 'good', 900);
  }
  if (ph === 'lobby') {
    me.alive = false;
    for (const e of ents.values()) { e.alive = false; e.obj.visible = false; e.tag.visible = false; }
    fx.clearAll();
    items.clear();
    renderLobby();
  }
  if (ph === 'results') renderResults();
}

function onSnap(m) {
  const now = performance.now();
  if (m.ph !== S.phase) setPhase(m.ph, m.tl);
  S.endsAt = now + m.tl;
  const seen = new Set();
  for (const q of m.p) {
    seen.add(q.s);
    const e = ensureEnt(q.s);
    e.name = q.n;
    e.human = !!q.h;
    e.hp = q.hp;
    e.kills = q.k;
    e.deaths = q.d;
    e.inv = !!q.inv;
    if (q.s === S.slot) continue;
    e.firing = !!q.f;
    e.boosting = !!q.b;
    if (q.e && !e.evading) { e.evadeStart = now; e.evadeDir = Math.random() < 0.5 ? -1 : 1; }
    e.evading = !!q.e;
    const wasAlive = e.alive;
    e.alive = !!q.a;
    if (e.alive && !wasAlive) { e.buf = []; e.tv.snap = true; }
    const prev = e.buf[e.buf.length - 1];
    if (prev && now - prev.t > 5) {
      const k = 1000 / (now - prev.t);
      tmp.set((q.x - prev.x) * k, (q.y - prev.y) * k, (q.z - prev.z) * k);
      if (tmp.lengthSq() < 250 * 250) e.vel.lerp(tmp, 0.5);
    }
    e.buf.push({ t: now, x: q.x, y: q.y, z: q.z, yaw: q.yw, pitch: q.pt, roll: q.rl });
    if (e.buf.length > 30) e.buf.shift();
  }
  for (const s of [...ents.keys()]) if (!seen.has(s)) removeEnt(s);
}

function onSpawn(m) {
  const e = ensureEnt(m.slot);
  e.alive = true;
  e.exploded = false;
  e.hp = CFG.HP;
  e.inv = true;
  if (m.slot === S.slot) {
    const p = newPlane();
    p.x = m.x; p.y = m.y; p.z = m.z; p.yaw = m.yaw;
    me.plane = p;
    me.alive = true;
    cam.snap = true;
  } else {
    e.buf = [{ t: performance.now(), x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: 0, roll: 0 }];
  }
  setPose(e, m.x, m.y, m.z, m.yaw, 0, 0);
}

function onDmg(m) {
  const e = ents.get(m.slot);
  if (e) e.hp = m.hp;
  if (m.slot === S.slot) {
    cam.shake = Math.min(1.2, cam.shake + 0.45);
    flashVignette();
    sfx.hurt();
    me.ult = Math.min(100, me.ult + m.d * 0.5);
    const a = m.by != null ? ents.get(m.by) : null;
    if (a && !TV) showDamageDir(a.pos);
  }
  if (m.by === S.slot && m.slot !== S.slot) {
    hitMarker();
    sfx.hit();
    me.ult = Math.min(100, me.ult + m.d * 0.8);
  }
}

const W_NAME = { mg: '기관총', ms: '미사일', ult: '필살기' };
const pName = (e) => (e ? `<span class="p" style="color:${COLOR_CSS[e.slot]}">${esc(e.name)}</span>` : '?');

function onKill(m) {
  const v = ents.get(m.victim);
  const k = m.killer != null ? ents.get(m.killer) : null;
  if (m.w === 'crash') addFeed(`${pName(v)} 추락`);
  else if (k) addFeed(`${pName(k)} <small>[${W_NAME[m.w] || '격추'}]</small> ${pName(v)}`);
  else addFeed(`${pName(v)} 격추됨`);
  if (v) {
    if (!v.exploded) {
      const pos = v.slot === S.slot ? tmp.set(me.plane.x, me.plane.y, me.plane.z) : v.pos;
      fx.explosion(pos, 1.3);
      sfx.boom(Math.max(0.3, volAt(pos)), true);
    }
    v.exploded = true;
    v.alive = false;
    v.obj.visible = false;
    v.tag.visible = false;
  }
  if (v) { v.deathAt = performance.now(); v.deathPos = (v.deathPos || V()).copy(v.slot === S.slot ? tmp.set(me.plane.x, me.plane.y, me.plane.z) : v.pos); }
  if (m.fb && k) addFeed(`${pName(k)} 첫 격추`);
  if (m.streak >= 3 && k && m.killer !== S.slot) addFeed(`${pName(k)} ${m.streak}연속 격추`);

  if (m.victim === S.slot) {
    if (me.alive) {
      me.alive = false;
      me.deathAt = performance.now();
      me.deathPos.set(me.plane.x, me.plane.y, me.plane.z);
      cam.shake = 1.3;
    }
    // 추락이면 이미 '바다에 추락!/지형에 충돌!'을 띄웠으니 덮어쓰지 않음
    if (m.w !== 'crash') showCenter(k ? `${k.name}에게 격추됨` : '격추됨', 'bad', 2500);
  } else if (m.killer === S.slot && m.w !== 'crash') {
    const words = ['', '격추 +1', '더블 킬', '트리플 킬', '쿼드라 킬'];
    let text = m.streak >= 5 ? `${m.streak}연속 격추` : words[m.streak] || '격추 +1';
    if (m.fb) text = `첫 격추\n${text}`;
    showCenter(text, 'good', 1600);
    if (m.streak >= 2) sfx.streak(m.streak); else sfx.kill();
  }
}

function onPick(m) {
  const info = ITEM_INFO[m.kind];
  if (!info) return;
  tmp.set(m.x, m.y, m.z);
  for (let i = 0; i < 10; i++) {
    fx.puff(tmp, {
      color: info.color, add: true, life: 0.6, s0: 6, s1: 2, opacity: 1,
      vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60, vz: (Math.random() - 0.5) * 60,
    });
  }
  fx.puff(tmp, { color: info.color, add: true, life: 0.35, s0: 10, s1: 50, opacity: 0.9 });
  if (m.slot === S.slot) {
    sfx.pickup(1);
    showCenter(info.label, 'good', 1300);
    if (m.kind === 'rapid') me.rapidUntil = performance.now() + CFG.RAPID_TIME * 1000;
  } else {
    sfx.pickup(volAt(tmp) * 0.6);
  }
}

function showDamageDir(pos) {
  tmp.copy(pos).applyMatrix4(camera.matrixWorldInverse);
  const ang = Math.atan2(tmp.x, -tmp.z);
  const el = $('dmgdir');
  el.style.transform = `rotate(${ang}rad)`;
  el.classList.add('show');
  void el.offsetWidth;
  el.classList.remove('show');
}

function onFx(m) {
  const e = ents.get(m.slot);
  if (m.kind === 'ms') {
    fx.addMissile({ id: m.id, owner: m.slot, target: m.target, pos: { x: m.x, y: m.y, z: m.z }, dir: { x: m.dx, y: m.dy, z: m.dz }, local: false });
    sfx.launch(volAt(tmp.set(m.x, m.y, m.z)));
  } else if (m.kind === 'msx') {
    const mm = fx.endMissile(m.id, true);
    if (mm) sfx.boom(volAt(mm.pos) * 0.7);
  } else if (m.kind === 'horn' && e) {
    sfx.horn(Math.max(0.15, volAt(e.pos)));
    fx.bubble(() => (e.alive ? e.pos : null), '빵빵');
  } else if (m.kind === 'ult') {
    tmp.set(m.x, m.y, m.z);
    fx.shockwave(tmp, CFG.ULT_RADIUS);
    sfx.ult(Math.max(0.3, volAt(tmp)));
  }
}

// ---------- 내 비행기 ----------
function fireGun() {
  const p = me.plane;
  const e = ents.get(S.slot);
  const f = e.fwd;
  me.gunSide *= -1;
  tmp2.set(1, 0, 0).applyQuaternion(e.obj.quaternion);
  tmp.copy(e.pos).addScaledVector(f, 6).addScaledVector(tmp2, 2.4 * me.gunSide);
  const s = CFG.MG_SPREAD;
  // 체험 모드: 조준점이 적 근처면 예측 위치로 살짝 보정
  let ax = f.x, ay = f.y, az = f.z;
  if (S.settings.mode === 'easy' && me.hasLead) {
    tmp3.copy(me.leadPos).sub(tmp).normalize();
    if (tmp3.angleTo(f) < CFG.AIM_ASSIST) { ax = tmp3.x; ay = tmp3.y; az = tmp3.z; }
  }
  tmp3.set(ax + (Math.random() - 0.5) * s, ay + (Math.random() - 0.5) * s, az + (Math.random() - 0.5) * s)
    .normalize()
    .multiplyScalar(CFG.MG_SPEED + p.speed);
  fx.addBullet(tmp, tmp3, true, S.slot);
  sfx.mg(1);
}

function fireMissile() {
  const e = ents.get(S.slot);
  const f = e.fwd;
  const id = `${S.slot}-${++me.msCount}`;
  const pos = { x: e.pos.x + f.x * 6, y: e.pos.y + f.y * 6 - 1.5, z: e.pos.z + f.z * 6 };
  const target = me.lockSlot;
  fx.addMissile({ id, owner: S.slot, target, pos, dir: f, local: true });
  send({ t: 'fx', kind: 'ms', id, target, x: r2(pos.x), y: r2(pos.y), z: r2(pos.z), dx: r2(f.x), dy: r2(f.y), dz: r2(f.z) });
  me.msCd = CFG.MS_CD;
  sfx.launch(1);
}

function doHorn() {
  me.hornCd = 0.7;
  const e = ents.get(S.slot);
  sfx.horn(1);
  fx.bubble(() => (me.alive ? e.pos : null), '빵빵');
  send({ t: 'fx', kind: 'horn' });
}

function doUlt() {
  const e = ents.get(S.slot);
  me.ult = 0;
  for (const o of ents.values()) {
    if (o.slot === S.slot || !o.alive || o.inv) continue;
    if (o.pos.distanceTo(e.pos) < CFG.ULT_RADIUS) send({ t: 'hit', target: o.slot, dmg: CFG.ULT_DMG, w: 'ult' });
  }
  fx.shockwave(e.pos, CFG.ULT_RADIUS);
  sfx.ult(1);
  cam.shake = 1;
  send({ t: 'fx', kind: 'ult', x: r2(e.pos.x), y: r2(e.pos.y), z: r2(e.pos.z) });
}

function crash(kind) {
  const e = ents.get(S.slot);
  me.alive = false;
  me.deathAt = performance.now();
  me.deathPos.copy(e.pos);
  e.exploded = true;
  e.alive = false;
  e.obj.visible = false;
  fx.explosion(e.pos, 1.3);
  sfx.boom(1, true);
  cam.shake = 1.3;
  send({ t: 'crash' });
  showCenter(kind === 'sea' ? '바다에 추락' : '지형 충돌', 'bad', 2000);
}

function computeLock() {
  const e = ents.get(S.slot);
  let best = -1, bestScore = 1e9;
  for (const o of ents.values()) {
    if (o.slot === S.slot || !o.alive || o.inv) continue;
    tmp.copy(o.pos).sub(e.pos);
    const d = tmp.length();
    if (d > CFG.MS_LOCK_DIST || d < 1) continue;
    const ang = tmp.divideScalar(d).angleTo(e.fwd);
    if (ang > CFG.MS_LOCK_ANGLE) continue;
    const score = ang * 2 + d / CFG.MS_LOCK_DIST;
    if (score < bestScore) { bestScore = score; best = o.slot; }
  }
  me.lockSlot = best;
  me.hasLead = false;
  const t = ents.get(best);
  if (t) {
    const d = t.pos.distanceTo(e.pos);
    const tf = d / (CFG.MG_SPEED + me.plane.speed);
    me.leadPos.copy(t.pos).addScaledVector(t.vel, tf);
    me.hasLead = d < 700;
  }
}

function updateLocal(dt, inp, now) {
  me.msCd = Math.max(0, me.msCd - dt);
  me.evCd = Math.max(0, me.evCd - dt);
  me.hornCd = Math.max(0, me.hornCd - dt);
  me.mgT -= dt;
  if (S.slot < 0) return;
  const e = ensureEnt(S.slot);
  const pro = S.settings.mode === 'pro';
  const playing = S.phase === 'playing';

  if (playing && me.alive) {
    const boost = pro && inp.boost;
    const hit = stepPlane(me.plane, { bank: inp.bank, pitch: inp.pitch, boost, assist: true }, dt);
    if (inp.evadeEdge && me.evCd <= 0) {
      me.plane.evadeT = CFG.EV_TIME;
      me.plane.evadeDir = inp.bank < -0.15 ? -1 : 1;
      me.evCd = CFG.EV_CD;
      e.evadeStart = now;
      e.evadeDir = me.plane.evadeDir;
      sfx.whoosh(1);
    }
    const p = me.plane;
    setPose(e, p.x, p.y, p.z, p.yaw, p.pitch, p.roll);
    e.firing = inp.fire;
    e.boosting = boost && p.boost > 0;
    e.evading = p.evadeT > 0;
    e.speed = p.speed;
    e.alive = true;

    computeLock();
    if (inp.fire && me.mgT <= 0) {
      me.mgT = 1 / (CFG.MG_RATE * (now < me.rapidUntil ? CFG.RAPID_MULT : 1));
      fireGun();
    }
    if (inp.missileEdge && me.msCd <= 0) fireMissile();
    if (!pro && inp.b4Edge && me.hornCd <= 0) doHorn();
    if (pro && inp.ultEdge && me.ult >= 100) doUlt();
    if (hit) { crash(hit); return; }

    me.sendT -= dt;
    if (me.sendT <= 0) {
      me.sendT = 1 / 30;
      send({
        t: 'st', x: r2(p.x), y: r2(p.y), z: r2(p.z), yaw: r2(p.yaw), pitch: r2(p.pitch), roll: r2(p.roll),
        f: e.firing ? 1 : 0, e: e.evading ? 1 : 0, b: e.boosting ? 1 : 0,
      });
    }
  } else if (S.phase === 'countdown' && me.alive) {
    const p = me.plane;
    p.roll += (inp.bank * CFG.MAX_ROLL * 0.4 - p.roll) * Math.min(1, dt * 4);
    setPose(e, p.x, p.y, p.z, p.yaw, p.pitch, p.roll);
    e.alive = true;
    me.lockSlot = -1;
  } else {
    me.lockSlot = -1;
    me.hasLead = false;
  }
}

// ---------- 다른 비행기 ----------
const sampleOut = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };
function sampleBuf(buf, t) {
  const n = buf.length;
  if (n === 1 || t <= buf[0].t) return buf[0];
  for (let i = n - 2; i >= 0; i--) {
    const a = buf[i], b = buf[i + 1];
    if (t >= a.t) {
      if (t >= b.t) return b;
      const k = (t - a.t) / (b.t - a.t || 1);
      sampleOut.x = a.x + (b.x - a.x) * k;
      sampleOut.y = a.y + (b.y - a.y) * k;
      sampleOut.z = a.z + (b.z - a.z) * k;
      sampleOut.yaw = a.yaw + wrapAngle(b.yaw - a.yaw) * k;
      sampleOut.pitch = a.pitch + (b.pitch - a.pitch) * k;
      sampleOut.roll = a.roll + (b.roll - a.roll) * k;
      return sampleOut;
    }
  }
  return buf[n - 1];
}

function updateEnts(dt, now) {
  const rt = now - 100;
  for (const e of ents.values()) {
    const isMe = e.slot === S.slot;
    if (!isMe) {
      if (!e.alive || e.buf.length === 0 || S.phase === 'lobby') {
        e.obj.visible = false;
        e.tag.visible = false;
        continue;
      }
      const s = sampleBuf(e.buf, rt);
      setPose(e, s.x, s.y, s.z, s.yaw, s.pitch, s.roll);
      if (e.firing && S.phase === 'playing') {
        e.fireAcc -= dt;
        if (e.fireAcc <= 0) {
          e.fireAcc = 1 / (e.human ? CFG.MG_RATE : CFG.BOT_FIRE_RATE);
          tmp.copy(e.pos).addScaledVector(e.fwd, 7);
          tmp3.copy(e.fwd).multiplyScalar(CFG.MG_SPEED + CFG.SPEED);
          fx.addBullet(tmp, tmp3, false, e.slot);
          sfx.mg(volAt(e.pos) * 0.7);
        }
      } else {
        e.fireAcc = 0;
      }
    } else if (!me.alive || !(S.phase === 'playing' || S.phase === 'countdown')) {
      e.obj.visible = false;
      e.tag.visible = false;
      continue;
    }

    e.obj.visible = true;
    const ud = e.obj.userData;
    ud.prop.rotation.z += dt * 45;
    ud.flame.visible = e.boosting;
    if (e.boosting) ud.flame.scale.set(1, 1, 0.8 + Math.random() * 0.4);
    ud.shield.visible = e.inv && S.phase === 'playing';
    if (ud.shield.visible) ud.shield.material.opacity = 0.12 + Math.sin(now / 90) * 0.05;
    const ep = (now - e.evadeStart) / (CFG.EV_TIME * 1000);
    ud.body.rotation.z = e.evading && ep < 1 ? -ep * Math.PI * 2 * e.evadeDir : 0;

    // 급선회·부스터 때 날개 끝 비행운
    if (S.phase === 'playing' && (Math.abs(e.roll) > 0.7 || e.boosting)) {
      e.trailT -= dt;
      if (e.trailT <= 0) {
        e.trailT = 0.03;
        e.obj.updateMatrixWorld();
        for (const sx of [-6.2, 6.2]) {
          tmp.set(sx, -0.35, 1).applyMatrix4(e.obj.matrixWorld);
          fx.puff(tmp, { color: 0xffffff, life: 0.9, s0: 0.7, s1: 2.2, opacity: 0.32 });
        }
      }
    }

    if (e.hp < 40 && S.phase === 'playing') {
      e.smokeT -= dt;
      if (e.smokeT <= 0) {
        e.smokeT = e.hp < 20 ? 0.04 : 0.08;
        tmp.copy(e.pos).addScaledVector(e.fwd, 3);
        fx.puff(tmp, { color: 0x2a2624, life: 1.6, s0: 2, s1: 9, opacity: 0.6 });
        if (e.hp < 20) fx.puff(tmp, { color: 0xff7a2a, add: true, life: 0.2, s0: 2.5, s1: 1, opacity: 1 });
      }
    }

    if (!isMe && !TV) {
      e.tag.visible = true;
      e.tag.position.set(e.pos.x, e.pos.y + 6, e.pos.z);
      setTagText(e.tag, e.name, e.hp);
    } else if (TV) {
      e.tag.visible = true;
      e.tag.position.set(e.pos.x, e.pos.y + 6, e.pos.z);
      setTagText(e.tag, e.name, e.hp);
    } else {
      e.tag.visible = false;
    }
  }
}

// ---------- 이펙트 연결 ----------
const fxCtx = {
  bulletHit(a, b, owner) {
    if (owner !== S.slot) return false;
    const r = S.settings.mode === 'easy' ? CFG.HIT_R_EASY : CFG.HIT_R;
    for (const e of ents.values()) {
      if (e.slot === S.slot || !e.alive || e.inv || e.evading) continue;
      if (segSphere(a.x, a.y, a.z, b.x, b.y, b.z, e.pos.x, e.pos.y, e.pos.z, r)) {
        send({ t: 'hit', target: e.slot, dmg: CFG.MG_DMG, w: 'mg' });
        fx.spark(b);
        return true;
      }
    }
    return false;
  },
  target(slot) {
    const e = ents.get(slot);
    if (!e || !e.alive) return null;
    return { pos: e.pos, evading: e.evading || e.inv };
  },
  enemiesOf(owner) {
    const out = [];
    for (const e of ents.values()) {
      if (e.slot !== owner && e.alive && !e.inv) out.push({ slot: e.slot, pos: e.pos, evading: e.evading });
    }
    return out;
  },
  missileHit(m, slot) {
    send({ t: 'hit', target: slot, dmg: CFG.MS_DMG, w: 'ms' });
  },
  missileEnd(m) {
    send({ t: 'fx', kind: 'msx', id: m.id });
    sfx.boom(volAt(m.pos) * 0.7);
  },
};

// ---------- 카메라 ----------
const cam = { pos: new THREE.Vector3(0, 300, 0), shake: 0, fov: 68, snap: true, follow: -1, followT: 0, demoInit: false };

function chase(e, dt, back, up, c = camera, st = cam) {
  tmp.copy(e.pos).addScaledVector(e.fwd, -back);
  tmp.y += up;
  const k = st.snap ? 1 : 1 - Math.exp(-dt * 6);
  st.pos.lerp(tmp, k);
  if (st.pos.y < 4) st.pos.y = 4;
  c.position.copy(st.pos);
  tmp2.set(0, 1, 0).applyQuaternion(e.obj.quaternion).multiplyScalar(0.35).add(UP).normalize();
  c.up.lerp(tmp2, k).normalize();
  tmp3.copy(e.pos).addScaledVector(e.fwd, 40);
  c.lookAt(tmp3);
  st.snap = false;
}

// ---------- TV 4분할 ----------
const tvCams = [0, 1, 2, 3].map(() => new THREE.PerspectiveCamera(66, 1, 0.5, 14000));
const tvActive = () => TV && (S.phase === 'countdown' || S.phase === 'playing');

function renderTV(dt, now) {
  const w = innerWidth, h = innerHeight;
  const hw = Math.floor(w / 2), hh = Math.floor(h / 2);
  renderer.setScissorTest(true);
  for (let i = 0; i < 4; i++) {
    const c = tvCams[i];
    const asp = hw / hh;
    if (Math.abs(c.aspect - asp) > 1e-3) { c.aspect = asp; c.updateProjectionMatrix(); }
    const e = ents.get(i);
    if (e && e.alive && e.buf.length) {
      chase(e, dt, 30, 9, c, e.tv);
    } else if (e && e.deathPos) {
      const a = (now - (e.deathAt || 0)) / 4000;
      c.position.set(e.deathPos.x + Math.cos(a) * 80, Math.max(12, e.deathPos.y + 35), e.deathPos.z + Math.sin(a) * 80);
      c.up.copy(UP);
      c.lookAt(e.deathPos);
      e.tv.snap = true;
    } else {
      const a = now / 20000 + i * 1.6;
      c.position.set(Math.cos(a) * 1500, 420, Math.sin(a) * 1500);
      c.up.copy(UP);
      c.lookAt(0, 120, 0);
    }
    world.update(0, simT, c);
    const x = (i % 2) * hw;
    const y = i < 2 ? h - hh : 0;
    renderer.setViewport(x, y, hw, hh);
    renderer.setScissor(x, y, hw, hh);
    renderer.render(scene, c);
  }
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, w, h);
}

function updateCamera(dt, now) {
  let fovTarget = 68;
  const active = S.phase === 'countdown' || S.phase === 'playing';
  if (!TV && S.slot >= 0 && active) {
    const e = ents.get(S.slot);
    if (me.alive && e) {
      chase(e, dt, 26, 7);
      fovTarget = 66 + (me.plane.speed - CFG.SPEED) * 0.14;
    } else {
      const a = (now - me.deathAt) / 4000;
      tmp.set(me.deathPos.x + Math.cos(a) * 70, Math.max(10, me.deathPos.y + 30), me.deathPos.z + Math.sin(a) * 70);
      cam.pos.lerp(tmp, 1 - Math.exp(-dt * 2));
      camera.position.copy(cam.pos);
      camera.up.copy(UP);
      camera.lookAt(me.deathPos);
    }
  } else if (TV && active) {
    // 4분할은 renderTV에서 그림. 메인 카메라는 소리 기준용으로 경기장 위에 둠
    camera.position.set(0, 600, 0);
    camera.lookAt(0, 0, 1);
    cam.snap = true;
  } else {
    demoCam(dt, now);
  }

  if (cam.shake > 0) {
    const s = cam.shake * 0.6;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
    cam.shake = Math.max(0, cam.shake - dt * 2.5);
  }
  cam.fov += (fovTarget - cam.fov) * Math.min(1, dt * 3);
  if (Math.abs(camera.fov - cam.fov) > 0.05) {
    camera.fov = cam.fov;
    camera.updateProjectionMatrix();
  }
}

// 로비/결과 화면의 배경 비행
const VIEW = params.has('view') ? params.get('view').split(',').map(Number) : null; // 맵 확인용 고정 카메라
function demoCam(dt, now) {
  if (VIEW && VIEW.length === 6) {
    camera.position.set(VIEW[0], VIEW[1], VIEW[2]);
    camera.up.copy(UP);
    camera.lookAt(VIEW[3], VIEW[4], VIEW[5]);
    return;
  }
  const slot = S.slot >= 0 ? S.slot : 0;
  if (!demo.obj || demo.obj.userData.slot !== slot) {
    if (demo.obj) scene.remove(demo.obj);
    demo.obj = buildPlane(COLORS[slot]);
    demo.obj.userData.slot = slot;
    scene.add(demo.obj);
    demo.plane = newPlane();
    demo.plane.y = 180;
    demo.plane.x = 300;
    cam.snap = true;
  }
  const show = !(S.phase === 'countdown' || S.phase === 'playing') || TV;
  demo.obj.visible = show && !(S.phase === 'countdown' || S.phase === 'playing');
  if (!demo.obj.visible) {
    camera.position.set(0, 400, 1200);
    camera.lookAt(0, 150, 0);
    return;
  }
  const p = demo.plane;
  const t = now / 1000;
  stepPlane(p, { bank: 0.32 + Math.sin(t * 0.3) * 0.12, pitch: Math.sin(t * 0.45) * 0.25 + (180 - p.y) / 200, assist: true }, dt);
  demo.obj.position.set(p.x, p.y, p.z);
  demo.obj.rotation.set(-p.pitch, p.yaw, p.roll, 'YXZ');
  demo.obj.userData.prop.rotation.z += dt * 45;
  const f = forwardOf(p);
  const rx = -Math.cos(p.yaw), rz = Math.sin(p.yaw);
  const side = Math.sin(t * 0.15) * 30;
  tmp.set(p.x - f.x * 34 + rx * side, p.y + 8, p.z - f.z * 34 + rz * side);
  const k = cam.snap ? 1 : 1 - Math.exp(-dt * 3);
  cam.pos.lerp(tmp, k);
  cam.snap = false;
  camera.position.copy(cam.pos);
  camera.up.copy(UP);
  camera.lookAt(p.x + f.x * 30, p.y + 2, p.z + f.z * 30);
}

// ---------- HUD ----------
const W = () => innerWidth;
const H = () => innerHeight;
const indicators = [];
for (let i = 0; i < 4; i++) {
  const d = document.createElement('div');
  d.className = 'ind';
  d.style.display = 'none';
  $('indicators').appendChild(d);
  indicators.push(d);
}

function toScreen(v, out) {
  tmp.copy(v).project(camera);
  out.x = (tmp.x + 1) / 2 * W();
  out.y = (1 - tmp.y) / 2 * H();
  out.z = tmp.z;
  out.nx = tmp.x;
  out.ny = tmp.y;
  return out;
}
const scr = { x: 0, y: 0, z: 0, nx: 0, ny: 0 };
let hudTextT = 0;
let centerTimer = 0;

function showCenter(text, cls, ms) {
  const c = $('center');
  c.textContent = text;
  c.className = `show ${cls || ''}`;
  clearTimeout(centerTimer);
  centerTimer = setTimeout(() => { c.className = ''; }, ms);
}
function addFeed(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  const feed = $('feed');
  feed.prepend(d);
  while (feed.children.length > 5) feed.lastChild.remove();
  setTimeout(() => d.remove(), 6000);
}
function hitMarker() {
  const h = $('hitmark');
  h.classList.remove('show');
  void h.offsetWidth;
  h.classList.add('show');
}
function flashVignette() {
  const v = $('vignette');
  v.style.opacity = '0.8';
  setTimeout(() => { v.style.opacity = '0'; }, 150);
}
const fmt = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function updateHUD(now, dt) {
  const active = S.phase === 'countdown' || S.phase === 'playing';
  if (!active) return;
  const left = S.endsAt - now;

  if (S.phase === 'countdown') {
    const n = Math.ceil(left / 1000);
    if (n !== S.lastCount && n > 0) { S.lastCount = n; sfx.beep(660, 0.15); }
    $('bigcount').textContent = n > 0 ? n : '';
  } else if (left > 5000 || left <= 0) {
    $('bigcount').textContent = '';
  }

  const e = S.slot >= 0 ? ents.get(S.slot) : null;
  const playingAlive = S.phase === 'playing' && me.alive && e && !TV;

  // 조준점 / 록온 / 화면 밖 표시
  const ch = $('crosshair');
  const lock = $('lock');
  if (playingAlive) {
    tmp2.copy(e.pos).addScaledVector(e.fwd, 300);
    toScreen(tmp2, scr);
    ch.style.display = '';
    ch.style.transform = `translate(${scr.x}px, ${scr.y}px)`;
    const t = ents.get(me.lockSlot);
    if (t) {
      toScreen(t.pos, scr);
      lock.classList.remove('hidden');
      lock.classList.toggle('ready', me.msCd <= 0);
      lock.style.transform = `translate(${scr.x}px, ${scr.y}px)`;
    } else lock.classList.add('hidden');
  } else {
    ch.style.display = 'none';
    lock.classList.add('hidden');
  }
  const leadEl = $('lead');
  if (playingAlive && me.hasLead) {
    toScreen(me.leadPos, scr);
    leadEl.style.display = scr.z < 1 ? 'block' : 'none';
    leadEl.style.transform = `translate(${scr.x}px, ${scr.y}px) rotate(45deg)`;
  } else {
    leadEl.style.display = 'none';
  }

  // 마지막 30초 / 10초
  if (S.phase === 'playing') {
    if (left < 30000 && !S.announced30) {
      S.announced30 = true;
      showCenter('30초 남음', 'good', 1500);
      sfx.alert();
    }
    const n = Math.ceil(left / 1000);
    if (n <= 10 && n > 0 && n !== S.lastTen) {
      S.lastTen = n;
      sfx.beep(n <= 3 ? 990 : 770, 0.12);
      if (n <= 5) $('bigcount').textContent = n;
    }
  }

  let ii = 0;
  if (!TV && S.phase === 'playing') {
    for (const o of ents.values()) {
      if (o.slot === S.slot || !o.alive || ii >= 4) continue;
      toScreen(o.pos, scr);
      let x = scr.nx, y = scr.ny;
      const behind = scr.z > 1;
      if (!behind && Math.abs(x) < 0.93 && Math.abs(y) < 0.9) continue;
      if (behind) { x = -x; y = -y; }
      const a = Math.atan2(y, x);
      const px = (Math.cos(a) * 0.92 + 1) / 2 * W();
      const py = (1 - Math.sin(a) * 0.86) / 2 * H();
      const d = indicators[ii++];
      d.style.display = '';
      d.style.borderLeftColor = COLOR_CSS[o.slot];
      d.style.transform = `translate(${px}px, ${py}px) rotate(${-a}rad)`;
    }
  }
  for (; ii < 4; ii++) indicators[ii].style.display = 'none';

  // 미사일 경보
  let warnDist = Infinity;
  const myPos = _warnV.set(me.plane.x, me.plane.y, me.plane.z);
  const lockedNow = new Set();
  if (me.alive) {
    for (const m of fx.missiles.values()) {
      if (m.target === S.slot && m.owner !== S.slot) {
        lockedNow.add(m.id);
        warnDist = Math.min(warnDist, m.pos.distanceTo(myPos));
      }
    }
  }
  // 나를 쫓던 미사일이 아직 날아가는데 목표를 놓쳤으면 = 따돌림 성공
  for (const id of me.lockedMs || []) {
    const m = fx.missiles.get(id);
    if (m && m.target !== S.slot && me.alive) { showCenter('회피 성공', 'good', 1000); sfx.pickup(0.7); }
  }
  me.lockedMs = lockedNow;
  const warned = warnDist < Infinity;
  $('warn').classList.toggle('hidden', !warned);
  if (warned) {
    const close = warnDist < 320;
    $('warn').innerHTML = close
      ? `미사일 ${Math.round(warnDist)}m · 크게 꺾기 / <i class="cap white"></i> 회피`
      : `미사일 추적 중 ${Math.round(warnDist)}m`;
    $('warn').classList.toggle('close', close);
    me.warnT -= dt;
    if (me.warnT <= 0) { me.warnT = clamp(warnDist / 900, 0.12, 0.5); sfx.warn(); }
  }

  // 글자는 1초에 10번만 갱신
  hudTextT -= dt;
  if (hudTextT > 0) return;
  hudTextT = 0.1;

  const timer = $('timer');
  timer.textContent = S.phase === 'countdown' ? fmt(S.settings.roundTime * 1000) : fmt(left);
  timer.classList.toggle('low', S.phase === 'playing' && left < 30000);

  const list = [...ents.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  $('board').innerHTML = list.map((o) => `<li class="${o.slot === S.slot ? 'me' : ''} ${o.alive ? '' : 'dead'}">
    <i class="dot" style="background:${COLOR_CSS[o.slot]}"></i><span class="n">${esc(o.name)}${o.human ? '' : ' (AI)'}</span>
    <b>${o.kills}</b><small>/ ${o.deaths}</small></li>`).join('');

  // 1위 변동
  let leader = -1;
  if (list[0] && list[0].kills > 0 && (!list[1] || list[0].kills > list[1].kills)) leader = list[0].slot;
  if (leader !== S.leader && S.phase === 'playing') {
    const L = ents.get(leader);
    if (TV) { if (L) addFeed(`${pName(L)} 1위`); }
    else if (leader === S.slot) showCenter('1위', 'good', 1200);
    else if (S.leader === S.slot) showCenter('1위 뺏김', 'bad', 1200);
  }
  S.leader = leader;

  if (TV) {
    for (let i = 0; i < 4; i++) {
      const el = $(`tvl${i}`);
      const o = ents.get(i);
      if (!o) { el.innerHTML = `<span class="st">빈 자리</span>`; el.style.borderLeftColor = COLOR_CSS[i]; el.classList.remove('lead'); continue; }
      const st = o.alive ? '' : `<span class="st">격추됨 · 부활 대기</span>`;
      el.style.borderLeftColor = COLOR_CSS[i];
      el.classList.toggle('lead', o.slot === leader);
      el.innerHTML = `<span style="color:${COLOR_CSS[i]}">${esc(o.name)}${o.human ? '' : ' (AI)'}</span>
        <span class="k">${o.kills}</span><span class="hp"><i style="width:${o.alive ? o.hp : 0}%;background:${COLOR_CSS[i]}"></i></span>${st}`;
    }
    return;
  }

  const buffs = [];
  if (now < me.rapidUntil) buffs.push(`연사 ${Math.ceil((me.rapidUntil - now) / 1000)}초`);
  if (e && e.inv && me.alive) buffs.push('보호막');
  $('buffs').innerHTML = buffs.map((b) => `<span>${b}</span>`).join('');

  if (e) {
    const hp = me.alive ? e.hp : 0;
    $('hpbar').style.width = `${hp}%`;
    $('hpbar').classList.toggle('low', hp < 35);
    $('hptext').textContent = me.alive ? `HP ${hp}` : `부활까지 ${Math.max(0, Math.ceil((me.deathAt + CFG.RESPAWN * 1000 - now) / 1000))}초`;
  }
  const pro = S.settings.mode === 'pro';
  $('sk4-name').textContent = pro ? '부스터' : '경적';
  $('sk-ms').querySelector('.cd').style.height = `${(me.msCd / CFG.MS_CD) * 100}%`;
  $('sk-ev').querySelector('.cd').style.height = `${(me.evCd / CFG.EV_CD) * 100}%`;
  $('sk-4').querySelector('.cd').style.height = pro ? `${100 - me.plane.boost}%` : '0%';
  $('sk-fire').classList.toggle('active', !!(e && e.firing));
  $('ultwrap').classList.toggle('hidden', !pro);
  $('ultbar').style.width = `${me.ult}%`;
  $('ultwrap').classList.toggle('full', me.ult >= 100);
  $('ulttext').textContent = me.ult >= 100 ? '필살기 준비! 컨트롤러를 흔드세요' : `필살기 ${Math.floor(me.ult)}%`;

  const live = IN.isLive();
  const st = [];
  st.push(live ? '컨트롤러' : '키보드');
  if (me.alive) st.push(`속도 ${Math.round(me.plane.speed * 3.6)} km/h`, `고도 ${Math.round(me.plane.y)} m`);
  if (me.plane.outside && me.alive) st.push('경기장 밖');
  $('status').textContent = st.join(' · ');
}

// ---------- 레이더 ----------
const radarCtx = $('radar').getContext('2d');
function drawRadar() {
  const c = radarCtx;
  c.clearRect(0, 0, 200, 200);
  if (!(S.phase === 'countdown' || S.phase === 'playing')) return;
  const R = 96, cx = 100, cy = 100;
  let ox = 0, oz = 0, yaw = 0, range = 1500;
  const myE = S.slot >= 0 ? ents.get(S.slot) : null;
  if (!TV) {
    if (!myE) return;
    if (me.alive) { ox = myE.pos.x; oz = myE.pos.z; yaw = myE.yaw; } else { ox = me.deathPos.x; oz = me.deathPos.z; yaw = myE.yaw; }
    range = 1200;
  }
  const sc = R / range;
  const fx_ = Math.sin(yaw), fz = Math.cos(yaw), rx = -Math.cos(yaw), rz = Math.sin(yaw);
  const P = (x, z, clampEdge) => {
    const dx = x - ox, dz = z - oz;
    let sx = (dx * rx + dz * rz) * sc, sy = (dx * fx_ + dz * fz) * sc;
    const d = Math.hypot(sx, sy);
    let edge = false;
    if (clampEdge && d > R - 6) { sx *= (R - 6) / d; sy *= (R - 6) / d; edge = true; }
    return [cx + sx, cy - sy, edge];
  };

  c.save();
  c.beginPath();
  c.arc(cx, cy, R, 0, Math.PI * 2);
  c.fillStyle = 'rgba(12,8,18,0.62)';
  c.fill();
  c.lineWidth = 2;
  c.strokeStyle = 'rgba(255,200,160,0.35)';
  c.stroke();
  c.clip();
  c.strokeStyle = 'rgba(255,200,160,0.12)';
  c.lineWidth = 1;
  c.beginPath(); c.arc(cx, cy, R / 2, 0, Math.PI * 2); c.stroke();

  // 경기장 경계
  const [ax, ay] = P(0, 0, false);
  c.beginPath();
  c.arc(ax, ay, CFG.ARENA_R * sc, 0, Math.PI * 2);
  c.strokeStyle = 'rgba(255,120,80,0.6)';
  c.setLineDash([4, 4]);
  c.stroke();
  c.setLineDash([]);

  // 섬
  c.fillStyle = 'rgba(150,115,80,0.55)';
  for (const isl of ISLANDS) {
    const [x, y] = P(isl.x, isl.z, false);
    c.beginPath(); c.arc(x, y, Math.max(2, isl.r * sc * 0.8), 0, Math.PI * 2); c.fill();
  }
  for (const s of STACKS) {
    const [x, y] = P(s.x, s.z, false);
    c.beginPath(); c.arc(x, y, 1.5, 0, Math.PI * 2); c.fill();
  }
  c.strokeStyle = 'rgba(190,150,110,0.8)';
  c.lineWidth = 3;
  for (const a of ARCHES) {
    const [x1, y1] = P(a.p1.x, a.p1.z, false);
    const [x2, y2] = P(a.p2.x, a.p2.z, false);
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
  }

  // 아이템
  for (const it of items.map.values()) {
    const [x, y, edge] = P(it.x, it.z, true);
    c.fillStyle = ITEM_INFO[it.kind].css;
    c.globalAlpha = edge ? 0.5 : 1;
    c.beginPath(); c.arc(x, y, 4, 0, Math.PI * 2); c.fill();
  }
  c.globalAlpha = 1;

  // 나를 노리는 미사일
  c.fillStyle = '#ff3030';
  for (const m of fx.missiles.values()) {
    if (!TV && m.target !== S.slot) continue;
    const [x, y] = P(m.pos.x, m.pos.z, true);
    c.beginPath(); c.arc(x, y, 2.5, 0, Math.PI * 2); c.fill();
  }

  // 비행기
  const tri = (x, y, rot, color, size, alpha) => {
    c.save();
    c.translate(x, y);
    c.rotate(rot);
    c.globalAlpha = alpha;
    c.fillStyle = color;
    c.strokeStyle = 'rgba(0,0,0,0.6)';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(0, -size); c.lineTo(size * 0.7, size * 0.8); c.lineTo(-size * 0.7, size * 0.8);
    c.closePath();
    c.fill(); c.stroke();
    c.restore();
  };
  for (const o of ents.values()) {
    if (!o.alive || (!TV && o.slot === S.slot)) continue;
    const [x, y, edge] = P(o.pos.x, o.pos.z, true);
    tri(x, y, Math.atan2(Math.sin(yaw - o.yaw), Math.cos(yaw - o.yaw)), COLOR_CSS[o.slot], TV ? 7 : 6, edge ? 0.55 : 1);
  }
  if (!TV && me.alive) tri(cx, cy, 0, '#ffffff', 7, 1);
  c.restore();
}

// ---------- 로비 ----------
function renderLobby() {
  const L = S.lobby;
  if (!L) return;
  const slotsEl = $('slots');
  slotsEl.innerHTML = L.slots.map((s, i) => {
    const mine = i === S.slot;
    const cls = ['slot', mine ? 'mine' : '', s ? (s.ready ? 'ready' : '') : 'empty'].join(' ');
    const name = s ? esc(s.name) + (mine ? ' (나)' : '') : '비어 있음';
    const st = !s ? (S.slot >= 0 ? '클릭해서 이동' : '') : !s.human ? 'AI' : s.ready ? '준비 완료' : '대기 중';
    return `<div class="${cls}" data-i="${i}"><div class="top"><i class="dot" style="background:${COLOR_CSS[i]}"></i>${name}</div><div class="st">${st}</div></div>`;
  }).join('');
  slotsEl.querySelectorAll('.slot.empty').forEach((el) => {
    el.onclick = () => send({ t: 'pick', slot: +el.dataset.i });
  });

  const mine = S.slot >= 0 ? L.slots[S.slot] : null;
  S.ready = !!(mine && mine.ready);
  const rb = $('btn-ready');
  rb.textContent = S.ready ? '준비 완료 (누르면 취소)' : '준비 완료';
  rb.classList.toggle('on', S.ready);
  rb.disabled = S.slot < 0;

  const ms = $('me-slot');
  if (S.slot >= 0) ms.innerHTML = `<i class="dot" style="background:${COLOR_CSS[S.slot]}"></i>${S.slot + 1}번 비행기 · ${COLOR_NAMES[S.slot]}`;
  else ms.textContent = '자리가 꽉 찼어요 · 관전 중';
  const nameEl = $('name');
  if (mine && document.activeElement !== nameEl) nameEl.value = mine.name;

  document.querySelectorAll('#mode button').forEach((b) => b.classList.toggle('on', b.dataset.v === L.settings.mode));
  document.querySelectorAll('#rtime button').forEach((b) => b.classList.toggle('on', +b.dataset.v === L.settings.roundTime));
  $('bots').checked = L.settings.bots;

  const lb = L.leaderboard || [];
  $('rank').innerHTML = lb.length
    ? lb.map((r, i) => `<li><span>${i + 1}. ${esc(r.name)}</span><b>${r.kills}격추 <small>/ ${r.deaths}</small></b></li>`).join('')
    : '<li class="empty">아직 기록이 없어요. 첫 번째 주인공이 되어 보세요!</li>';
}

function renderResults() {
  const R = S.results;
  if (!R) return;
  const medals = [];
  const top = R.ranking[0];
  const iWon = top && top.slot === S.slot && top.kills > 0;
  const tie = R.ranking[1] && top && R.ranking[1].kills === top.kills && R.ranking[1].deaths === top.deaths;
  const maxBy = (k) => R.ranking.reduce((a, b) => ((b[k] || 0) > (a ? a[k] || 0 : 0) ? b : a), null);
  const dmgKing = maxBy('dmg');
  const streakKing = maxBy('best');
  const tough = R.ranking.reduce((a, b) => (!a || b.deaths < a.deaths ? b : a), null);
  const award = (title, r, val) => (r ? `<div>${title}<b style="color:${COLOR_CSS[r.slot]}">${esc(r.name)}</b><small>${val}</small></div>` : '');
  $('results').innerHTML = `
    <h1>라운드 종료</h1>
    ${top ? `<div class="win">${tie ? '공동 1위' : `${esc(top.name)} 우승`}</div>` : ''}
    <ol>${R.ranking.map((r, i) => `<li class="${r.slot === S.slot ? 'me' : ''}">
      <span class="m">${medals[i] || i + 1}</span><i class="dot" style="background:${COLOR_CSS[r.slot]}"></i>
      <span class="n">${esc(r.name)}${r.human ? '' : ' (AI)'}</span><b>${r.kills}격추</b><small>${r.deaths}번 격추됨</small>
      <span class="dmg">피해 ${r.dmg || 0}</span></li>`).join('')}</ol>
    <div class="awards">
      ${dmgKing && dmgKing.dmg > 0 ? award('최다 피해', dmgKing, `${dmgKing.dmg}`) : ''}
      ${streakKing && streakKing.best >= 2 ? award('최다 연속 격추', streakKing, `${streakKing.best}연속`) : ''}
      ${tough ? award('불사조', tough, `${tough.deaths}번만 격추됨`) : ''}
    </div>
    <p>잠시 후 로비로 돌아가요</p>`;
  if (S.phase === 'results' && iWon) sfx.fanfare();
}

// 로비 버튼들
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
// 게임 고르기 카드 (파티 게임 화면과 같은 모양)
$('games').innerHTML = [['dogfight', { name: '노을 공중전', desc: '기울여 조종하는 비행 대전', time: '1~5분' }], ...Object.entries(GAMES)]
  .map(([k, g], i) => `<button class="gcard ${k === 'dogfight' ? 'on' : ''}" data-g="${k}"><span class="gi">${String(i + 1).padStart(2, '0')}</span><b>${g.name}</b><small>${g.desc}</small><em>${g.time}</em></button>`).join('');
$('games').querySelectorAll('.gcard').forEach((el) => {
  el.onclick = () => { if (el.dataset.g !== 'dogfight') send({ t: 'goto', to: 'party', game: el.dataset.g }); };
});
$('bots').onchange = (e) => send({ t: 'settings', bots: e.target.checked });
document.querySelectorAll('#mode button').forEach((b) => { b.onclick = () => send({ t: 'settings', mode: b.dataset.v }); });
document.querySelectorAll('#rtime button').forEach((b) => { b.onclick = () => send({ t: 'settings', roundTime: +b.dataset.v }); });
$('invert').checked = IN.ctrl.invert;
$('invert').onchange = (e) => IN.setInvert(e.target.checked);
$('btn-serial').onclick = async () => {
  sfx.unlock();
  if (!IN.ctrl.supported) {
    $('help-origin').textContent = location.origin;
    $('help').classList.remove('hidden');
    return;
  }
  try { await IN.connectSerial(); } catch { /* 사용자가 취소 */ }
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

// ---------- 기울기 보정 창 ----------
const calib = { open: false, step: 0 };
const CALIB_TEXT = [
  '컨트롤러를 평평하게 든 채로 아무 버튼이나 누르세요',
  '오른쪽으로 크게 기울인 채로 버튼을 누르세요 ↘',
  '앞쪽(화면 쪽)으로 숙인 채로 버튼을 누르세요 ⤵',
];
function openCalib() {
  calib.open = true;
  calib.step = 0;
  $('calib').classList.remove('hidden');
  renderCalib('');
}
function renderCalib(msg) {
  $('calib-steps').innerHTML = [0, 1, 2].map((i) => `<i class="${i <= calib.step ? 'on' : ''}"></i>`).join('');
  $('calib-text').textContent = IN.isLive() ? CALIB_TEXT[calib.step] : '컨트롤러를 먼저 연결해 주세요';
  $('calib-msg').textContent = msg || '';
}
$('calib-cancel').onclick = () => { calib.open = false; $('calib').classList.add('hidden'); };
IN.ctrl.onConnect = () => {
  if (!IN.ctrl.cal) setTimeout(openCalib, 400);
};

function handleUiInput(inp) {
  if (inp.enterEdge || inp.ctrlAnyEdge) sfx.unlock();
  if (calib.open) {
    if (inp.ctrlAnyEdge) {
      const r = IN.calibCapture(calib.step);
      if (r.ok) {
        sfx.beep(880, 0.1);
        if (r.done) {
          calib.open = false;
          $('calib').classList.add('hidden');
          showCenter('기울기 설정 완료', 'good', 1500);
        } else {
          calib.step++;
          renderCalib('');
        }
      } else {
        renderCalib(r.msg);
      }
    }
    const raw = IN.ctrl.raw;
    const t = IN.ctrl.cal ? IN.tiltDeg() : { bank: raw.r, fwd: raw.p };
    $('calib-dot').style.transform = `translate(${clamp(t.bank, -60, 60) * 1.2}px, ${clamp(t.fwd, -60, 60) * 1.2}px)`;
    return;
  }
  if (S.phase === 'lobby' && !TV) {
    if (inp.enterEdge && document.activeElement !== $('name')) send({ t: 'ready', v: !S.ready });
    if (inp.ctrlAnyEdge && !S.ready) send({ t: 'ready', v: true });
  }
}

addEventListener('pointerdown', () => sfx.unlock());
addEventListener('keydown', () => sfx.unlock());

// ---------- 메인 루프 ----------
let lastT = performance.now();
let simT = 0;
let statusT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  simT += dt;

  const inp = IN.poll(dt);
  handleUiInput(inp);
  updateLocal(dt, inp, now);
  updateEnts(dt, now);
  fx.update(dt, fxCtx);
  updateCamera(dt, now);
  world.update(dt, simT, camera);
  updateHUD(now, dt);
  sfx.engine(me.alive && S.phase === 'playing' ? me.plane.speed : 0, me.plane.boost < CFG.BOOST_MAX && ents.get(S.slot)?.boosting);

  items.update(dt, simT);
  drawRadar();

  statusT -= dt;
  if (statusT <= 0) { statusT = 0.3; updateCtrlStatus(); }

  if (tvActive()) renderTV(dt, now);
  else renderer.render(scene, camera);
}

IN.autoConnect();
connect();
requestAnimationFrame(frame);
