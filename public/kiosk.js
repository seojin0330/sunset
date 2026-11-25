// 체험전용: 노트북 화면이 꺼지지 않게 (https 주소나 크롬 flags 설정이 있을 때만 작동)
let lock = null;

async function keepAwake() {
  if (!('wakeLock' in navigator) || lock || document.visibilityState !== 'visible') return;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => { lock = null; });
  } catch { lock = null; }
}

export function initKiosk() {
  keepAwake();
  // 탭을 다시 보거나 처음 클릭/키를 누르면 다시 요청 (브라우저가 사용자 동작을 요구할 때가 있음)
  document.addEventListener('visibilitychange', keepAwake);
  addEventListener('pointerdown', keepAwake);
  addEventListener('keydown', keepAwake);
}
