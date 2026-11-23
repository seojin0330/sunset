// 구슬 스모 화면
import * as THREE from 'three';
import { SUMO, sumoAngle } from '/shared/party.js';
import { COLORS } from '/shared/sim.js';
import { nameTag, blobShadow, Puffs, Rings, disposeTree, ballTexture, softDot } from './util.js';

const O = new THREE.Vector3(0, 240, 0); // 경기장 위치 (가운데 분화구 섬 위 하늘)

function ringTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(256, 256, 20, 256, 256, 256);
  gr.addColorStop(0, '#e9cf9d'); gr.addColorStop(0.85, '#d7b47c'); gr.addColorStop(1, '#a4733f');
  g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 1600; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '90,50,20'},${Math.random() * 0.08})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 3, 3);
  }
  g.strokeStyle = 'rgba(255,250,235,0.9)'; g.lineWidth = 10;
  g.beginPath(); g.arc(256, 256, 236, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 4; g.strokeStyle = 'rgba(255,250,235,0.6)';
  g.beginPath(); g.arc(256, 256, 120, 0, Math.PI * 2); g.stroke();
  g.fillStyle = 'rgba(255,250,235,0.85)';
  g.fillRect(226, 236, 14, 40); g.fillRect(272, 236, 14, 40);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function create(core) {
  const { scene, sfx, TV, COLOR_CSS } = core;
  const root = new THREE.Group();
  root.position.copy(O);
  scene.add(root);

  // 경기장
  const plate = new THREE.Group();
  root.add(plate);
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(SUMO.R0, SUMO.R0 * 0.985, 1.2, 96),
    [new THREE.MeshStandardMaterial({ color: 0x8a5a34, roughness: 0.9 }), new THREE.MeshStandardMaterial({ map: ringTexture(), roughness: 0.85 }), new THREE.MeshStandardMaterial({ color: 0x5a3a24 })],
  );
  top.position.y = -0.6;
  plate.add(top);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(SUMO.R0, 0.32, 10, 120).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffb060 }));
  rim.position.y = 0.05;
  plate.add(rim);
  // 아래 바위
  const rock = new THREE.Mesh(new THREE.ConeGeometry(SUMO.RMIN * 1.1, 22, 9, 3).rotateX(Math.PI),
    new THREE.MeshStandardMaterial({ color: 0x6b4038, roughness: 1, flatShading: true }));
  rock.position.y = -12.4;
  root.add(rock);
  for (let i = 0; i < 7; i++) {
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(1.5 + Math.random() * 2.2, 0),
      new THREE.MeshStandardMaterial({ color: 0x7a4a3e, roughness: 1, flatShading: true }));
    const a = Math.random() * Math.PI * 2;
    r.position.set(Math.cos(a) * 9, -3 - Math.random() * 8, Math.sin(a) * 9);
    root.add(r);
  }
  // 둥둥 떠 있는 등불
  const lanterns = [];
  const glowMat = new THREE.SpriteMaterial({ map: softDot(), color: 0xffb36a, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
  for (let i = 0; i < 12; i++) {
    const g = new THREE.Group();
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.65, 1.2, 8), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xff7a4a : 0xffc070 }));
    const glow = new THREE.Sprite(glowMat);
    glow.scale.set(5, 5, 1);
    g.add(lamp, glow);
    const a = (i / 12) * Math.PI * 2;
    g.userData = { a, ph: Math.random() * 6 };
    g.position.set(Math.cos(a) * (SUMO.R0 + 8), 2, Math.sin(a) * (SUMO.R0 + 8));
    root.add(g);
    lanterns.push(g);
  }

  // 공
  const balls = new Map();
  function ensureBall(s) {
    if (balls.has(s)) return balls.get(s);
    const mat = new THREE.MeshStandardMaterial({ map: ballTexture(COLOR_CSS[s]), roughness: 0.28, metalness: 0.15 });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(SUMO.BALL_R, 32, 20), mat);
    const shadow = blobShadow(SUMO.BALL_R);
    const tag = nameTag(core.nameOf(s) + (s === core.slot ? ' (나)' : ''), COLOR_CSS[s]);
    const crown = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.8, 5), new THREE.MeshBasicMaterial({ color: 0xffd24a }));
    crown.visible = false;
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.9, 3).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    arrow.visible = s === core.slot && !TV;
    root.add(mesh, shadow, tag, crown, arrow);
    const o = { mesh, mat, shadow, tag, crown, arrow, q: new THREE.Quaternion(), color: new THREE.Color(COLORS[s]), prevAlive: true };
    balls.set(s, o);
    return o;
  }

  // 번개 아이템
  const item = new THREE.Group();
  const boltShape = new THREE.Shape();
  boltShape.moveTo(0.15, 1.1); boltShape.lineTo(-0.55, -0.05); boltShape.lineTo(-0.05, -0.05);
  boltShape.lineTo(-0.25, -1.1); boltShape.lineTo(0.55, 0.15); boltShape.lineTo(0.05, 0.15); boltShape.lineTo(0.15, 1.1);
  const bolt = new THREE.Mesh(new THREE.ExtrudeGeometry(boltShape, { depth: 0.25, bevelEnabled: false }).translate(0, 0, -0.12),
    new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0xffa000, emissiveIntensity: 0.8 }));
  bolt.scale.setScalar(1.1);
  const boltGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: 0xffd24a, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
  boltGlow.scale.set(4.5, 4.5, 1);
  const itemRing = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.45, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.7 }));
  itemRing.position.y = 0.04;
  item.add(bolt, boltGlow, itemRing);
  item.visible = false;
  root.add(item);

  const puffs = new Puffs(root, 600);
  const rings = new Rings(root);

  // 화면 정보
  const hud = core.hud;
  hud.innerHTML = `
    <div class="g-top"><div class="g-pill" id="s-round"></div><div class="g-pill" id="s-time"></div></div>
    <div class="g-chips" id="s-chips"></div>
    <div class="g-big" id="s-big"></div>
    <div class="g-warn hidden" id="s-warn">판이 줄어드는 중</div>
    ${TV ? '' : `<div class="g-skills" id="s-skills">
      <div class="g-sk" data-k="dash"><i class="cap red"></i>대시<div class="cd"></div></div>
      <div class="g-sk" data-k="heavy"><i class="cap blue"></i>무거워지기<div class="cd"></div></div>
      <div class="g-sk" data-k="jump"><i class="cap white"></i>점프<div class="cd"></div></div>
      <div class="g-sk" data-k="brake"><i class="cap black"></i>브레이크<div class="cd"></div></div>
      <div class="g-sk" data-k="wave"><i class="tilt">〰</i>흔들기 충격파<div class="cd"></div></div>
    </div>
    <div class="g-tip">컨트롤러를 기울이면 공이 굴러가요 · 상대를 판 밖으로 밀어내세요!</div>`}`;
  const el = (id) => hud.querySelector(`#${id}`);
  const skEls = {};
  hud.querySelectorAll('.g-sk').forEach((e) => { skEls[e.dataset.k] = e; });

  const camera = new THREE.PerspectiveCamera(TV ? 52 : 58, 1, 0.5, 14000);
  const camLook = O.clone();
  const tmpV = new THREE.Vector3();
  let lastSub = '';
  let shrinkWarned = false;

  function setSkill(k, cd, max, on) {
    const e = skEls[k];
    if (!e) return;
    e.classList.toggle('wait', cd > 0.01);
    e.classList.toggle('on', !!on);
    e.querySelector('.cd').style.width = `${cd > 0 ? (1 - cd / max) * 100 : 100}%`;
  }

  return {
    camera,
    frame(dt, t) {
      const sm = core.sample();
      const snap = sm ? sm.b : null;
      const R = core.rows(sm, 'b', [1, 2, 3, 12, 13]);
      const radius = sm ? sm.a.r + (sm.b.r - sm.a.r) * sm.f : SUMO.R0;
      const sc = radius / SUMO.R0;
      plate.scale.set(sc, 1, sc);
      const shrinking = radius < SUMO.R0 - 0.05;
      rim.material.color.setHex(shrinking ? (Math.sin(t * 10) > 0 ? 0xff3a2a : 0xffb060) : 0xffb060);

      for (const g of lanterns) {
        const u = g.userData;
        g.position.y = 2 + Math.sin(t * 1.3 + u.ph) * 0.6;
      }

      if (snap && snap.it) {
        item.visible = true;
        item.position.set(snap.it[0], 0, snap.it[1]);
        bolt.position.y = 1.6 + Math.sin(t * 3) * 0.25;
        bolt.rotation.y = t * 2.5;
        boltGlow.position.y = bolt.position.y;
        itemRing.scale.setScalar(1 + Math.sin(t * 5) * 0.12);
      } else item.visible = false;

      let leaderWins = 0;
      for (const r of R.values()) leaderWins = Math.max(leaderWins, r[6]);

      for (const [s, r] of R) {
        const b = ensureBall(s);
        const [, x, z, y, alive, fl, wins, , , , , , vx, vz] = r;
        const falling = fl & 8;
        const vis = !!alive;
        b.mesh.visible = vis;
        b.tag.visible = vis && !falling;
        b.shadow.visible = vis && !falling;
        b.mesh.position.set(x, SUMO.BALL_R + y, z);
        // 굴러가는 회전
        const sp = Math.hypot(vx, vz);
        if (sp > 0.05 && !falling) {
          tmpV.set(vz / sp, 0, -vx / sp);
          b.q.premultiply(new THREE.Quaternion().setFromAxisAngle(tmpV, (sp * dt) / SUMO.BALL_R));
        }
        b.mesh.quaternion.copy(b.q);
        const heavy = fl & 1;
        b.mesh.scale.setScalar(heavy ? 1.12 : 1);
        b.mat.metalness = heavy ? 0.85 : 0.15;
        b.mat.roughness = heavy ? 0.25 : 0.28;
        const mega = fl & 16;
        b.mat.emissive.setHex(mega ? (Math.sin(t * 20) > 0 ? 0x806000 : 0x402800) : heavy ? 0x222222 : 0x000000);
        if (mega) b.mesh.scale.setScalar(1.25);
        if (mega && !falling && Math.random() < 0.7) puffs.emit(x, SUMO.BALL_R + y, z, { n: 1, speed: 2, up: 2, life: 0.4, size: 0.7, color: 0xffd24a, grav: 0 });
        b.shadow.position.set(x, 0.06, z);
        const sh = 1 / (1 + y * 0.25);
        b.shadow.scale.setScalar(sh);
        b.shadow.material.opacity = sh;
        b.tag.position.set(x, SUMO.BALL_R * 2 + y + 1.6, z);
        b.crown.visible = vis && !falling && wins > 0 && wins === leaderWins;
        b.crown.position.set(x, SUMO.BALL_R * 2 + y + 0.5, z);
        b.crown.rotation.y = t * 2;
        b.arrow.position.set(x, SUMO.BALL_R * 2 + y + 2.8 + Math.sin(t * 5) * 0.2, z);
        b.arrow.visible = vis && !falling && s === core.slot && !TV;
        if (fl & 4 && sp > 3 && !falling) puffs.emit(x, 0.2, z, { n: 1, speed: 1, up: 1, life: 0.4, size: 0.6, color: 0xe8d0a0 });
        if (sp > 9 && !falling && Math.random() < 0.5) puffs.emit(x, 0.3, z, { n: 1, speed: 0.6, up: 0.6, life: 0.5, size: 0.8, color: b.color.getHex() });
      }

      puffs.update(dt);
      rings.update(dt);

      // 카메라
      if (TV) {
        const a = t * 0.08;
        camera.position.set(O.x + Math.cos(a) * 42, O.y + 34, O.z + Math.sin(a) * 42);
        camLook.copy(O);
      } else {
        const a = sumoAngle(Math.max(0, core.slot));
        camera.position.set(O.x + Math.cos(a) * 33, O.y + 23, O.z + Math.sin(a) * 33);
        const me = R.get(core.slot);
        tmpV.copy(O);
        if (me && me[4] && !(me[5] & 8)) tmpV.add(new THREE.Vector3(me[1], 0, me[2]).multiplyScalar(0.3));
        camLook.lerp(tmpV, Math.min(1, dt * 3));
      }
      camera.lookAt(camLook);
      core.render(camera);

      // 화면 정보
      if (!snap) return;
      el('s-round').innerHTML = `라운드 ${snap.rd}<small>/ ${snap.rds}</small>`;
      el('s-time').textContent = `${Math.floor(snap.rt)}초`;
      el('s-warn').classList.toggle('hidden', !(shrinking && snap.sub === 'fight' && snap.rt < SUMO.SHRINK_START + 4));
      if (shrinking && !shrinkWarned) { shrinkWarned = true; sfx.alert(); }
      el('s-chips').innerHTML = snap.b.map((r) => `<div class="g-chip ${r[4] && !(r[5] & 8) ? '' : 'out'} ${r[0] === core.slot ? 'me' : ''}" style="border-color:${COLOR_CSS[r[0]]}">
        ${core.esc(core.nameOf(r[0]))}${core.isHuman(r[0]) ? '' : ' (AI)'}<b>${'★'.repeat(r[6]) || '·'}</b></div>`).join('');
      let big = '';
      if (snap.sub === 'ready') big = `라운드 ${snap.rd} · ${Math.ceil(snap.se / 1000)}`;
      else if (snap.sub === 'inter') big = snap.w >= 0 ? `${core.esc(core.nameOf(snap.w))} 승리` : '무승부';
      el('s-big').innerHTML = big;
      el('s-big').style.color = snap.sub === 'inter' && snap.w >= 0 ? COLOR_CSS[snap.w] : '';
      if (snap.sub !== lastSub) {
        if (snap.sub === 'ready') shrinkWarned = false;
        lastSub = snap.sub;
      }
      const me = snap.b.find((r) => r[0] === core.slot);
      if (me) {
        setSkill('dash', me[8], SUMO.DASH_CD);
        setSkill('heavy', me[9], SUMO.HEAVY_CD, me[5] & 1);
        setSkill('jump', me[10], SUMO.JUMP_CD, me[5] & 2);
        setSkill('brake', 0, 1, me[5] & 4);
        setSkill('wave', me[11], SUMO.WAVE_CD);
      }
    },
    event(ev) {
      const R = core.rows(core.sample(), 'b', [1, 2]);
      const at = (s) => R.get(s);
      const mine = ev.s === core.slot;
      switch (ev.k) {
        case 'dash': {
          const r = at(ev.s);
          if (r) puffs.emit(r[1], 0.4, r[2], { n: 14, speed: 5, up: 1.5, life: 0.5, size: 1, color: 0xffffff });
          sfx.whoosh(mine ? 1 : 0.5);
          break;
        }
        case 'heavy': sfx.boom(mine ? 0.5 : 0.25); break;
        case 'jump': sfx.whoosh(mine ? 0.7 : 0.3); break;
        case 'wave': {
          const r = at(ev.s);
          if (r) {
            rings.spawn(r[1], 0.3, r[2], { color: COLORS[ev.s], r0: 1, r1: SUMO.WAVE_R, life: 0.5 });
            rings.spawn(r[1], 0.3, r[2], { color: 0xffffff, r0: 0.5, r1: SUMO.WAVE_R * 0.7, life: 0.4 });
          }
          sfx.ult(mine ? 0.8 : 0.4);
          break;
        }
        case 'bump':
          puffs.emit(ev.x, 1.2, ev.z, { n: Math.min(20, 4 + ev.v), speed: 4, up: 3, life: 0.5, size: 0.8, color: 0xfff0c0 });
          sfx.hit();
          if (ev.v > 8) sfx.boom(Math.min(0.6, ev.v / 30));
          break;
        case 'fall': {
          const who = core.nameOf(ev.s);
          const by = ev.by >= 0 ? core.nameOf(ev.by) : null;
          if (mine) { core.center(by ? `${by}에게 밀려 탈락` : '탈락', 'bad', 1800); sfx.hurt(); }
          else if (ev.by === core.slot) { core.center(`${who} 밀어냄`, 'good', 1500); sfx.kill(); }
          else sfx.whoosh(0.4);
          break;
        }
        case 'round':
          if (ev.w === core.slot || TV) sfx.fanfare(); else sfx.alert();
          break;
        case 'nextround': break;
        case 'item': sfx.pickup(0.4); break;
        case 'mega':
          if (mine) { core.center('번개 · 무거워짐', 'good', 1200); sfx.streak(3); }
          else sfx.ult(0.3);
          {
            const r = at(ev.s);
            if (r) rings.spawn(r[1], 0.3, r[2], { color: 0xffd24a, r0: 1, r1: 6, life: 0.5 });
          }
          break;
        case 'go': sfx.beep(1320, 0.3); core.center('시작', 'good', 800); break;
        default:
      }
    },
    dispose() {
      scene.remove(root);
      disposeTree(root);
    },
  };
}
