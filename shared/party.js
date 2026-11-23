// 파티 게임(구슬 스모 · 보트 레이스 · 허들 달리기 · 협동 미로) 공용 데이터
// 서버와 브라우저가 같이 씁니다.
import { terrainHeight } from './sim.js';

export const GAMES = {
  sumo: { name: '구슬 스모', desc: '굴려서 밀어 떨어뜨리기', time: '라운드당 30초~1분' },
  boat: { name: '보트 레이스', desc: '섬 사이 물길 레이스', time: '2~3분' },
  dash: { name: '허들 달리기', desc: '버튼 연타 달리기', time: '20초' },
  maze: { name: '협동 미로', desc: '4명이 같이 판 기울이기', time: '2~3분' },
};

// ---------- 구슬 스모 ----------
export const SUMO = {
  R0: 22,            // 처음 판 반지름
  RMIN: 7,           // 가장 작아질 때
  SHRINK_START: 12,  // 이 시간(초)부터 판이 줄어듦
  SHRINK_TIME: 30,
  BALL_R: 1.3,
  ACC: 20,           // 기울기 가속
  DRAG: 1.35,
  BRAKE_DRAG: 5,
  DASH: 17, DASH_CD: 2.2,
  HEAVY_T: 1.5, HEAVY_CD: 5, HEAVY_MASS: 4,
  JUMP_T: 0.8, JUMP_CD: 3, JUMP_H: 3.2,
  WAVE_R: 8, WAVE_IMP: 18, WAVE_CD: 12,
  REST: 1.15,        // 부딪힐 때 튕기는 정도
  ROUND_MAX: 80,     // 라운드 최대 시간
  READY: 3,          // 라운드 시작 전 카운트
  INTER: 3.5,        // 라운드 사이 쉬는 시간
  ITEM_FIRST: 5,     // 번개 아이템 첫 등장(초)
  ITEM_EVERY: 7,     // 먹은 뒤 다음 등장까지
  MEGA_T: 4, MEGA_MASS: 2.5, MEGA_ACC: 1.35,
};
export const sumoAngle = (i) => i * Math.PI / 2 + Math.PI / 4;

// 플레이어 i의 화면 기준 '앞'과 '오른쪽' (x,z 평면)
export function sumoAxes(i) {
  const a = sumoAngle(i);
  const fx = -Math.cos(a), fz = -Math.sin(a);
  return { fx, fz, rx: -fz, rz: fx };
}

// ---------- 보트 레이스 ----------
export const BOAT = {
  WIDTH: 76,
  CRUISE: 62, FAST: 76, SLOW: 30,
  BOOST: 108, BOOST_T: 2.2, BOOST_CD: 6,
  TURN: 1.25,
  ASSIST: 0.55,      // 조종 도우미 세기 (0이면 끔)
  DRIFT_TURN: 1.9,
  OFF_MAX: 34,       // 물길 밖(얕은 물)에서 최고 속도
  RADIUS: 5,
  SPRAY_R: 70, SPRAY_CD: 12, SPRAY_SLOW: 2.2,
  FINISH_WAIT: 20,   // 1등 도착 뒤 기다리는 시간
  PAD_R: 10, PAD_BOOST: 1.4, // 부스터 발판
  TIME_MAX: 300,
};

// 물길 중심선 (섬과 아치 사이를 통과하는 고리)
const TRACK_PTS = [
  [-120, -470], [60, -520], [175, -535], [250, -430], [305, -335], [335, -150], [460, 60],
  [530, 215], [640, 238], [770, 280], [835, 410], [760, 500], [600, 440],
  [430, 350], [220, 345], [20, 400], [-200, 360], [-400, 200], [-480, 260], [-560, 330], [-700, 220],
  [-760, 0], [-800, -330], [-700, -520], [-500, -580], [-300, -560],
];

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [0, 1].map((k) => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
}

// 일정 간격(약 12m)으로 나눈 중심선
export const TRACK = (() => {
  const n = TRACK_PTS.length;
  const dense = [];
  for (let i = 0; i < n; i++) {
    const p0 = TRACK_PTS[(i - 1 + n) % n], p1 = TRACK_PTS[i], p2 = TRACK_PTS[(i + 1) % n], p3 = TRACK_PTS[(i + 2) % n];
    for (let s = 0; s < 40; s++) dense.push(catmull(p0, p1, p2, p3, s / 40));
  }
  const out = [dense[0]];
  let acc = 0;
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1], b = dense[i % dense.length];
    acc += Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (acc >= 12) { out.push(b); acc = 0; }
  }
  if (Math.hypot(out[out.length - 1][0] - out[0][0], out[out.length - 1][1] - out[0][1]) < 6) out.pop();
  return out.map(([x, z]) => ({ x, z }));
})();
export const TRACK_LEN = TRACK.reduce((s, p, i) => {
  const q = TRACK[(i + 1) % TRACK.length];
  return s + Math.hypot(q.x - p.x, q.z - p.z);
}, 0);

// 점 (x,z)에서 가장 가까운 중심선 위치. hint 근처만 찾음 (없으면 전체)
export function trackNearest(x, z, hint = -1) {
  const N = TRACK.length;
  let best = { d: Infinity, i: 0, t: 0, side: 0 };
  const from = hint < 0 ? 0 : hint - 6, to = hint < 0 ? N : hint + 7;
  for (let k = from; k < to; k++) {
    const i = ((k % N) + N) % N;
    const a = TRACK[i], b = TRACK[(i + 1) % N];
    const vx = b.x - a.x, vz = b.z - a.z;
    const L2 = vx * vx + vz * vz;
    let t = ((x - a.x) * vx + (z - a.z) * vz) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = a.x + vx * t, pz = a.z + vz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.d) {
      const side = Math.sign(vx * (z - a.z) - vz * (x - a.x));
      best = { d, i, t, side, dx: vx / Math.sqrt(L2), dz: vz / Math.sqrt(L2) };
    }
  }
  return best;
}

// 물 위의 부스터 발판 (물길 위치 비율, 옆으로 비킨 거리)
export const BOOST_PADS = [[0.09, -14], [0.22, 16], [0.36, 0], [0.5, -16], [0.63, 14], [0.77, -10], [0.9, 12]].map(([f, off]) => {
  const N = TRACK.length;
  const i = Math.floor(f * N);
  const a = TRACK[i], b = TRACK[(i + 1) % N];
  const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
  return { x: a.x - (dz / L) * off, z: a.z + (dx / L) * off, yaw: Math.atan2(dz, dx), seg: i };
});

export function boatGrid(slot) {
  // 출발선 뒤로 2줄 2칸
  const N = TRACK.length;
  const i = (N - 3 - (slot >> 1) * 2 + N) % N;
  const a = TRACK[i], b = TRACK[(i + 1) % N];
  const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
  const nx = -dz / L, nz = dx / L;
  const off = (slot & 1 ? 1 : -1) * 14;
  return { x: a.x + nx * off, z: a.z + nz * off, yaw: Math.atan2(dz, dx), seg: i };
}

export const isLand = (x, z) => terrainHeight(x, z) > -0.5;

// ---------- 허들 달리기 ----------
export const DASH = {
  LEN: 110,
  STEP: 1.45,        // 한 걸음마다 붙는 속도
  DRAG: 1.05,
  VMAX: 13,
  HURDLES: [26, 46, 64, 82, 98],
  JUMP_T: 0.55,
  STUMBLE_T: 0.7,
  SPURT_T: 2, SPURT_MULT: 1.5,
  LANE_W: 2.2,
  TIME_MAX: 45,
};
export const laneZ = (i) => (i - 1.5) * DASH.LANE_W;

// ---------- 협동 미로 ----------
export const MAZE = {
  CELL: 2,
  BALL_R: 0.55,
  HOLE_R: 0.72,
  ACC: 10,
  DRAG: 0.75,
  TILT_VIS: 0.17,     // 판이 보이는 기울기(라디안)
  JUMP_T: 0.7,
  JUMP_WIN: 0.6,      // 이 시간 안에 같이 눌러야 점프
  PENALTY: 5,
  STAR_BONUS: 3,
  TIME_MAX: 240,
};

// # 벽  . 바닥  O 구멍  S 출발  C 체크포인트  G 골  * 보너스 별(-3초)
export const MAZE_LEVELS = [
  {
    name: '1단계 · 연습',
    map: [
      '###############',
      '#S....#......*#',
      '#.###.#.##.##.#',
      '#...#...#...#.#',
      '###.#####.#.#.#',
      '#*........#O..#',
      '#.##O#.####.#.#',
      '#..........C#.#',
      '#.#####.##.##.#',
      '#*....O.....#G#',
      '###############',
    ],
  },
  {
    name: '2단계 · 구멍 지대',
    map: [
      '#################',
      '#S..#.....O....*#',
      '#.#.#.###.#.###.#',
      '#.#...#O#...#O..#',
      '#.#####.#####.###',
      '#.........C.....#',
      '###.#.#.O.#.#O#.#',
      '#*O.#...#...#...#',
      '#.###.#.#.###.#.#',
      '#.....#O...*#..G#',
      '#################',
    ],
  },
  {
    name: '3단계 · 마지막 관문',
    map: [
      '#################',
      '#S.......#*....O#',
      '#..#.###.#.##.#.#',
      '##.#..O#...#..#.#',
      '#..###.#.#.#.##.#',
      '#......C.#...O..#',
      '#.#.####.###.##.#',
      '#.#...O.....O#*.#',
      '#.#O#.###.#.##.##',
      '#*..#.....#....G#',
      '#################',
    ],
  },
];

export function parseMaze(level) {
  const rows = level.map;
  const H = rows.length, W = rows[0].length;
  const C = MAZE.CELL;
  const cx = (c) => (c - (W - 1) / 2) * C;
  const cz = (r) => (r - (H - 1) / 2) * C;
  const out = { W, H, walls: [], holes: [], checkpoints: [], stars: [], start: null, goal: null, cx, cz, grid: rows };
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const ch = rows[r][c];
      const p = { x: cx(c), z: cz(r), r, c };
      if (ch === '#') out.walls.push(p);
      else if (ch === 'O') out.holes.push(p);
      else if (ch === 'S') out.start = p;
      else if (ch === 'G') out.goal = p;
      else if (ch === 'C') out.checkpoints.push(p);
      else if (ch === '*') out.stars.push(p);
    }
  }
  return out;
}
