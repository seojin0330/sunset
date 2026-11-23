// 하늘에 떠 있는 아이템 (체력, 연사, 보호막)
import * as THREE from 'three';
import { ITEM_INFO } from '/shared/sim.js';

const iconTex = {};
function getIconTex(kind) {
  if (iconTex[kind]) return iconTex[kind];
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(20,10,20,0.55)';
  g.beginPath();
  g.arc(64, 64, 58, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = ITEM_INFO[kind].css;
  g.stroke();
  // 아이콘은 직접 그림 (십자 / 번개 / 방패)
  g.fillStyle = ITEM_INFO[kind].css;
  g.beginPath();
  if (kind === 'hp') {
    g.rect(52, 30, 24, 68); g.rect(30, 52, 68, 24);
  } else if (kind === 'rapid') {
    g.moveTo(72, 24); g.lineTo(38, 70); g.lineTo(60, 70); g.lineTo(52, 104); g.lineTo(90, 54); g.lineTo(67, 54); g.lineTo(78, 24);
  } else {
    g.moveTo(64, 26); g.lineTo(96, 38); g.lineTo(94, 66); g.quadraticCurveTo(88, 92, 64, 104); g.quadraticCurveTo(40, 92, 34, 66); g.lineTo(32, 38);
  }
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  iconTex[kind] = t;
  return t;
}

let glowTex = null;
function getGlowTex() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

export class Items {
  constructor(scene) {
    this.scene = scene;
    this.map = new Map();
  }

  sync(list) {
    const ids = new Set(list.map((i) => i.id));
    for (const [id, it] of this.map) {
      if (!ids.has(id)) { this.scene.remove(it.group); this.map.delete(id); }
    }
    for (const d of list) {
      if (this.map.has(d.id)) continue;
      const info = ITEM_INFO[d.kind];
      if (!info) continue;
      const group = new THREE.Group();
      group.position.set(d.x, d.y, d.z);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: getGlowTex(), color: info.color, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }));
      glow.scale.set(34, 34, 1);
      group.add(glow);
      const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: getIconTex(d.kind), transparent: true, depthWrite: false }));
      icon.scale.set(14, 14, 1);
      group.add(icon);
      // 멀리서도 보이는 빛기둥
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.9, 0.9, d.y, 8, 1, true),
        new THREE.MeshBasicMaterial({
          color: info.color, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending,
          depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
        }),
      );
      beam.position.y = -d.y / 2;
      group.add(beam);
      this.scene.add(group);
      this.map.set(d.id, { ...d, group, glow, icon, baseY: d.y, phase: Math.random() * 6 });
    }
  }

  clear() { this.sync([]); }

  update(dt, t) {
    for (const it of this.map.values()) {
      it.group.position.y = it.baseY + Math.sin(t * 1.6 + it.phase) * 2.5;
      const s = 30 + Math.sin(t * 4 + it.phase) * 6;
      it.glow.scale.set(s, s, 1);
    }
  }
}
