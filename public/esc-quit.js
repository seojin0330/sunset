// ESC를 꾹 누르고 있으면 지금 게임을 끝내고 모두 로비로 (비행기 게임 · 파티 게임 공용)
const HOLD_MS = 1500;

export function initEscQuit({ active, onQuit }) {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:50%;bottom:12%;transform:translateX(-50%);z-index:50;display:none;'
    + 'padding:12px 20px;border-radius:14px;background:rgba(16,10,20,0.88);border:2px solid #ff8a3d;'
    + 'color:#fff;font-weight:800;font-size:20px;text-align:center;min-width:280px;pointer-events:none';
  box.innerHTML = '<div>ESC를 계속 누르면 게임 종료</div>'
    + '<div style="margin-top:8px;height:8px;border-radius:4px;background:rgba(255,255,255,0.18);overflow:hidden">'
    + '<div style="height:100%;width:0;background:#ff8a3d"></div></div>';
  document.body.appendChild(box);
  const bar = box.querySelector('div > div > div');

  let downAt = 0, raf = 0, fired = false;
  const reset = () => { downAt = 0; fired = false; box.style.display = 'none'; bar.style.width = '0'; cancelAnimationFrame(raf); };
  const tick = () => {
    if (!downAt) return;
    const k = Math.min(1, (performance.now() - downAt) / HOLD_MS);
    bar.style.width = `${k * 100}%`;
    if (k >= 1 && !fired) { fired = true; onQuit(); setTimeout(reset, 300); return; }
    raf = requestAnimationFrame(tick);
  };

  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.repeat || downAt || !active()) return;
    downAt = performance.now();
    box.style.display = 'block';
    raf = requestAnimationFrame(tick);
  });
  addEventListener('keyup', (e) => { if (e.key === 'Escape' && !fired) reset(); });
  addEventListener('blur', () => { if (!fired) reset(); });
}
