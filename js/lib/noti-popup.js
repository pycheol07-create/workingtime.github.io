// === js/lib/noti-popup.js ===
// 안 읽은 개인 알림을 바로 띄우는 팝업의 순수 판정 (2026-10-22).
//   대시보드 알림창 자동 열기(js/app-sync.js)·공통 상단바 알림 팝업(js/app-shell.js)이 같이 쓴다.
//   - '나중에'·닫기로 닫은 알림 id 는 이 탭(sessionStorage)에만 기억한다 — 새로고침해도 같은 알림이 또 뜨지 않게.
//     id 만 남긴다(이름·알림 내용은 남기지 않는다).
//   - 봇(업무마감봇·업무예상알림 — Playwright)은 navigator.webdriver 가 true 다. 그때는 자동으로 띄우지 않는다
//     (가운데 창이 버튼을 가려 봇이 멈춘다).
// ※ 의존성 없음 — node --test 로 시험한다(tests/noti-popup.test.js).

export const DISMISS_KEY = 'noti.dismissed.v1';
export const DISMISS_MAX = 100;

/** 자동화 브라우저(Playwright·Selenium 등)면 true. navigator 가 없거나 읽다 실패하면 false. */
export function isAutomation(nav) {
    try {
        const n = nav !== undefined ? nav : (typeof navigator !== 'undefined' ? navigator : null);
        return !!n && n.webdriver === true;
    } catch (e) {
        return false;
    }
}

// sessionStorage 는 꺼내는 것만으로도 예외가 날 수 있다(저장소 막힘·샌드박스). 못 쓰면 null.
function defaultStore() {
    try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null; } catch (e) { return null; }
}

function readIds(store) {
    try {
        const s = store === undefined ? defaultStore() : store;
        if (!s) return [];
        const arr = JSON.parse(s.getItem(DISMISS_KEY) || '[]');
        return Array.isArray(arr) ? arr.filter(x => typeof x === 'string' && x) : [];
    } catch (e) {
        return [];
    }
}

/** 이 탭에서 닫은 알림 id 집합. 저장소가 없거나 깨졌으면 빈 집합. (store 는 시험용 — 기본은 sessionStorage) */
export function loadDismissed(store) {
    return new Set(readIds(store));
}

/** ids 를 닫은 것으로 기억한다(최근 DISMISS_MAX 개만). 저장에 실패해도 던지지 않는다. 기억한 뒤의 집합을 돌려준다. */
export function addDismissed(ids, store) {
    const add = (Array.isArray(ids) ? ids : [ids]).filter(x => typeof x === 'string' && x);
    let list = readIds(store);
    if (add.length) {
        const fresh = new Set(add);
        list = list.filter(x => !fresh.has(x)).concat([...fresh]);   // 다시 닫은 것은 맨 뒤(최근)로
        if (list.length > DISMISS_MAX) list = list.slice(list.length - DISMISS_MAX);
        try {
            const s = store === undefined ? defaultStore() : store;
            if (s) s.setItem(DISMISS_KEY, JSON.stringify(list));
        } catch (e) { /* 저장소 막힘·가득 참 — 이번 화면에서만 다시 뜰 수 있다 */ }
    }
    return new Set(list);
}

const timeOf = (n) => {
    const t = Date.parse(n && n.createdAt);
    return Number.isNaN(t) ? 0 : t;
};

/** 팝업에 띄울 알림 — 안 읽었고(isRead 아님) 닫은 적 없는 것, 최신순. */
export function pickPopup(list, dismissed) {
    const skip = dismissed instanceof Set ? dismissed : new Set(Array.isArray(dismissed) ? dismissed : []);
    return (Array.isArray(list) ? list : [])
        .filter(n => n && n.id && !n.isRead && !skip.has(n.id))
        .sort((a, b) => timeOf(b) - timeOf(a));
}

/** 알림 목록 정렬 — 안 읽은 것 위로, 그 안에서 최신순(원본은 그대로 둔다). */
export function sortUnreadFirst(list) {
    return (Array.isArray(list) ? list.slice() : [])
        .sort((a, b) => ((a && a.isRead ? 1 : 0) - (b && b.isRead ? 1 : 0)) || (timeOf(b) - timeOf(a)));
}

// 다른 창이 열려 있는지 — js/modal-esc.js 의 '모달' 판정과 같은 규칙(fixed inset-0 + justify-center, .modal-overlay,
// data-esc-modal) + 확인창(role=dialog/alertdialog, aria-modal) + 셸의 서랍·빠른 이동·알림 팝업(섀도 DOM 호스트 태그).
const MODAL_SELECTOR = '.fixed.inset-0, .modal-overlay, [data-esc-modal], [role="dialog"], [role="alertdialog"], [aria-modal="true"], '
    + 'app-shell-overlay, app-shell-palette, app-shell-noti-pop';

function isCandidate(el) {
    const tag = String(el.tagName || '').toLowerCase();
    if (tag.startsWith('app-shell-')) return true;
    const cls = el.classList;
    if (cls && cls.contains('modal-overlay')) return true;
    if (el.hasAttribute && el.hasAttribute('data-esc-modal')) return true;
    const attr = (k) => (el.getAttribute ? el.getAttribute(k) : null);
    if (attr('aria-modal') === 'true') return true;
    if (attr('role') === 'dialog' || attr('role') === 'alertdialog') return true;
    if (/-modal$/.test(el.id || '')) return true;                       // 로그인 창(#login-modal)은 justify-center 가 없다
    return String(el.className || '').indexOf('justify-center') !== -1;
}

function isVisible(el, win) {
    if (!el || (el.classList && el.classList.contains('hidden'))) return false;
    try {
        const cs = win && win.getComputedStyle ? win.getComputedStyle(el) : null;
        if (cs && (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0')) return false;
    } catch (e) { /* 스타일을 못 읽으면 아래 크기로만 본다 */ }
    return (el.getClientRects ? el.getClientRects().length > 0 : false) || el.offsetWidth > 0 || el.offsetHeight > 0;
}

/**
 * 보이는 다른 창(모달)이 있으면 그 요소, 없으면 null.
 * except: 빼고 볼 요소 id 목록(알림창 자신 등). 데이터 관리 전체 화면(history.html 의 #history-modal)은 창이 아니라 화면 본체라 뺀다.
 */
export function findOpenModal(doc, { except = [], win } = {}) {
    if (!doc || !doc.querySelectorAll) return null;
    const w = win !== undefined ? win : (typeof window !== 'undefined' ? window : null);
    const skip = new Set(except);
    const pageBody = (el) => el.id === 'history-modal' && !!doc.body && doc.body.dataset && doc.body.dataset.shell === 'history';
    for (const el of Array.from(doc.querySelectorAll(MODAL_SELECTOR))) {
        if (el.id && skip.has(el.id)) continue;
        if (pageBody(el) || !isCandidate(el)) continue;
        if (isVisible(el, w)) return el;
    }
    return null;
}
