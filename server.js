// 노을 공중전 게임 서버
// - 게임 파일(웹페이지)을 노트북들에게 전달
// - 4명의 위치/피해/점수/라운드/AI 봇/랭킹을 관리
// 실행: npm start   (포트 변경: PORT=8080 npm start)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  CFG, SPAWNS, newPlane, stepPlane, forwardOf, wrapAngle, clamp, terrainHeight, solidAt, segSphere,
} from './shared/sim.js';
import { createParty } from './party-server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const TICK = 30;

// ---------- 정적 파일 ----------
const ROOTS = [
  ['/shared/', path.join(__dirname, 'shared')],
  ['/vendor/', path.join(__dirname, 'node_modules', 'three', 'build')],
  ['/', path.join(__dirname, 'public')],
];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400); res.end(); return;
  }
  if (urlPath === '/') urlPath = '/index.html';
  for (const [prefix, root] of ROOTS) {
    if (!urlPath.startsWith(prefix)) continue;
    const file = path.normalize(path.join(root, urlPath.slice(prefix.length)));
    if (!file.startsWith(root)) break;
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    });
    return;
  }
  res.writeHead(404); res.end('Not found');
});

// ---------- 랭킹 ----------
const DATA_DIR = path.join(__dirname, 'data');
const LB_FILE = path.join(DATA_DIR, 'leaderboard.json');
let leaderboard = [];
try { leaderboard = JSON.parse(fs.readFileSync(LB_FILE, 'utf8')); } catch { leaderboard = []; }

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function todayBoard() {
  const t = today();
  return leaderboard
    .filter((e) => e.date === t)
    .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
    .slice(0, 10);
}
function saveLeaderboard() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(LB_FILE, JSON.stringify(leaderboard));
  } catch (e) { console.error('랭킹 저장 실패:', e.message); }
}

// ---------- 게임 상태 ----------
const settings = { mode: 'easy', roundTime: CFG.ROUND, bots: true };
let phase = 'lobby';
let phaseEnd = 0;
const slots = [null, null, null, null];
const clients = new Set();
const botBullets = [];
const BOT_NAMES = ['AI 독수리', 'AI 매', 'AI 올빼미', 'AI 갈매기'];
const DEFAULT_NAMES = ['빨강 파일럿', '파랑 파일럿', '초록 파일럿', '노랑 파일럿'];

function cleanName(n, slot) {
  const s = String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 10);
  return s || DEFAULT_NAMES[slot];
}

function makeEntity(slot, human, name, ws) {
  return {
    slot, human, name, ws,
    ready: false,
    plane: newPlane(),
    hp: CFG.HP, alive: false, respawnAt: 0, invUntil: 0,
    kills: 0, deaths: 0,
    dmgDealt: 0, streak: 0, bestStreak: 0, rapidUntil: 0,
    lastHitBy: null, lastHitAt: 0,
    firing: false, evading: false, boosting: false,
    bot: human ? null : { fireT: 0, think: 0, aimErr: 0, target: null, evadeCd: 0, msCd: 4 + Math.random() * 6 },
  };
}

// ---------- 아이템 ----------
const items = [];
const itemRespawns = [];
let itemSeq = 1;
const ITEM_KINDS = ['hp', 'rapid', 'shield'];

function randomItem() {
  for (let i = 0; i < 60; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * 1100;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const y = 130 + Math.random() * 200;
    if (terrainHeight(x, z) > y - 50 || solidAt(x, y + 20, z) || solidAt(x, y - 20, z)) continue;
    if (items.some((o) => Math.hypot(o.x - x, o.z - z) < 250)) continue;
    const kind = ITEM_KINDS[Math.floor(Math.random() * ITEM_KINDS.length)];
    return { id: itemSeq++, kind, x: Math.round(x), y: Math.round(y), z: Math.round(z) };
  }
  return null;
}
const broadcastItems = () => broadcast({ t: 'items', items });
function resetItems() {
  items.length = 0;
  itemRespawns.length = 0;
  for (let i = 0; i < CFG.ITEM_COUNT; i++) {
    const it = randomItem();
    if (it) items.push(it);
  }
  broadcastItems();
}
function applyItem(e, it, now) {
  if (it.kind === 'hp') e.hp = Math.min(CFG.HP, e.hp + CFG.ITEM_HP);
  else if (it.kind === 'shield') e.invUntil = Math.max(e.invUntil, now + CFG.SHIELD_TIME * 1000);
  else if (it.kind === 'rapid') e.rapidUntil = now + CFG.RAPID_TIME * 1000;
}
function updateItems(now) {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    for (const e of slots) {
      if (!e || !e.alive) continue;
      const p = e.plane;
      if (Math.hypot(p.x - it.x, p.y - it.y, p.z - it.z) < CFG.ITEM_R) {
        applyItem(e, it, now);
        items.splice(i, 1);
        itemRespawns.push(now + CFG.ITEM_RESPAWN * 1000);
        broadcast({ t: 'pick', id: it.id, slot: e.slot, kind: it.kind, x: it.x, y: it.y, z: it.z });
        broadcastItems();
        break;
      }
    }
  }
  for (let i = itemRespawns.length - 1; i >= 0; i--) {
    if (now < itemRespawns[i]) continue;
    itemRespawns.splice(i, 1);
    const it = randomItem();
    if (it) { items.push(it); broadcastItems(); }
  }
}

// ---------- AI 미사일 ----------
const botMissiles = [];
let bmSeq = 1;

function fireBotMissile(e, T) {
  const p = e.plane;
  const f = forwardOf(p);
  const m = {
    id: `b${e.slot}-${bmSeq++}`, owner: e.slot, target: T.slot,
    x: p.x + f.x * 6, y: p.y + f.y * 6 - 1.5, z: p.z + f.z * 6,
    dx: f.x, dy: f.y, dz: f.z, life: CFG.MS_LIFE,
  };
  botMissiles.push(m);
  broadcast({ t: 'fx', kind: 'ms', slot: e.slot, id: m.id, target: m.target, x: r2(m.x), y: r2(m.y), z: r2(m.z), dx: r2(f.x), dy: r2(f.y), dz: r2(f.z) });
}

function updateBotMissiles(dt, now) {
  for (let i = botMissiles.length - 1; i >= 0; i--) {
    const m = botMissiles[i];
    const T = m.target >= 0 ? slots[m.target] : null;
    if (T && T.alive && !T.evading && now >= T.invUntil) {
      let tx = T.plane.x - m.x, ty = T.plane.y - m.y, tz = T.plane.z - m.z;
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      const dot = clamp(m.dx * tx + m.dy * ty + m.dz * tz, -1, 1);
      const ang = Math.acos(dot);
      const maxTurn = CFG.MS_TURN * dt;
      if (ang > CFG.MS_OVERSHOOT) m.target = -1;
      else if (ang > 1e-4) {
        const k = Math.min(1, maxTurn / ang);
        const s = Math.sin(ang);
        const a = Math.sin((1 - k) * ang) / s, b = Math.sin(k * ang) / s;
        m.dx = a * m.dx + b * tx; m.dy = a * m.dy + b * ty; m.dz = a * m.dz + b * tz;
        const l = Math.hypot(m.dx, m.dy, m.dz);
        m.dx /= l; m.dy /= l; m.dz /= l;
      }
    } else {
      m.target = -1;
    }
    m.x += m.dx * CFG.MS_SPEED * dt;
    m.y += m.dy * CFG.MS_SPEED * dt;
    m.z += m.dz * CFG.MS_SPEED * dt;
    m.life -= dt;
    let end = m.life <= 0 || m.y < 1 || solidAt(m.x, m.y, m.z);
    if (!end) {
      for (const o of slots) {
        if (!o || !o.alive || o.slot === m.owner || o.evading) continue;
        if (Math.hypot(o.plane.x - m.x, o.plane.y - m.y, o.plane.z - m.z) < CFG.MS_PROX) {
          applyDamage(m.owner, o.slot, CFG.MS_DMG, 'ms');
          end = true;
          break;
        }
      }
    }
    if (end) {
      botMissiles.splice(i, 1);
      broadcast({ t: 'fx', kind: 'msx', slot: m.owner, id: m.id });
    }
  }
}
const makeBot = (slot) => makeEntity(slot, false, BOT_NAMES[slot], null);

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}
function broadcast(msg, except) {
  const s = JSON.stringify(msg);
  for (const ws of clients) if (ws !== except && ws.readyState === 1) ws.send(s);
}
function lobbyState() {
  return {
    t: 'lobby',
    phase,
    settings,
    slots: slots.map((e) => (e ? { name: e.name, human: e.human, ready: e.ready } : null)),
    leaderboard: todayBoard(),
  };
}
const pushLobby = () => broadcast(lobbyState());

function welcome(ws) {
  return { t: 'welcome', slot: ws.slot, phase, tl: Math.max(0, phaseEnd - Date.now()), settings };
}

function takeSlot(ws, slot, name) {
  const e = makeEntity(slot, true, cleanName(name, slot), ws);
  ws.slot = slot;
  slots[slot] = e;
  return e;
}

// ---------- 라운드 진행 ----------
function startCountdown() {
  if (phase !== 'lobby') return;
  phase = 'countdown';
  phaseEnd = Date.now() + CFG.COUNTDOWN * 1000;
  botBullets.length = 0;
  botMissiles.length = 0;
  firstBlood = false;
  for (let i = 0; i < 4; i++) {
    if (!slots[i] && settings.bots) slots[i] = makeBot(i);
  }
  broadcast({ t: 'phase', phase, tl: CFG.COUNTDOWN * 1000, settings });
  for (const e of slots) {
    if (!e) continue;
    e.kills = 0; e.deaths = 0;
    e.dmgDealt = 0; e.streak = 0; e.bestStreak = 0; e.rapidUntil = 0;
    spawnEntity(e, e.slot, phaseEnd + CFG.SPAWN_INV * 1000);
  }
  resetItems();
  pushLobby();
}
let firstBlood = false;

function startPlaying() {
  phase = 'playing';
  phaseEnd = Date.now() + settings.roundTime * 1000;
  broadcast({ t: 'phase', phase, tl: settings.roundTime * 1000, settings });
}

function endRound() {
  phase = 'results';
  phaseEnd = Date.now() + CFG.RESULTS * 1000;
  botBullets.length = 0;
  botMissiles.length = 0;
  items.length = 0;
  broadcastItems();
  const ranking = slots
    .filter(Boolean)
    .map((e) => ({
      slot: e.slot, name: e.name, kills: e.kills, deaths: e.deaths, human: e.human,
      dmg: Math.round(e.dmgDealt), best: e.bestStreak,
    }))
    .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  const date = today();
  for (const r of ranking) {
    if (r.human) leaderboard.push({ name: r.name, kills: r.kills, deaths: r.deaths, date });
  }
  saveLeaderboard();
  broadcast({ t: 'results', ranking, leaderboard: todayBoard() });
  broadcast({ t: 'phase', phase, tl: CFG.RESULTS * 1000, settings });
}

function toLobby() {
  phase = 'lobby';
  phaseEnd = 0;
  for (let i = 0; i < 4; i++) {
    const e = slots[i];
    if (!e) continue;
    if (!e.human) { slots[i] = null; continue; }
    e.ready = false; e.alive = false;
  }
  broadcast({ t: 'phase', phase, tl: 0, settings });
  pushLobby();
}

function checkAllReady() {
  if (phase !== 'lobby') return;
  const humans = slots.filter((e) => e && e.human);
  if (humans.length > 0 && humans.every((e) => e.ready)) startCountdown();
}

function pickSpawn(e) {
  // 살아있는 다른 비행기와 가장 먼 출발점
  let best = SPAWNS[e.slot], bestD = -1;
  for (const s of SPAWNS) {
    let minD = 1e9;
    for (const o of slots) {
      if (!o || o === e || !o.alive) continue;
      minD = Math.min(minD, Math.hypot(o.plane.x - s.x, o.plane.z - s.z));
    }
    if (minD > bestD) { bestD = minD; best = s; }
  }
  return best;
}

function spawnEntity(e, spawnIndex, invUntil) {
  const s = spawnIndex != null ? SPAWNS[spawnIndex] : pickSpawn(e);
  const p = newPlane();
  p.x = s.x; p.y = s.y; p.z = s.z; p.yaw = s.yaw;
  e.plane = p;
  e.hp = CFG.HP;
  e.alive = true;
  e.firing = false; e.evading = false; e.boosting = false;
  e.lastHitBy = null; e.lastHitAt = 0;
  e.invUntil = invUntil || Date.now() + CFG.SPAWN_INV * 1000;
  broadcast({ t: 'spawn', slot: e.slot, x: p.x, y: p.y, z: p.z, yaw: p.yaw });
}


function applyDamage(att, tgt, dmg, w) {
  if (phase !== 'playing' || !(dmg > 0)) return;
  const T = slots[tgt];
  if (!T || !T.alive) return;
  const now = Date.now();
  if (now < T.invUntil || T.evading) return;
  const A = att != null && att !== tgt ? slots[att] : null;
  if (A) A.dmgDealt += Math.min(dmg, Math.max(0, T.hp));
  T.hp -= dmg;
  T.lastHitBy = att;
  T.lastHitAt = now;
  broadcast({ t: 'dmg', slot: tgt, hp: Math.max(0, Math.round(T.hp)), by: att, w, d: dmg });
  if (T.hp <= 0) killEntity(T, att, w);
}

function killEntity(T, killer, w) {
  if (!T.alive) return;
  T.alive = false;
  T.deaths++;
  T.firing = false;
  T.respawnAt = Date.now() + CFG.RESPAWN * 1000;
  T.streak = 0;
  const K = killer != null && killer !== T.slot ? slots[killer] : null;
  let fb = false;
  if (K) {
    K.kills++;
    K.streak++;
    K.bestStreak = Math.max(K.bestStreak, K.streak);
    if (!firstBlood) { firstBlood = true; fb = true; }
  }
  broadcast({
    t: 'kill', killer: K ? killer : null, victim: T.slot, w,
    streak: K ? K.streak : 0, fb,
    x: T.plane.x, y: T.plane.y, z: T.plane.z,
  });
}

// ---------- AI 봇 ----------
function dist3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function updateBot(e, dt, now) {
  const b = e.bot;
  const p = e.plane;
  b.think -= dt;
  b.evadeCd -= dt;
  if (b.think <= 0) {
    b.think = 0.3 + Math.random() * 0.3;
    let best = null, bestScore = 1e9;
    for (const o of slots) {
      if (!o || o === e || !o.alive) continue;
      const score = dist3(p, o.plane) - (o.human ? 200 : 0);
      if (score < bestScore) { bestScore = score; best = o; }
    }
    b.target = best;
    b.aimErr = (Math.random() - 0.5) * 0.16;
  }

  let bank = 0, pitchIn = 0, fire = false, boost = false;
  const T = b.target && b.target.alive ? b.target : null;
  b.msCd -= dt;

  // 체력이 낮으면 가까운 회복 아이템으로
  let heal = null;
  if (e.hp < 45) {
    let bd = 700;
    for (const it of items) {
      if (it.kind !== 'hp') continue;
      const d = Math.hypot(it.x - p.x, it.y - p.y, it.z - p.z);
      if (d < bd) { bd = d; heal = it; }
    }
  }

  if (heal) {
    const dx = heal.x - p.x, dy = heal.y - p.y, dz = heal.z - p.z;
    bank = clamp(-wrapAngle(Math.atan2(dx, dz) - p.yaw) * 2.5, -1, 1);
    pitchIn = clamp((Math.atan2(dy, Math.hypot(dx, dz)) - p.pitch) * 3, -1, 1);
  } else if (T) {
    const q = T.plane;
    const tf = forwardOf(q);
    const d = dist3(p, q);
    const lead = d / (CFG.MG_SPEED + p.speed);
    const tx = q.x + tf.x * q.speed * lead;
    const ty = q.y + tf.y * q.speed * lead;
    const tz = q.z + tf.z * q.speed * lead;
    const dx = tx - p.x, dy = ty - p.y, dz = tz - p.z;
    const wantYaw = Math.atan2(dx, dz) + b.aimErr;
    const wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
    const dyaw = wrapAngle(wantYaw - p.yaw);
    const dp = wantPitch - p.pitch;
    bank = clamp(-dyaw * 2.5, -1, 1);
    pitchIn = clamp(dp * 3, -1, 1);
    fire = Math.abs(dyaw) < 0.18 && Math.abs(dp) < 0.18 && d < 600 && now >= T.invUntil;
    boost = d > 700 && p.boost > 50;
    if (b.msCd <= 0 && d < CFG.MS_LOCK_DIST && d > 120 && Math.abs(dyaw) < CFG.MS_LOCK_ANGLE * 0.7
      && !botMissiles.some((q) => q.target === T.slot)
        && Math.abs(dp) < CFG.MS_LOCK_ANGLE * 0.7 && now >= T.invUntil) {
      fireBotMissile(e, T);
      b.msCd = CFG.BOT_MS_CD * (0.8 + Math.random() * 0.6);
    }
  } else {
    const wantYaw = Math.atan2(-p.x, -p.z);
    bank = clamp(-wrapAngle(wantYaw - p.yaw) * 2, -1, 1);
    pitchIn = clamp((250 - p.y) / 150, -1, 1);
  }

  // 바다/섬 피하기
  const f = forwardOf(p);
  let danger = p.y < 90;
  for (const dist of [60, 120, 180]) {
    const ax = p.x + f.x * dist, ay = p.y + f.y * dist, az = p.z + f.z * dist;
    if (terrainHeight(ax, az) > ay - 40 || solidAt(ax, ay, az)) { danger = true; break; }
  }
  if (danger) pitchIn = 1;
  if (p.y > CFG.CEIL - 40) pitchIn = Math.min(pitchIn, -0.5);

  // 맞으면 가끔 회피
  if (now - e.lastHitAt < 200 && b.evadeCd <= 0 && Math.random() < 0.35) {
    p.evadeT = CFG.EV_TIME;
    p.evadeDir = Math.random() < 0.5 ? -1 : 1;
    b.evadeCd = CFG.EV_CD * 1.5;
  }

  const hit = stepPlane(p, { bank, pitch: pitchIn, boost: settings.mode === 'pro' && boost, assist: true }, dt);
  e.firing = fire;
  e.boosting = settings.mode === 'pro' && boost && p.boost > 0;
  e.evading = p.evadeT > 0;
  if (hit) { killEntity(e, null, 'crash'); return; }

  if (fire) {
    b.fireT -= dt;
    while (b.fireT <= 0) {
      b.fireT += 1 / (CFG.BOT_FIRE_RATE * (now < e.rapidUntil ? CFG.RAPID_MULT : 1));
      spawnBotBullet(e);
    }
  } else {
    b.fireT = 0;
  }
}

function spawnBotBullet(e) {
  const p = e.plane;
  const f = forwardOf(p);
  const s = CFG.BOT_SPREAD;
  let dx = f.x + (Math.random() - 0.5) * s;
  let dy = f.y + (Math.random() - 0.5) * s;
  let dz = f.z + (Math.random() - 0.5) * s;
  const l = Math.hypot(dx, dy, dz);
  dx /= l; dy /= l; dz /= l;
  const sp = CFG.MG_SPEED + p.speed;
  botBullets.push({
    owner: e.slot,
    x: p.x + f.x * 8, y: p.y + f.y * 8, z: p.z + f.z * 8,
    vx: dx * sp, vy: dy * sp, vz: dz * sp,
    life: CFG.MG_LIFE,
  });
}

function updateBotBullets(dt) {
  for (let i = botBullets.length - 1; i >= 0; i--) {
    const b = botBullets[i];
    const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt, nz = b.z + b.vz * dt;
    let hit = false;
    for (const o of slots) {
      if (!o || !o.alive || o.slot === b.owner) continue;
      const q = o.plane;
      if (segSphere(b.x, b.y, b.z, nx, ny, nz, q.x, q.y, q.z, CFG.HIT_R)) {
        applyDamage(b.owner, o.slot, CFG.BOT_DMG, 'mg');
        hit = true;
        break;
      }
    }
    b.x = nx; b.y = ny; b.z = nz;
    b.life -= dt;
    if (hit || b.life <= 0 || b.y < 0 || solidAt(b.x, b.y, b.z)) botBullets.splice(i, 1);
  }
}

// ---------- 네트워크 ----------
const wss = new WebSocketServer({ noServer: true });
// 파티 게임(스모·보트·달리기·미로)은 /party 주소로 따로 연결
const party = createParty({ dataDir: DATA_DIR, onGoto: null });
server.on('upgrade', (req, socket, head) => {
  let p = '/';
  try { p = new URL(req.url, 'http://x').pathname; } catch { /* */ }
  if (p === '/party') party.handleUpgrade(req, socket, head);
  else wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
  ws.slot = -1;
  clients.add(ws);
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m && typeof m === 'object') handle(ws, m);
  });
  ws.on('close', () => {
    clients.delete(ws);
    const s = ws.slot;
    if (s >= 0 && slots[s] && slots[s].ws === ws) {
      slots[s] = null;
      if ((phase === 'playing' || phase === 'countdown') && settings.bots) {
        slots[s] = makeBot(s);
        spawnEntity(slots[s]);
      }
      broadcast({ t: 'leave', slot: s });
      pushLobby();
      checkAllReady();
    }
  });
});

const mine = (ws) => (ws.slot >= 0 && slots[ws.slot] && slots[ws.slot].ws === ws ? slots[ws.slot] : null);
const num = (v) => (Number.isFinite(+v) ? +v : 0);
const FX_KINDS = new Set(['ms', 'msx', 'horn', 'ult']);

function handle(ws, m) {
  switch (m.t) {
    case 'hello': {
      if (ws.slot >= 0) return;
      if (!m.spectate) {
        const free = (i) => !slots[i] || !slots[i].human;
        const want = Number.isInteger(m.want) && m.want >= 0 && m.want < 4 ? m.want : -1;
        let slot = want >= 0 && free(want) ? want : -1;
        if (slot < 0) slot = [0, 1, 2, 3].find(free) ?? -1;
        if (slot >= 0) takeSlot(ws, slot, m.name);
      }
      send(ws, welcome(ws));
      send(ws, lobbyState());
      send(ws, { t: 'items', items });
      if (ws.slot >= 0 && (phase === 'playing' || phase === 'countdown')) {
        spawnEntity(slots[ws.slot], phase === 'countdown' ? ws.slot : null, phase === 'countdown' ? phaseEnd + CFG.SPAWN_INV * 1000 : 0);
      }
      pushLobby();
      break;
    }
    case 'pick': {
      if (phase !== 'lobby' || ws.slot < 0) return;
      const i = m.slot;
      if (!(Number.isInteger(i) && i >= 0 && i < 4) || slots[i]) return;
      const old = slots[ws.slot];
      slots[ws.slot] = null;
      takeSlot(ws, i, old ? old.name : m.name);
      send(ws, welcome(ws));
      pushLobby();
      break;
    }
    case 'name': {
      const e = mine(ws);
      if (e) { e.name = cleanName(m.name, e.slot); pushLobby(); }
      break;
    }
    case 'ready': {
      const e = mine(ws);
      if (e && phase === 'lobby') { e.ready = !!m.v; pushLobby(); checkAllReady(); }
      break;
    }
    case 'settings': {
      if (phase !== 'lobby') return;
      if (m.mode === 'easy' || m.mode === 'pro') settings.mode = m.mode;
      if ([60, 120, 180, 300].includes(m.roundTime)) settings.roundTime = m.roundTime;
      if (typeof m.bots === 'boolean') settings.bots = m.bots;
      pushLobby();
      break;
    }
    case 'quit': {
      // ESC 꾹 누르기: 지금 판을 끝내고 모두 로비로 (기록은 남기지 않음)
      if (phase !== 'countdown' && phase !== 'playing') return;
      botBullets.length = 0;
      botMissiles.length = 0;
      items.length = 0;
      broadcastItems();
      toLobby();
      break;
    }
    case 'start': {
      if (phase === 'lobby' && slots.some((e) => e && e.human)) startCountdown();
      break;
    }
    case 'st': {
      const e = mine(ws);
      if (!e || !e.alive || phase !== 'playing') return;
      const p = e.plane;
      p.x = num(m.x); p.y = num(m.y); p.z = num(m.z);
      p.yaw = num(m.yaw); p.pitch = num(m.pitch); p.roll = num(m.roll);
      e.firing = !!m.f; e.evading = !!m.e; e.boosting = !!m.b;
      break;
    }
    case 'hit': {
      const e = mine(ws);
      if (!e) return;
      const cap = { mg: CFG.MG_DMG, ms: CFG.MS_DMG, ult: CFG.ULT_DMG }[m.w];
      const tgt = m.target;
      if (!cap || !(Number.isInteger(tgt) && tgt >= 0 && tgt < 4) || tgt === e.slot) return;
      applyDamage(e.slot, tgt, Math.min(cap, num(m.dmg)), m.w);
      break;
    }
    case 'crash': {
      const e = mine(ws);
      // 지형/바다 충돌은 누구의 격추도 아닌 '추락'
      if (e && e.alive && phase === 'playing') killEntity(e, null, 'crash');
      break;
    }
    case 'goto': {
      // 로비에서 '파티 게임' 을 고르면 모든 노트북/TV가 같이 이동
      if (phase === 'lobby' && m.to === 'party') {
        if (typeof m.game === 'string') party.setGame(m.game);
        broadcast({ t: 'goto', url: '/party.html' });
      }
      break;
    }
    case 'fx': {
      if (ws.slot < 0 || !FX_KINDS.has(m.kind)) return;
      const out = { t: 'fx', kind: m.kind, slot: ws.slot };
      for (const k of ['id', 'target', 'x', 'y', 'z', 'dx', 'dy', 'dz']) if (k in m) out[k] = k === 'id' ? String(m.id).slice(0, 20) : num(m[k]);
      broadcast(out, ws);
      break;
    }
    default:
  }
}

// ---------- 게임 루프 ----------
const r2 = (v) => Math.round(v * 100) / 100;
let last = Date.now();

setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (phase === 'countdown' && now >= phaseEnd) startPlaying();
  else if (phase === 'playing' && now >= phaseEnd) endRound();
  else if (phase === 'results' && now >= phaseEnd) toLobby();

  if (phase === 'playing') {
    for (const e of slots) {
      if (!e) continue;
      if (!e.alive) {
        if (now >= e.respawnAt) spawnEntity(e);
        continue;
      }
      if (!e.human) updateBot(e, dt, now);
    }
    updateBotBullets(dt);
    updateBotMissiles(dt, now);
    updateItems(now);
  }

  if (phase === 'countdown' || phase === 'playing') {
    broadcast({
      t: 'snap',
      ph: phase,
      tl: Math.max(0, phaseEnd - now),
      p: slots.filter(Boolean).map((e) => ({
        s: e.slot, n: e.name, h: e.human ? 1 : 0,
        x: r2(e.plane.x), y: r2(e.plane.y), z: r2(e.plane.z),
        yw: r2(e.plane.yaw), pt: r2(e.plane.pitch), rl: r2(e.plane.roll),
        hp: Math.max(0, Math.round(e.hp)), a: e.alive ? 1 : 0,
        f: e.firing ? 1 : 0, e: e.evading ? 1 : 0, b: e.boosting ? 1 : 0,
        k: e.kills, d: e.deaths, inv: now < e.invUntil ? 1 : 0,
      })),
    });
  }
}, 1000 / TICK);

server.listen(PORT, () => {
  console.log('\n  노을 공중전 서버가 켜졌어요!\n');
  const addrs = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) addrs.push(a.address);
  }
  console.log(`  이 컴퓨터:   http://localhost:${PORT}`);
  for (const a of addrs) console.log(`  노트북에서:  http://${a}:${PORT}`);
  console.log(`  TV(관전):    http://${addrs[0] || 'localhost'}:${PORT}/?tv`);
  console.log(`  파티 게임:   http://${addrs[0] || 'localhost'}:${PORT}/party.html  (TV는 ?tv)`);
  console.log('\n  종료: Ctrl + C\n');
});
