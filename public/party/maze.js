// 협동 미로 화면 (모두의 기울기 평균으로 판이 기울어짐)
import * as THREE from 'three';
import { MAZE, MAZE_LEVELS, parseMaze } from '/shared/party.js';
import { blobShadow, Puffs, Rings, disposeTree, softDot } from './util.js';

const M0 = new THREE.Vector3(-420, 150, -620);

function floorTexture(W, H) {
  const PX = 64;
  const c = document.createElement('canvas');
  c.width = W * PX; c.height = H * PX;
  const g = c.getContext('2d');
  g.fillStyle = '#e8cf9c'; g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < W * H * 8; i++) {
    g.fillStyle = `rgba(120,70,30,${Math.random() * 0.06})`;
    g.fillRect(Math.random() * c.width, Math.random() * c.height, 30 + Math.random() * 60, 2);
  }
  g.strokeStyle = 'rgba(120,70,30,0.12)'; g.lineWidth = 2;
  for (let x = 0; x <= W; x++) { g.beginPath(); g.moveTo(x * PX, 0); g.lineTo(x * PX, c.height); g.stroke(); }
  for (let y = 0; y <= H; y++) { g.beginPath(); g.moveTo(0, y * PX); g.lineTo(c.width, y * PX); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

let holeTex = null;
function holeTexture() {
  if (holeTex) return holeTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 10, 64, 64, 64);
  gr.addColorStop(0, '#000'); gr.addColorStop(0.7, '#0a0408'); gr.addColorStop(0.86, '#3a1d12'); gr.addColorStop(1, 'rgba(58,29,18,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  holeTex = new THREE.CanvasTexture(c);
  return holeTex;
}

export function create(core) {
  const { scene, sfx, TV, COLOR_CSS } = core;
  const C = MAZE.CELL;
  const root = new THREE.Group();
  root.position.copy(M0);
  scene.add(root);
  const board = new THREE.Group();
  root.add(board);
  // 받침대
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(6, 10, 40, 10), new THREE.MeshStandardMaterial({ color: 0x6b4038, roughness: 1, flatShading: true }));
  pedestal.position.y = -22;
  root.add(pedestal);

  const ballMat = new THREE.MeshStandardMaterial({ color: 0xf4f0ff, metalness: 0.35, roughness: 0.18, emissive: 0x221a2a });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(MAZE.BALL_R, 32, 20), ballMat);
  const ballShadow = blobShadow(MAZE.BALL_R);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: 0xffe0a0, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.scale.set(2.4, 2.4, 1);
  const puffs = new Puffs(board, 300);
  const rings = new Rings(board);

  let level = null;     // 지금 판의 3D 물체들
  let levelIdx = -1;
  let parsed = null;
  let cpMeshes = [];
  let starMeshes = [];
  let goalObj = null;

  function buildLevel(i) {
    if (level) { board.remove(level); disposeTree(level); }
    levelIdx = i;
    parsed = parseMaze(MAZE_LEVELS[i]);
    const { W, H } = parsed;
    level = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(W * C + 1.6, 1, H * C + 1.6), new THREE.MeshStandardMaterial({ color: 0x7a4a2e, roughness: 0.9 }));
    base.position.y = -0.52;
    level.add(base);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W * C, H * C).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: floorTexture(W, H), roughness: 0.85, emissive: 0x2a1a10 }));
    floor.position.y = 0.002;
    level.add(floor);
    const wallGeo = new THREE.BoxGeometry(C, 1.1, C);
    wallGeo.translate(0, 0.55, 0);
    const walls = new THREE.InstancedMesh(wallGeo, new THREE.MeshStandardMaterial({ color: 0xc87a50, roughness: 0.8, emissive: 0x3a1a0e }), parsed.walls.length);
    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();
    parsed.walls.forEach((w, k) => {
      m4.makeTranslation(w.x, 0, w.z);
      walls.setMatrixAt(k, m4);
      const edge = w.r === 0 || w.c === 0 || w.r === H - 1 || w.c === W - 1;
      walls.setColorAt(k, col.setHex(edge ? 0x7c4630 : 0xb06a44));
    });
    level.add(walls);
    const holeMat = new THREE.MeshBasicMaterial({ map: holeTexture(), transparent: true, depthWrite: false });
    for (const h of parsed.holes) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(MAZE.HOLE_R * 2.6, MAZE.HOLE_R * 2.6).rotateX(-Math.PI / 2), holeMat);
      m.position.set(h.x, 0.01, h.z);
      level.add(m);
    }
    const start = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.85, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x38d870 }));
    start.position.set(parsed.start.x, 0.02, parsed.start.z);
    level.add(start);
    cpMeshes = parsed.checkpoints.map((cp) => {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.8), new THREE.MeshStandardMaterial({ color: 0xffffff }));
      pole.position.set(0.7, 0.9, -0.7);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.45), new THREE.MeshBasicMaterial({ color: 0x3d8bff, side: THREE.DoubleSide }));
      flag.position.set(1.05, 1.55, -0.7);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.85, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3d8bff }));
      ring.position.y = 0.02;
      g.add(pole, flag, ring);
      g.position.set(cp.x, 0, cp.z);
      level.add(g);
      return { g, flag, ring };
    });
    starMeshes = parsed.stars.map((o) => {
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.42), new THREE.MeshStandardMaterial({ color: 0xffe066, emissive: 0xb08000 }));
      m.position.set(o.x, 0.7, o.z);
      level.add(m);
      return m;
    });
    goalObj = new THREE.Group();
    const gring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.9, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd24a }));
    gring.position.y = 0.02;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 2.6, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = 1.3;
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.45), new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0xaa7a10 }));
    star.position.y = 1.4;
    goalObj.add(gring, beam, star);
    goalObj.userData.star = star;
    goalObj.position.set(parsed.goal.x, 0, parsed.goal.z);
    level.add(goalObj);
    board.add(level);
    board.add(ball, ballShadow, glow);
  }

  const camera = new THREE.PerspectiveCamera(48, 1, 0.3, 14000);

  // 화면 정보
  const hud = core.hud;
  hud.innerHTML = `
    <div class="g-top"><div class="g-pill" id="m-lv"></div><div class="g-pill" id="m-time"></div><div class="g-pill" id="m-falls"></div></div>
    <canvas class="m-tilt" id="m-tilt" width="400" height="400"></canvas>
    <div class="m-jump" id="m-jump"></div>
    <div class="g-tip" id="m-tip">4명 기울기의 평균으로 판이 기울어짐</div>
    <div class="g-big" id="m-big"></div>`;
  const el = (id) => hud.querySelector(`#${id}`);
  const tiltC = el('m-tilt');
  let bigTimer = 0;
  function big(text, ms = 1600) {
    el('m-big').textContent = text;
    clearTimeout(bigTimer);
    bigTimer = setTimeout(() => { el('m-big').textContent = ''; }, ms);
  }

  let lastCp = -1;
  return {
    camera,
    frame(dt, t) {
      const sm = core.sample();
      if (!sm) { core.render(camera); return; }
      const s = sm.b;
      if (s.lv !== levelIdx) { buildLevel(s.lv); lastCp = -1; }
      const L = (k) => (sm.a.lv === sm.b.lv ? sm.a[k] + (sm.b[k] - sm.a[k]) * sm.f : sm.b[k]);
      const tx = L('tx'), ty = L('ty');
      board.rotation.set(-ty * MAZE.TILT_VIS, 0, -tx * MAZE.TILT_VIS);
      const x = L('x'), z = L('z'), y = L('y');
      const falling = y < -0.01;
      ball.position.set(x, MAZE.BALL_R + y, z);
      ball.scale.setScalar(falling ? Math.max(0.2, 1 + y * 0.25) : 1);
      const mx = x - (ball.userData.px ?? x), mz = z - (ball.userData.pz ?? z), md = Math.hypot(mx, mz);
      if (md > 1e-4 && md < 2) ball.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(mz / md, 0, -mx / md), md / MAZE.BALL_R));
      ball.userData.px = x; ball.userData.pz = z;
      ballShadow.position.set(x, 0.03, z);
      ballShadow.visible = !falling;
      ballShadow.scale.setScalar(1 / (1 + Math.max(0, y)));
      glow.position.set(x, MAZE.BALL_R + y, z);
      if (goalObj) {
        goalObj.userData.star.rotation.y = t * 2;
        goalObj.userData.star.position.y = 1.4 + Math.sin(t * 3) * 0.15;
      }
      const got = new Set(s.sg || []);
      starMeshes.forEach((m, i) => {
        m.visible = !got.has(i);
        m.rotation.y = t * 3 + i;
        m.position.y = 0.7 + Math.sin(t * 4 + i) * 0.12;
      });
      cpMeshes.forEach((c, i) => {
        const on = i === s.cp;
        c.flag.material.color.setHex(on ? 0x38d870 : 0x3d8bff);
        c.ring.material.color.setHex(on ? 0x38d870 : 0x3d8bff);
        c.flag.rotation.y = Math.sin(t * 5 + i) * 0.4;
      });
      puffs.update(dt);
      rings.update(dt);

      // 카메라: 판 전체가 보이게
      const span = parsed ? Math.max(parsed.W * C * 0.62, parsed.H * C) : 30;
      camera.position.set(M0.x, M0.y + span * 1.18, M0.z + span * 0.7);
      camera.lookAt(M0.x, M0.y, M0.z + 0.8);
      core.render(camera);

      // 화면 정보
      el('m-lv').textContent = MAZE_LEVELS[s.lv].name;
      el('m-time').innerHTML = `${(s.tm + s.pen - (s.bon || 0)).toFixed(1)}초${s.pen ? `<small>벌점 +${s.pen}</small>` : ''}${s.bon ? `<small>별 -${s.bon}</small>` : ''}`;
      el('m-falls').textContent = `빠짐 ${s.falls}`;
      el('m-jump').innerHTML = `<i class="cap red"></i>다 같이 누르면 점프 <span style="color:#ffd24a">${s.have}/${s.need}명</span>`;

      // 기울기 그림
      const g = tiltC.getContext('2d');
      const W = tiltC.width, cx = W / 2, R = W * 0.42;
      g.clearRect(0, 0, W, W);
      g.fillStyle = 'rgba(10,6,14,0.6)';
      g.beginPath(); g.arc(cx, cx, W / 2 - 2, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 3;
      g.beginPath(); g.arc(cx, cx, R, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(cx - R, cx); g.lineTo(cx + R, cx); g.moveTo(cx, cx - R); g.lineTo(cx, cx + R); g.stroke();
      const arrow = (ax, ay, color, w) => {
        const ex = cx + ax * R, ey = cx - ay * R;
        g.strokeStyle = color; g.fillStyle = color; g.lineWidth = w; g.lineCap = 'round';
        g.beginPath(); g.moveTo(cx, cx); g.lineTo(ex, ey); g.stroke();
        g.beginPath(); g.arc(ex, ey, w * 1.3, 0, Math.PI * 2); g.fill();
      };
      for (const [slot, px, py] of s.p) arrow(px, py, COLOR_CSS[slot], 7);
      arrow(tx, ty, '#ffffff', 12);
      g.fillStyle = '#fff'; g.font = 'bold 26px sans-serif'; g.textAlign = 'center';
      g.fillText('모두의 기울기', cx, W - 14);
    },
    event(ev) {
      const R = (k) => core.latest()?.[k];
      switch (ev.k) {
        case 'fall':
          sfx.hurt();
          big(`구멍 +${MAZE.PENALTY}초`, 1400);
          break;
        case 'respawn': sfx.beep(520, 0.1); break;
        case 'star':
          sfx.pickup(1);
          big(`별 -${MAZE.STAR_BONUS}초`, 1000);
          puffs.emit(ev.x, 0.8, ev.z, { n: 20, speed: 3, up: 4, life: 0.8, size: 0.5, color: 0xffe066, grav: -6 });
          break;
        case 'cp': sfx.pickup(0.8); big('체크포인트', 1000); break;
        case 'jump':
          sfx.whoosh(0.8);
          rings.spawn(R('x') || 0, 0.05, R('z') || 0, { color: 0xffd24a, r0: 0.5, r1: 2.5, life: 0.4 });
          break;
        case 'wall': if (ev.v > 4) sfx.hit(); break;
        case 'clear':
          sfx.fanfare();
          big(ev.final ? '전 단계 클리어' : `${ev.lv + 1}단계 통과`, 2200);
          puffs.emit(R('x') || 0, 1, R('z') || 0, { n: 40, speed: 5, up: 6, life: 1.2, size: 0.8, color: 0xffd24a, grav: -6 });
          break;
        default:
      }
    },
    dispose() {
      clearTimeout(bigTimer);
      scene.remove(root);
      disposeTree(root);
    },
  };
}
