// 파티 게임들이 같이 쓰는 3D 도구 (이름표, 그림자, 파티클, 고리 효과)
import * as THREE from 'three';

export function nameTag(text, color, size = 1) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 34px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 7; g.strokeStyle = 'rgba(0,0,0,0.8)';
  g.strokeText(text, 128, 32);
  g.fillStyle = color; g.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false }));
  s.scale.set(0.13 * size, 0.0325 * size, 1);
  s.renderOrder = 30;
  return s;
}

let blobTex = null;
export function blobShadow(r) {
  if (!blobTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    blobTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2.4, r * 2.4).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, fog: false }));
  m.renderOrder = 2;
  return m;
}

let dotTex = null;
export function softDot() {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  dotTex = new THREE.CanvasTexture(c);
  return dotTex;
}

// 간단한 파티클 (먼지, 물보라, 반짝이)
export class Puffs {
  constructor(parent, max = 400) {
    this.max = max;
    this.list = [];
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: softDot() }, uScale: { value: 600 } },
      vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC; varying float vA;
        uniform float uScale;
        void main(){ vC = color; vA = clamp(size, 0.0, 1.0); vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = abs(size) * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uTex; varying vec3 vC; varying float vA;
        void main(){ vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(vC, t.a * 0.85); }`,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    parent.add(this.points);
  }
  emit(x, y, z, { n = 8, speed = 4, up = 2, life = 0.8, size = 1, color = 0xffffff, spread = 0.3, vx = 0, vy = 0, vz = 0, grav = -4 } = {}) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      if (this.list.length >= this.max) this.list.shift();
      const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.6);
      this.list.push({
        x: x + (Math.random() - 0.5) * spread, y: y + (Math.random() - 0.5) * spread, z: z + (Math.random() - 0.5) * spread,
        vx: vx + Math.cos(a) * s, vy: vy + up * (0.5 + Math.random()), vz: vz + Math.sin(a) * s,
        life, t: 0, size: size * (0.6 + Math.random() * 0.8), r: c.r, g: c.g, b: c.b, grav,
      });
    }
  }
  update(dt) {
    let k = 0;
    this.list = this.list.filter((p) => (p.t += dt) < p.life);
    for (const p of this.list) {
      p.vy += p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.vx *= 0.96; p.vz *= 0.96;
      this.pos[k * 3] = p.x; this.pos[k * 3 + 1] = p.y; this.pos[k * 3 + 2] = p.z;
      const fade = 1 - p.t / p.life;
      this.col[k * 3] = p.r; this.col[k * 3 + 1] = p.g; this.col[k * 3 + 2] = p.b;
      this.size[k] = p.size * (0.5 + fade * 0.5) * (fade < 0.3 ? fade / 0.3 : 1);
      k++;
    }
    for (let i = k; i < this.max; i++) this.size[i] = 0;
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
    g.setDrawRange(0, Math.max(1, k));
  }
}

// 바닥에 퍼지는 고리 (충격파 등)
export class Rings {
  constructor(parent) { this.parent = parent; this.list = []; }
  spawn(x, y, z, { color = 0xffffff, r0 = 1, r1 = 8, life = 0.5 } = {}) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    m.position.set(x, y, z);
    m.renderOrder = 6;
    this.parent.add(m);
    this.list.push({ m, t: 0, r0, r1, life });
  }
  update(dt) {
    this.list = this.list.filter((o) => {
      o.t += dt;
      const f = o.t / o.life;
      if (f >= 1) { this.parent.remove(o.m); o.m.geometry.dispose(); o.m.material.dispose(); return false; }
      const r = o.r0 + (o.r1 - o.r0) * (1 - (1 - f) * (1 - f));
      o.m.scale.set(r, 1, r);
      o.m.material.opacity = 1 - f;
      return true;
    });
  }
}

export function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    }
  });
}

// 줄무늬 공 텍스처 (굴러가는 게 잘 보이게)
export function ballTexture(colorCss) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = colorCss; g.fillRect(0, 0, 256, 128);
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.fillRect(0, 56, 256, 16);
  for (let i = 0; i < 4; i++) {
    g.beginPath(); g.arc(32 + i * 64, 30, 11, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(0, 100, 256, 28);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
