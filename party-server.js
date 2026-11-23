// 파티 게임 서버 (구슬 스모 · 보트 레이스 · 허들 달리기 · 협동 미로)
// 모든 물리는 서버가 계산하고, 노트북은 입력만 보냅니다.
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import {
  GAMES, SUMO, sumoAngle, sumoAxes,
  BOAT, TRACK, trackNearest, boatGrid, isLand, BOOST_PADS,
  DASH, MAZE, MAZE_LEVELS, parseMaze,
} from './shared/party.js';

const TICK = 30;
const COUNTDOWN = 6; // 이 동안 조작법 카드를 보여줌
const RESULTS = 12;
const BOT_NAMES = ['AI 땅콩', 'AI 콩떡', 'AI 감자', 'AI 호떡'];
const DEFAULT_NAMES = ['빨강', '파랑', '초록', '노랑'];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const r2 = (v) => Math.round(v * 100) / 100;
const num = (v) => (Number.isFinite(+v) ? +v : 0);
const wrapA = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

function cleanName(n, slot) {
  const s = String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 10);
  return s || DEFAULT_NAMES[slot];
}

// 플레이어 입력 도우미
const presses = (p, i) => clamp(p.cnt[i] - p.prev[i], 0, 6);
const shakes = (p) => clamp(p.sh - p.prevSh, 0, 3);
function botPress(p, i) { p.cnt[i]++; }

// =====================================================================
// 구슬 스모
// =====================================================================
function createSumo(ctx) {
  const C = SUMO;
  const balls = [];
  for (const p of ctx.players) {
    if (!p) continue;
    balls.push({
      p, s: p.slot, x: 0, z: 0, y: 0, vx: 0, vz: 0, vy: 0,
      alive: true, falling: false, fallT: 0,
      dashCd: 0, heavyT: 0, heavyCd: 0, jumpT: 0, jumpCd: 0, waveCd: 0, brake: false,
      lastBy: -1, lastAt: 0, wins: 0, kos: 0, falls: 0, survive: 0,
      bot: { think: 0, dx: 0, dz: 0, mood: Math.random() },
    });
  }
  const st = { sub: 'fight', subEnd: 0, round: 1, rounds: ctx.settings.rounds, radius: C.R0, roundT: 0, winner: -2, item: null, itemAt: C.ITEM_FIRST };
  const bumpT = new Map();

  // 번개 아이템: 먹으면 잠깐 무겁고 빨라짐
  function updateItem(now) {
    if (!st.item && st.roundT >= st.itemAt) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * st.radius * 0.55;
      st.item = { x: r2(Math.cos(a) * d), z: r2(Math.sin(a) * d) };
      ctx.emit({ k: 'item', x: st.item.x, z: st.item.z });
    }
    if (!st.item) return;
    for (const b of balls) {
      if (!b.alive || b.falling || b.jumpT > 0.2) continue;
      if (Math.hypot(b.x - st.item.x, b.z - st.item.z) < C.BALL_R + 1) {
        b.megaT = C.MEGA_T;
        st.item = null;
        st.itemAt = st.roundT + C.ITEM_EVERY;
        ctx.emit({ k: 'mega', s: b.s });
        break;
      }
    }
  }

  function resetRound(first) {
    for (const b of balls) {
      const a = sumoAngle(b.s);
      const d = C.R0 * 0.55;
      Object.assign(b, {
        x: Math.cos(a) * d, z: Math.sin(a) * d, y: 0, vx: 0, vz: 0, vy: 0,
        alive: true, falling: false, fallT: 0, dashCd: 0, heavyT: 0, heavyCd: 0, jumpT: 0, jumpCd: 0,
        waveCd: C.WAVE_CD * 0.5, lastBy: -1, megaT: 0,
      });
    }
    st.item = null;
    st.itemAt = C.ITEM_FIRST;
    st.radius = C.R0;
    st.roundT = 0;
    st.winner = -2;
    if (first) st.sub = 'fight';
    else { st.sub = 'ready'; st.subEnd = ctx.now() + C.READY * 1000; }
  }
  resetRound(true);

  const mass = (b) => (b.heavyT > 0 ? C.HEAVY_MASS : 1) * (b.megaT > 0 ? C.MEGA_MASS : 1);
  const air = (b) => b.jumpT > 0;

  function botThink(b, dt) {
    const p = b.p;
    const ax = sumoAxes(b.s);
    const r = Math.hypot(b.x, b.z);
    const bot = b.bot;
    bot.think -= dt;
    let target = null, best = Infinity;
    for (const o of balls) {
      if (o === b || !o.alive || o.falling) continue;
      const d = Math.hypot(o.x - b.x, o.z - b.z);
      const score = d + (o.p.human ? 3 : 0) + Math.hypot(o.x, o.z) * 0.3;
      if (score < best) { best = score; target = o; }
    }
    let dx = 0, dz = 0;
    // 번개 아이템이 상대보다 가까우면 아이템부터
    if (st.item && Math.hypot(st.item.x - b.x, st.item.z - b.z) < best * 0.8) {
      dx = st.item.x - b.x; dz = st.item.z - b.z;
      const L = Math.hypot(dx, dz) || 1;
      dx /= L; dz /= L;
    } else if (target) {
      // 상대를 바깥으로 밀 수 있게 상대 뒤(중심 쪽)에서 들어감
      const tr = Math.hypot(target.x, target.z) || 1;
      const gx = target.x - (target.x / tr) * 2.2, gz = target.z - (target.z / tr) * 2.2;
      dx = gx - b.x; dz = gz - b.z;
      const L = Math.hypot(dx, dz) || 1;
      dx /= L; dz /= L;
    }
    // 가장자리 위험 → 안쪽으로
    const speedOut = (b.vx * b.x + b.vz * b.z) / (r || 1);
    const danger = r + Math.max(0, speedOut) * 0.45 - (st.radius - 3.5);
    if (danger > 0) {
      const w = clamp(danger / 3, 0, 1);
      dx = dx * (1 - w) - (b.x / (r || 1)) * w * 1.6;
      dz = dz * (1 - w) - (b.z / (r || 1)) * w * 1.6;
      p.inp.h[3] = danger > 2.5;
    } else p.inp.h[3] = false;
    if (bot.think <= 0) {
      bot.think = 0.25 + Math.random() * 0.3;
      bot.dx = (Math.random() - 0.5) * 0.5; bot.dz = (Math.random() - 0.5) * 0.5;
    }
    dx += bot.dx; dz += bot.dz;
    // 시작하자마자 달려들지 않게
    const calm = clamp(st.roundT / 2.5, 0.25, 1) * (0.75 + bot.mood * 0.25);
    dx *= calm; dz *= calm;
    const L = Math.hypot(dx, dz);
    if (L > 1) { dx /= L; dz /= L; }
    p.inp.x = dx * ax.rx + dz * ax.rz;
    p.inp.y = dx * ax.fx + dz * ax.fz;
    if (target && st.sub === 'fight') {
      const d = Math.hypot(target.x - b.x, target.z - b.z);
      const tx = (target.x - b.x) / d, tz = (target.z - b.z) / d;
      if (st.roundT > 2 && d < 7 && b.dashCd <= 0 && danger < -1 && Math.random() < dt * 1.3) botPress(p, 0);
      if (d < 4 && b.heavyCd <= 0 && Math.random() < dt * 1.2) botPress(p, 1);
      const closing = (target.vx - b.vx) * -tx + (target.vz - b.vz) * -tz;
      if (d < 5 && closing > 9 && b.jumpCd <= 0 && Math.random() < 0.5) botPress(p, 2);
      const near = balls.filter((o) => o !== b && o.alive && !o.falling && Math.hypot(o.x - b.x, o.z - b.z) < C.WAVE_R * 0.7).length;
      if (near >= 1 && b.waveCd <= 0 && Math.random() < dt * (near >= 2 ? 2 : 0.4)) p.sh++;
    }
  }

  function useSkills(b, now) {
    const p = b.p;
    if (!b.alive || b.falling) return;
    const ax = sumoAxes(b.s);
    const ix = clamp(p.inp.x, -1, 1), iy = clamp(p.inp.y, -1, 1);
    let dx = ix * ax.rx + iy * ax.fx, dz = ix * ax.rz + iy * ax.fz;
    if (presses(p, 0) && b.dashCd <= 0) {
      let L = Math.hypot(dx, dz);
      if (L < 0.25) { dx = b.vx; dz = b.vz; L = Math.hypot(dx, dz); }
      if (L < 0.5) { dx = -b.x; dz = -b.z; L = Math.hypot(dx, dz) || 1; }
      b.vx += (dx / L) * C.DASH; b.vz += (dz / L) * C.DASH;
      b.dashCd = C.DASH_CD;
      ctx.emit({ k: 'dash', s: b.s });
    }
    if (presses(p, 1) && b.heavyCd <= 0) {
      b.heavyT = C.HEAVY_T; b.heavyCd = C.HEAVY_CD;
      ctx.emit({ k: 'heavy', s: b.s });
    }
    if (presses(p, 2) && b.jumpCd <= 0 && !air(b)) {
      b.jumpT = C.JUMP_T; b.jumpCd = C.JUMP_CD;
      ctx.emit({ k: 'jump', s: b.s });
    }
    if (shakes(p) && b.waveCd <= 0) {
      b.waveCd = C.WAVE_CD;
      for (const o of balls) {
        if (o === b || !o.alive || o.falling || air(o)) continue;
        const ox = o.x - b.x, oz = o.z - b.z, d = Math.hypot(ox, oz);
        if (d > C.WAVE_R || d < 0.01) continue;
        const f = (C.WAVE_IMP * (1 - d / C.WAVE_R * 0.6)) / mass(o);
        o.vx += (ox / d) * f; o.vz += (oz / d) * f;
        o.lastBy = b.s; o.lastAt = now;
      }
      ctx.emit({ k: 'wave', s: b.s });
    }
    b.brake = !!p.inp.h[3];
  }

  function physics(dt, now) {
    for (const b of balls) {
      if (!b.alive) continue;
      if (b.falling) {
        b.vy -= 30 * dt; b.y += b.vy * dt;
        b.x += b.vx * dt * 0.6; b.z += b.vz * dt * 0.6;
        continue;
      }
      const p = b.p;
      const ax = sumoAxes(b.s);
      const ix = clamp(p.inp.x, -1, 1), iy = clamp(p.inp.y, -1, 1);
      let dx = ix * ax.rx + iy * ax.fx, dz = ix * ax.rz + iy * ax.fz;
      const L = Math.hypot(dx, dz);
      if (L > 1) { dx /= L; dz /= L; }
      const acc = C.ACC * (b.heavyT > 0 ? 0.55 : 1) * (air(b) ? 0.35 : 1) * (b.megaT > 0 ? C.MEGA_ACC : 1);
      b.vx += dx * acc * dt; b.vz += dz * acc * dt;
      const drag = Math.exp(-(b.brake && !air(b) ? C.BRAKE_DRAG : C.DRAG) * dt);
      b.vx *= drag; b.vz *= drag;
      b.x += b.vx * dt; b.z += b.vz * dt;
      if (air(b)) {
        const t = 1 - b.jumpT / C.JUMP_T;
        b.y = 4 * C.JUMP_H * t * (1 - t);
      } else b.y = 0;
    }
    // 충돌
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      if (!a.alive || a.falling || air(a)) continue;
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j];
        if (!b.alive || b.falling || air(b)) continue;
        let nx = b.x - a.x, nz = b.z - a.z;
        const d = Math.hypot(nx, nz);
        const minD = C.BALL_R * 2;
        if (d >= minD || d < 1e-4) continue;
        nx /= d; nz /= d;
        const ma = mass(a), mb = mass(b);
        const over = minD - d;
        a.x -= nx * over * (mb / (ma + mb)); a.z -= nz * over * (mb / (ma + mb));
        b.x += nx * over * (ma / (ma + mb)); b.z += nz * over * (ma / (ma + mb));
        const vn = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
        if (vn >= 0) continue;
        const jimp = (-(1 + C.REST) * vn) / (1 / ma + 1 / mb);
        a.vx -= (jimp / ma) * nx; a.vz -= (jimp / ma) * nz;
        b.vx += (jimp / mb) * nx; b.vz += (jimp / mb) * nz;
        a.lastBy = b.s; a.lastAt = now; b.lastBy = a.s; b.lastAt = now;
        const key = a.s * 4 + b.s;
        if (-vn > 2.5 && now - (bumpT.get(key) || 0) > 150) {
          bumpT.set(key, now);
          ctx.emit({ k: 'bump', x: r2((a.x + b.x) / 2), z: r2((a.z + b.z) / 2), v: r2(-vn) });
        }
      }
    }
    // 떨어짐
    for (const b of balls) {
      if (!b.alive || b.falling || air(b)) continue;
      if (Math.hypot(b.x, b.z) > st.radius + C.BALL_R * 0.3) {
        b.falling = true; b.fallT = 0; b.vy = 2;
        b.falls++;
        const by = b.lastBy >= 0 && now - b.lastAt < 4000 ? b.lastBy : -1;
        const killer = balls.find((o) => o.s === by);
        if (killer) killer.kos++;
        ctx.emit({ k: 'fall', s: b.s, by });
      }
    }
  }

  return {
    tick(dt, now) {
      for (const b of balls) {
        b.dashCd = Math.max(0, b.dashCd - dt); b.heavyCd = Math.max(0, b.heavyCd - dt);
        b.jumpCd = Math.max(0, b.jumpCd - dt); b.waveCd = Math.max(0, b.waveCd - dt);
        b.heavyT = Math.max(0, b.heavyT - dt); b.jumpT = Math.max(0, b.jumpT - dt);
        b.megaT = Math.max(0, (b.megaT || 0) - dt);
      }
      if (st.sub === 'ready') {
        if (now >= st.subEnd) { st.sub = 'fight'; ctx.emit({ k: 'go' }); }
        return false;
      }
      if (st.sub === 'inter') {
        if (now < st.subEnd) {
          for (const b of balls) if (b.falling) { b.vy -= 30 * dt; b.y += b.vy * dt; }
          return false;
        }
        if (st.round >= st.rounds) return true;
        st.round++;
        resetRound(false);
        ctx.emit({ k: 'nextround', round: st.round });
        return false;
      }
      st.roundT += dt;
      const t = st.roundT;
      if (t > C.ROUND_MAX) st.radius = Math.max(0.5, C.RMIN - (t - C.ROUND_MAX) * 1.2);
      else if (t > C.SHRINK_START) st.radius = C.R0 - (C.R0 - C.RMIN) * Math.min(1, (t - C.SHRINK_START) / C.SHRINK_TIME);
      for (const b of balls) if (!b.p.human && b.alive && !b.falling) botThink(b, dt);
      for (const b of balls) useSkills(b, now);
      updateItem(now);
      const SUB = 3;
      for (let i = 0; i < SUB; i++) physics(dt / SUB, now);
      for (const b of balls) {
        if (b.falling) { b.fallT += dt; if (b.fallT > 1.1) { b.alive = false; } }
        if (b.alive && !b.falling) b.survive += dt;
      }
      const standing = balls.filter((b) => b.alive && !b.falling);
      if (standing.length <= 1 && balls.length > 1 || (balls.length === 1 && standing.length === 0)) {
        const w = standing[0];
        st.winner = w ? w.s : -1;
        if (w) w.wins++;
        st.sub = 'inter';
        st.subEnd = now + C.INTER * 1000;
        ctx.emit({ k: 'round', w: st.winner, round: st.round });
      }
      return false;
    },
    snap(now) {
      return {
        r: r2(st.radius), sub: st.sub, se: Math.max(0, st.subEnd - now), rd: st.round, rds: st.rounds, w: st.winner,
        rt: r2(st.roundT), it: st.item ? [st.item.x, st.item.z] : null,
        b: balls.map((b) => [
          b.s, r2(b.x), r2(b.z), r2(b.y), b.alive ? 1 : 0,
          (b.heavyT > 0 ? 1 : 0) | (b.jumpT > 0 ? 2 : 0) | (b.brake ? 4 : 0) | (b.falling ? 8 : 0) | (b.megaT > 0 ? 16 : 0),
          b.wins, b.kos, r2(b.dashCd), r2(b.heavyCd), r2(b.jumpCd), r2(b.waveCd), r2(b.vx), r2(b.vz),
        ]),
      };
    },
    ranking() {
      return [...balls]
        .sort((a, b) => b.wins - a.wins || b.kos - a.kos || b.survive - a.survive)
        .map((b) => ({ slot: b.s, main: `${b.wins}승`, sub: `밀어내기 ${b.kos} · 떨어짐 ${b.falls}`, score: b.wins }));
    },
    record() {
      const top = [...balls].sort((a, b) => b.wins - a.wins || b.kos - a.kos)[0];
      if (!top || !top.p.human || top.wins === 0) return null;
      return { name: top.p.name, value: top.kos, label: `${top.wins}승 · 밀어내기 ${top.kos}`, better: 'high' };
    },
  };
}

// =====================================================================
// 보트 레이스
// =====================================================================
function createBoat(ctx) {
  const C = BOAT;
  const N = TRACK.length;
  const L = ctx.settings.laps;
  const boats = [];
  for (const p of ctx.players) {
    if (!p) continue;
    const g = boatGrid(p.slot);
    boats.push({
      p, s: p.slot, x: g.x, z: g.z, yaw: g.yaw, my: g.yaw, v: 0, seg: g.seg, t: 0,
      laps: -1, half: true, prog: 0, boostT: 0, boostCd: 0, sprayCd: C.SPRAY_CD * 0.5, slowT: 0,
      finishT: null, place: 0, lapStart: 0, bestLap: null, lastLap: null, wrongT: 0, stuckT: 0,
      off: false, drift: false, bumpAt: 0,
      bot: { lane: (Math.random() - 0.5) * 30, skill: 0.85 + Math.random() * 0.15, think: 0 },
    });
  }
  const st = { rt: 0, firstFinish: null, finished: 0 };

  function progressOf(b) { return b.laps * N + b.seg + b.t; }

  function respawn(b) {
    const a = TRACK[b.seg], c = TRACK[(b.seg + 1) % N];
    b.x = a.x; b.z = a.z;
    b.yaw = b.my = Math.atan2(c.z - a.z, c.x - a.x);
    b.v = 25;
    b.stuckT = 0;
    ctx.emit({ k: 'reset', s: b.s });
  }

  function botThink(b, dt) {
    const p = b.p;
    const look = 4 + Math.round(b.v / 14);
    const a = TRACK[(b.seg + look) % N], c = TRACK[(b.seg + look + 1) % N];
    const dx = c.x - a.x, dz = c.z - a.z, dl = Math.hypot(dx, dz);
    const tx = a.x + (-dz / dl) * b.bot.lane * 0.6, tz = a.z + (dx / dl) * b.bot.lane * 0.6;
    const want = Math.atan2(tz - b.z, tx - b.x);
    const diff = wrapA(want - b.yaw);
    p.inp.x = clamp(diff * 2.4, -1, 1);
    // 앞에 있는 사람과 거리에 따라 속도 조절 (너무 앞서가지 않게)
    const humans = boats.filter((o) => o.p.human);
    const leadH = humans.length ? Math.max(...humans.map(progressOf)) : progressOf(b);
    const gap = progressOf(b) - leadH;
    p.inp.y = gap > 30 ? -1 : gap > 12 ? -0.6 : gap < -30 ? 1 : 0.4 * b.bot.skill;
    b.bot.gap = gap;
    p.inp.h[2] = Math.abs(diff) > 0.5;
    b.bot.think -= dt;
    if (b.bot.think <= 0) {
      b.bot.think = 1 + Math.random() * 2;
      b.bot.lane = clamp(b.bot.lane + (Math.random() - 0.5) * 20, -26, 26);
      const pad = BOOST_PADS.find((pd) => { const d = (pd.seg - b.seg + N) % N; return d > 4 && d < 30; });
      if (pad && gap < 10 && Math.random() < 0.5) {
        const a = TRACK[pad.seg], c = TRACK[(pad.seg + 1) % N];
        const dl = Math.hypot(c.x - a.x, c.z - a.z);
        b.bot.lane = ((pad.x - a.x) * -(c.z - a.z) + (pad.z - a.z) * (c.x - a.x)) / dl / 0.6;
      }
      if (b.boostCd <= 0 && Math.abs(diff) < 0.12 && (gap < -5 || (gap < 8 && Math.random() < 0.3))) botPress(p, 0);
      if (b.sprayCd <= 0 && boats.some((o) => o !== b && Math.hypot(o.x - b.x, o.z - b.z) < C.SPRAY_R * 0.8 && progressOf(o) < progressOf(b))) p.sh++;
    }
  }

  function step(b, dt, now) {
    const p = b.p;
    const ix = clamp(p.inp.x, -1, 1), iy = clamp(p.inp.y, -1, 1);
    b.drift = !!p.inp.h[2] && b.v > 25;
    if (b.finishT !== null) { b.v *= Math.exp(-1.2 * dt); }
    else {
      let target = C.CRUISE + (iy > 0 ? iy * (C.FAST - C.CRUISE) : iy * (C.CRUISE - C.SLOW));
      if (b.boostT > 0) target = C.BOOST;
      if (b.off) target = Math.min(target, C.OFF_MAX);
      if (b.slowT > 0) target *= 0.55;
      if (b.drift) target *= 0.9;
      const k = b.v < target ? 24 : 34;
      b.v += clamp(target - b.v, -k * dt, k * dt);
    }
    let turn = (b.drift ? C.DRIFT_TURN : C.TURN) * ix * clamp(b.v / 38, 0.35, 1);
    // 조종 도우미: 사람이 손을 안 대고 있으면 물길 쪽으로 살짝 돌려줌 (처음 하는 사람용)
    if (p.human && Math.abs(ix) < 0.2 && b.finishT === null) {
      const ahead = TRACK[(b.seg + 6) % N];
      const want = Math.atan2(ahead.z - b.z, ahead.x - b.x);
      turn += clamp(wrapA(want - b.yaw) * 1.3, -C.ASSIST, C.ASSIST);
    }
    b.yaw = wrapA(b.yaw + turn * dt);
    // 진행 방향은 뱃머리를 늦게 따라감 (드리프트 때 미끄러짐)
    const follow = b.drift ? 2.2 : 7;
    b.my = wrapA(b.my + wrapA(b.yaw - b.my) * Math.min(1, follow * dt));
    const nx = b.x + Math.cos(b.my) * b.v * dt, nz = b.z + Math.sin(b.my) * b.v * dt;
    const hx = nx + Math.cos(b.yaw) * C.RADIUS, hz = nz + Math.sin(b.yaw) * C.RADIUS;
    if (isLand(nx, nz) || isLand(hx, hz)) {
      // 부딪힘: 튕겨나며 물길 방향으로 살짝 돌려줌
      const near = trackNearest(b.x, b.z, b.seg);
      const ty = Math.atan2(near.dz, near.dx);
      b.yaw = b.my = wrapA(b.yaw + clamp(wrapA(ty - b.yaw), -0.6, 0.6));
      b.v *= 0.35;
      const px = b.x - Math.cos(b.my) * 1.5, pz = b.z - Math.sin(b.my) * 1.5;
      if (!isLand(px, pz)) { b.x = px; b.z = pz; }
      if (now - b.bumpAt > 300) { b.bumpAt = now; ctx.emit({ k: 'crash', s: b.s, x: r2(b.x), z: r2(b.z) }); }
    } else { b.x = nx; b.z = nz; }

    const near = trackNearest(b.x, b.z, b.seg);
    const prevSeg = b.seg;
    b.seg = near.i; b.t = near.t;
    b.off = near.d > C.WIDTH / 2;
    // 부스터 발판
    b.padCd = Math.max(0, (b.padCd || 0) - dt);
    if (b.padCd <= 0 && b.finishT === null) {
      for (let i = 0; i < BOOST_PADS.length; i++) {
        const pd = BOOST_PADS[i];
        if (Math.hypot(pd.x - b.x, pd.z - b.z) < C.PAD_R) {
          b.boostT = Math.max(b.boostT, C.PAD_BOOST);
          b.padCd = 1.5;
          ctx.emit({ k: 'pad', s: b.s, i });
          break;
        }
      }
    }
    if (prevSeg > N * 0.75 && b.seg < N * 0.25) {
      if (b.half) {
        b.laps++; b.half = false;
        if (b.laps >= 1) {
          const lap = st.rt - b.lapStart;
          b.lastLap = lap;
          if (b.bestLap === null || lap < b.bestLap) b.bestLap = lap;
        }
        b.lapStart = st.rt;
        if (b.laps >= 1 && b.laps < L) ctx.emit({ k: 'lap', s: b.s, lap: b.laps + 1, time: r2(b.lastLap) });
        if (b.laps >= L && b.finishT === null) {
          b.finishT = st.rt;
          b.place = ++st.finished;
          if (st.firstFinish === null) st.firstFinish = st.rt;
          ctx.emit({ k: 'finish', s: b.s, place: b.place, time: r2(b.finishT) });
        }
      }
    } else if (prevSeg < N * 0.25 && b.seg > N * 0.75) {
      b.laps--; b.half = true;
    }
    if (b.seg > N * 0.45 && b.seg < N * 0.55) b.half = true;
    const dot = Math.cos(b.yaw) * near.dx + Math.sin(b.yaw) * near.dz;
    b.wrongT = dot < -0.3 && b.v > 8 ? b.wrongT + dt : 0;
    b.stuckT = b.v < 10 && b.finishT === null ? b.stuckT + dt : 0;
    if (b.stuckT > 3 && (b.off || near.d > C.WIDTH * 0.3)) respawn(b);
  }

  return {
    tick(dt, now) {
      st.rt += dt;
      for (const b of boats) {
        b.boostT = Math.max(0, b.boostT - dt); b.boostCd = Math.max(0, b.boostCd - dt);
        b.sprayCd = Math.max(0, b.sprayCd - dt); b.slowT = Math.max(0, b.slowT - dt);
        if (!b.p.human && b.finishT === null) botThink(b, dt);
        const p = b.p;
        if (b.finishT === null) {
          if (presses(p, 0) && b.boostCd <= 0) { b.boostT = C.BOOST_T; b.boostCd = C.BOOST_CD; ctx.emit({ k: 'boost', s: b.s }); }
          if (presses(p, 1)) respawn(b);
          if (presses(p, 3)) ctx.emit({ k: 'horn', s: b.s });
          if (shakes(p) && b.sprayCd <= 0) {
            b.sprayCd = C.SPRAY_CD;
            for (const o of boats) {
              if (o === b) continue;
              const dx = o.x - b.x, dz = o.z - b.z;
              if (Math.hypot(dx, dz) < C.SPRAY_R && dx * Math.cos(b.yaw) + dz * Math.sin(b.yaw) < 10) {
                o.slowT = C.SPRAY_SLOW;
                ctx.emit({ k: 'sprayed', s: o.s, by: b.s });
              }
            }
            ctx.emit({ k: 'spray', s: b.s });
          }
        }
      }
      for (let i = 0; i < 2; i++) for (const b of boats) step(b, dt / 2, now);
      // 보트끼리 부딪힘
      for (let i = 0; i < boats.length; i++) {
        for (let j = i + 1; j < boats.length; j++) {
          const a = boats[i], b = boats[j];
          let dx = b.x - a.x, dz = b.z - a.z;
          const d = Math.hypot(dx, dz), minD = C.RADIUS * 2;
          if (d >= minD || d < 1e-3) continue;
          dx /= d; dz /= d;
          const over = (minD - d) / 2;
          if (!isLand(a.x - dx * over, a.z - dz * over)) { a.x -= dx * over; a.z -= dz * over; }
          if (!isLand(b.x + dx * over, b.z + dz * over)) { b.x += dx * over; b.z += dz * over; }
          a.v *= 0.97; b.v *= 0.97;
          if (now - a.bumpAt > 400) { a.bumpAt = now; ctx.emit({ k: 'bump', x: r2((a.x + b.x) / 2), z: r2((a.z + b.z) / 2) }); }
        }
      }
      for (const b of boats) b.prog = progressOf(b);
      const humans = boats.filter((b) => b.p.human);
      const allDone = boats.every((b) => b.finishT !== null) || (humans.length > 0 && humans.every((b) => b.finishT !== null) && st.rt - st.firstFinish > 3);
      if (allDone) return true;
      if (st.firstFinish !== null && st.rt - st.firstFinish > C.FINISH_WAIT) return true;
      return st.rt > C.TIME_MAX;
    },
    snap() {
      const order = [...boats].sort((a, b) => (a.finishT !== null) - (b.finishT !== null) ? (a.finishT !== null ? -1 : 1) : a.finishT !== null ? a.finishT - b.finishT : b.prog - a.prog);
      return {
        rt: r2(st.rt), laps: L, ff: st.firstFinish === null ? -1 : r2(st.firstFinish),
        b: boats.map((b) => [
          b.s, r2(b.x), r2(b.z), r2(b.yaw), r2(b.v), Math.max(0, b.laps), order.indexOf(b) + 1,
          (b.boostT > 0 ? 1 : 0) | (b.drift ? 2 : 0) | (b.off ? 4 : 0) | (b.wrongT > 1.2 ? 8 : 0) | (b.finishT !== null ? 16 : 0) | (b.slowT > 0 ? 32 : 0),
          r2(b.boostCd), r2(b.sprayCd), b.finishT === null ? -1 : r2(b.finishT), b.bestLap === null ? -1 : r2(b.bestLap), r2(b.my),
        ]),
      };
    },
    ranking() {
      const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
      return [...boats]
        .sort((a, b) => (a.finishT !== null) !== (b.finishT !== null) ? (a.finishT !== null ? -1 : 1) : a.finishT !== null ? a.finishT - b.finishT : b.prog - a.prog)
        .map((b) => ({
          slot: b.s,
          main: b.finishT !== null ? fmt(b.finishT) : '완주 못함',
          sub: b.bestLap !== null ? `최고 바퀴 ${fmt(b.bestLap)}` : `${Math.max(0, b.laps) + 1}바퀴째`,
        }));
    },
    record() {
      const done = boats.filter((b) => b.p.human && b.bestLap !== null).sort((a, b) => a.bestLap - b.bestLap)[0];
      if (!done) return null;
      return { name: done.p.name, value: r2(done.bestLap), label: `한 바퀴 ${done.bestLap.toFixed(1)}초`, better: 'low' };
    },
  };
}

// =====================================================================
// 허들 달리기
// =====================================================================
function createDash(ctx) {
  const C = DASH;
  const runners = [];
  for (const p of ctx.players) {
    if (!p) continue;
    runners.push({
      p, s: p.slot, x: 0, v: 0, jumpT: 0, stumbleT: 0, spurtT: 0, spurtUsed: false, last: -1,
      finishT: null, place: 0, knocked: 0, prevY: 0,
      bot: { rate: 5.6 + Math.random() * 1.8, acc: 0, side: 0, plan: new Map() },
    });
  }
  const st = { rt: 0, finished: 0, humansDoneAt: null, best: ctx.best ? ctx.best('dash') : null };
  st.ghost = st.best;

  function bot(r, dt) {
    const b = r.bot;
    b.acc += dt * b.rate * (0.85 + Math.random() * 0.3);
    while (b.acc >= 1) { b.acc -= 1; botPress(r.p, b.side ? 0 : 2); b.side ^= 1; }
    for (let i = 0; i < C.HURDLES.length; i++) {
      const h = C.HURDLES[i];
      if (!b.plan.has(i)) b.plan.set(i, { ok: Math.random() < 0.85, lead: 0.12 + Math.random() * 0.12 });
      const pl = b.plan.get(i);
      const ahead = h - r.x;
      if (ahead > 0 && ahead < r.v * (pl.ok ? pl.lead + 0.15 : 0.05) && r.jumpT <= 0 && !pl.done) { pl.done = true; botPress(r.p, 1); }
    }
    if (!r.spurtUsed && r.x > 60 && Math.random() < dt * 0.5) r.p.sh++;
  }

  return {
    tick(dt) {
      st.rt += dt;
      for (const r of runners) {
        const p = r.p;
        r.jumpT = Math.max(0, r.jumpT - dt);
        r.stumbleT = Math.max(0, r.stumbleT - dt);
        r.spurtT = Math.max(0, r.spurtT - dt);
        if (r.finishT !== null) { r.v *= Math.exp(-2 * dt); r.x += r.v * dt; continue; }
        if (!p.human) bot(r, dt);
        // 왼발(왼쪽 위) · 오른발(오른쪽 위) 번갈아 누르기
        const nL = presses(p, 2), nR = presses(p, 0);
        let steps = 0;
        if (nL && nR) {
          steps = Math.min(nL, nR) * 2;
          if (nL !== nR) { const side = nL > nR ? 0 : 1; if (side !== r.last) steps++; r.last = side; }
          else r.last = r.last === 0 ? 0 : 1;
        } else if (nL) { if (r.last !== 0) steps = 1; r.last = 0; }
        else if (nR) { if (r.last !== 1) steps = 1; r.last = 1; }
        if (r.stumbleT > 0) steps = 0;
        const mult = r.spurtT > 0 ? C.SPURT_MULT : 1;
        r.v += steps * C.STEP * mult;
        r.v *= Math.exp(-C.DRAG * dt);
        r.v = Math.min(r.v, C.VMAX * (r.spurtT > 0 ? 1.25 : 1));
        // 점프: 아래 버튼 또는 컨트롤러를 뒤로 젖히기
        const tiltJump = p.inp.y < -0.55 && r.prevY >= -0.55;
        r.prevY = p.inp.y;
        if ((presses(p, 1) || presses(p, 3) || tiltJump) && r.jumpT <= 0) { r.jumpT = C.JUMP_T; ctx.emit({ k: 'jump', s: r.s }); }
        if (shakes(p) && !r.spurtUsed) { r.spurtUsed = true; r.spurtT = C.SPURT_T; ctx.emit({ k: 'spurt', s: r.s }); }
        const nx = r.x + r.v * dt;
        for (let i = 0; i < C.HURDLES.length; i++) {
          const h = C.HURDLES[i];
          if (r.x < h && nx >= h) {
            if (r.jumpT > 0.05) ctx.emit({ k: 'clear', s: r.s, i });
            else {
              r.v *= 0.3; r.stumbleT = C.STUMBLE_T; r.knocked |= 1 << i;
              ctx.emit({ k: 'trip', s: r.s, i });
            }
          }
        }
        r.x = nx;
        if (r.x >= C.LEN) {
          r.finishT = st.rt - (r.x - C.LEN) / Math.max(1, r.v);
          r.place = ++st.finished;
          ctx.emit({ k: 'finish', s: r.s, place: r.place, time: r2(r.finishT) });
          if (p.human && (st.best === null || r.finishT < st.best)) {
            ctx.emit({ k: 'newrec', s: r.s, time: r2(r.finishT), old: st.best });
            st.best = r.finishT;
          }
        }
      }
      const humans = runners.filter((r) => r.p.human);
      if (humans.length && humans.every((r) => r.finishT !== null) && st.humansDoneAt === null) st.humansDoneAt = st.rt;
      if (runners.every((r) => r.finishT !== null)) return st.rt - Math.max(...runners.map((r) => r.finishT)) > 1.5;
      if (st.humansDoneAt !== null && st.rt - st.humansDoneAt > 4) return true;
      return st.rt > C.TIME_MAX;
    },
    snap() {
      return {
        rt: r2(st.rt), gb: st.ghost === null ? -1 : r2(st.ghost),
        r: runners.map((r) => [
          r.s, r2(r.x), r2(r.v), (r.jumpT > 0 ? 1 : 0) | (r.stumbleT > 0 ? 2 : 0) | (r.spurtT > 0 ? 4 : 0) | (r.spurtUsed ? 8 : 0),
          r.finishT === null ? -1 : r2(r.finishT), r.place, r.knocked, r2(r.jumpT),
        ]),
      };
    },
    ranking() {
      return [...runners]
        .sort((a, b) => (a.finishT ?? 1e9) - (b.finishT ?? 1e9) || b.x - a.x)
        .map((r) => {
          const knocks = C.HURDLES.filter((_, i) => r.knocked & (1 << i)).length;
          return { slot: r.s, main: r.finishT !== null ? `${r.finishT.toFixed(2)}초` : `${Math.round(r.x)}m`, sub: knocks ? `허들 ${knocks}개 걸림` : '허들 완벽!' };
        });
    },
    record() {
      const best = runners.filter((r) => r.p.human && r.finishT !== null).sort((a, b) => a.finishT - b.finishT)[0];
      if (!best) return null;
      return { name: best.p.name, value: r2(best.finishT), label: `${best.finishT.toFixed(2)}초`, better: 'low' };
    },
  };
}

// =====================================================================
// 협동 미로 (모두의 기울기 평균으로 판이 기울어짐)
// =====================================================================
function createMaze(ctx) {
  const C = MAZE;
  const st = {
    lv: 0, m: null, x: 0, z: 0, vx: 0, vz: 0, y: 0, jumpT: 0, fallT: 0,
    cp: null, t: 0, pen: 0, bonus: 0, nstars: 0, got: new Set(), falls: 0, tx: 0, ty: 0, done: false, cleared: 0, jt: new Map(), lvTimes: [],
  };
  const humans = () => ctx.players.filter((p) => p && p.human);

  function load(i) {
    st.lv = i;
    st.m = parseMaze(MAZE_LEVELS[i]);
    st.cp = st.m.start;
    st.x = st.m.start.x; st.z = st.m.start.z;
    st.vx = st.vz = 0; st.y = 0; st.jumpT = 0; st.fallT = 0;
    st.lvStart = st.t;
    st.got = new Set();
  }
  load(0);

  function walls(dt) {
    const R = C.BALL_R, H = C.CELL / 2;
    for (const w of st.m.walls) {
      if (Math.abs(w.x - st.x) > H + R + 0.1 || Math.abs(w.z - st.z) > H + R + 0.1) continue;
      const qx = clamp(st.x, w.x - H, w.x + H), qz = clamp(st.z, w.z - H, w.z + H);
      let nx = st.x - qx, nz = st.z - qz;
      const d = Math.hypot(nx, nz);
      if (d >= R) continue;
      if (d < 1e-5) {
        // 중심이 벽 안에 들어감 → 가장 가까운 면으로
        const ox = st.x - w.x, oz = st.z - w.z;
        if (Math.abs(ox) > Math.abs(oz)) { nx = Math.sign(ox) || 1; nz = 0; st.x = w.x + nx * (H + R); }
        else { nz = Math.sign(oz) || 1; nx = 0; st.z = w.z + nz * (H + R); }
      } else {
        nx /= d; nz /= d;
        st.x += nx * (R - d); st.z += nz * (R - d);
      }
      const vn = st.vx * nx + st.vz * nz;
      if (vn < 0) {
        st.vx -= 1.35 * vn * nx; st.vz -= 1.35 * vn * nz;
        if (vn < -3) ctx.emit({ k: 'wall', v: r2(-vn) });
      }
    }
  }

  return {
    tick(dt, now) {
      const hs = humans();
      st.t += dt;
      // 기울기 = 사람들 입력 평균
      let ax = 0, ay = 0;
      for (const p of hs) { ax += clamp(p.inp.x, -1, 1); ay += clamp(p.inp.y, -1, 1); }
      if (hs.length) { ax /= hs.length; ay /= hs.length; }
      const L = Math.hypot(ax, ay);
      if (L > 1) { ax /= L; ay /= L; }
      st.tx += (ax - st.tx) * Math.min(1, dt * 7);
      st.ty += (ay - st.ty) * Math.min(1, dt * 7);
      // 다같이 점프
      for (const p of hs) {
        if (presses(p, 0) || presses(p, 1) || presses(p, 2) || presses(p, 3) || shakes(p)) st.jt.set(p.slot, now);
      }
      const need = Math.max(1, Math.ceil(hs.length / 2));
      const have = hs.filter((p) => now - (st.jt.get(p.slot) || 0) < C.JUMP_WIN * 1000).length;
      st.have = have; st.need = need;
      if (have >= need && st.jumpT <= 0 && st.fallT <= 0) {
        st.jumpT = C.JUMP_T; st.jt.clear();
        ctx.emit({ k: 'jump' });
      }
      st.jumpT = Math.max(0, st.jumpT - dt);
      st.y = st.jumpT > 0 ? 4 * 1.4 * (1 - st.jumpT / C.JUMP_T) * (st.jumpT / C.JUMP_T) : 0;

      if (st.fallT > 0) {
        st.fallT -= dt;
        st.y = -(0.8 - st.fallT) * 4;
        if (st.fallT <= 0) {
          st.x = st.cp.x; st.z = st.cp.z; st.vx = st.vz = 0; st.y = 0;
          ctx.emit({ k: 'respawn' });
        }
        return st.t >= C.TIME_MAX;
      }
      const SUB = 5, h = dt / SUB;
      for (let i = 0; i < SUB; i++) {
        st.vx += st.tx * C.ACC * h;
        st.vz += -st.ty * C.ACC * h;
        const drag = Math.exp(-C.DRAG * h);
        st.vx *= drag; st.vz *= drag;
        st.x += st.vx * h; st.z += st.vz * h;
        walls(h);
      }
      if (st.jumpT <= 0) {
        for (const o of st.m.holes) {
          if (Math.hypot(o.x - st.x, o.z - st.z) < C.HOLE_R) {
            st.fallT = 0.8; st.falls++; st.pen += C.PENALTY;
            st.x = o.x; st.z = o.z; st.vx = st.vz = 0;
            ctx.emit({ k: 'fall' });
            break;
          }
        }
      }
      for (const c of st.m.checkpoints) {
        if (c !== st.cp && Math.hypot(c.x - st.x, c.z - st.z) < 1) { st.cp = c; ctx.emit({ k: 'cp' }); }
      }
      st.m.stars.forEach((o, i) => {
        if (!st.got.has(i) && st.jumpT <= 0.3 && Math.hypot(o.x - st.x, o.z - st.z) < 0.95) {
          st.got.add(i); st.bonus += C.STAR_BONUS; st.nstars++;
          ctx.emit({ k: 'star', i, x: o.x, z: o.z });
        }
      });
      const g = st.m.goal;
      if (Math.hypot(g.x - st.x, g.z - st.z) < 0.9) {
        st.lvTimes.push(st.t - st.lvStart);
        st.cleared = st.lv + 1;
        if (st.lv + 1 >= MAZE_LEVELS.length) {
          st.done = true;
          ctx.emit({ k: 'clear', lv: st.lv, final: true });
          return true;
        }
        ctx.emit({ k: 'clear', lv: st.lv });
        load(st.lv + 1);
      }
      return st.t >= C.TIME_MAX;
    },
    snap() {
      return {
        lv: st.lv, x: r2(st.x), z: r2(st.z), y: r2(st.y), tx: r2(st.tx), ty: r2(st.ty),
        tm: r2(st.t), pen: st.pen, bon: st.bonus, sg: [...st.got], falls: st.falls, have: st.have || 0, need: st.need || 1,
        cp: st.m.checkpoints.indexOf(st.cp),
        p: humans().map((p) => [p.slot, r2(clamp(p.inp.x, -1, 1)), r2(clamp(p.inp.y, -1, 1))]),
      };
    },
    ranking() {
      const total = st.t + st.pen - st.bonus;
      const main = st.done ? `${total.toFixed(1)}초` : `${st.cleared}/${MAZE_LEVELS.length}단계`;
      return humans().map((p) => ({ slot: p.slot, main, sub: `떨어짐 ${st.falls}번 (+${st.pen}초) · 별 ${st.nstars}개 (-${st.bonus}초)` }));
    },
    team() {
      return { done: st.done, cleared: st.cleared, levels: MAZE_LEVELS.length, time: r2(st.t), pen: st.pen, bonus: st.bonus, stars: st.nstars, total: r2(st.t + st.pen - st.bonus), falls: st.falls };
    },
    record() {
      if (!st.done) return null;
      const names = humans().map((p) => p.name).join(', ');
      const total = st.t + st.pen - st.bonus;
      return { name: names, value: r2(total), label: `${total.toFixed(1)}초`, better: 'low' };
    },
  };
}

const FACTORIES = { sumo: createSumo, boat: createBoat, dash: createDash, maze: createMaze };

// =====================================================================
// 방 관리
// =====================================================================
export function createParty({ dataDir, onGoto }) {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set();
  const slots = [null, null, null, null];
  const settings = { game: 'sumo', bots: true, rounds: 3, laps: 2 };
  let phase = 'lobby';
  let phaseEnd = 0;
  let game = null;
  let gameKey = null;
  let lastResults = null;

  // ---------- 오늘의 기록 ----------
  const REC_FILE = path.join(dataDir, 'party-records.json');
  let records = [];
  try { records = JSON.parse(fs.readFileSync(REC_FILE, 'utf8')); } catch { records = []; }
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  function board(g) {
    const t = today();
    const list = records.filter((r) => r.date === t && r.game === g);
    const low = list[0]?.better === 'low';
    return list.sort((a, b) => (low ? a.value - b.value : b.value - a.value)).slice(0, 5).map((r) => ({ name: r.name, label: r.label }));
  }
  function allBoards() { return Object.fromEntries(Object.keys(GAMES).map((g) => [g, board(g)])); }
  function saveRecord(g, rec) {
    if (!rec) return;
    records.push({ ...rec, game: g, date: today() });
    if (records.length > 3000) records = records.slice(-2000);
    try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(REC_FILE, JSON.stringify(records)); } catch (e) { console.error('기록 저장 실패:', e.message); }
  }

  const send = (ws, m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
  const broadcast = (m) => { const s = JSON.stringify(m); for (const c of clients) if (c.readyState === 1) c.send(s); };
  const now = () => Date.now();

  function makePlayer(slot, human, name, ws) {
    return { slot, human, name, ws, ready: false, inp: { x: 0, y: 0, h: [false, false, false, false] }, cnt: [0, 0, 0, 0], prev: [0, 0, 0, 0], sh: 0, prevSh: 0 };
  }
  function lobbyState() {
    return {
      t: 'lobby', phase, settings,
      slots: slots.map((p) => (p && p.human ? { name: p.name, ready: p.ready } : null)),
      boards: allBoards(),
    };
  }
  const pushLobby = () => broadcast(lobbyState());

  function startCountdown() {
    if (phase !== 'lobby') return;
    const ctxPlayers = slots.map((p, i) => {
      if (p && p.human) return p;
      if (settings.bots && settings.game !== 'maze') return makePlayer(i, false, BOT_NAMES[i], null);
      return null;
    });
    for (let i = 0; i < 4; i++) if (!slots[i] || !slots[i].human) slots[i] = ctxPlayers[i];
    for (const p of slots) if (p) { p.cnt = [0, 0, 0, 0]; p.prev = [0, 0, 0, 0]; p.sh = 0; p.prevSh = 0; p.inp = { x: 0, y: 0, h: [false, false, false, false] }; }
    gameKey = settings.game;
    game = FACTORIES[gameKey]({
      players: slots, settings: { ...settings }, now,
      best: (g) => { const b = board(g)[0]; const rec = b && records.find((r) => r.game === g && r.label === b.label && r.name === b.name); return rec ? rec.value : null; },
      emit: (ev) => broadcast({ t: 'ev', ...ev }),
    });
    phase = 'countdown';
    phaseEnd = now() + COUNTDOWN * 1000;
    broadcast({ t: 'phase', phase, game: gameKey, tl: COUNTDOWN * 1000, names: slots.map((p) => (p ? { n: p.name, h: p.human ? 1 : 0 } : null)) });
  }
  function startPlaying() {
    phase = 'playing';
    broadcast({ t: 'phase', phase, game: gameKey });
  }
  function endGame() {
    phase = 'results';
    phaseEnd = now() + RESULTS * 1000;
    const rec = game.record();
    saveRecord(gameKey, rec);
    const ranking = game.ranking().map((r) => ({ ...r, name: slots[r.slot]?.name || '', human: !!slots[r.slot]?.human }));
    lastResults = { t: 'results', game: gameKey, ranking, team: game.team ? game.team() : null, board: board(gameKey), record: rec };
    broadcast(lastResults);
    broadcast({ t: 'phase', phase, game: gameKey, tl: RESULTS * 1000 });
  }
  function toLobby() {
    phase = 'lobby';
    game = null;
    for (let i = 0; i < 4; i++) {
      if (slots[i] && !slots[i].human) slots[i] = null;
      if (slots[i]) slots[i].ready = false;
    }
    broadcast({ t: 'phase', phase });
    pushLobby();
  }
  function checkAllReady() {
    const humans = slots.filter((p) => p && p.human);
    if (phase === 'lobby' && humans.length > 0 && humans.every((p) => p.ready)) startCountdown();
  }

  const mine = (ws) => (ws.slot >= 0 && slots[ws.slot] && slots[ws.slot].ws === ws ? slots[ws.slot] : null);

  function handle(ws, m) {
    switch (m.t) {
      case 'hello': {
        if (ws.slot >= 0) return;
        if (!m.spectate) {
          const free = (i) => !slots[i] || !slots[i].human;
          const want = Number.isInteger(m.want) && m.want >= 0 && m.want < 4 ? m.want : -1;
          let slot = want >= 0 && free(want) ? want : -1;
          if (slot < 0) slot = [0, 1, 2, 3].find(free) ?? -1;
          if (slot >= 0) {
            const old = slots[slot];
            const p = makePlayer(slot, true, cleanName(m.name, slot), ws);
            // 게임 도중 들어오면 봇 자리를 이어받음
            if (old && !old.human && phase !== 'lobby') { Object.assign(old, { human: true, name: p.name, ws }); }
            else slots[slot] = p;
            ws.slot = slot;
          }
        }
        send(ws, { t: 'welcome', slot: ws.slot });
        send(ws, lobbyState());
        if (phase !== 'lobby') send(ws, { t: 'phase', phase, game: gameKey, tl: Math.max(0, phaseEnd - now()), names: slots.map((p) => (p ? { n: p.name, h: p.human ? 1 : 0 } : null)) });
        if (phase === 'results' && lastResults) send(ws, lastResults);
        pushLobby();
        break;
      }
      case 'pick': {
        if (phase !== 'lobby' || ws.slot < 0) return;
        const i = m.slot;
        if (!(Number.isInteger(i) && i >= 0 && i < 4) || slots[i]) return;
        const p = slots[ws.slot];
        slots[ws.slot] = null;
        p.slot = i; slots[i] = p; ws.slot = i;
        send(ws, { t: 'welcome', slot: i });
        pushLobby();
        break;
      }
      case 'name': {
        const p = mine(ws);
        if (p) { p.name = cleanName(m.name, p.slot); pushLobby(); }
        break;
      }
      case 'ready': {
        const p = mine(ws);
        if (p && phase === 'lobby') { p.ready = !!m.v; pushLobby(); checkAllReady(); }
        break;
      }
      case 'settings': {
        if (phase !== 'lobby') return;
        if (m.game in GAMES) settings.game = m.game;
        if (typeof m.bots === 'boolean') settings.bots = m.bots;
        if ([1, 3, 5].includes(m.rounds)) settings.rounds = m.rounds;
        if ([1, 2, 3].includes(m.laps)) settings.laps = m.laps;
        pushLobby();
        break;
      }
      case 'start': {
        if (phase === 'lobby' && slots.some((p) => p && p.human)) startCountdown();
        break;
      }
      case 'goto': {
        if (phase !== 'lobby') return;
        if (m.to === 'dogfight') {
          broadcast({ t: 'goto', url: '/' });
          if (onGoto) onGoto();
        }
        break;
      }
      case 'in': {
        const p = mine(ws);
        if (!p) return;
        p.inp.x = clamp(num(m.x), -1, 1);
        p.inp.y = clamp(num(m.y), -1, 1);
        if (Array.isArray(m.h)) for (let i = 0; i < 4; i++) p.inp.h[i] = !!m.h[i];
        // 버튼 누른 횟수 (누적값) → 서버에서 차이로 '눌림'을 계산
        if (Array.isArray(m.c)) {
          for (let i = 0; i < 4; i++) {
            const v = Math.floor(num(m.c[i]));
            if (v >= p.cnt[i] && v - p.cnt[i] < 50) p.cnt[i] = v;
            else if (v < p.cnt[i]) { p.cnt[i] = v; p.prev[i] = v; }
          }
        }
        const s = Math.floor(num(m.s));
        if (s >= p.sh && s - p.sh < 20) p.sh = s;
        else if (s < p.sh) { p.sh = s; p.prevSh = s; }
        break;
      }
      default:
    }
  }

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
        if (phase === 'lobby' || !settings.bots || gameKey === 'maze') {
          if (phase === 'lobby') slots[s] = null;
          else { slots[s].human = false; slots[s].ws = null; slots[s].inp = { x: 0, y: 0, h: [false, false, false, false] }; }
        } else {
          // 게임 중이면 AI가 이어서 함
          slots[s].human = false; slots[s].ws = null; slots[s].name = BOT_NAMES[s];
        }
        pushLobby();
        checkAllReady();
      }
    });
  });

  let last = now();
  setInterval(() => {
    const t = now();
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    if (phase === 'countdown' && t >= phaseEnd) startPlaying();
    else if (phase === 'results' && t >= phaseEnd) toLobby();
    // 사람이 모두 나가면 게임을 끝내고 로비로
    if ((phase === 'playing' || phase === 'countdown') && !slots.some((p) => p && p.human)) { toLobby(); return; }
    if (phase === 'playing') {
      const done = game.tick(dt, t);
      for (const p of slots) if (p) { p.prev = [...p.cnt]; p.prevSh = p.sh; }
      if (done) endGame();
    } else if (phase === 'countdown') {
      for (const p of slots) if (p) { p.prev = [...p.cnt]; p.prevSh = p.sh; }
    }
    if ((phase === 'countdown' || phase === 'playing') && game) {
      broadcast({ t: 'snap', g: gameKey, ph: phase, tl: phase === 'countdown' ? Math.max(0, phaseEnd - t) : 0, ...game.snap(t) });
    }
  }, 1000 / TICK);

  return {
    handleUpgrade(req, socket, head) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    },
    // 비행기 게임에서 '파티 게임으로' 를 누르면
    broadcastGoto(url) { broadcast({ t: 'goto', url }); },
    // 비행기 게임 대기실에서 미니게임 카드를 누르면 그 게임을 골라 둠
    setGame(g) { if (phase === 'lobby' && g in GAMES) { settings.game = g; pushLobby(); } },
  };
}
