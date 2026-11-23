// 프로펠러 비행기 모델과 이름표
import * as THREE from 'three';

const white = new THREE.MeshStandardMaterial({ color: 0xf3efe6, roughness: 0.5, flatShading: true });
const dark = new THREE.MeshStandardMaterial({ color: 0x26272b, roughness: 0.6, metalness: 0.3, flatShading: true });
const glass = new THREE.MeshStandardMaterial({ color: 0x1b2a3a, roughness: 0.15, metalness: 0.7 });

export function buildPlane(colorHex) {
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  const body = new THREE.Group();
  g.add(body);
  const prim = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.45, metalness: 0.15, flatShading: true });
  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    body.add(m);
    return m;
  };
  add(new THREE.CylinderGeometry(1.0, 0.55, 9, 10).rotateX(Math.PI / 2), prim, 0, 0, 0);
  add(new THREE.CylinderGeometry(1.12, 1.05, 1.4, 12).rotateX(Math.PI / 2), dark, 0, 0, 4.6);
  add(new THREE.ConeGeometry(0.45, 1.0, 8).rotateX(Math.PI / 2), white, 0, 0, 5.75);
  add(new THREE.BoxGeometry(12.5, 0.3, 2.3), prim, 0, -0.35, 1.0);
  add(new THREE.BoxGeometry(1.6, 0.32, 2.32), white, 5.3, -0.35, 1.0);
  add(new THREE.BoxGeometry(1.6, 0.32, 2.32), white, -5.3, -0.35, 1.0);
  add(new THREE.BoxGeometry(4.6, 0.22, 1.3), prim, 0, 0.1, -4.1);
  add(new THREE.BoxGeometry(0.22, 2.1, 1.6), prim, 0, 1.05, -4.0);
  add(new THREE.BoxGeometry(0.24, 0.7, 1.62), white, 0, 1.75, -4.0);
  add(new THREE.CylinderGeometry(1.02, 1.02, 0.6, 10).rotateX(Math.PI / 2), white, 0, 0, -1.6);
  const cockpit = add(new THREE.SphereGeometry(0.75, 10, 8), glass, 0, 0.75, 0.6);
  cockpit.scale.set(1, 0.75, 1.7);

  const prop = new THREE.Group();
  prop.position.set(0, 0, 5.45);
  body.add(prop);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.28, 5.0, 0.12), dark);
  prop.add(blade);
  const blade2 = blade.clone();
  blade2.rotation.z = Math.PI / 2;
  prop.add(blade2);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(2.6, 24),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide }),
  );
  disc.position.z = 5.48;
  body.add(disc);

  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.6, 3.6, 10).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  );
  flame.position.set(0, 0, -6.3);
  flame.visible = false;
  body.add(flame);

  const shield = new THREE.Mesh(
    new THREE.SphereGeometry(7.5, 20, 14),
    new THREE.MeshBasicMaterial({
      color: 0x5ad8ff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false,
    }),
  );
  shield.visible = false;
  g.add(shield);

  g.userData = { body, prop, flame, shield };
  g.visible = false;
  return g;
}

export function makeTag(colorCss) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.12, 0.03, 1);
  sprite.renderOrder = 20;
  sprite.userData = { canvas, tex, color: colorCss, text: null };
  sprite.visible = false;
  return sprite;
}

export function setTagText(sprite, text, hp) {
  const key = `${text}|${hp}`;
  if (sprite.userData.text === key) return;
  sprite.userData.text = key;
  const { canvas, tex, color } = sprite.userData;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 64);
  ctx.font = 'bold 28px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeText(text, 128, 24);
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 24);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(48, 48, 160, 9);
  ctx.fillStyle = hp > 35 ? color : '#ff3030';
  ctx.fillRect(49, 49, Math.max(0, (158 * hp) / 100), 7);
  tex.needsUpdate = true;
}
