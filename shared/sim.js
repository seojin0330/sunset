// 서버(봇)와 클라이언트가 함께 쓰는 설정값과 비행 물리.
// 숫자를 바꾸면 게임 밸런스가 바뀌어요. (서버 재시작 + 브라우저 새로고침 필요)

export const CFG = {
  ARENA_R: 1400,        // 경기장 반지름 (m)
  CEIL: 560,            // 최대 고도
  FLOOR: 3,             // 이 아래로 내려가면 바다에 추락

  SPEED: 85,            // 기본 속도
  BOOST_SPEED: 150,     // 부스터 속도 (고수 모드)
  EVADE_SPEED: 125,     // 회피 중 속도

  MAX_ROLL: 1.2,        // 최대 기울기 (rad)
  ROLL_RESP: 4.5,       // 기울기 반응 속도
  TURN: 1.25,           // 선회 속도
  PITCH_RATE: 1.15,     // 상승/하강 속도
  MAX_PITCH: 1.1,

  HP: 100,

  MG_RATE: 11,          // 기관총 초당 발사 수
  MG_SPEED: 520,
  MG_LIFE: 1.1,
  MG_DMG: 5,
  MG_SPREAD: 0.012,

  MS_CD: 5,             // 미사일 쿨타임 (초)
  MS_SPEED: 180,
  MS_TURN: 0.95,          // 미사일 선회력 (비행기보다 둔해서 마지막에 크게 꺾으면 피할 수 있음)
  MS_LIFE: 5,
  MS_DMG: 45,
  MS_LOCK_ANGLE: 0.55,
  MS_LOCK_DIST: 900,
  MS_PROX: 7,
  MS_OVERSHOOT: 1.75,    // 목표가 이 각도(rad)보다 옆/뒤로 가면 미사일이 놓침

  EV_CD: 4,             // 회피 쿨타임
  EV_TIME: 0.7,         // 회피(무적) 시간
  EV_SLIDE: 45,

  BOOST_MAX: 100,
  BOOST_DRAIN: 40,
  BOOST_REGEN: 14,

  ULT_DMG: 60,          // 필살기 (고수 모드)
  ULT_RADIUS: 300,

  HIT_R: 7,             // 피격 판정 반지름
  HIT_R_EASY: 10,       // 체험 모드는 더 잘 맞게

  RESPAWN: 3,
  SPAWN_INV: 2.5,

  ROUND: 180,
  COUNTDOWN: 5,
  RESULTS: 12,

  BOT_DMG: 4,
  BOT_SPREAD: 0.06,
  BOT_FIRE_RATE: 7,
  BOT_MS_CD: 15,        // AI 미사일 간격 (초)

  ITEM_COUNT: 4,        // 동시에 떠 있는 아이템 수
  ITEM_RESPAWN: 8,      // 먹힌 뒤 새 아이템이 나오기까지 (초)
  ITEM_R: 15,           // 아이템 획득 거리
  ITEM_HP: 40,          // 체력 회복량
  RAPID_TIME: 8,        // 연사 강화 시간
  RAPID_MULT: 2,
  SHIELD_TIME: 6,       // 보호막 시간

  AIM_ASSIST: 0.07,     // 체험 모드 조준 보조 각도 (rad)
};

export const ITEM_INFO = {
  hp: { color: 0x4cff7a, css: '#4cff7a', label: '체력 +40' },
  rapid: { color: 0xffd24a, css: '#ffd24a', label: '연사 강화 8초' },
  shield: { color: 0x5ad8ff, css: '#5ad8ff', label: '보호막 6초' },
};

export const COLORS = [0xff4a3d, 0x3d8bff, 0x38d870, 0xffcc33];
export const COLOR_CSS = ['#ff4a3d', '#3d8bff', '#38d870', '#ffcc33'];
export const COLOR_NAMES = ['빨강', '파랑', '초록', '노랑'];

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ================= 맵 =================
// 서버(AI 충돌)와 노트북(화면)이 같은 함수로 지형을 계산해요.

function hash2(x, z, s) {
  const h = Math.sin(x * 127.1 + z * 311.7 + s * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
export function vnoise(x, z, s = 0) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi, s), b = hash2(xi + 1, zi, s), c = hash2(xi, zi + 1, s), d = hash2(xi + 1, zi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, z, s = 0) {
  return vnoise(x, z, s) * 0.55 + vnoise(x * 2.1, z * 2.1, s + 1) * 0.3 + vnoise(x * 4.3, z * 4.3, s + 2) * 0.15;
}

// 섬 종류: peak(뾰족산) ridge(능선) crater(분화구) mesa(평평한 고원)
export const ISLANDS = [
  { x: 0, z: 0, r: 230, h: 170, type: 'crater', seed: 11 },
  { x: 520, z: -300, r: 150, h: 210, type: 'peak', seed: 12 },
  { x: -560, z: -260, r: 170, h: 95, type: 'mesa', seed: 13 },
  { x: -300, z: 600, r: 190, h: 150, type: 'ridge', seed: 14 },
  { x: 420, z: 560, r: 130, h: 180, type: 'peak', seed: 15 },
  { x: 900, z: 150, r: 120, h: 110, type: 'ridge', seed: 16 },
  { x: -950, z: 250, r: 110, h: 140, type: 'peak', seed: 17 },
  { x: -150, z: -900, r: 140, h: 85, type: 'mesa', seed: 18 },
  { x: 650, z: -900, r: 95, h: 125, type: 'peak', seed: 19 },
  { x: -820, z: -820, r: 90, h: 90, type: 'ridge', seed: 20 },
  { x: 150, z: 1000, r: 105, h: 130, type: 'peak', seed: 21 },
  { x: 300, z: 170, r: 50, h: 38, type: 'peak', seed: 22 },
  { x: -260, z: -380, r: 60, h: 34, type: 'mesa', seed: 23 },
  { x: 1120, z: -460, r: 70, h: 60, type: 'peak', seed: 24 },
];
const ISL_MAXR = 1.18; // 해안선 들쭉날쭉한 정도를 포함한 최대 반지름 배율

// 바다에 솟은 돌기둥
export const STACKS = [
  [760, -500, 13, 95], [800, -560, 9, 60], [710, -560, 8, 45], [840, -470, 7, 38], [745, -430, 6, 30],
  [-650, 660, 14, 110], [-600, 720, 9, 70], [-700, 610, 8, 52], [-590, 640, 6, 34],
  [90, -640, 12, 80], [140, -690, 8, 50], [40, -680, 7, 40],
  [1050, 700, 11, 90], [1000, 760, 8, 55],
].map(([x, z, r, h], i) => ({ x, z, r, h, seed: 100 + i }));

// 통과할 수 있는 바위 아치
export const ARCHES = [
  { x: 250, z: -430, yaw: 0.6, span: 104, height: 88, thick: 15 },
  { x: -480, z: 260, yaw: -0.9, span: 112, height: 96, thick: 16 },
  { x: 620, z: 230, yaw: 1.35, span: 92, height: 78, thick: 13 },
].map((a) => {
  const cx = Math.cos(a.yaw) * a.span / 2, cz = -Math.sin(a.yaw) * a.span / 2;
  return { ...a, p1: { x: a.x - cx, z: a.z - cz }, p2: { x: a.x + cx, z: a.z + cz } };
});

// 등대 (고원 섬 위)
export const LIGHTHOUSE = { x: -560, z: -260, r: 6, tower: 34 };

export function islandHeight(isl, x, z) {
  const dx = x - isl.x, dz = z - isl.z;
  const d = Math.hypot(dx, dz);
  if (d > isl.r * ISL_MAXR) return -1;
  const ca = dx / (d || 1), sa = dz / (d || 1);
  const edge = isl.r * (0.84 + 0.34 * vnoise(ca * 1.7 + 5, sa * 1.7 + 5, isl.seed));
  const t = d / edge;
  if (t >= 1) return -1;
  let p;
  if (isl.type === 'peak') p = Math.pow(1 - t, 1.5);
  else if (isl.type === 'ridge') {
    const ang = Math.atan2(sa, ca);
    p = Math.pow(1 - t, 1.15) * (0.55 + 0.45 * Math.abs(Math.sin(ang + isl.seed)));
  } else if (isl.type === 'crater') {
    const ring = t < 0.5 ? 0.3 + 0.7 * (t / 0.5) * (t / 0.5) : 1;
    p = Math.pow(1 - t, 0.75) * ring * 1.25;
  } else {
    p = Math.min(1, (1 - t) * 3.2) * 0.95;
  }
  const n = fbm(x * 0.011, z * 0.011, isl.seed);
  const shore = Math.min(1, (1 - t) * 6);
  // 작은 굴곡 (능선, 골짜기)
  const detail = (1 - Math.abs(vnoise(x * 0.035, z * 0.035, isl.seed + 9) * 2 - 1)) - 0.5;
  return isl.h * p * (0.72 + 0.56 * n) * shore * (1 + detail * 0.22 * (1 - t)) + shore * 1.5;
}

export function stackHeight(s, x, z) {
  const d = Math.hypot(x - s.x, z - s.z);
  return d < s.r ? s.h : -1;
}

export function terrainHeight(x, z) {
  let h = -1;
  for (const isl of ISLANDS) {
    if (Math.abs(x - isl.x) > isl.r * ISL_MAXR || Math.abs(z - isl.z) > isl.r * ISL_MAXR) continue;
    const v = islandHeight(isl, x, z);
    if (v > h) h = v;
  }
  for (const s of STACKS) {
    const v = stackHeight(s, x, z);
    if (v > h) h = v;
  }
  for (const a of ARCHES) {
    if (Math.hypot(x - a.p1.x, z - a.p1.z) < a.thick || Math.hypot(x - a.p2.x, z - a.p2.z) < a.thick) h = Math.max(h, a.height);
  }
  const L = LIGHTHOUSE;
  if (Math.hypot(x - L.x, z - L.z) < L.r) {
    h = Math.max(h, islandHeight(ISLANDS[2], L.x, L.z) + L.tower);
  }
  return h;
}

// 아치 윗부분 (아래로는 지나갈 수 있음)
function archBeamHit(a, x, y, z) {
  if (Math.abs(y - a.height) > a.thick) return false;
  const vx = a.p2.x - a.p1.x, vz = a.p2.z - a.p1.z;
  const len2 = vx * vx + vz * vz;
  const t = clamp(((x - a.p1.x) * vx + (z - a.p1.z) * vz) / len2, 0, 1);
  const px = a.p1.x + vx * t - x, pz = a.p1.z + vz * t - z;
  // 가운데가 살짝 아치 모양으로 올라감
  const cy = a.height - 4 + Math.sin(t * Math.PI) * 6;
  return px * px + pz * pz + (y - cy) * (y - cy) < a.thick * a.thick;
}

export function solidAt(x, y, z) {
  if (y < terrainHeight(x, z)) return true;
  for (const a of ARCHES) if (archBeamHit(a, x, y, z)) return true;
  return false;
}

export const SPAWNS = [45, 135, 225, 315].map((deg) => {
  const a = (deg * Math.PI) / 180;
  const x = Math.cos(a) * 1000;
  const z = Math.sin(a) * 1000;
  return { x, y: 300, z, yaw: Math.atan2(-x, -z) };
});

export function newPlane() {
  return {
    x: 0, y: 300, z: 0,
    yaw: 0, pitch: 0, roll: 0,
    speed: CFG.SPEED,
    boost: CFG.BOOST_MAX,
    evadeT: 0, evadeDir: 1,
    outside: false,
  };
}

export function forwardOf(p) {
  const cp = Math.cos(p.pitch);
  return { x: Math.sin(p.yaw) * cp, y: Math.sin(p.pitch), z: Math.cos(p.yaw) * cp };
}

// inp: { bank: -1..1 (오른쪽 +), pitch: -1..1 (상승 +), boost: bool, assist: bool }
// 충돌하면 'sea' 또는 'island' 를 돌려줌
export function stepPlane(p, inp, dt) {
  let bank = inp.bank || 0;
  let pitchIn = inp.pitch || 0;

  // 경기장 밖으로 나가면 자동으로 안쪽으로 선회
  const dist = Math.hypot(p.x, p.z);
  p.outside = dist > CFG.ARENA_R;
  if (p.outside) {
    const toC = Math.atan2(-p.x, -p.z);
    bank = clamp(-wrapAngle(toC - p.yaw) * 2, -1, 1);
  }
  if (p.y > CFG.CEIL) pitchIn = Math.min(pitchIn, -0.6);
  if (inp.assist && p.y < 50) pitchIn = Math.max(pitchIn, clamp((50 - p.y) / 25, 0, 1));

  const targetRoll = bank * CFG.MAX_ROLL;
  p.roll += (targetRoll - p.roll) * Math.min(1, dt * CFG.ROLL_RESP);
  p.yaw = wrapAngle(p.yaw - Math.sin(p.roll) * CFG.TURN * dt);

  if (Math.abs(pitchIn) > 0.05) p.pitch += pitchIn * CFG.PITCH_RATE * dt;
  else p.pitch -= p.pitch * Math.min(1, dt * 0.9); // 손을 떼면 자동 수평
  p.pitch = clamp(p.pitch, -CFG.MAX_PITCH, CFG.MAX_PITCH);

  let target = CFG.SPEED;
  if (inp.boost && p.boost > 0) {
    target = CFG.BOOST_SPEED;
    p.boost = Math.max(0, p.boost - CFG.BOOST_DRAIN * dt);
  } else {
    p.boost = Math.min(CFG.BOOST_MAX, p.boost + CFG.BOOST_REGEN * dt);
  }
  if (p.evadeT > 0) {
    target = Math.max(target, CFG.EVADE_SPEED);
    p.evadeT = Math.max(0, p.evadeT - dt);
  }
  target -= Math.sin(p.pitch) * 25; // 내려가면 빨라지고 올라가면 느려짐
  p.speed += (target - p.speed) * Math.min(1, dt * 1.5);

  const f = forwardOf(p);
  p.x += f.x * p.speed * dt;
  p.y += f.y * p.speed * dt;
  p.z += f.z * p.speed * dt;

  if (p.evadeT > 0) {
    const rx = -Math.cos(p.yaw);
    const rz = Math.sin(p.yaw);
    p.x += rx * p.evadeDir * CFG.EV_SLIDE * dt;
    p.z += rz * p.evadeDir * CFG.EV_SLIDE * dt;
  }

  if (p.y < CFG.FLOOR) return 'sea';
  if (solidAt(p.x, p.y, p.z)) return 'island';
  return null;
}

// 선분 a→b 가 중심 c, 반지름 r 인 구와 닿는지
export function segSphere(ax, ay, az, bx, by, bz, cx, cy, cz, r) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len2 = dx * dx + dy * dy + dz * dz || 1e-9;
  let t = ((cx - ax) * dx + (cy - ay) * dy + (cz - az) * dz) / len2;
  t = clamp(t, 0, 1);
  const px = ax + dx * t - cx, py = ay + dy * t - cy, pz = az + dz * t - cz;
  return px * px + py * py + pz * pz <= r * r;
}
