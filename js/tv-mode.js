// === js/tv-mode.js — 현장 TV 보기(대시보드 index.html?tv=1, 2026-11-26 앱 점검) ===
// 대시보드를 그대로 쓰되 '오늘 진행' 띠와 '오늘 업무 처리량' 카드만 크게 보인다(사람 이름이 나오는 카드·메뉴·내 업무는 숨김 —
// css/dash-d.css .tv-mode). 새 Firestore 읽기 없음(대시보드 탭 하나와 같다). 화면 꺼짐 방지(Wake Lock), 시계.
// 알림 창이 저절로 뜨지 않게 js/app-sync.js maybeOpenNotificationModal 이 isTvMode() 를 본다.
// 클래스는 index.html <head> 인라인 스크립트가 먼저 붙인다(처음에 전체 화면이 번쩍이지 않게).

export const isTvMode = () => {
    try { return new URLSearchParams(location.search).get('tv') === '1'; } catch (_) { return false; }
};

let lock = null;
async function keepAwake() {
    try {
        if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
        if (lock && !lock.released) return;
        lock = await navigator.wakeLock.request('screen');
    } catch (_) { /* 지원 안 함·거부 — 화면 설정에 맡긴다 */ }
}

const WD = ['일', '월', '화', '수', '목', '금', '토'];
function tick() {
    const d = new Date();
    const c = document.getElementById('tv-clock');
    const t = document.getElementById('tv-date');
    if (c) c.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (t) t.textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`;
}

export function initTvMode() {
    if (!isTvMode()) return;
    document.documentElement.classList.add('tv-mode');
    tick();
    setInterval(tick, 10 * 1000);
    keepAwake();
    document.addEventListener('visibilitychange', keepAwake);
}
