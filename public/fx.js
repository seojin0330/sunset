// 총알, 미사일, 폭발, 연기, 충격파, 말풍선
import * as THREE from 'three';
import { CFG, solidAt } from '/shared/sim.js';

function softTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.tex = softTexture();

    this.bulletGeo = new THREE.BoxGeometry(0.25, 0.25, 7);
    this.bulletMat = new THREE.MeshBasicMaterial({
      color: 0xffd27a, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    this.bullets = [];
    this.bulletPool = [];

    this.puffs = [];
    this.puffPool = [];

    this.missileGeo = new THREE.CylinderGeometry(0.22, 0.22, 2.6, 6).rotateX(Math.PI / 2);
    this.missileMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.4, metalness: 0.4 });
    this.missiles = new Map();

    this.waves = [];
    this.bubbles = [];
  }

  // ---------- 총알 ----------
  addBullet(pos, vel, local, owner) {
    const mesh = this.bulletPool.pop() || new THREE.Mesh(this.bulletGeo, this.bulletMat);
    mesh.position.copy(pos);
    _a.copy(pos).add(vel);
    mesh.lookAt(_a);
    mesh.visible = true;
    this.scene.add(mesh);
    this.bullets.push({ mesh, pos: mesh.position, vel: vel.clone(), life: CFG.MG_LIFE, local, owner });
  }

  // ---------- 연기/불꽃 입자 ----------
  puff(pos, o = {}) {
    let s = this.puffPool.pop();
    if (!s) {
      s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false }));
    }
    const m = s.material;
    m.color.set(o.color ?? 0x888888);
    m.blending = o.add ? THREE.AdditiveBlending : THREE.NormalBlending;
    m.toneMapped = !o.add;
    m.opacity = o.opacity ?? 0.7;
    s.position.copy(pos);
    s.visible = true;
    this.scene.add(s);
    this.puffs.push({
      s, life: o.life ?? 1, max: o.life ?? 1,
      s0: o.s0 ?? 2, s1: o.s1 ?? 8, op: o.opacity ?? 0.7,
      vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0,
    });
  }

  explosion(pos, scale = 1) {
    this.puff(pos, { color: 0xffd9a0, add: true, life: 0.25, s0: 10 * scale, s1: 40 * scale, opacity: 1 });
    for (let i = 0; i < 14; i++) {
      const r = 18 * scale;
      this.puff(pos, {
        color: i % 2 ? 0xff8a2a : 0xffc24a, add: true, life: 0.5 + Math.random() * 0.5,
        s0: 5 * scale, s1: 16 * scale, opacity: 0.95,
        vx: (Math.random() - 0.5) * r * 2, vy: (Math.random() - 0.3) * r * 2, vz: (Math.random() - 0.5) * r * 2,
      });
    }
    for (let i = 0; i < 9; i++) {
      this.puff(pos, {
        color: 0x2b2522, life: 2 + Math.random() * 1.5, s0: 6 * scale, s1: 30 * scale, opacity: 0.55,
        vx: (Math.random() - 0.5) * 14, vy: 4 + Math.random() * 8, vz: (Math.random() - 0.5) * 14,
      });
    }
  }

  spark(pos) {
    for (let i = 0; i < 3; i++) {
      this.puff(pos, {
        color: 0xffe08a, add: true, life: 0.22, s0: 2.5, s1: 5, opacity: 1,
        vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30, vz: (Math.random() - 0.5) * 30,
      });
    }
  }

  splash(pos) {
    _b.set(pos.x, 1, pos.z);
    for (let i = 0; i < 3; i++) {
      this.puff(_b, { color: 0xffe6d6, life: 0.8, s0: 1.5, s1: 6, opacity: 0.6, vy: 8 + Math.random() * 6, vx: (Math.random() - 0.5) * 6, vz: (Math.random() - 0.5) * 6 });
    }
  }

  // ---------- 미사일 ----------
  addMissile({ id, owner, target, pos, dir, local }) {
    if (this.missiles.has(id)) return;
    const mesh = new THREE.Mesh(this.missileGeo, this.missileMat);
    mesh.position.set(pos.x, pos.y, pos.z);
    this.scene.add(mesh);
    const d = new THREE.Vector3(dir.x, dir.y, dir.z).normalize();
    this.missiles.set(id, { id, owner, target, mesh, pos: mesh.position, dir: d, life: CFG.MS_LIFE, local, smokeT: 0 });
  }

  endMissile(id, explode) {
    const m = this.missiles.get(id);
    if (!m) return null;
    this.missiles.delete(id);
    this.scene.remove(m.mesh);
    if (explode) this.explosion(m.pos, 0.6);
    return m;
  }

  // ---------- 충격파, 말풍선 ----------
  shockwave(pos, radius) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.waves.push({ mesh, t: 0, dur: 0.7, radius });
    this.puff(pos, { color: 0xbff2ff, add: true, life: 0.3, s0: 20, s1: 80, opacity: 1 });
  }

  bubble(getPos, text) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 96;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.beginPath();
    g.roundRect(8, 8, 240, 64, 24);
    g.fill();
    g.beginPath();
    g.moveTo(110, 70); g.lineTo(128, 92); g.lineTo(146, 70);
    g.fill();
    g.fillStyle = '#222';
    g.font = 'bold 34px "Segoe UI Emoji", "Malgun Gothic", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 128, 41);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
    s.scale.set(0.1, 0.0375, 1);
    s.renderOrder = 30;
    this.scene.add(s);
    this.bubbles.push({ s, getPos, life: 1.6 });
  }

  clearAll() {
    for (const b of this.bullets) { this.scene.remove(b.mesh); this.bulletPool.push(b.mesh); }
    this.bullets.length = 0;
    for (const id of [...this.missiles.keys()]) this.endMissile(id, false);
    for (const w of this.waves) this.scene.remove(w.mesh);
    this.waves.length = 0;
    for (const b of this.bubbles) this.scene.remove(b.s);
    this.bubbles.length = 0;
  }

  // ctx: { bulletHit(a,b,owner)->bool, target(slot)->{pos,evading}|null, enemiesOf(owner)->[{slot,pos,evading}], missileHit(m,slot), missileEnd(m) }
  update(dt, ctx) {
    // 총알
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      _a.copy(b.pos);
      b.pos.addScaledVector(b.vel, dt);
      b.life -= dt;
      let dead = b.life <= 0;
      if (!dead && b.local && ctx.bulletHit(_a, b.pos, b.owner)) dead = true;
      if (!dead && (b.pos.y < 0 || solidAt(b.pos.x, b.pos.y, b.pos.z))) {
        if (b.pos.y < 2) this.splash(b.pos);
        else this.puff(b.pos, { color: 0x9a8070, life: 0.6, s0: 1.5, s1: 5, opacity: 0.6 });
        dead = true;
      }
      if (dead) {
        this.scene.remove(b.mesh);
        this.bulletPool.push(b.mesh);
        this.bullets.splice(i, 1);
      }
    }

    // 미사일
    for (const m of [...this.missiles.values()]) {
      if (m.target != null && m.target >= 0) {
        const t = ctx.target(m.target);
        if (!t || t.evading) m.target = -1;
        else {
          _a.copy(t.pos).sub(m.pos).normalize();
          const ang = m.dir.angleTo(_a);
          const maxTurn = CFG.MS_TURN * dt;
          // 너무 옆/뒤로 빠져나가면 놓침 (급선회로 따돌리기)
          if (ang > CFG.MS_OVERSHOOT) m.target = -1;
          else if (ang > 1e-4) {
            _q.setFromUnitVectors(m.dir, _a);
            _qi.identity().slerp(_q, Math.min(1, maxTurn / ang));
            m.dir.applyQuaternion(_qi).normalize();
          }
        }
      }
      m.pos.addScaledVector(m.dir, CFG.MS_SPEED * dt);
      _b.copy(m.pos).add(m.dir);
      m.mesh.lookAt(_b);
      m.life -= dt;
      m.smokeT -= dt;
      if (m.smokeT <= 0) {
        m.smokeT = 0.025;
        this.puff(m.pos, { color: 0xdedede, life: 1.4, s0: 1.2, s1: 6, opacity: 0.5 });
        this.puff(m.pos, { color: 0xffa040, add: true, life: 0.12, s0: 1.6, s1: 0.6, opacity: 1 });
      }
      if (m.local) {
        let hitSlot = -1;
        for (const e of ctx.enemiesOf(m.owner)) {
          if (e.evading) continue;
          if (e.pos.distanceTo(m.pos) < CFG.MS_PROX) { hitSlot = e.slot; break; }
        }
        const ground = m.pos.y < 1 || solidAt(m.pos.x, m.pos.y, m.pos.z);
        if (hitSlot >= 0) ctx.missileHit(m, hitSlot);
        if (hitSlot >= 0 || ground || m.life <= 0) {
          this.endMissile(m.id, true);
          ctx.missileEnd(m);
        }
      } else if (m.life <= -1) {
        this.endMissile(m.id, false);
      }
    }

    // 입자
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.s);
        this.puffPool.push(p.s);
        this.puffs.splice(i, 1);
        continue;
      }
      const k = 1 - p.life / p.max;
      const sc = p.s0 + (p.s1 - p.s0) * k;
      p.s.scale.set(sc, sc, 1);
      p.s.material.opacity = p.op * (1 - k);
      p.s.position.x += p.vx * dt;
      p.s.position.y += p.vy * dt;
      p.s.position.z += p.vz * dt;
      p.vx *= 1 - dt * 1.5; p.vy *= 1 - dt * 1.5; p.vz *= 1 - dt * 1.5;
    }

    // 충격파
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.t += dt;
      const k = w.t / w.dur;
      if (k >= 1) {
        this.scene.remove(w.mesh);
        w.mesh.geometry.dispose();
        w.mesh.material.dispose();
        this.waves.splice(i, 1);
        continue;
      }
      const r = w.radius * (1 - Math.pow(1 - k, 3));
      w.mesh.scale.setScalar(Math.max(1, r));
      w.mesh.material.opacity = 0.45 * (1 - k);
    }

    // 말풍선
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      b.life -= dt;
      const p = b.getPos();
      if (b.life <= 0 || !p) {
        this.scene.remove(b.s);
        b.s.material.map.dispose();
        b.s.material.dispose();
        this.bubbles.splice(i, 1);
        continue;
      }
      b.s.position.set(p.x, p.y + 11, p.z);
      b.s.material.opacity = Math.min(1, b.life * 3);
    }
  }
}
