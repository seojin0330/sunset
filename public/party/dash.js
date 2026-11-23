// 허들 달리기 화면 (바다 위 부두에서 해를 향해 달리기)
import * as THREE from 'three';
import { DASH, laneZ } from '/shared/party.js';
import { COLORS } from '/shared/sim.js';
import { nameTag, blobShadow, Puffs, disposeTree } from './util.js';

const ORIGIN = new THREE.Vector3(30, 2.2, -1080);
const DIR = new THREE.Vector2(-0.35, -1).normalize(); // 해 쪽
const HALF = DASH.LANE_W * 2 + 0.4;

function trackTexture() {
  const L0 = -6, L1 = DASH.LEN + 12, PX = 16; // 1m = 16px
  const c = document.createElement('canvas');
  c.width = Math.round((L1 - L0) * PX); c.height = Math.round(HALF * 2 * PX);
  const g = c.getContext('2d');
  g.fillStyle = '#c4553a'; g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`; g.fillRect(Math.random() * c.width, Math.random() * c.height, 2, 2); }
  g.fillStyle = 'rgba(255,255,255,0.9)';
  for (let i = 0; i <= 4; i++) {
    const z = HALF + (i - 2) * DASH.LANE_W;
    g.fillRect(0, z * PX - 2, c.width, 4);
  }
  const X = (x) => (x - L0) * PX;
  g.fillRect(X(0) - 4, 0, 8, c.height);
  for (let y = 0; y < c.height; y += 12) for (let k = 0; k < 2; k++) {
    g.fillStyle = (y / 12 + k) % 2 ? '#111' : '#fff';
    g.fillRect(X(DASH.LEN) - 12 + k * 12, y, 12, 12);
  }
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i < 4; i++) {
    const z = HALF + (i - 1.5) * DASH.LANE_W;
    g.save(); g.translate(X(-3), z * PX); g.rotate(Math.PI / 2); g.fillText(String(i + 1), 0, 0); g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return { tex: t, L0, L1 };
}

function buildRunner(color) {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xf2c49b, roughness: 0.7 });
  const shirt = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x2a2a3a, roughness: 0.7 });
  const body = new THREE.Group();
  body.position.y = 1.05;
  g.add(body);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.5, 4, 10), shirt);
  torso.position.y = 0.42;
  body.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), skin);
  head.position.y = 1.0;
  body.add(head);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.05, 6, 16).rotateX(Math.PI / 2), shirt);
  band.position.y = 1.08;
  body.add(band);
  const limb = (r, len, mat) => {
    const pivot = new THREE.Group();
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 8), mat);
    m.position.y = -len / 2 - r;
    pivot.add(m);
    return pivot;
  };
  const legL = limb(0.11, 0.62, pants), legR = limb(0.11, 0.62, pants);
  legL.position.set(0, 0.05, 0.14); legR.position.set(0, 0.05, -0.14);
  const armL = limb(0.08, 0.45, shirt), armR = limb(0.08, 0.45, shirt);
  armL.position.set(0, 0.72, 0.34); armR.position.set(0, 0.72, -0.34);
  body.add(legL, legR, armL, armR);
  g.userData = { body, legL, legR, armL, armR };
  return g;
}

function buildHurdle() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
  const red = new THREE.MeshStandardMaterial({ color: 0xff4a3d, roughness: 0.5 });
  for (const z of [-0.8, 0.8]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.8, 0.08), white);
    leg.position.set(0, 0.4, z);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.08), white);
    foot.position.set(0.25, 0.03, z);
    g.add(leg, foot);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 1.7), red);
  bar.position.set(0, 0.8, 0);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 1.72), white);
  stripe.position.set(0, 0.8, 0);
  g.add(bar, stripe);
  return g;
}

export function create(core) {
  const { scene, sfx, TV, COLOR_CSS } = core;
  const root = new THREE.Group();
  root.position.copy(ORIGIN);
  root.rotation.y = Math.atan2(-DIR.y, DIR.x);
  scene.add(root);

  // 부두
  const { tex, L0, L1 } = trackTexture();
  const pier = new THREE.Mesh(new THREE.BoxGeometry(L1 - L0 + 16, 1, HALF * 2 + 9), new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.9 }));
  pier.position.set((L0 + L1) / 2, -0.52, 0);
  root.add(pier);
  const track = new THREE.Mesh(new THREE.PlaneGeometry(L1 - L0, HALF * 2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
  track.position.set((L0 + L1) / 2, 0.005, 0);
  root.add(track);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x5a3a28, roughness: 1 });
  const postGeo = new THREE.CylinderGeometry(0.35, 0.4, 6, 8);
  for (let x = L0 - 6; x <= L1 + 6; x += 9) {
    for (const z of [-(HALF + 4), HALF + 4]) {
      const p = new THREE.Mesh(postGeo, postMat);
      p.position.set(x, -3.5, z);
      root.add(p);
    }
  }
  // 난간 깃발
  const flagCols = [0xff4a3d, 0x3d8bff, 0x38d870, 0xffcc33];
  const flags = [];
  for (let x = L0; x <= L1; x += 6) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3), postMat);
    pole.position.set(x, 1.5, -(HALF + 3.6));
    const f = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.6), new THREE.MeshBasicMaterial({ color: flagCols[Math.round(x / 6) & 3], side: THREE.DoubleSide }));
    f.position.set(x + 0.5, 2.7, -(HALF + 3.6));
    root.add(pole, f);
    flags.push(f);
  }
  // 관중석 (반대편)
  const crowd = [];
  const stand = new THREE.Mesh(new THREE.BoxGeometry(L1 - L0, 2.5, 4), new THREE.MeshStandardMaterial({ color: 0x6a4a6a, roughness: 0.9 }));
  stand.position.set((L0 + L1) / 2, 0.6, -(HALF + 7));
  root.add(stand);
  const headGeo = new THREE.SphereGeometry(0.35, 8, 6);
  const crowdMats = [0xff8a6a, 0xffd27a, 0x8ac8ff, 0xc8a0ff, 0x9ae8a8].map((c) => new THREE.MeshStandardMaterial({ color: c }));
  for (let x = L0 + 2; x < L1; x += 1.3) {
    for (let row = 0; row < 2; row++) {
      if (Math.random() < 0.3) continue;
      const h = new THREE.Mesh(headGeo, crowdMats[Math.floor(Math.random() * crowdMats.length)]);
      h.position.set(x + Math.random() * 0.5, 2.2 + row * 0.8, -(HALF + 6) - row * 1.5);
      h.userData.ph = Math.random() * 6;
      root.add(h);
      crowd.push(h);
    }
  }
  // 결승 문
  const arch = new THREE.Group();
  const archMat = new THREE.MeshStandardMaterial({ color: 0xff7a3d, roughness: 0.5 });
  for (const z of [-(HALF + 0.6), HALF + 0.6]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5, 0.5), archMat);
    p.position.set(0, 2.5, z);
    arch.add(p);
  }
  const ban = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.1, HALF * 2 + 1.7), archMat);
  ban.position.y = 5;
  arch.add(ban);
  arch.position.x = DASH.LEN;
  root.add(arch);

  // 허들 (레인마다)
  const hurdles = [];
  for (let lane = 0; lane < 4; lane++) {
    hurdles.push(DASH.HURDLES.map((hx) => {
      const h = buildHurdle();
      h.position.set(hx, 0, laneZ(lane));
      h.scale.set(1, 1, DASH.LANE_W / 2.1);
      root.add(h);
      return h;
    }));
  }

  // 오늘의 기록 유령 (금색 반투명 벽)
  const ghost = new THREE.Group();
  const gMat = new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });
  const gWall = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, 2.6).rotateY(Math.PI / 2), gMat);
  gWall.position.y = 1.3;
  const gLine = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, HALF * 2), new THREE.MeshBasicMaterial({ color: 0xffd24a }));
  gLine.position.y = 0.03;
  const gTag = nameTag('오늘의 기록', '#ffd24a', 0.9);
  gTag.position.y = 3.3;
  ghost.add(gWall, gLine, gTag);
  ghost.visible = false;
  root.add(ghost);

  // 선수
  const runners = new Map();
  function ensureRunner(s) {
    if (runners.has(s)) return runners.get(s);
    const obj = buildRunner(COLORS[s]);
    const shadow = blobShadow(0.5);
    const tag = nameTag(core.nameOf(s) + (s === core.slot ? ' (나)' : ''), COLOR_CSS[s], 0.9);
    root.add(obj, shadow, tag);
    const o = { obj, shadow, tag, ph: Math.random() * 6 };
    runners.set(s, o);
    return o;
  }
  const dust = new Puffs(root, 400);

  const camera = new THREE.PerspectiveCamera(TV ? 50 : 55, 1, 0.3, 14000);
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  let camInit = false;

  // 화면 정보
  const hud = core.hud;
  hud.innerHTML = `
    <div class="d-track" id="d-track"><div class="fin"></div>
      ${DASH.HURDLES.map((h) => `<div class="hd" style="left:calc(16px + (100% - 56px) * ${h / DASH.LEN})"></div>`).join('')}
      ${[0, 1, 2, 3].map((i) => `<div class="ln" style="top:${16 + i * 20}px"></div><div class="rn" id="d-rn${i}" style="top:${16 + i * 20}px;background:${COLOR_CSS[i]}"></div>`).join('')}
    </div>
    <div class="g-big" id="d-big"></div>
    <div class="g-pill" id="d-time" style="position:absolute;top:120px;left:50%;transform:translateX(-50%)"></div>
    ${TV ? '' : `
    <div class="d-jump hidden" id="d-jump">점프! <small>(파랑·검정 버튼 / 뒤로 젖히기)</small></div>
    <div class="d-mash"><i class="cap white" id="d-l"></i><i class="cap red" id="d-r"></i></div>
    <div class="g-tip" id="d-tip">흰색 · 빨강 버튼을 번갈아 빠르게! (키보드 L · J)</div>
    <div class="g-skills"><div class="g-sk" id="d-spurt"><i class="tilt">〰</i>흔들어서 스퍼트 (1번)</div></div>
    <div class="d-meter"><i id="d-meter"></i></div>`}`;
  const el = (id) => hud.querySelector(`#${id}`);
  let finished = false;

  function localToWorld(x, y, z, out) { return root.localToWorld(out.set(x, y, z)); }

  return {
    camera,
    frame(dt, t) {
      const sm = core.sample();
      const snap = sm ? sm.b : null;
      const R = core.rows(sm, 'r', [1, 2, 7]);
      let leadX = 0;
      for (const [s, r] of R) {
        const o = ensureRunner(s);
        const [, x, v, fl, , , knocked, jT] = r;
        leadX = Math.max(leadX, x);
        const z = laneZ(s);
        const u = jT > 0 ? 1 - jT / DASH.JUMP_T : 0;
        const y = jT > 0 ? 4 * 0.95 * u * (1 - u) : 0;
        o.obj.position.set(x, y, z);
        o.ph += dt * (2 + v * 1.05);
        const amp = Math.min(1, 0.15 + v / 9);
        const ud = o.obj.userData;
        const sw = Math.sin(o.ph) * amp;
        if (jT > 0) {
          ud.legL.rotation.z = 1.1; ud.legR.rotation.z = -0.6; ud.armL.rotation.z = -1.2; ud.armR.rotation.z = 0.8;
        } else {
          ud.legL.rotation.z = sw * 1.0; ud.legR.rotation.z = -sw * 1.0;
          ud.armL.rotation.z = -sw * 1.1; ud.armR.rotation.z = sw * 1.1;
        }
        ud.body.position.y = 1.05 + Math.abs(Math.cos(o.ph)) * 0.08 * amp;
        ud.body.rotation.z = fl & 2 ? -0.9 : -Math.min(0.35, v * 0.025);
        o.shadow.position.set(x, 0.03, z);
        o.shadow.scale.setScalar(1 / (1 + y));
        o.tag.position.set(x, 3 + y, z);
        if (fl & 4 && Math.random() < 0.6) dust.emit(x - 0.4, 0.8, z, { n: 1, speed: 0.6, up: 0.5, life: 0.5, size: 0.5, color: 0xffd24a, grav: 0 });
        if (v > 6 && Math.random() < dt * v) dust.emit(x - 0.3, 0.1, z, { n: 1, speed: 0.5, up: 0.6, life: 0.5, size: 0.35, color: 0xe0a080 });
        // 걸린 허들은 넘어짐
        DASH.HURDLES.forEach((_, i) => {
          const h = hurdles[s][i];
          const target = knocked & (1 << i) ? -1.45 : 0;
          h.rotation.z += (target - h.rotation.z) * Math.min(1, dt * 10);
        });
      }
      // 기록 유령: 출발은 느리고 뒤로 갈수록 빠르게
      const gb = snap ? snap.gb : -1;
      if (gb > 0 && snap) {
        const rt = sm.a.rt + (sm.b.rt - sm.a.rt) * sm.f;
        const u = Math.min(1, rt / gb);
        ghost.visible = core.phase === 'playing' && u < 1;
        ghost.position.x = DASH.LEN * Math.pow(u, 1.15);
      } else ghost.visible = false;
      for (const f of flags) f.rotation.y = Math.sin(t * 6 + f.position.x) * 0.3;
      for (const h of crowd) h.position.y += Math.sin(t * 8 + h.userData.ph) * 0.006;
      dust.update(dt);

      // 카메라
      const me = R.get(core.slot);
      const fx = TV || !me ? leadX : me[1];
      const fz = TV || !me ? 0 : laneZ(core.slot);
      const wantPos = new THREE.Vector3(), wantLook = new THREE.Vector3();
      if (TV) {
        localToWorld(fx - 7, 8, 17, wantPos);
        localToWorld(fx + 5, 0.5, 0, wantLook);
      } else {
        localToWorld(fx - 5.5, 3.6, fz + 9.5, wantPos);
        localToWorld(fx + 4, 1.2, fz - 0.5, wantLook);
      }
      if (!camInit) { camPos.copy(wantPos); camLook.copy(wantLook); camInit = true; }
      camPos.lerp(wantPos, Math.min(1, dt * 5));
      camLook.lerp(wantLook, Math.min(1, dt * 6));
      camera.position.copy(camPos);
      camera.lookAt(camLook);
      core.render(camera);

      // 화면 정보
      if (!snap) return;
      for (const r of snap.r) {
        const e = el(`d-rn${r[0]}`);
        if (e) e.style.left = `calc(16px + (100% - 56px) * ${Math.min(1, r[1] / DASH.LEN)})`;
      }
      for (let i = 0; i < 4; i++) { const e = el(`d-rn${i}`); if (e && !snap.r.some((r) => r[0] === i)) e.style.display = 'none'; }
      el('d-time').innerHTML = `${snap.rt.toFixed(2)}초${snap.gb > 0 ? `<small>오늘의 기록 ${snap.gb.toFixed(2)}초</small>` : ''}`;
      if (!TV) {
        const m = snap.r.find((r) => r[0] === core.slot);
        el('d-l').classList.toggle('hit', core.inp.h[2]);
        el('d-r').classList.toggle('hit', core.inp.h[0]);
        if (m) {
          el('d-meter').style.height = `${Math.min(100, (m[2] / DASH.VMAX) * 100)}%`;
          const next = DASH.HURDLES.find((h) => h > m[1]);
          const near = next !== undefined && next - m[1] < Math.max(3, m[2] * 0.45) && !(m[3] & 1) && m[4] < 0;
          el('d-jump').classList.toggle('hidden', !near);
          el('d-spurt').classList.toggle('wait', !!(m[3] & 8));
          el('d-spurt').classList.toggle('on', !!(m[3] & 4));
          if (m[4] >= 0 && !finished) {
            finished = true;
            el('d-big').textContent = `${m[5]}위! ${m[4].toFixed(2)}초`;
            el('d-big').style.color = COLOR_CSS[core.slot];
          }
          el('d-tip').classList.toggle('hidden', m[4] >= 0);
        }
      }
    },
    event(ev) {
      const mine = ev.s === core.slot;
      switch (ev.k) {
        case 'jump': if (mine) sfx.whoosh(0.5); break;
        case 'clear': if (mine) sfx.beep(990, 0.06); break;
        case 'trip':
          if (mine) { sfx.hurt(); core.center('허들에 걸림', 'bad', 900); }
          else sfx.hit();
          break;
        case 'spurt':
          if (mine) { sfx.ult(0.6); core.center('스퍼트', 'good', 900); }
          break;
        case 'newrec':
          core.center(`오늘의 신기록 · ${core.nameOf(ev.s)} ${ev.time.toFixed(2)}초`, 'good', 2600);
          sfx.cheer(1.2); sfx.streak(4);
          break;
        case 'finish':
          if (ev.place === 1) sfx.cheer(TV ? 1 : 0.6);
          if (mine) sfx.fanfare();
          else if (ev.place === 1) { core.center(`${core.nameOf(ev.s)} 1등`, 'good', 1500); sfx.kill(); }
          break;
        default:
      }
    },
    dispose() {
      scene.remove(root);
      disposeTree(root);
    },
  };
}
