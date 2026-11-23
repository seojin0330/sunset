// 키보드 + ESP32 컨트롤러(USB 시리얼) 입력
// 컨트롤러가 보내는 한 줄: roll,pitch,b1,b2,b3,b4,shake
//   b1 = 오른쪽 위(기관총), b2 = 오른쪽 아래(미사일), b3 = 왼쪽 위(회피), b4 = 왼쪽 아래(경적/부스터)
import { clamp } from '/shared/sim.js';

const CAL_KEY = 'sd_calib_v1';
const INV_KEY = 'sd_invert';

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* 저장 불가 */ } }

export const ctrl = {
  supported: 'serial' in navigator,
  connected: false,
  error: '',
  raw: { r: 0, p: 0 },
  btn: [false, false, false, false],
  shake: false,
  last: 0,
  cal: null,
  invert: lsGet(INV_KEY) === '1',
  onConnect: null,
};

try { ctrl.cal = JSON.parse(lsGet(CAL_KEY) || 'null'); } catch { ctrl.cal = null; }

export function setInvert(v) {
  ctrl.invert = !!v;
  lsSet(INV_KEY, v ? '1' : '0');
}

const wrapDeg = (a) => { while (a > 180) a -= 360; while (a < -180) a += 360; return a; };
const axisVal = (a) => (a === 'r' ? ctrl.raw.r : ctrl.raw.p);
const zeroOf = (a) => (a === 'r' ? ctrl.cal.zr : ctrl.cal.zp);
const dead = (v, d) => Math.sign(v) * Math.max(0, Math.abs(v) - d);
const curve = (x) => { x = clamp(x, -1, 1); return x * (0.55 + 0.45 * Math.abs(x)); };

export const isLive = () => ctrl.connected && performance.now() - ctrl.last < 600;

// 현재 기울기 (보정 후, 도 단위)
export function tiltDeg() {
  if (!ctrl.cal) return { bank: 0, fwd: 0 };
  const c = ctrl.cal;
  return {
    bank: wrapDeg(axisVal(c.bankAxis) - zeroOf(c.bankAxis)) * c.bankSign,
    fwd: wrapDeg(axisVal(c.fwdAxis) - zeroOf(c.fwdAxis)) * c.fwdSign,
  };
}

// ---------- 보정 마법사 ----------
let tmpCal = null;
export function calibCapture(step) {
  const { r, p } = ctrl.raw;
  if (step === 0) {
    tmpCal = { zr: r, zp: p };
    return { ok: true };
  }
  if (step === 1) {
    const dr = wrapDeg(r - tmpCal.zr);
    const dp = wrapDeg(p - tmpCal.zp);
    if (Math.max(Math.abs(dr), Math.abs(dp)) < 12) return { ok: false, msg: '조금 더 크게 기울여 주세요' };
    if (Math.abs(dr) >= Math.abs(dp)) Object.assign(tmpCal, { bankAxis: 'r', bankSign: Math.sign(dr), fwdAxis: 'p' });
    else Object.assign(tmpCal, { bankAxis: 'p', bankSign: Math.sign(dp), fwdAxis: 'r' });
    return { ok: true };
  }
  if (step === 2) {
    const z = tmpCal.fwdAxis === 'r' ? tmpCal.zr : tmpCal.zp;
    const d = wrapDeg((tmpCal.fwdAxis === 'r' ? r : p) - z);
    if (Math.abs(d) < 12) return { ok: false, msg: '조금 더 크게 숙여 주세요' };
    tmpCal.fwdSign = Math.sign(d);
    ctrl.cal = tmpCal;
    lsSet(CAL_KEY, JSON.stringify(ctrl.cal));
    return { ok: true, done: true };
  }
  return { ok: false };
}

// 지금 잡고 있는 자세를 '수평'으로 (라운드 시작 때 자동 호출)
export function zeroNow() {
  if (!ctrl.cal || !isLive()) return;
  ctrl.cal.zr = ctrl.raw.r;
  ctrl.cal.zp = ctrl.raw.p;
  lsSet(CAL_KEY, JSON.stringify(ctrl.cal));
}

// ---------- 시리얼 ----------
let running = false;

function parseLine(line) {
  if (!line) return;
  if (line.startsWith('ERR')) {
    ctrl.error = '기울기 센서(MPU6050) 연결을 확인하세요';
    return;
  }
  const v = line.split(',');
  if (v.length < 7) return;
  const r = parseFloat(v[0]);
  const p = parseFloat(v[1]);
  if (!Number.isFinite(r) || !Number.isFinite(p)) return;
  ctrl.raw.r = r;
  ctrl.raw.p = p;
  for (let i = 0; i < 4; i++) ctrl.btn[i] = v[2 + i] === '1';
  ctrl.shake = v[6].trim() === '1';
  ctrl.last = performance.now();
  if (!(r === 0 && p === 0)) ctrl.error = '';
}

async function runPort(port) {
  if (running) return;
  running = true;
  try {
    await port.open({ baudRate: 115200 });
  } catch (e) {
    running = false;
    ctrl.error = '컨트롤러를 열 수 없어요 (다른 창에서 쓰는 중인지 확인)';
    return;
  }
  ctrl.connected = true;
  ctrl.error = '';
  ctrl.last = performance.now();
  if (ctrl.onConnect) ctrl.onConnect();
  const decoder = new TextDecoderStream();
  const closed = port.readable.pipeTo(decoder.writable).catch(() => {});
  const reader = decoder.readable.getReader();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        parseLine(buf.slice(0, i).trim());
        buf = buf.slice(i + 1);
      }
      if (buf.length > 2000) buf = '';
    }
  } catch {
    // 케이블이 빠지면 여기로 옴
  } finally {
    try { reader.releaseLock(); } catch { /* */ }
    await closed;
    try { await port.close(); } catch { /* */ }
    ctrl.connected = false;
    ctrl.btn = [false, false, false, false];
    running = false;
  }
}

export async function connectSerial() {
  if (!ctrl.supported) throw new Error('NO_SERIAL');
  const port = await navigator.serial.requestPort();
  runPort(port);
}

export async function autoConnect() {
  if (!ctrl.supported) return;
  navigator.serial.addEventListener('connect', (e) => runPort(e.target));
  const ports = await navigator.serial.getPorts();
  if (ports[0]) runPort(ports[0]);
}

// ---------- 키보드 ----------
const keys = new Set();
const keyEdges = new Set();
addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT') return;
  if (!keys.has(e.code)) keyEdges.add(e.code);
  keys.add(e.code);
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
const has = (...c) => c.some((k) => keys.has(k));
const edge = (...c) => c.some((k) => keyEdges.has(k));

// ---------- 매 프레임 ----------
const kb = { bank: 0, pitch: 0 };
const prev = { ctrlAny: false, btn: [false, false, false, false], shake: false };
export const inp = {
  bank: 0, pitch: 0, fire: false, boost: false,
  missileEdge: false, evadeEdge: false, b4Edge: false, ultEdge: false,
  ctrlAnyEdge: false, enterEdge: false,
};

export function poll(dt) {
  const live = isLive();
  const kBank = (has('ArrowRight', 'KeyD') ? 1 : 0) - (has('ArrowLeft', 'KeyA') ? 1 : 0);
  const kPitch = (has('ArrowUp', 'KeyW') ? 1 : 0) - (has('ArrowDown', 'KeyS') ? 1 : 0);
  kb.bank += (kBank - kb.bank) * Math.min(1, dt * 6);
  kb.pitch += (kPitch - kb.pitch) * Math.min(1, dt * 6);
  let bank = kb.bank;
  let pitch = kb.pitch;

  if (live && ctrl.cal) {
    const t = tiltDeg();
    bank += curve(dead(t.bank, 3) / 30);
    // 앞으로 숙이면 하강 (상하 반전 옵션)
    pitch += -curve(dead(t.fwd, 3) / 24) * (ctrl.invert ? -1 : 1);
  }
  inp.bank = clamp(bank, -1, 1);
  inp.pitch = clamp(pitch, -1, 1);

  const b = live ? ctrl.btn : [false, false, false, false];
  const sh = live && ctrl.shake;
  inp.fire = has('Space', 'KeyJ') || b[0];
  inp.boost = has('KeyB', 'Semicolon') || b[3];
  inp.missileEdge = edge('KeyK') || (b[1] && !prev.btn[1]);
  inp.evadeEdge = edge('KeyL', 'ShiftLeft', 'ShiftRight') || (b[2] && !prev.btn[2]);
  inp.b4Edge = edge('KeyB', 'Semicolon') || (b[3] && !prev.btn[3]);
  inp.ultEdge = edge('KeyU') || (sh && !prev.shake);
  const any = b.some(Boolean);
  inp.ctrlAnyEdge = any && !prev.ctrlAny;
  inp.enterEdge = edge('Enter', 'NumpadEnter');

  prev.ctrlAny = any;
  prev.btn = [...b];
  prev.shake = sh;
  keyEdges.clear();
  return inp;
}
