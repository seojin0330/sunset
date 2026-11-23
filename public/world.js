// 노을 지는 바다, 하늘, 섬, 아치, 돌기둥, 등대, 새, 먼 산맥
import * as THREE from 'three';
import { ISLANDS, STACKS, ARCHES, LIGHTHOUSE, islandHeight, fbm, vnoise } from '/shared/sim.js';

export const SUN_DIR = new THREE.Vector3(-0.35, 0.085, -1).normalize();
const FOG_DENSITY = 0.00036;

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------- 하늘 ----------------
const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const skyFrag = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uFog;
varying vec3 vDir;
float h21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5); }
void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 mid = vec3(0.55, 0.16, 0.20);
  vec3 top = vec3(0.03, 0.025, 0.10);
  vec3 col = mix(uFog, mid, smoothstep(0.0, 0.22, y));
  col = mix(col, top, smoothstep(0.18, 0.75, y));
  if (y < 0.0) col = uFog;
  float s = max(dot(d, uSunDir), 0.0);
  col += vec3(1.0, 0.45, 0.18) * pow(s, 6.0) * 0.55;
  col += vec3(1.0, 0.75, 0.45) * pow(s, 90.0) * 1.2;
  col += vec3(1.0, 0.9, 0.7) * smoothstep(0.9993, 0.9997, s) * 6.0;
  // 높은 하늘의 별 몇 개
  vec2 g = floor(d.xz / (d.y + 0.3) * 160.0);
  float st = step(0.997, h21(g)) * smoothstep(0.35, 0.8, y);
  col += vec3(1.0, 0.92, 0.85) * st * 0.9;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ---------------- 바다 ----------------
const N_ISL = ISLANDS.length;
const waterVert = /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  float h = sin(w.x * 0.021 + uTime * 1.1) * 1.3
          + sin(w.z * 0.027 + uTime * 0.85) * 1.1
          + sin((w.x + w.z) * 0.052 + uTime * 1.7) * 0.45;
  w.y += h;
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const waterFrag = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uFog;
uniform float uFogDensity;
uniform vec3 uIsl[${N_ISL}];
varying vec3 vWorld;
void main() {
  vec2 q = vWorld.xz;
  // 파도 함수를 미분해서 부드러운 법선 (격자 무늬 방지)
  float c1 = cos(q.x * 0.021 + uTime * 1.1), c2 = cos(q.y * 0.027 + uTime * 0.85), c3 = cos((q.x + q.y) * 0.052 + uTime * 1.7);
  float dhdx = 1.3 * 0.021 * c1 + 0.45 * 0.052 * c3;
  float dhdz = 1.1 * 0.027 * c2 + 0.45 * 0.052 * c3;
  vec3 n = normalize(vec3(-dhdx, 1.0, -dhdz));
  n = normalize(n + vec3(
    sin(q.x * 0.31 + uTime * 2.0) * 0.05 + sin(q.y * 0.23 - uTime * 1.7) * 0.05,
    0.0,
    cos(q.y * 0.29 + uTime * 2.3) * 0.05 + cos(q.x * 0.21 + uTime * 1.3) * 0.05));
  vec3 v = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);

  // 섬 주변 얕은 바다
  float sh = 0.0;
  for (int i = 0; i < ${N_ISL}; i++) {
    float d = length(q - uIsl[i].xy);
    sh = max(sh, 1.0 - smoothstep(uIsl[i].z * 0.8, uIsl[i].z * 1.55, d));
  }
  vec3 deep = mix(vec3(0.012, 0.02, 0.055), vec3(0.03, 0.17, 0.16), sh * 0.85);
  vec3 skyRefl = vec3(0.6, 0.2, 0.09);
  vec3 r = reflect(-v, n);
  float sd = max(dot(r, uSunDir), 0.0);
  float spec = pow(sd, 220.0) * 4.0 + pow(sd, 18.0) * 0.35;
  vec3 col = mix(deep, skyRefl, clamp(fres * 0.9 + 0.04, 0.0, 1.0));
  col += vec3(1.0, 0.7, 0.4) * spec;
  float dist = length(cameraPosition - vWorld);
  float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFog, clamp(fog, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ---------------- 섬 ----------------
const C = {
  sand: [0.86, 0.66, 0.42],
  wet: [0.42, 0.33, 0.26],
  grass1: [0.2, 0.31, 0.11],
  grass2: [0.3, 0.38, 0.14],
  dry: [0.5, 0.44, 0.22],
  rock: [0.44, 0.33, 0.28],
  rock2: [0.33, 0.25, 0.23],
};

function islandMesh(isl) {
  const S = isl.r * 1.2;
  const N = Math.max(36, Math.min(84, Math.round((2 * S) / 6.5)));
  const step = (2 * S) / N;
  const H = [];
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const x = isl.x - S + i * step, z = isl.z - S + j * step;
      const h = islandHeight(isl, x, z);
      H.push(h >= 0 ? h : -14);
    }
  }
  const at = (i, j) => H[j * (N + 1) + i];
  const pos = [];
  const col = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const tri = (i0, j0, i1, j1, i2, j2) => {
    const y0 = at(i0, j0), y1 = at(i1, j1), y2 = at(i2, j2);
    if (y0 < -5 && y1 < -5 && y2 < -5) return;
    a.set(-S + i0 * step, y0, -S + j0 * step);
    b.set(-S + i1 * step, y1, -S + j1 * step);
    c.set(-S + i2 * step, y2, -S + j2 * step);
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    e1.subVectors(b, a); e2.subVectors(c, a);
    const ny = Math.abs(e1.cross(e2).normalize().y);
    const y = (y0 + y1 + y2) / 3;
    const hr = y / isl.h;
    const n = vnoise((a.x + isl.x) * 0.05, (a.z + isl.z) * 0.05, isl.seed);
    let base;
    if (y < 0) base = C.wet;
    else if (y < 4) base = C.sand;
    else if (ny < 0.6) base = n > 0.5 ? C.rock : C.rock2;
    else if (hr > 0.8 && isl.type !== 'mesa') base = C.rock2;
    else if (isl.type === 'mesa' && hr > 0.55) base = n > 0.4 ? C.dry : C.grass2;
    else base = n > 0.5 ? C.grass1 : C.grass2;
    const k = 0.88 + n * 0.24;
    for (let q = 0; q < 3; q++) col.push(base[0] * k, base[1] * k, base[2] * k);
  };
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      if ((i + j) % 2) { tri(i, j, i, j + 1, i + 1, j); tri(i + 1, j, i, j + 1, i + 1, j + 1); }
      else { tri(i, j, i, j + 1, i + 1, j + 1); tri(i, j, i + 1, j + 1, i + 1, j); }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
  mesh.position.set(isl.x, 0, isl.z);
  return mesh;
}

function shoreRadius(isl, ang) {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  let last = 0;
  for (let d = 0; d < isl.r * 1.2; d += 2) {
    if (islandHeight(isl, isl.x + ca * d, isl.z + sa * d) > 0.4) last = d;
  }
  return last;
}

// 해안의 하얀 파도
function foamRing(cx, cz, radiusAt, inner, outer) {
  const seg = 96;
  const pos = [], col = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const ang = (i / seg) * Math.PI * 2;
    const r = radiusAt(ang);
    const ca = Math.cos(ang), sa = Math.sin(ang);
    pos.push(cx + ca * (r - inner), 1.0, cz + sa * (r - inner));
    pos.push(cx + ca * (r + outer), 1.0, cz + sa * (r + outer));
    col.push(1, 0.95, 0.9, 0.7, 1, 0.95, 0.9, 0);
    if (i < seg) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  geo.setIndex(idx);
  return geo;
}

// 나무와 바위
function scatter(scene) {
  const rnd = mulberry(777);
  const trees = [], bushes = [], rocks = [];
  for (const isl of ISLANDS) {
    const tries = Math.round(isl.r * 1.6);
    for (let k = 0; k < tries; k++) {
      const ang = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * isl.r;
      const x = isl.x + Math.cos(ang) * d, z = isl.z + Math.sin(ang) * d;
      const h = islandHeight(isl, x, z);
      if (h < 0.5) continue;
      if (Math.hypot(x - LIGHTHOUSE.x, z - LIGHTHOUSE.z) < 25) continue;
      const hx = islandHeight(isl, x + 3, z) - h, hz = islandHeight(isl, x, z + 3) - h;
      const slope = Math.hypot(hx, hz) / 3;
      if (h < 4.5) { if (rnd() < 0.25) rocks.push([x, h, z, 1.5 + rnd() * 3.5, rnd()]); continue; }
      if (slope > 0.9) { if (rnd() < 0.15) rocks.push([x, h, z, 2 + rnd() * 4, rnd()]); continue; }
      if (h / isl.h > 0.8 && isl.type !== 'mesa') continue;
      if (vnoise(x * 0.02, z * 0.02, 5) < 0.42) continue; // 숲이 뭉쳐 있게
      (rnd() < 0.7 ? trees : bushes).push([x, h, z, 0.8 + rnd() * 0.8, rnd()]);
    }
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const inst = (geo, mat, list, yOff, scl) => {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach(([x, y, z, sc, r], i) => {
      q.setFromAxisAngle(up, r * 6.28);
      s.set(sc * scl[0], sc * scl[1], sc * scl[2]);
      p.set(x, y + yOff * sc, z);
      m4.compose(p, q, s);
      im.setMatrixAt(i, m4);
    });
    im.instanceMatrix.needsUpdate = true;
    scene.add(im);
  };
  const flat = (color) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9 });
  inst(new THREE.ConeGeometry(3.2, 10, 6), flat(0x3a6a2c), trees, 7, [1, 1, 1]);
  inst(new THREE.CylinderGeometry(0.5, 0.7, 3, 5), flat(0x6a4630), trees, 1.2, [1, 1, 1]);
  inst(new THREE.IcosahedronGeometry(3.2, 0), flat(0x4f7a30), bushes, 2, [1, 0.8, 1]);
  inst(new THREE.DodecahedronGeometry(1, 0), flat(0x8a7466), rocks, 0.2, [1, 0.7, 1.2]);
}

function rockyColumn(rBottom, rTop, h, seed) {
  const geo = new THREE.CylinderGeometry(rTop, rBottom, h, 9, 7);
  const p = geo.attributes.position;
  const col = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = vnoise(x * 0.15 + seed, y * 0.08, seed);
    const k = 0.8 + n * 0.45;
    p.setXYZ(i, x * k, y, z * k);
  }
  const g2 = geo.toNonIndexed();
  const p2 = g2.attributes.position;
  for (let i = 0; i < p2.count; i += 3) {
    const y = (p2.getY(i) + p2.getY(i + 1) + p2.getY(i + 2)) / 3;
    const t = (y + h / 2) / h;
    const n = vnoise(p2.getX(i) * 0.2, y * 0.2, seed);
    let c = n > 0.5 ? C.rock : C.rock2;
    if (t > 0.93) c = C.grass2;
    if (t < 0.06) c = C.wet;
    for (let q = 0; q < 3; q++) col.push(c[0], c[1], c[2]);
  }
  g2.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g2.computeVertexNormals();
  return g2;
}

const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });

function buildStacks(scene) {
  for (const s of STACKS) {
    const m = new THREE.Mesh(rockyColumn(s.r * 1.1, s.r * 0.75, s.h + 6, s.seed), rockMat);
    m.position.set(s.x, (s.h + 6) / 2 - 6, s.z);
    scene.add(m);
  }
}

function buildArches(scene) {
  for (const a of ARCHES) {
    for (const pt of [a.p1, a.p2]) {
      const m = new THREE.Mesh(rockyColumn(a.thick * 1.25, a.thick * 0.95, a.height + 8, a.span), rockMat);
      m.position.set(pt.x, (a.height + 8) / 2 - 8, pt.z);
      scene.add(m);
    }
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pts.push(new THREE.Vector3(
        a.p1.x + (a.p2.x - a.p1.x) * t,
        a.height - 4 + Math.sin(t * Math.PI) * 6,
        a.p1.z + (a.p2.z - a.p1.z) * t,
      ));
    }
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, a.thick * 0.95, 9, false);
    const p = tube.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = vnoise(x * 0.12, z * 0.12 + y * 0.1, 3) - 0.5;
      p.setY(i, y + n * 5 + (y > a.height ? 2 : 0));
    }
    const g2 = tube.toNonIndexed();
    const col = [];
    const p2 = g2.attributes.position;
    for (let i = 0; i < p2.count; i += 3) {
      const y = (p2.getY(i) + p2.getY(i + 1) + p2.getY(i + 2)) / 3;
      const c = y > a.height + a.thick * 0.6 ? C.grass2 : vnoise(p2.getX(i) * 0.2, p2.getZ(i) * 0.2, 9) > 0.5 ? C.rock : C.rock2;
      for (let q = 0; q < 3; q++) col.push(c[0], c[1], c[2]);
    }
    g2.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g2.computeVertexNormals();
    scene.add(new THREE.Mesh(g2, rockMat));
  }
}

function buildLighthouse(scene) {
  const L = LIGHTHOUSE;
  const base = islandHeight(ISLANDS[2], L.x, L.z) - 1;
  const g = new THREE.Group();
  g.position.set(L.x, base, L.z);
  const white = new THREE.MeshStandardMaterial({ color: 0xf2ece2, roughness: 0.6, flatShading: true });
  const red = new THREE.MeshStandardMaterial({ color: 0xc23a2e, roughness: 0.6, flatShading: true });
  const seg = 5;
  for (let i = 0; i < seg; i++) {
    const h = L.tower / seg;
    const r0 = 5.6 - (i / seg) * 1.6, r1 = 5.6 - ((i + 1) / seg) * 1.6;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, h, 12), i % 2 ? red : white);
    m.position.y = h * i + h / 2;
    g.add(m);
  }
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.2, 0.8, 12), new THREE.MeshStandardMaterial({ color: 0x2a2a2e }));
  deck.position.y = L.tower + 0.4;
  g.add(deck);
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 4, 10), new THREE.MeshBasicMaterial({ color: 0xffe2a0, toneMapped: false }));
  lamp.position.y = L.tower + 2.8;
  g.add(lamp);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(4, 4, 10), red);
  roof.position.y = L.tower + 6.8;
  g.add(roof);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffe0a0, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
  });
  const beams = new THREE.Group();
  beams.position.y = L.tower + 2.8;
  for (const dir of [1, -1]) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(16, 260, 16, 1, true).rotateZ(dir * Math.PI / 2), beamMat);
    cone.position.x = dir * 130;
    beams.add(cone);
  }
  g.add(beams);
  scene.add(g);
  return beams;
}

// 섬 주위를 도는 새 떼
function buildBirds(scene) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0.6, -2.2, 0.5, -0.4, 0, 0, -0.4,
    0, 0, 0.6, 0, 0, -0.4, 2.2, 0.5, -0.4,
  ], 3));
  geo.computeVertexNormals();
  const flocks = [
    { cx: 0, cz: 0, r: 160, y: 190, n: 9 },
    { cx: 520, cz: -300, r: 120, y: 150, n: 7 },
    { cx: -300, cz: 600, r: 140, y: 120, n: 8 },
    { cx: -560, cz: -260, r: 110, y: 130, n: 6 },
  ];
  const total = flocks.reduce((s, f) => s + f.n, 0);
  const im = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0x1a1216, side: THREE.DoubleSide }), total);
  const birds = [];
  const rnd = mulberry(99);
  for (const f of flocks) {
    for (let i = 0; i < f.n; i++) {
      birds.push({ f, off: rnd() * 0.9, dr: (rnd() - 0.5) * 30, dy: (rnd() - 0.5) * 16, ph: rnd() * 6, sp: 0.18 + rnd() * 0.05 });
    }
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  scene.add(im);
  return (t) => {
    birds.forEach((b, i) => {
      const a = t * b.sp + b.off;
      const r = b.f.r + b.dr;
      p.set(b.f.cx + Math.cos(a) * r, b.f.y + b.dy + Math.sin(t * 0.7 + b.ph) * 4, b.f.cz + Math.sin(a) * r);
      e.set(0, -a, 0.35);
      q.setFromEuler(e);
      const flap = 0.4 + Math.abs(Math.sin(t * 7 + b.ph)) * 1.2;
      s.set(1.6, flap * 1.6, 1.6);
      m4.compose(p, q, s);
      im.setMatrixAt(i, m4);
    });
    im.instanceMatrix.needsUpdate = true;
  };
}

// 겹겹이 보이는 먼 산맥
function buildRanges(scene) {
  const layers = [
    { r: 3300, base: 40, amp: 480, color: 0x6a3242, seed: 3 },
    { r: 4300, base: 100, amp: 720, color: 0x8c4249, seed: 7 },
    { r: 5400, base: 180, amp: 980, color: 0xae5a4e, seed: 13 },
  ];
  for (let li = layers.length - 1; li >= 0; li--) {
    const L = layers[li];
    const seg = 420;
    const pos = [], idx = [];
    for (let i = 0; i <= seg; i++) {
      const ang = (i / seg) * Math.PI * 2;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      let n = fbm(ca * 3.2 + L.seed, sa * 3.2 + L.seed, L.seed);
      const ridge = 1 - Math.abs(vnoise(ca * 14 + L.seed, sa * 14, L.seed + 4) * 2 - 1);
      n = Math.pow(n, 1.6) * 1.4 + ridge * 0.22 + vnoise(ca * 40, sa * 40, L.seed) * 0.06;
      // 해가 지는 쪽은 낮게 열어 둠
      const sunSide = Math.max(0, ca * SUN_DIR.x + sa * SUN_DIR.z);
      const h = L.base + L.amp * n * (1 - Math.pow(sunSide, 6) * 0.75);
      pos.push(ca * L.r, -40, sa * L.r, ca * L.r, h, sa * L.r);
      if (i < seg) {
        const k = i * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: L.color, fog: false, side: THREE.DoubleSide }));
    m.renderOrder = -5 + li;
    scene.add(m);
  }
}

function cloudTexture(seed) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const rnd = mulberry(seed);
  for (let i = 0; i < 14; i++) {
    const x = 50 + rnd() * 156;
    const y = 54 + (rnd() - 0.5) * 40 - Math.sin(((x - 50) / 156) * Math.PI) * 14;
    const r = 22 + rnd() * 30;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.25)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildClouds() {
  const g = new THREE.Group();
  const texes = [cloudTexture(1), cloudTexture(2), cloudTexture(3)];
  const rnd = mulberry(21);
  for (let i = 0; i < 46; i++) {
    const a = rnd() * Math.PI * 2;
    const d = 200 + Math.sqrt(rnd()) * 2600;
    const low = i % 4 === 0;
    const y = low ? 230 + rnd() * 120 : 420 + rnd() * 260;
    const w = 160 + rnd() * 260;
    const mat = new THREE.SpriteMaterial({
      map: texes[i % 3],
      color: new THREE.Color().setHSL(0.03 + rnd() * 0.04, 0.7, 0.72 + rnd() * 0.12),
      transparent: true,
      opacity: low ? 0.6 : 0.8,
      depthWrite: false,
    });
    const s = new THREE.Sprite(mat);
    s.position.set(Math.cos(a) * d, y, Math.sin(a) * d);
    s.scale.set(w, w * 0.45, 1);
    g.add(s);
  }
  return g;
}

export function createWorld() {
  const scene = new THREE.Scene();
  const fogColor = new THREE.Color(0xc65f3c);
  scene.fog = new THREE.FogExp2(fogColor, FOG_DENSITY);
  scene.background = fogColor;

  scene.add(new THREE.HemisphereLight(0xff9a6a, 0x182040, 1.15));
  const sun = new THREE.DirectionalLight(0xffb27a, 2.6);
  sun.position.copy(SUN_DIR).multiplyScalar(1000);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x6a70ff, 0.35);
  fill.position.set(0.5, 0.6, 1);
  scene.add(fill);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1000, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: { uSunDir: { value: SUN_DIR }, uFog: { value: fogColor } },
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  scene.add(sky);

  const waterMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: SUN_DIR },
      uFog: { value: fogColor },
      uFogDensity: { value: FOG_DENSITY },
      uIsl: { value: ISLANDS.map((i) => new THREE.Vector3(i.x, i.z, i.r)) },
    },
    vertexShader: waterVert,
    fragmentShader: waterFrag,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000, 180, 180).rotateX(-Math.PI / 2), waterMat);
  water.frustumCulled = false;
  scene.add(water);

  for (const isl of ISLANDS) scene.add(islandMesh(isl));
  scatter(scene);
  buildStacks(scene);
  buildArches(scene);
  const beams = buildLighthouse(scene);
  const birds = buildBirds(scene);
  buildRanges(scene);

  const foamMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, opacity: 0.7 });
  for (const isl of ISLANDS) {
    const rs = [];
    for (let i = 0; i <= 96; i++) rs.push(shoreRadius(isl, (i / 96) * Math.PI * 2));
    const geo = foamRing(isl.x, isl.z, (ang) => rs[Math.round((ang / (Math.PI * 2)) * 96)], 4, 10);
    scene.add(new THREE.Mesh(geo, foamMat));
  }
  for (const s of [...STACKS, ...ARCHES.flatMap((a) => [{ ...a.p1, r: a.thick * 1.2 }, { ...a.p2, r: a.thick * 1.2 }])]) {
    scene.add(new THREE.Mesh(foamRing(s.x, s.z, () => s.r * 1.05, 1, 6), foamMat));
  }

  const clouds = buildClouds();
  scene.add(clouds);

  return {
    scene,
    update(dt, t, cam) {
      waterMat.uniforms.uTime.value = t;
      const step = 50;
      water.position.set(Math.round(cam.position.x / step) * step, 0, Math.round(cam.position.z / step) * step);
      sky.position.copy(cam.position);
      if (dt > 0) {
        for (const c of clouds.children) {
          c.position.x += dt * 4;
          if (c.position.x > 2900) c.position.x -= 5800;
        }
        beams.rotation.y = t * 0.6;
        foamMat.opacity = 0.55 + Math.sin(t * 1.3) * 0.2;
        birds(t);
      }
    },
  };
}
