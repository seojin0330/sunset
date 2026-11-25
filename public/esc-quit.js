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

  // 종료는 타이머로 (화면 갱신이 멈춰도 정확히 1.5초 뒤), 막대는 CSS 애니메이션으로
  let timer = 0;
  const reset = () => {
    clearTimeout(timer); timer = 0;
    box.style.display = 'none';
    bar.style.transition = 'none'; bar.style.width = '0';
  };

  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.repeat || timer || !active()) return;
    box.style.display = 'block';
    bar.style.transition = 'none'; bar.style.width = '0';
    void bar.offsetWidth; // 처음부터 다시 차오르게
    bar.style.transition = `width ${HOLD_MS}ms linear`; bar.style.width = '100%';
    timer = setTimeout(() => { onQuit(); setTimeout(reset, 300); }, HOLD_MS);
  });
  addEventListener('keyup', (e) => { if (e.key === 'Escape') reset(); });
  addEventListener('blur', reset);
}
