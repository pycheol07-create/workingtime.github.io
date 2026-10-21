// === js/supplies-alert-dash.js ===
// 대시보드(index.html) '주요 일정 및 알림' 맨 위 — 비품 발주 알림(발주 권장일 5일 이내, 2026-10-20).
//   판정·문구: js/lib/supplies-reorder-alert.js (비품관리와 같은 effectiveStatus·reorderDaysLeft)
//   권한: 기능 supplies.view(js/lib/feature-catalog.js) 가 있는 사람에게만 보이고, 없으면 구독도 하지 않는다.
// 💰 읽기: 문서 3개(비품 목록·예측·발주 상태)를 구독한다 — 처음 3번 읽고 그 뒤로는 바뀔 때만 읽는다
//    (예측은 하루 1번 08:30, 발주 상태는 사람이 누를 때, 비품 목록은 재고 반영 때). 30초마다 다시 그리는 것은
//    받아 둔 값으로만 한다(날짜가 바뀌면 남은 날이 줄어들도록). 대시보드 화면(#widget-supplies-alert)에서만 켠다.
// 🔒 메모리에는 판정에 필요한 칸만 둔다(이름·코드·예측 날짜·발주 상태). 단가·업체·이력은 담지 않고 화면에도 쓰지 않는다.
// ⚠️ 새 요소에 role="dialog" · data-act 를 쓰지 않는다(업무마감봇 화면 보호).
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import * as State from './state.js?v=202610210917';
import { can } from './lib/perm.js?v=202610210917';
import { escapeHtml } from './utils.js?v=202610210917';
import { sidebarLinkTarget } from './app-shell-data.js?v=202610210917';
import { mdw } from './lib/supplies-forecast-view.js?v=202610210917';
import { reorderAlerts, alertDayLabel, alertSummaryText } from './lib/supplies-reorder-alert.js?v=202610210917';

const BASE = ['artifacts', 'team-work-logger-v2'];
const SOURCES = {
    items:    [...BASE, 'persistent_data', 'supplies'],
    forecast: [...BASE, 'integrations', 'suppliesForecast'],
    orders:   [...BASE, 'persistent_data', 'suppliesOrders']
};
const MAX_ROWS = 5;            // 상자에 줄로 보여 줄 비품 수(나머지는 '외 n건')
const RETRY_MS = 60 * 1000;

let unsubs = {};               // { items, forecast, orders } → 해제 함수
let got = {};                  // 받은 값(판정에 필요한 칸만). 아직 못 받았으면 undefined
let failed = {};               // 구독 실패
let retryTimer = null;

const BOX_ID = 'widget-supplies-alert';
export const suppliesAlertAllowed = () => can(State.appState.perm, 'supplies.view');

// 문서 → 판정에 필요한 칸만
const pickItems = (d) => (Array.isArray(d && d.items) ? d.items : [])
    .filter(it => it && it.id)
    .map(it => ({ id: it.id, name: it.name || '', ezCode: it.ezCode || '' }));
const pickForecast = (d) => {
    const out = {};
    const src = (d && typeof d.items === 'object' && d.items) || {};
    for (const [id, fc] of Object.entries(src)) {
        if (fc && typeof fc === 'object') out[id] = { status: fc.status, level: fc.level, today: fc.today || (d && d.today) || '', reorderDate: fc.reorderDate || null };
    }
    return { items: out };
};
const pickOrders = (d) => {
    const out = {};
    const src = (d && typeof d.orders === 'object' && d.orders) || {};
    for (const [id, o] of Object.entries(src)) {
        if (o && typeof o === 'object') out[id] = { status: o.status, receivedDate: o.receivedDate || '' };
    }
    return { orders: out };
};
const PICK = { items: pickItems, forecast: pickForecast, orders: pickOrders };

function listen(key) {
    if (unsubs[key] || !State.db) return;
    try {
        unsubs[key] = onSnapshot(doc(State.db, ...SOURCES[key]), (snap) => {
            got[key] = PICK[key](snap.exists() ? snap.data() : null);
            failed[key] = false;
            renderSuppliesAlert();
        }, (e) => {
            console.warn('[supplies-alert] 구독 실패:', key, e && e.code);
            failed[key] = true;
            unsubs[key] = null;            // 에러가 나면 리스너는 끝난다 — 비워야 다시 구독한다
            renderSuppliesAlert();
            clearTimeout(retryTimer);
            retryTimer = setTimeout(() => {
                if (State.auth && State.auth.currentUser) startSuppliesAlert();   // 로그아웃했으면 그만
            }, RETRY_MS);
        });
    } catch (e) {
        console.warn('[supplies-alert] 구독을 시작하지 못했습니다:', e);
    }
}

/** 로그인 뒤 app.js 가 부른다. 대시보드가 아니거나 권한이 없으면 아무것도 읽지 않는다. */
export function startSuppliesAlert() {
    if (!document.getElementById(BOX_ID)) return;
    if (!suppliesAlertAllowed()) { stopSuppliesAlert(); return; }
    Object.keys(SOURCES).forEach(listen);
}

/** 로그아웃 때 app.js 가 부른다. */
export function stopSuppliesAlert() {
    clearTimeout(retryTimer); retryTimer = null;
    Object.values(unsubs).forEach(u => { if (u) { try { u(); } catch (e) { /* 무시 */ } } });
    unsubs = {}; got = {}; failed = {};
    renderSuppliesAlert();
}

/** 받은 값으로 상자를 그린다. 문서 변경·대시보드 30초 렌더가 부른다(읽기 없음). */
export function renderSuppliesAlert() {
    const box = document.getElementById(BOX_ID);
    if (!box) return;
    // class 와 hidden 속성을 같이 켜고 끈다(속성이 있어야 부모 space-y-2 가 이 상자를 건너뛴다 — index.html 주석)
    const hide = () => { box.classList.add('hidden'); box.hidden = true; box.removeAttribute('title'); };
    // 권한이 없거나, 셋 중 하나라도 아직 못 받았거나 실패했으면 띄우지 않는다
    // (발주 상태를 못 읽은 채 띄우면 이미 발주한 비품까지 '발주 필요'로 보인다)
    if (!suppliesAlertAllowed()) return hide();
    if (Object.keys(SOURCES).some(k => failed[k] || got[k] === undefined)) return hide();

    const alerts = reorderAlerts(got.items, got.forecast, got.orders);
    if (alerts.length === 0) return hide();

    const countEl = document.getElementById('widget-supplies-count');
    const listEl = document.getElementById('widget-supplies-list');
    if (countEl) countEl.textContent = alerts.length;
    if (listEl) {
        const rows = alerts.slice(0, MAX_ROWS).map(a => {
            const tone = a.days <= 0 ? 't-risk font-semibold' : 't-2';
            return `<li class="flex items-center justify-between gap-2 px-3 py-1.5">`
                + `<span class="t-1 font-medium truncate">${escapeHtml(a.name)}</span>`
                + `<span class="text-xs shrink-0 tabular-nums ${tone}">${escapeHtml(mdw(a.reorderDate))} · ${escapeHtml(alertDayLabel(a.days))}</span></li>`;
        });
        const rest = alerts.length - MAX_ROWS;
        if (rest > 0) rows.push(`<li class="px-3 py-1.5 text-xs t-3">외 ${rest}건</li>`);
        listEl.innerHTML = rows.join('');
    }
    const target = sidebarLinkTarget('supplies.html');
    if (target) box.setAttribute('target', target); else box.removeAttribute('target');
    box.title = `${alertSummaryText(alerts)}\n발주 권장일까지 5일 이내 — 누르면 비품 관리로 갑니다`;
    box.setAttribute('aria-label', alertSummaryText(alerts));
    box.hidden = false;
    box.classList.remove('hidden');
}
