// 보트 레이스 화면
import * as THREE from 'three';
import { BOAT, TRACK, BOOST_PADS } from '/shared/party.js';
import { COLORS } from '/shared/sim.js';
import { nameTag, Puffs, disposeTree, softDot } from './util.js';

const N = TRACK.length;

function trackDir(i) {
  const a = TRACK[i], b = TRACK[(i + 1) % N];
  const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
  return { dx: dx / L, dz: dz / L };
}

function buildBoat(color) {
  const g = new THREE.Group();
  // 위에서 본 배 모양 (앞 = +x)
  const sh = new THREE.Shape();
  sh.moveTo(-4.2, -1.7);
  sh.lineTo(1.6, -1.8);
  sh.quadraticCurveTo(4.2, -1.4, 5.2, 0);
  sh.quadraticCurveTo(4.2, 1.4, 1.6, 1.8);
  sh.lineTo(-4.2, 1.7);
  sh.lineTo(-4.2, -1.7);
  const hullGeo = new THREE.ExtrudeGeometry(sh, { depth: 1.5, bevelEnabled: true, bevelThickness: 0.25, bevelSize: 0.25, bevelSegments: 2 });
  hullGeo.rotateX(-Math.PI / 2);
  hullGeo.translate(0, -0.6, 0);
  const hull = new THREE.Mesh(hullGeo, new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.2 }));
  g.add(hull);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.28, 3.95), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }));
  stripe.position.set(0.1, 0.25, 0);
  g.add(stripe);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.2, 3.1), new THREE.MeshStandardMaterial({ color: 0xe9d7b8, roughness: 0.8 }));
  deck.position.set(-1.2, 1.05, 0);
  g.add(deck);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.1, 2.4), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }));
  cabin.position.set(0.2, 1.6, 0);
  g.add(cabin);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.8, 2.2), new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.1, metalness: 0.6 }));
  glass.position.set(1.15, 1.75, 0);
  glass.rotation.z = -0.5;
  g.add(glass);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 1.4), new THREE.MeshStandardMaterial({ color }));
  seat.position.set(-1.6, 1.45, 0);
  g.add(seat);
  const motor = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.6, 1.0), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 }));
  motor.position.set(-4.5, 0.6, 0);
  g.add(motor);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.55, 3, 10).rotateZ(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7ad0ff, transparent: true, opacity: 0.85 }));
  flame.position.set(-6.3, 0.4, 0);
  flame.visible = false;
  g.add(flame);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
  flag.position.set(-3.4, 3.1, 0);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4), new THREE.MeshBasicMaterial({ color: 0x222222 }));
  pole.position.set(-4.1, 2.4, 0);
  g.add(flag, pole);
  g.userData = { flame, flag };
  return g;
}

function bannerTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 128;
  const g = c.getContext('2d');
  for (let x = 0; x < 1024; x += 32) for (let y = 0; y < 128; y += 32) {
    g.fillStyle = ((x + y) / 32) % 2 ? '#111' : '#fff';
    g.fillRect(x, y, 32, 32);
  }
  g.fillStyle = 'rgba(255,74,61,0.92)';
  g.fillRect(180, 14, 664, 100);
  g.fillStyle = '#fff';
  g.font = 'bold 76px "Malgun Gothic", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('START · FINISH', 512, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function create(core) {
  const { scene, sfx, TV, COLOR_CSS } = core;
  const root = new THREE.Group();
  scene.add(root);

  // 부표 (물길 양쪽)
  const buoyPts = [];
  for (let i = 0; i < N; i += 3) {
    const a = TRACK[i], d = trackDir(i);
    for (const side of [-1, 1]) {
      buoyPts.push({ x: a.x - d.dz * side * BOAT.WIDTH / 2, z: a.z + d.dx * side * BOAT.WIDTH / 2, red: (i / 3) % 2 === 0 });
    }
  }
  const buoyGeo = new THREE.CylinderGeometry(0.9, 1.2, 2.4, 10);
  buoyGeo.translate(0, 0.6, 0);
  const buoyMat = new THREE.MeshStandardMaterial({ roughness: 0.5 });
  const buoys = new THREE.InstancedMesh(buoyGeo, buoyMat, buoyPts.length);
  const topGeo = new THREE.SphereGeometry(0.55, 10, 8);
  topGeo.translate(0, 2.2, 0);
  const tops = new THREE.InstancedMesh(topGeo, new THREE.MeshBasicMaterial({ color: 0xfff2c0 }), buoyPts.length);
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  buoyPts.forEach((p, i) => {
    m4.makeTranslation(p.x, 0, p.z);
    buoys.setMatrixAt(i, m4);
    tops.setMatrixAt(i, m4);
    buoys.setColorAt(i, col.setHex(p.red ? 0xff4a3d : 0xffffff));
  });
  root.add(buoys, tops);

  // 진행 방향 화살표 (물 위에 떠 있는 표시)
  const chevShape = new THREE.Shape();
  chevShape.moveTo(-3, -4); chevShape.lineTo(3, 0); chevShape.lineTo(-3, 4); chevShape.lineTo(-1.2, 0); chevShape.lineTo(-3, -4);
  const chevGeo = new THREE.ShapeGeometry(chevShape).rotateX(-Math.PI / 2);
  const chevIdx = [];
  for (let i = 4; i < N; i += 9) chevIdx.push(i);
  const chevs = new THREE.InstancedMesh(chevGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }), chevIdx.length);
  chevIdx.forEach((i, k) => {
    const a = TRACK[i], d = trackDir(i);
    m4.makeRotationY(Math.atan2(-d.dz, d.dx)).setPosition(a.x, 0.5, a.z);
    chevs.setMatrixAt(k, m4);
  });
  chevs.renderOrder = 3;
  root.add(chevs);

  // 부스터 발판 (화살표가 흐르는 주황 판)
  const padTex = (() => {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(255,120,40,0.55)'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = 'rgba(255,230,120,0.95)';
    for (const y of [0, 64]) { g.beginPath(); g.moveTo(20, y + 50); g.lineTo(64, y + 14); g.lineTo(108, y + 50); g.lineTo(108, y + 64); g.lineTo(64, y + 28); g.lineTo(20, y + 64); g.fill(); }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, 2);
    return t;
  })();
  const padMat = new THREE.MeshBasicMaterial({ map: padTex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  for (const pd of BOOST_PADS) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(BOAT.PAD_R * 1.5, BOAT.PAD_R * 2.4).rotateX(-Math.PI / 2), padMat);
    m.rotation.y = Math.atan2(-Math.sin(pd.yaw), Math.cos(pd.yaw)) - Math.PI / 2;
    m.position.set(pd.x, 0.6, pd.z);
    m.renderOrder = 4;
    root.add(m);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: 0xff9a40, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.set(26, 10, 1);
    glow.position.set(pd.x, 2, pd.z);
    root.add(glow);
  }

  // 출발선 문
  const gate = new THREE.Group();
  {
    const a = TRACK[0], d = trackDir(0);
    const half = BOAT.WIDTH / 2 + 3;
    const pylonMat = new THREE.MeshStandardMaterial({ color: 0xff7a3d, roughness: 0.5 });
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.2, 24, 12), pylonMat);
      p.position.set(-d.dz * side * half, 12, d.dx * side * half);
      gate.add(p);
    }
    const ban = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 4, 6, 0.8), [
      pylonMat, pylonMat, pylonMat, pylonMat,
      new THREE.MeshBasicMaterial({ map: bannerTexture() }), new THREE.MeshBasicMaterial({ map: bannerTexture() }),
    ]);
    ban.position.y = 22;
    ban.rotation.y = Math.atan2(-d.dz, d.dx) + Math.PI / 2;
    gate.add(ban);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, 3).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false }));
    line.rotation.y = ban.rotation.y;
    line.position.y = 0.4;
    gate.add(line);
    gate.position.set(a.x, 0, a.z);
  }
  root.add(gate);

  // 보트들
  const boats = new Map();
  function ensureBoat(s) {
    if (boats.has(s)) return boats.get(s);
    const obj = buildBoat(COLORS[s]);
    const tag = nameTag(core.nameOf(s) + (s === core.slot ? ' (나)' : ''), COLOR_CSS[s]);
    root.add(obj, tag);
    const o = { obj, tag, wakeT: 0, turn: 0, prevYaw: undefined };
    boats.set(s, o);
    return o;
  }
  const foam = new Puffs(root, 1400);
  foam.points.material.uniforms.uScale.value = 520;

  // 카메라
  const cams = [0, 1, 2, 3].map(() => new THREE.PerspectiveCamera(64, 1, 0.5, 14000));
  const camState = cams.map(() => ({ pos: new THREE.Vector3(), look: new THREE.Vector3(), init: false, fov: 64 }));
  const camera = TV ? cams[0] : cams[Math.max(0, core.slot)];

  // 화면 정보
  const hud = core.hud;
  hud.innerHTML = TV ? `<div class="tvsplit"><div class="g-pill" id="b-time"></div><canvas class="b-map" id="b-map" width="340" height="340"></canvas>
      ${[0, 1, 2, 3].map((i) => `<div class="tvq" id="b-q${i}" style="${i % 2 ? 'left:calc(50% + 14px)' : 'left:14px'};${i < 2 ? 'top:14px' : 'top:calc(50% + 14px)'}"></div>`).join('')}</div>
      <div class="g-big" id="b-big"></div>`
    : `<div class="g-top"><div class="g-pill" id="b-lap"></div><div class="g-pill" id="b-time"></div></div>
    <div class="b-pos" id="b-pos"></div>
    <div class="g-big" id="b-big"></div>
    <div class="g-warn hidden" id="b-warn"></div>
    <canvas class="b-map" id="b-map" width="420" height="420"></canvas>
    <div class="b-speed" id="b-speed"></div>
    <div class="g-skills">
      <div class="g-sk" data-k="boost"><i class="cap red"></i>부스터<div class="cd"></div></div>
      <div class="g-sk" data-k="reset"><i class="cap blue"></i>물길 복귀<div class="cd"></div></div>
      <div class="g-sk" data-k="drift"><i class="cap white"></i>드리프트<div class="cd"></div></div>
      <div class="g-sk" data-k="horn"><i class="cap black"></i>경적<div class="cd"></div></div>
      <div class="g-sk" data-k="spray"><i class="tilt">〰</i>흔들기 물보라<div class="cd"></div></div>
    </div>`;
  const el = (id) => hud.querySelector(`#${id}`);
  const skEls = {};
  hud.querySelectorAll('.g-sk').forEach((e) => { skEls[e.dataset.k] = e; });
  function setSkill(k, cd, max, on) {
    const e = skEls[k];
    if (!e) return;
    e.classList.toggle('wait', cd > 0.01);
    e.classList.toggle('on', !!on);
    e.querySelector('.cd').style.width = `${cd > 0 ? (1 - cd / max) * 100 : 100}%`;
  }

  // 미니맵 (물길은 한 번만 그려둠)
  const mapC = el('b-map');
  const mapBg = document.createElement('canvas');
  mapBg.width = mapC.width; mapBg.height = mapC.height;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of TRACK) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  const span = Math.max(maxX - minX, maxZ - minZ) * 1.12;
  const mcx = (minX + maxX) / 2, mcz = (minZ + maxZ) / 2;
  const MP = (x, z) => [mapC.width / 2 + ((x - mcx) / span) * mapC.width, mapC.height / 2 + ((z - mcz) / span) * mapC.height];
  {
    const g = mapBg.getContext('2d');
    g.fillStyle = 'rgba(10,6,14,0.55)';
    g.beginPath(); g.arc(mapBg.width / 2, mapBg.height / 2, mapBg.width / 2, 0, Math.PI * 2); g.fill();
    g.lineJoin = 'round';
    for (const [w, c] of [[mapBg.width * 0.05, 'rgba(255,255,255,0.18)'], [mapBg.width * 0.012, 'rgba(255,255,255,0.7)']]) {
      g.lineWidth = w; g.strokeStyle = c;
      g.beginPath();
      TRACK.forEach((p, i) => { const [x, y] = MP(p.x, p.z); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.closePath(); g.stroke();
    }
    g.fillStyle = '#ff9a40';
    for (const pd of BOOST_PADS) { const [px, py] = MP(pd.x, pd.z); g.beginPath(); g.arc(px, py, mapBg.width * 0.014, 0, Math.PI * 2); g.fill(); }
    const [sx, sy] = MP(TRACK[0].x, TRACK[0].z);
    g.fillStyle = '#fff'; g.fillRect(sx - 5, sy - 5, 10, 10);
  }

  let lastPlace = 0;
  let lastFinish = false;

  function chase(i, r, dt) {
    const c = cams[i], st = camState[i];
    const [, x, z, yaw, v, , , fl] = r;
    const hx = Math.cos(yaw), hz = Math.sin(yaw);
    const back = 21 + v * 0.06, up = 7.5 + v * 0.02;
    const want = new THREE.Vector3(x - hx * back, up, z - hz * back);
    const look = new THREE.Vector3(x + hx * 16, 2.5, z + hz * 16);
    if (!st.init) { st.pos.copy(want); st.look.copy(look); st.init = true; }
    st.pos.lerp(want, Math.min(1, dt * 4.5));
    st.look.lerp(look, Math.min(1, dt * 7));
    c.position.copy(st.pos);
    c.lookAt(st.look);
    const fov = (fl & 1 ? 76 : 64);
    st.fov += (fov - st.fov) * Math.min(1, dt * 3);
    if (Math.abs(c.fov - st.fov) > 0.05) { c.fov = st.fov; c.updateProjectionMatrix(); }
  }

  return {
    camera,
    frame(dt, t) {
      const sm = core.sample();
      const snap = sm ? sm.b : null;
      const R = core.rows(sm, 'b', [1, 2, 4], [3, 12]);
      for (const [s, r] of R) {
        const b = ensureBoat(s);
        const [, x, z, yaw, v, , , fl] = r;
        const o = b.obj;
        o.position.set(x, 0.35 + Math.sin(t * 2.2 + s) * 0.18, z);
        o.rotation.set(0, -yaw, 0);
        o.rotateZ(Math.min(0.12, v * 0.0016) + Math.sin(t * 1.7 + s) * 0.02);
        // 도는 쪽으로 살짝 기울기
        if (b.prevYaw !== undefined && dt > 0) {
          const rate = core.lerpAng(0, yaw - b.prevYaw, 1) / dt;
          b.turn += (rate - b.turn) * Math.min(1, dt * 6);
        }
        b.prevYaw = yaw;
        o.rotateX(Math.max(-0.3, Math.min(0.3, b.turn * 0.22)) + Math.sin(t * 2 + s) * 0.02);
        o.userData.flame.visible = !!(fl & 1);
        o.userData.flame.scale.set(1, 0.8 + Math.random() * 0.5, 1);
        o.userData.flag.rotation.y = Math.sin(t * 9 + s) * 0.3;
        b.tag.position.set(x, 6.5, z);
        // 물보라 자국
        b.wakeT -= dt;
        if (v > 5 && b.wakeT <= 0) {
          b.wakeT = 0.03;
          const hx = Math.cos(yaw), hz = Math.sin(yaw);
          const big = fl & 1;
          foam.emit(x - hx * 5, 0.5, z - hz * 5, { n: big ? 3 : 2, speed: 1.5, up: 0.3, life: 1.5, size: big ? 1.9 : 1.4, color: 0xf4fbff, grav: 0, spread: 2.5 });
          if (fl & 2) foam.emit(x - hx * 2 - hz * 3, 0.8, z - hz * 2 + hx * 3, { n: 2, speed: 3, up: 2, life: 0.7, size: 2, color: 0xe8f6ff, grav: -6 });
        }
      }
      foam.update(dt);
      padTex.offset.y = -t * 1.6;

      // 카메라와 그리기
      if (TV) {
        for (let i = 0; i < 4; i++) { const r = R.get(i); if (r) chase(i, r, dt); }
        core.renderSplit([0, 1, 2, 3].map((i) => (R.get(i) ? cams[i] : null)));
      } else {
        const me = R.get(core.slot) || R.values().next().value;
        if (me) chase(Math.max(0, core.slot), me, dt);
        core.render(camera);
      }

      if (!snap) return;
      const me = snap.b.find((r) => r[0] === core.slot);
      if (!TV && me) {
        sfx.engine(me[4] * 2.2, me[7] & 1);
        const fin = me[7] & 16;
        el('b-lap').innerHTML = fin ? '도착' : `바퀴 ${Math.min(snap.laps, me[5] + 1)}<small>/ ${snap.laps}</small>`;
        el('b-pos').innerHTML = `${me[6]}<small>위 / ${snap.b.length}</small>`;
        el('b-pos').style.color = COLOR_CSS[core.slot];
        el('b-speed').innerHTML = `${Math.round(me[4] * 3.6)}<small>km/h</small>`;
        let warn = '';
        if (me[7] & 8) warn = '역주행';
        else if (me[7] & 32) warn = '물보라 맞음';
        else if (me[7] & 4) warn = '얕은 물! 부표 사이로 돌아가세요';
        el('b-warn').textContent = warn;
        el('b-warn').classList.toggle('hidden', !warn || !!fin);
        setSkill('boost', me[8], BOAT.BOOST_CD, me[7] & 1);
        setSkill('reset', 0, 1);
        setSkill('drift', 0, 1, me[7] & 2);
        setSkill('horn', 0, 1);
        setSkill('spray', me[9], BOAT.SPRAY_CD);
        if (me[6] < lastPlace && lastPlace && !fin && core.phase === 'playing') sfx.pickup(0.5);
        lastPlace = me[6];
        if (fin && !lastFinish) el('b-big').textContent = `${me[6]}위 도착`;
        lastFinish = !!fin;
      }
      el('b-time').textContent = core.fmtTime(snap.rt);
      if (TV) {
        for (let i = 0; i < 4; i++) {
          const q = el(`b-q${i}`);
          const r = snap.b.find((x) => x[0] === i);
          if (!r) { q.style.display = 'none'; continue; }
          q.style.display = '';
          q.style.borderColor = COLOR_CSS[i];
          q.innerHTML = `<span class="k">${r[6]}위</span>${core.esc(core.nameOf(i))}${core.isHuman(i) ? '' : ' (AI)'}<span class="st">${r[7] & 16 ? r[10].toFixed(1) + '초' : `바퀴 ${Math.min(snap.laps, r[5] + 1)}/${snap.laps}`}</span>`;
        }
        if (snap.ff >= 0) el('b-big').textContent = '';
      }
      // 미니맵
      const g = mapC.getContext('2d');
      g.clearRect(0, 0, mapC.width, mapC.height);
      g.drawImage(mapBg, 0, 0);
      for (const r of [...snap.b].sort((a, b) => (a[0] === core.slot) - (b[0] === core.slot))) {
        const [x, y] = MP(r[1], r[2]);
        g.fillStyle = COLOR_CSS[r[0]];
        g.strokeStyle = r[0] === core.slot ? '#fff' : '#000';
        g.lineWidth = r[0] === core.slot ? 3 : 2;
        g.beginPath(); g.arc(x, y, r[0] === core.slot ? mapC.width * 0.03 : mapC.width * 0.022, 0, Math.PI * 2); g.fill(); g.stroke();
      }
    },
    event(ev) {
      const mine = ev.s === core.slot;
      const R = core.rows(core.sample(), 'b', [1, 2]);
      const r = R.get(ev.s);
      switch (ev.k) {
        case 'boost': if (mine) sfx.launch(0.8); break;
        case 'pad': if (mine) { sfx.launch(0.6); sfx.pickup(0.4); } break;
        case 'crash':
          foam.emit(ev.x, 1, ev.z, { n: 14, speed: 6, up: 5, life: 0.9, size: 2.4, color: 0xffffff, grav: -9 });
          if (mine) { sfx.boom(0.5); core.center('쿵', 'bad', 600); }
          break;
        case 'bump': sfx.hit(); break;
        case 'horn': if (mine || TV) sfx.horn(mine ? 1 : 0.4); break;
        case 'spray':
          if (r) foam.emit(r[1], 2, r[2], { n: 50, speed: 16, up: 8, life: 1.1, size: 2, color: 0xdff4ff, grav: -10, spread: 6 });
          if (mine) sfx.whoosh(1);
          break;
        case 'sprayed': if (mine) sfx.hurt(); else if (ev.by === core.slot) { core.center(`${core.nameOf(ev.s)} 물보라 명중`, 'good', 1200); sfx.kill(); } break;
        case 'reset': if (mine) { sfx.beep(520, 0.12); core.center('물길로 복귀', '', 800); } break;
        case 'lap':
          if (mine) {
            const L = core.settings.laps || 2;
            core.center(ev.lap === L ? `마지막 바퀴\n지난 바퀴 ${ev.time.toFixed(1)}초` : `${ev.lap}바퀴째\n지난 바퀴 ${ev.time.toFixed(1)}초`, 'good', 2000);
            sfx.alert();
          }
          break;
        case 'finish':
          if (mine) { sfx.fanfare(); }
          else if (TV || ev.place === 1) { core.center(`${core.nameOf(ev.s)} ${ev.place}위 도착`, 'good', 1800); sfx.kill(); }
          break;
        default:
      }
    },
    dispose() {
      sfx.engine(0);
      scene.remove(root);
      disposeTree(root);
    },
  };
}
