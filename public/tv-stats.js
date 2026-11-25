// TV 화면 구석: "오늘 ○판 · 연 ○명 참가 · 최고 기록"
// gameKey(): 지금 TV가 보여주는 게임 ('dogfight', 'sumo' …) — 그 게임의 오늘 최고 기록을 보여줌
const NAMES = { dogfight: '공중전', sumo: '스모', boat: '보트', dash: '허들', maze: '미로' };

export function initTvStats(gameKey) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;right:16px;top:12px;z-index:40;pointer-events:none;'
    + 'padding:6px 12px;border-radius:10px;background:rgba(16,10,20,0.6);color:#f3ece8;'
    + 'font-size:15px;font-weight:600;white-space:nowrap;letter-spacing:0.2px';
  document.body.appendChild(el);
  let sum = null;

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function draw() {
    if (!sum) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    // 로비에선 오른쪽 위(제목 옆), 게임 중엔 오른쪽 아래 (위쪽은 게임별 진행 막대가 있음)
    const inGame = ['countdown', 'playing'].includes(document.body.dataset.phase);
    el.style.top = inGame ? 'auto' : '12px';
    el.style.bottom = inGame ? '12px' : 'auto';
    const g = gameKey();
    const best = sum.bestByGame && sum.bestByGame[g];
    const bestTxt = best ? ` · ${NAMES[g] || ''} 최고 ${esc(best.label)} <span style="opacity:0.75">(${esc(best.name)})</span>` : '';
    el.innerHTML = `오늘 ${sum.plays}판 · 연 ${sum.humans}명 참가${bestTxt}`;
  }
  async function load() {
    try { sum = await (await fetch('/api/stats/today', { cache: 'no-store' })).json(); } catch { /* 다음에 다시 */ }
    draw();
  }
  load();
  setInterval(load, 20000);
  setInterval(draw, 2000); // 보여주는 게임이 바뀌면 바로 반영
}
