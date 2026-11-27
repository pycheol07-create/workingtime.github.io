// === js/pull-refresh.js ===
// 대시보드(index.html) 휴대폰 '당겨서 새로고침' (2026-11-27 — 오른쪽 아래 새로고침 단추를 퀵메뉴로 바꾸면서).
//   휴대폰(767px 이하)에서는 틀이 고정되고 #app-content 안쪽만 스크롤되며 overscroll 도 막혀 있다(css/dash-d.css) — 브라우저 기본 당겨서
//   새로고침이 없어서 직접 만든다. #app-content 가 맨 위(scrollTop 0)일 때 아래로 당기면 위에 표시가 나오고,
//   PULL_TRIGGER_PX 이상 당겼다 놓으면 location.reload(), 덜 당기면 되돌아간다.
//   안 하는 때: 열린 창(모달·표 창·퀵메뉴 시트)이 있음 · 입력 중(입력칸에 초점) · 손가락 두 개 · 가로 스와이프 · 안쪽 목록이 스크롤돼 있음.
// passive: touchstart·touchend 는 passive, touchmove 만 #app-content 에 non-passive — 당기는 중일 때만 preventDefault 한다.
// 판정은 순수 함수 pullStep(시험 tests/pull-refresh.test.js). 표시 색은 css/dash-d.css #pull-refresh-ind.

export const PULL_TRIGGER_PX = 110;   // 손가락이 이만큼(px) 아래로 움직인 뒤 놓으면 새로고침(맨 위로 튕기는 손짓과 헷갈리지 않게 70 → 110, 2026-11-27 리뷰)
export const SCROLL_QUIET_MS = 400;   // 스크롤이 멈춘 지 이만큼 지난 뒤 시작한 손가락만(관성으로 맨 위에 막 닿은 직후는 무시)
export const PULL_DEAD_PX = 8;        // 이만큼 움직이기 전에는 방향을 정하지 않는다
const SHOW_MAX_PX = 90;               // 표시가 내려오는 최대 거리
const MOBILE_MQ = '(max-width:767px)';

/** 당기기 한 걸음 판정(순수). s = { decided, pulling }, dx·dy = 시작점에서 움직인 거리(아래가 +).
 *  → { decided, pulling, cancel, ready } — cancel 이면 이번 손가락은 손대지 않는다(보통 스크롤·가로 스와이프). */
export function pullStep(s, dx, dy) {
    if (!s.decided) {
        if (Math.abs(dx) < PULL_DEAD_PX && Math.abs(dy) < PULL_DEAD_PX) return { decided: false, pulling: false, cancel: false, ready: false };
        if (dy <= 0 || Math.abs(dx) >= Math.abs(dy)) return { decided: true, pulling: false, cancel: true, ready: false };
        return { decided: true, pulling: true, cancel: false, ready: dy >= PULL_TRIGGER_PX };
    }
    if (!s.pulling) return { decided: true, pulling: false, cancel: true, ready: false };
    return { decided: true, pulling: true, cancel: false, ready: dy >= PULL_TRIGGER_PX };
}

const OVERLAY_SEL = '.fixed.inset-0, .modal-overlay, [data-esc-modal], #refill-modal, #locrec-modal, #quick-menu-sheet';

function visible(el) {
    if (!el || el.hidden || el.classList.contains('hidden')) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    return el.getClientRects().length > 0;
}

/** 열린 창이 있거나 입력 중이면 true */
function blocked() {
    const a = document.activeElement;
    if (a && a !== document.body && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return true;
    return Array.from(document.querySelectorAll(OVERLAY_SEL)).some(visible);
}

/** 손가락이 시작된 곳에서 #app-content 까지 — 안쪽 세로 스크롤 상자가 내려가 있으면 그 상자를 스크롤해야 한다 */
function innerScrolled(target, root) {
    for (let el = target; el && el !== root; el = el.parentElement) {
        if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight) return true;
    }
    return false;
}

/** 대시보드에서 한 번 부른다(ui-main-board.js) */
export function setupPullRefresh() {
    if (typeof document === 'undefined') return;
    const root = document.getElementById('app-content');
    if (!root || root.dataset.pullRefresh === 'on') return;
    root.dataset.pullRefresh = 'on';
    const mq = matchMedia(MOBILE_MQ);

    const ind = document.createElement('div');
    ind.id = 'pull-refresh-ind';
    ind.hidden = true;
    ind.setAttribute('aria-live', 'polite');
    ind.innerHTML = '<span class="pr-arrow" aria-hidden="true">↓</span><span class="pr-text"></span>';
    document.body.appendChild(ind);
    const text = ind.querySelector('.pr-text');

    let t = null;           // { x, y, decided, pulling, ready }
    let reloading = false;
    let lastScrollAt = 0;
    root.addEventListener('scroll', () => { lastScrollAt = Date.now(); }, { passive: true });

    const place = (dy, ready) => {
        const top = root.getBoundingClientRect().top;
        const d = Math.min(SHOW_MAX_PX, Math.max(0, dy) * 0.6);
        ind.hidden = false;
        ind.classList.remove('pr-back');
        ind.classList.toggle('pr-ready', ready);
        ind.style.top = `${top}px`;
        ind.style.transform = `translate(-50%, ${d - 40}px)`;
        ind.style.opacity = String(Math.min(1, d / 40));
        const want = ready ? '놓으면 새로고침' : '당겨서 새로고침';
        if (text.textContent !== want) text.textContent = want;
    };
    const hide = () => {
        ind.classList.add('pr-back');
        ind.style.transform = 'translate(-50%, -40px)';
        ind.style.opacity = '0';
        setTimeout(() => { if (!t && !reloading) { ind.hidden = true; ind.classList.remove('pr-back', 'pr-ready'); } }, 200);
    };

    root.addEventListener('touchstart', (e) => {
        t = null;
        if (reloading || !mq.matches || e.touches.length !== 1) return;
        // 정지한 맨 위에서만 — 아이폰 고무줄 튕김(scrollTop 음수)·관성 스크롤 직후는 무시
        if (root.scrollTop !== 0 || Date.now() - lastScrollAt < SCROLL_QUIET_MS || blocked() || innerScrolled(e.target, root)) return;
        t = { x: e.touches[0].clientX, y: e.touches[0].clientY, decided: false, pulling: false, ready: false };
    }, { passive: true });

    root.addEventListener('touchmove', (e) => {
        if (!t) return;
        if (e.touches.length !== 1) { const was = t.pulling; t = null; if (was) hide(); return; }
        const dx = e.touches[0].clientX - t.x, dy = e.touches[0].clientY - t.y;
        const r = pullStep(t, dx, dy);
        if (r.cancel || (r.pulling && root.scrollTop > 0)) { const was = t.pulling; t = null; if (was) hide(); return; }
        t.decided = r.decided; t.pulling = r.pulling; t.ready = r.ready;
        t.dx = dx; t.dy = dy;
        if (!r.pulling) return;
        if (e.cancelable) e.preventDefault();      // 당기는 동안만 — 화면 튕김·텍스트 선택 막기
        place(dy, r.ready);
    }, { passive: false });

    const end = (e) => {
        const cur = t;
        t = null;
        if (!cur || !cur.pulling) return;
        // 놓을 때도 세로가 가로보다 커야 — 처음엔 아래로, 뒤에 옆으로 민 대각선(카드 넘기기)은 새로고침하지 않는다(리뷰)
        const vertical = cur.dy > Math.abs(cur.dx || 0) * 1.3;
        if (e.type === 'touchend' && cur.ready && vertical && !blocked()) {
            reloading = true;
            place(PULL_TRIGGER_PX / 0.6, true);
            text.textContent = '새로고침 중…';
            location.reload();
            return;
        }
        hide();
    };
    root.addEventListener('touchend', end, { passive: true });
    root.addEventListener('touchcancel', end, { passive: true });
}
