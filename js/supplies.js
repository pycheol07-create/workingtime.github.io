// === js/supplies.js ===
// 📦 비품 관리 — 데이터 관리·로케이션 관리처럼 별도 탭(페이지)으로 동작한다.
//
// 저장: artifacts/team-work-logger-v2/persistent_data/supplies  (단일 문서 { items: [...] })
//  - 비품은 수십 건 규모라 문서 하나로 관리하는 편이 읽기·쓰기 모두 저렴하다.
//  - 각 비품은 종류·현재고를 기본으로 하고, 단가/사이즈/발주정보/업체 등 상세를 함께 보관한다.
//
// 사용량 예측(2026-10-19, 서버 앱\비품재고연동\발주알림.py 가 업무일 08:30 계산 — 화면은 표시만):
//  - integrations/suppliesForecast  읽기만(서버만 씀). items[id] = 상태·소진 예상·권장 발주량·근거
//  - persistent_data/suppliesOrders 사람이 [발주함]·[입고 확인]·[발주 취소]로 orders.<id> 칸만 고친다(서버는 입고 자동 해제).
//    supplies 문서와 따로라 persist() 의 updatedAt 충돌 판정과 상관없다.
//  - 비품 항목 새 칸: forecastDriver(관리자만 화면에서 고름). 권장 발주량의 최소주문·묶음은 기존 MOQ 칸 문장에서 읽는다(서버 예측규칙.MOQ해석)
//  표시 규칙은 js/lib/supplies-forecast-view.js(테스트: tests/supplies-forecast-view.test.js).
//
// 앱 기준 전환(2026-11-26 2단계, 1단계 원장 = js/supplies-ledger-store.js):
//  - 스위치 persistent_data/suppliesSettings.ledgerLive(관리자만 씀). 켜짐이면 재고는 suppliesStock(원장) 하나 —
//    화면의 모든 재고 숫자는 curStock()(js/lib/supplies-mode.js stockOf)로만 읽는다. items[].stock·logs 는 읽은 값 그대로 다시 쓴다(persist).
//  - 켜짐 재고 패널: 입고·사용·실사 → 원장(commitLines·commitCount), 단위 단추로 기본 단위 환산(js/lib/supplies-units.js), 이력은 원장 + [되돌리기].
//    현재고조회 파일·연동 안내·메모 칸은 숨긴다. 이력의 사람 이름은 byEmail → mainConfig.memberEmails(by 칸은 안 씀).
//  - 비품코드(칸 이름 ezCode 그대로, 2026-11-27): 켜짐이어도 보이고 고친다. 비워 두고 저장하면 SP0001 모양 번호를 자동으로 붙이고
//    (저장 트랜잭션에서 서버 목록 기준 — js/lib/supplies-codes.js), 다른 비품과 같은 코드는 막는다(대소문자·공백 무시).
//  - 비품 상세의 새 칸: barcodes·units·noSingleOut·favorite(꺼짐이어도 저장).

import { initializeFirebase } from './config.js?v=242bb63abbe9-dd1665a9';
import { setShellContext, goHome } from './app-shell-bridge.js?v=b9a7199f3e1d-c80c27e9';
import { memberNameFor } from './app-shell-data.js?v=e42c6a10ca7a-9319c795';
import { escapeHtml as esc, showConfirm, showAlert } from './utils.js?v=65bb3512764f-e315797c';
import { kstDateTime } from './lib/kst-time.js?v=1f1e277244a9-6fe98384';
import { checkStockAdjust } from './lib/supplies-stock-check.js?v=bece1017afad-45058477';
import { normalizeItemUnits, validateUnits, unitButtons, checkBaseQty, findByBarcode, MAX_BARCODES, MAX_UNITS, MAX_UNIT_QTY } from './lib/supplies-units.js?v=38146ad5b84d-33598b26';
import { isLive, atMs, stockOf, isLowBy, ezLeftover, resumeBatchId, ledgerWho, cutoverStale, cutoverStartBlock, liveOnBlock } from './lib/supplies-mode.js?v=5f016d6adc90-90c9a625';
import { ledgerErrorText, ITEM_ID_RE } from './lib/supplies-ledger.js?v=44c94c8b86ad-92d65f68';
import { nextSupplyCodes, findDuplicateCode, isBlankCode, isEzCode, codeChanged } from './lib/supplies-codes.js?v=a9e176f7d66f-13c66d6f';
import { newBatchId, loadStock, loadStockOf, loadLedger, commitLines, commitCount, commitRevert } from './supplies-ledger-store.js?v=bd8190f12a34-0854dfa3';
import {
    effectiveStatus, statusBadge, depleteText, depleteSortValue, reorderText, reorderSortValue, reorderDaysLeft, recommendText, isStale, parseQty, mdw, basisText,
    leadTimeText, expectedDateFor, orderSummaryText, appOnlyWarning, packsProgressText, safetySuggestion, alertReasons, sortAlertRows,
    alertsEmptyText, ALERT_ORDERS_UNKNOWN, NOCODE_HINT, DRIVER_OPTIONS, TONE_CLASS, forecastOpts
} from './lib/supplies-forecast-view.js?v=c308b964945e-6e807d3e';
import { doc, getDoc, setDoc, onSnapshot, runTransaction, arrayUnion, FieldPath, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const { db, auth } = initializeFirebase();
const DOC_REF = doc(db, 'artifacts', 'team-work-logger-v2', 'persistent_data', 'supplies');
const FORECAST_REF = doc(db, 'artifacts', 'team-work-logger-v2', 'integrations', 'suppliesForecast');   // 읽기만
const ORDERS_REF = doc(db, 'artifacts', 'team-work-logger-v2', 'persistent_data', 'suppliesOrders');
const SETTINGS_REF = doc(db, 'artifacts', 'team-work-logger-v2', 'persistent_data', 'suppliesSettings');   // 재고 기준 스위치(관리자만 씀)

// 처음 열었을 때 자동으로 만들어 두는 기본 비품
const SEED_ITEMS = [
    { name: '택배봉투', category: '포장자재', unit: '장', isMain: true },
    { name: '포장봉투', category: '포장자재', unit: '장', isMain: true }
];

const MAX_LOG = 30; // 비품당 보관하는 재고 변동 이력 개수
const MAX_PRICE_LOG = 50; // 비품당 보관하는 단가 변경 이력 개수(priceLogs — 최신이 앞)

let items = [];
let currentUser = '';
let editingId = null;
let stockTargetId = null;   // 상세 창 재고 패널이 보고 있는 비품(새 비품 추가 중이면 null)
let forecastDoc = null;     // integrations/suppliesForecast (못 읽으면 null — 화면은 그대로)
let ordersDoc = { orders: {} };   // persistent_data/suppliesOrders
let ordersOk = false;       // 발주 상태를 읽었나 — 못 읽었으면 [발주함]·[입고 확인]·[발주 취소]를 막는다
let forecastOk = false;     // 이번 불러오기에서 예측을 읽었나 — #alerts 0건 안내('최신 알림을 확인하지 못했습니다')에 쓴다
let firstLoadDone = false;  // 로그인 뒤 첫 불러오기가 끝났나 — #alerts 를 그 전에 처리하지 않게
let isAdmin = false;        // 기준 물량 선택 표시용(화면 수준 — 규칙으로는 막지 않는다)
// 재고 기준(2026-11-26 2단계)
let suppliesSettings = null; // persistent_data/suppliesSettings(없으면 null = 꺼짐)
let settingsOk = null;       // 스위치를 읽었나(null = 아직) — 못 읽었으면(false) 재고 반영을 막는다(어느 쪽에 써야 할지 모름)
let ledgerLive = false;      // 켜짐 = 재고는 원장(suppliesStock)
let ledgerStock = {};        // { itemId: qty } (켜짐일 때 loadStock)
let ledgerStockOk = false;   // 켜짐인데 원장 재고를 못 읽었으면 재고 반영을 막는다
let ledgerEntries = [];      // 최근 기록(새 것부터) — 상세 창 이력은 여기서 이 비품만
let ledgerCursor = null;     // [더 보기] 이어 받기(loadLedger .cursor)
let ledgerMore = false;      // 더 받을 것이 있을 수 있나
let memberEmails = null;     // mainConfig.memberEmails — 원장 기록의 byEmail → 이름
let pendingStock = null;     // { key, batchId } — 저장이 실패(연결 끊김 등)한 입출고를 같은 값으로 다시 누르면 같은 batchId(중복 저장 막기)
let stockUnitQty = 1;        // 재고 패널에서 고른 단위(기본 단위 몇 개)
let formBarcodes = [];       // 상세 폼 바코드 칩
let myName = '';             // 내 이름(mainConfig.memberEmails) — 원장 기록 by 칸(표시용, 화면 이름은 byEmail 로 다시 찾는다)

const $ = (id) => document.getElementById(id);
const num = (v) => Number(v) || 0;
const fmt = (v) => num(v).toLocaleString();
const uid = () => 'sup-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// 재고는 여기서만 읽는다 — 켜짐이면 원장, 꺼짐이면 items[].stock(js/lib/supplies-mode.js)
const curStock = (it) => stockOf(it, ledgerLive, ledgerStock);
const isLow = (it) => isLowBy(it, curStock(it));
const stockValueOf = (it) => curStock(it) * num(it.unitPrice);

/** 문자열 안의 네 자리 이상 숫자에 천 단위 쉼표를 넣는다.
 *  MOQ는 '1박스 = 10000장'처럼 자유 입력이라, 숫자 부분만 골라 찍는다.
 *  이미 찍혀 있던 쉼표는 먼저 지우고 다시 계산해 중복을 막는다. */
const withThousands = (s) => String(s == null ? '' : s)
    .replace(/\d{1,3}(?:,\d{3})+/g, m => m.replace(/,/g, ''))
    .replace(/\d{4,}/g, m => Number(m).toLocaleString());

// 리드타임 단위. 수치는 예전부터 쓰던 leadTimeDays 필드에 그대로 담고,
// 단위만 leadTimeUnit으로 따로 둔다(없으면 '일' — 기존 데이터가 모두 일 단위였다).
const LEADTIME_UNITS = { day: '일', week: '주', month: '개월' };
const LEADTIME_DAYS = { day: 1, week: 7, month: 30 };
const leadTimeUnitOf = (it) => (LEADTIME_UNITS[it?.leadTimeUnit] ? it.leadTimeUnit : 'day');
const leadTimeTextOf = (it) => `${num(it.leadTimeDays)}${LEADTIME_UNITS[leadTimeUnitOf(it)]}`;
// 단위가 섞여 있어도 길이를 비교할 수 있도록 일수로 환산한 값(정렬·범위 필터용).
const leadTimeDaysEquiv = (it) => num(it.leadTimeDays) * LEADTIME_DAYS[leadTimeUnitOf(it)];

// 사용량 예측 — 서버 결과(forecastDoc)와 사람이 누른 발주(ordersDoc)를 합친 화면 상태
// 서버는 today 를 문서 최상위에만 쓴다 — 비품별로 채워 줘야 오늘 [입고 확인]한 비품이 '입고됨'으로 보인다(대시보드 알림과 같게, 2026-10-20)
const fcOf = (it) => {
    const fc = (forecastDoc && forecastDoc.items ? forecastDoc.items[it.id] : null) || null;
    return fc && !fc.today && forecastDoc.today ? { ...fc, today: forecastDoc.today } : fc;
};
const orderOf = (it) => (ordersDoc && ordersDoc.orders ? ordersDoc.orders[it.id] : null) || null;
/** 최근 발주일 = 상세에 직접 넣은 날짜와 [발주함] 기록(지금 진행 중·지난 기록 log)의 발주일 중 늦은 것(2026-11-27 사용자 요청 —
 *  발주 진행으로 10월에 발주·입고한 비품이 상세의 옛 날짜(2~3월)로 보였다). 'YYYY-MM-DD' 모양만 견준다 */
function lastOrderOf(it) {
    const ok = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '');
    let best = ok(it && it.lastOrderDate);
    const cur = it ? orderOf(it) : null;
    const take = (v) => { const d = ok(v); if (d > best) best = d; };
    if (cur) take(cur.orderedDate);
    const log = ordersDoc && Array.isArray(ordersDoc.log) ? ordersDoc.log : [];
    log.forEach(x => { if (x && it && x.itemId === it.id) take(x.orderedDate); });
    return best || (it && it.lastOrderDate) || '';
}
// 앱 기준(켜짐)이거나 예측 문서가 원장 기준(source 'ledger')이면 비품코드 없는 비품도 예측 상태를 그대로 보인다
const fcOpts = () => forecastOpts(forecastDoc, ledgerLive);
const statusOf = (it) => effectiveStatus(it, fcOf(it), orderOf(it), fcOpts());
const reasonsOf = (it) => alertReasons(it, fcOf(it), orderOf(it), ordersOk, undefined, fcOpts());
const reasonBadge = (r, extra = '') => `<span class="text-[11px] font-bold px-1.5 py-0.5 rounded-full ${esc(TONE_CLASS[r.tone] || '')} ${esc(extra)}" title="${esc(r.text)}">${esc(r.label)}</span>`;
function statusBadgeHtml(it) {
    const k = statusOf(it);
    const b = statusBadge(k);
    if (k === 'nocode') return `<span class="text-slate-400" title="${esc(b.title)}">-</span>`;
    return `<span class="text-[11px] font-bold px-1.5 py-0.5 rounded-full ${b.cls}"${b.title ? ` title="${esc(b.title)}"` : ''}>${esc(b.label)}</span>`;
}

// ───────── 목록 컬럼 정의 ─────────
// 헤더(정렬·필터)와 본문 셀을 한 곳에서 만든다 — 둘이 어긋나지 않도록.
//   type : 'text' → 값 목록 체크박스 필터 / 'num' → 최소·최대 범위 필터
//   get  : 정렬·필터가 보는 값
//   cell : 표에 그릴 내용(HTML)
//   hint : 필터 팝업에 덧붙일 설명
const COLS = [
    { key: 'category', label: '종류', type: 'text', td: 'text-slate-500',
      get: it => it.category || '미분류',
      cell: it => esc(it.category || '미분류') },
    { key: 'name', label: '품명', type: 'text', td: 'font-bold',
      get: it => it.name || '',
      cell: it => `${it.isMain ? '<span class="text-amber-500 mr-1">★</span>' : ''}${esc(it.name)}${reasonsOf(it).map(r => ` ${reasonBadge(r)}`).join('')}<span class="sr-only"> — 상세·재고 열기</span>` },
    { key: 'stock', label: '현재고', type: 'num', td: 'num font-bold',
      get: it => curStock(it),
      cell: it => `<span class="${isLow(it) ? 'text-red-600' : ''}">${esc(fmt(curStock(it)))}</span>`
                + ` <span class="text-[11px] font-normal text-slate-400">${esc(it.unit || '개')}</span>` },
    // 사용량 예측(매일 08:30) — 상태·소진 예상·권장 발주량
    { key: 'fcStatus', label: '상태', type: 'text', td: 'mid',
      get: it => statusBadge(statusOf(it)).label,
      cell: it => statusBadgeHtml(it) },
    { key: 'fcDeplete', label: '소진예상', type: 'num', td: 'mid text-slate-600',
      hint: '남은 업무일로 비교합니다(예측이 없으면 99999)',
      get: it => depleteSortValue(fcOf(it)),
      cell: it => esc(depleteText(fcOf(it))) },
    { key: 'fcReorder', label: '발주권장일', type: 'num', td: 'mid text-slate-600',
      hint: '오늘부터 남은 날 수로 비교합니다(지났으면 음수, 예측이 없으면 99999)',
      get: it => reorderSortValue(fcOf(it)),
      cell: it => {
          const fc = fcOf(it), n = reorderDaysLeft(fc);
          // 이미 발주했거나 입고 확인한 비품은 강조하지 않는다(서버 날짜는 발주와 상관없이 계산된다)
          const done = ['ordered', 'received'].includes(statusOf(it));
          const cls = n == null || done ? '' : n <= 0 ? 'text-red-600 font-bold' : n <= 7 ? 'text-amber-600 font-bold' : '';
          return `<span class="${cls}">${esc(reorderText(fc))}</span>`;
      } },
    { key: 'fcRecommend', label: '권장발주', type: 'num', td: 'num text-slate-600',
      get: it => num(fcOf(it)?.recommendQty),
      cell: it => esc(recommendText(fcOf(it), it.unit || '개')) },
    { key: 'safetyStock', label: '안전재고', type: 'num', td: 'num text-slate-500',
      get: it => num(it.safetyStock),
      cell: it => num(it.safetyStock) > 0 ? fmt(it.safetyStock) : '-' },
    { key: 'unitPrice', label: '단가', type: 'num', td: 'num',
      get: it => num(it.unitPrice),
      cell: it => num(it.unitPrice) > 0 ? fmt(it.unitPrice) + '원' : '-' },
    { key: 'stockValue', label: '재고금액', type: 'num', td: 'num text-slate-600',
      get: it => stockValueOf(it),
      cell: it => stockValueOf(it) > 0 ? fmt(Math.round(stockValueOf(it))) + '원' : '-' },
    { key: 'size', label: '사이즈', type: 'text', td: 'text-slate-600',
      get: it => it.size || '',
      cell: it => esc(it.size || '-') },
    { key: 'vendor', label: '업체', type: 'text', td: 'text-slate-600',
      get: it => it.vendor || '',
      cell: it => `${esc(it.vendor || '-')}`
                + (it.vendorContact ? `<div class="text-[11px] text-slate-400">${esc(it.vendorContact)}</div>` : '') },
    { key: 'ezCode', label: '비품코드', type: 'text', td: 'text-slate-500 text-[12px]',
      get: it => it.ezCode || '',
      cell: it => it.ezCode ? esc(it.ezCode) : '-' },
    { key: 'moq', label: 'MOQ', type: 'text', td: 'text-slate-600',
      get: it => withThousands(it.orderUnit || ''),
      cell: it => it.orderUnit ? esc(withThousands(it.orderUnit)) : '-' },
    { key: 'leadTime', label: '리드타임', type: 'num', td: 'mid text-slate-600',
      hint: '일수로 환산해 비교합니다 (주=7일, 개월=30일)',
      get: it => leadTimeDaysEquiv(it),
      cell: it => num(it.leadTimeDays) > 0 ? esc(leadTimeTextOf(it)) : '-' },
    { key: 'lastOrderDate', label: '최근발주', type: 'text', td: 'mid text-slate-600',
      get: it => lastOrderOf(it),
      cell: it => esc(lastOrderOf(it) || '-') },
    // 메모는 길 수 있어 한 줄로 자르고(넘치면 …), 전체 내용은 마우스를 올리면 보인다.
    { key: 'memo', label: '메모', type: 'text', td: 'text-slate-500 text-[12px] max-w-[22rem] overflow-hidden text-ellipsis',
      get: it => it.memo || '',
      cell: it => it.memo ? `<span title="${esc(it.memo)}">${esc(it.memo)}</span>` : '-' }
];
const colOf = (key) => COLS.find(c => c.key === key);
// 지금 보이는 열(헤더·본문·필터가 같은 목록을 쓴다) — 비품코드 열은 앱 기준(켜짐)에서도 보인다(2026-11-27)
const activeCols = () => COLS;
const NUM_COLS = new Set(COLS.filter(c => c.type === 'num').map(c => c.key));

// 헤더에서 고른 정렬·필터 상태
let sortState = { key: '', dir: 'asc' };
// { [key]: Set<string> }  — 값이 있으면 그 값들만 통과. text 컬럼 전용
const textFilters = {};
// { [key]: { min, max } } — 빈 문자열이면 제한 없음. num 컬럼 전용
const numFilters = {};

const hasColFilter = (key) =>
    (textFilters[key] && textFilters[key].size > 0) ||
    (numFilters[key] && (numFilters[key].min !== '' || numFilters[key].max !== ''));
const anyFilterActive = () =>
    activeCols().some(c => hasColFilter(c.key)) || !!sortState.key ||
    !!$('filter-category').value || !!$('filter-search').value.trim() || $('filter-low').checked
    || $('filter-order').checked;

// 공통 상단바 개인 알림(P2) — mainConfig 를 한 번 읽어 memberEmails 로 이름을 찾아 넘긴다.
// 이름은 메모리에만(캐시·로그에 남기지 않는다). 기다리지 않고, 실패해도 화면은 그대로 쓴다.
function pushShellMemberName(user) {
    getDoc(doc(db, 'artifacts', 'team-work-logger-v2', 'config', 'mainConfig')).then((snap) => {
        const memberName = memberNameFor(snap.exists() ? snap.data().memberEmails : null, user.email);
        if (memberName && auth.currentUser && auth.currentUser.uid === user.uid) setShellContext({ signedIn: true, uid: user.uid, memberName });
        // 원장 이력의 사람 이름(byEmail → 이름)·원장 기록의 by 칸(표시용)에 쓴다 — 메모리에만
        if (auth.currentUser && auth.currentUser.uid === user.uid) {
            memberEmails = (snap.exists() && snap.data().memberEmails) || null;
            myName = memberName || '';
            if (stockTargetId && ledgerLive) renderStockPanel();
        }
        // 같은 문서의 memberRoles 로 관리자 여부(기준 물량 선택 표시용). 이메일은 비교에만 쓴다.
        const roles = (snap.exists() && snap.data().memberRoles) || {};
        const admin = roles[String(user.email || '').toLowerCase()] === 'admin';
        if (admin !== isAdmin && auth.currentUser && auth.currentUser.uid === user.uid) {
            isAdmin = admin;
            if (stockTargetId) renderForecastBox();
            renderLedgerBar();
        }
    }).catch((e) => console.warn('[supplies] 알림용 설정 읽기 실패:', e && e.code));
}

// ───────── 인증 게이트 ─────────
onAuthStateChanged(auth, async (user) => {
    setShellContext(user ? { signedIn: true, uid: user.uid } : { signedIn: false });   // 공통 상단바(메뉴는 캐시)
    if (!user) {
        $('auth-gate').classList.remove('hidden');
        $('main').classList.add('hidden');
        return;
    }
    pushShellMemberName(user);
    currentUser = user.email || 'unknown';
    $('auth-gate').classList.add('hidden');
    $('main').classList.remove('hidden');
    await load();
    renderAll();
    firstLoadDone = true;
    handleAlertsHash();
    watchSettings();   // 재고 기준 스위치 구독(열어 둔 탭이 옛 방식으로 쓰지 않게)
});

// 앱 알림을 누르면 supplies.html#alerts 로 온다 — 한 번만 처리하고 해시를 지운다(지워야 다음 알림으로 또 hashchange 가 난다).
// 이미 이 화면이면 페이지가 새로 뜨지 않으므로(hashchange) 최신 예측을 다시 읽는다. 상세 창에 입력 중이면 다시 읽지 않는다.
async function handleAlertsHash(reload = false) {
    if (location.hash !== '#alerts' || !firstLoadDone || !auth.currentUser) return;
    history.replaceState(null, '', location.pathname + location.search);
    let reloadSkipped = false;
    if (reload) {
        if ($('item-modal').classList.contains('hidden')) {
            await load();
            renderAll();
        } else reloadSkipped = true;
    }
    const el = $('alert-notice');
    // 사유가 0건이면 왜 왔는지 안내한다 — 최신을 못 읽었으면(예측 읽기 실패·상세 창이 열려 다시 읽기를 건너뜀) 그렇다고, 아니면 이미 처리됨.
    //   발주 상태를 못 읽은 경우는 renderAlertNotice 가 경고 줄을 늘 보여 여기로 오지 않는다
    if (el.classList.contains('hidden')) {
        el.innerHTML = `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 text-xs font-bold text-slate-500">${esc(alertsEmptyText({ forecastOk, reloadSkipped }))}</div>`;
        el.classList.remove('hidden');
    }
    // 고정 머리줄에 가리지 않게 — 좁은 화면에서는 머리줄이 두 줄이 되기도 해 실제 높이로 잰다
    el.style.scrollMarginTop = `${Math.ceil(document.querySelector('#tool-root > header.sticky').getBoundingClientRect().bottom) + 8}px`;
    el.scrollIntoView({ block: 'start' });
}
window.addEventListener('hashchange', () => handleAlertsHash(true));

// ───────── 저장소 ─────────
// 이 문서는 이 화면만 쓰는 게 아니다 — 매일 19:30 서버 예약작업(앱\비품재고연동\연동.py)이 items[].stock 을
// 이지어드민 값으로 맞추고 이력을 남기며 ezSyncedAt·ezSyncSummary 를 쓴다(바뀐 게 있으면 updatedAt 도).
// 그래서 (1) 저장은 merge 로 해 ezSyncedAt 등 다른 필드를 지우지 않고, (2) 저장 직전에 서버 문서를 트랜잭션으로
// 다시 읽어 불러온 뒤 updatedAt 이 바뀌었으면 저장하지 않는다 — 열어 둔 화면이 자동 반영값·이력을 되돌리지 않게.
// 연동.py 는 바뀐 게 있을 때만 updatedAt 을 바꾸고 ezSyncedAt 은 매일 쓴다 → ezSyncedAt 만 바뀐 것은 충돌로 보지 않는다
// (표시용 ezSyncedAt·요약은 저장 트랜잭션에서 읽은 값으로 갱신).
let loadedStamp = { updatedAt: null, ezSyncedAt: null };   // 불러온 시점의 문서 표시
let ezSync = { at: null, summary: null };                    // 화면 위 '이지어드민 자동 반영' 한 줄

class SuppliesConflict extends Error {}

async function load() {
    forecastOk = false;   // 이번에 예측을 읽어야 true(loadForecast)
    await loadLedgerMode();
    try {
        const snap = await getDoc(DOC_REF);
        const d = snap.exists() ? snap.data() : {};
        loadedStamp = { updatedAt: d.updatedAt ?? null, ezSyncedAt: d.ezSyncedAt ?? null };
        ezSync = { at: d.ezSyncedAt ?? null, summary: d.ezSyncSummary ?? null };
        if (snap.exists() && Array.isArray(d.items)) {
            items = d.items;
            await loadForecast();
        } else {
            // 최초 진입 — 기본 비품(택배봉투·포장봉투) 생성
            items = SEED_ITEMS.map(s => ({
                id: uid(), stock: 0, safetyStock: 0, unitPrice: 0,
                size: '', vendor: '', vendorContact: '', orderUnit: '', ezCode: '',
                leadTimeDays: 0, leadTimeUnit: 'day', lastOrderDate: '', memo: '', logs: [], ...s
            }));
            await persist();
        }
    } catch (e) {
        if (e && e.handled) return;   // 처음 만들기 저장이 충돌 — persist 가 이미 안내하고 다시 불러왔다
        console.error('비품 데이터 로드 실패:', e);
        showAlert('비품 데이터를 불러오지 못했습니다: ' + (e.message || e), { title: '불러오기 실패', isError: true });
    }
}

// 재고 기준 스위치 + (켜짐이면) 원장 재고·최근 1개월 기록.
// 스위치를 못 읽으면 settingsOk=false — 재고 반영을 막는다(꺼짐으로 짐작해 items[].stock 에 쓰면 원장과 어긋난다).
async function loadLedgerMode() {
    try {
        const s = await getDoc(SETTINGS_REF);
        suppliesSettings = s.exists() ? s.data() : null;
        settingsOk = true;
    } catch (e) {
        console.warn('[supplies] 재고 기준 설정 읽기 실패:', e && e.code);
        settingsOk = false;
    }
    ledgerLive = settingsOk && isLive(suppliesSettings);
    ledgerStockOk = false;
    if (!ledgerLive) { ledgerStock = {}; ledgerEntries = []; ledgerCursor = null; ledgerMore = false; return; }
    const [st, lg] = await Promise.allSettled([loadStock(db), loadLedger(db, { days: 30 })]);
    if (st.status === 'fulfilled') { ledgerStock = st.value; ledgerStockOk = true; }
    else { ledgerStock = {}; console.warn('[supplies] 원장 재고 읽기 실패:', st.reason && st.reason.code); }
    if (lg.status === 'fulfilled') {
        ledgerEntries = lg.value; ledgerCursor = lg.value.cursor; ledgerMore = true;   // 1개월보다 오래된 것이 있을 수 있다 — [더 보기]
    } else { ledgerEntries = []; ledgerCursor = null; ledgerMore = false; console.warn('[supplies] 원장 기록 읽기 실패:', lg.reason && lg.reason.code); }
    if (!ledgerStockOk) showAlert('앱 재고를 불러오지 못했습니다 — 화면의 재고 숫자가 0 으로 보일 수 있습니다.\n[새로고침] 후 다시 해 주세요.', { title: '불러오기 실패', isError: true });
}

// 사용량 예측·발주 상태 — 실패해도 화면은 그대로 쓴다(예측 칸만 '예측 전'으로 보인다)
async function loadForecast() {
    const [f, o] = await Promise.allSettled([getDoc(FORECAST_REF), getDoc(ORDERS_REF)]);
    if (f.status === 'fulfilled') forecastDoc = f.value.exists() ? f.value.data() : null;
    else console.warn('[supplies] 사용량 예측 읽기 실패:', f.reason && f.reason.code);
    forecastOk = f.status === 'fulfilled' && f.value.exists();
    if (o.status === 'fulfilled') {
        const d = o.value.exists() ? o.value.data() : {};
        ordersDoc = { ...d, orders: (d && typeof d.orders === 'object' && d.orders) || {} };
        ordersOk = true;
    } else {
        ordersOk = false;
        console.warn('[supplies] 발주 상태 읽기 실패:', o.reason && o.reason.code);
    }
}

// opts.keepModal — 충돌이어도 상세 창을 닫지 않는다(재고 반영 경로: 상세 폼의 저장 안 한 입력을 지키려고).
//                   이때는 다시 불러오기까지만 하고, 창 안을 서버 값으로 다시 그리는 것은 부른 쪽이 한다.
// opts.conflictMsg — 충돌 안내문(없으면 기본 문구)
// opts.assignCode — 상세 저장하는 비품 객체(items 안의 것). 비품코드가 비었으면(앱 기준일 때만) 트랜잭션 안에서 SP 번호를 붙인다(실패하면 부른 쪽이 되돌린다)
// opts.checkCode — 코드 칸을 바꿨다(그때만 겹침 검사 — 이미 겹친 옛 코드가 있어도 다른 칸 수정은 막지 않는다)
async function persist(opts = {}) {
    const updatedAt = new Date().toISOString();
    let written = null;
    try {
        await runTransaction(db, async (tx) => {
            const snap = await tx.get(DOC_REF);
            const d = snap.exists() ? snap.data() : {};
            if ((d.updatedAt ?? null) !== loadedStamp.updatedAt) {
                throw new SuppliesConflict('changed');
            }
            // 재고 기준 스위치가 이 탭이 불러온 값 그대로인가 — 다르면(열어 둔 사이 전환·끄기) 저장하지 않는다
            const ss = await tx.get(SETTINGS_REF);
            if (settingsOk !== true || isLive(ss.exists() ? ss.data() : null) !== ledgerLive) throw new SuppliesConflict('mode');
            ezSync = { at: d.ezSyncedAt ?? null, summary: d.ezSyncSummary ?? null };
            // 비품코드 — 저장하는 비품(opts.assignCode)의 코드가 비었으면 앱 기준(켜짐)일 때만 서버 목록 + 이 화면 목록에서 다음 SP 번호를 붙이고,
            //   코드 칸을 바꿨으면(opts.checkCode) 서버 목록과도 겹치는지 본다. 위의 updatedAt 검사로 서버 목록은 불러온 때와 같다 —
            //   다른 사람이 그사이 저장했으면 충돌로 멈추므로 두 사람이 같은 번호를 받지 않는다(재시도 때마다 다시 계산)
            //   이지어드민 기준(꺼짐)이면 붙이지 않는다 — 그때 코드는 이지어드민 품목코드여야 한다
            const tgt = opts.assignCode || null;
            if (tgt) {
                const others = [...(Array.isArray(d.items) ? d.items : []), ...items].filter(x => x && x !== tgt && x.id !== tgt.id);
                if (isBlankCode(tgt.ezCode)) { if (ledgerLive) tgt.ezCode = nextSupplyCodes(others, 1)[0]; }
                else if (opts.checkCode) {
                    const dupS = findDuplicateCode(others, tgt.ezCode, tgt.id);
                    if (dupS) throw new Error(codeDupText(dupS));
                }
            }
            // 앱 기준(켜짐) — items[].stock·logs 는 이 화면이 바꾸지 않는다: 서버에서 읽은 값 그대로(새 비품은 0·빈 이력)
            //   원장 재고가 items 쪽으로 새면 끌 때(비상) 엉뚱한 숫자가 보인다.
            let out = items;
            written = null;
            if (ledgerLive) {
                const prev = new Map((Array.isArray(d.items) ? d.items : []).map(x => [x && x.id, x]));
                out = items.map(it => {
                    const p = prev.get(it.id);
                    return { ...it, stock: p ? (p.stock ?? 0) : 0, logs: p && Array.isArray(p.logs) ? p.logs : [] };
                });
            }
            // merge — items 는 배열이라 통째로 바뀌지만, ezSyncedAt·ezSyncSummary 같은 다른 필드는 남는다
            tx.set(DOC_REF, { items: out, updatedAt, updatedBy: currentUser }, { merge: true });
            if (out !== items) written = out;
        });
    } catch (e) {
        if (e instanceof SuppliesConflict && e.message === 'mode') {
            showAlert('재고 기준(이지어드민 ↔ 앱)이 바뀌었습니다 — 최신으로 다시 불러옵니다.\n방금 저장하려던 것은 저장되지 않았습니다. 다시 열어 해 주세요.', { title: '재고 기준이 바뀜', isError: true });
            await reloadForModeChange();
            e.handled = true;
            throw e;
        }
        if (e instanceof SuppliesConflict) {
            // 이 화면에서 바꾼 것은 버리고 서버 최신으로 다시 그린다(keepModal 이 아니면 열린 창은 닫는다)
            showAlert(opts.conflictMsg || ('다른 곳에서 비품이 바뀌었습니다 — 최신 내용으로 다시 불러옵니다.\n'
                + '방금 저장하려던 내용과 창에 입력해 두고 저장하지 않은 수정은 모두 사라졌습니다. 다시 열어 입력해 주세요.'), { title: '다른 곳에서 바뀜', isError: true });
            if (!opts.keepModal) closeModal('item-modal');
            await load();
            renderAll();
            e.handled = true;
        }
        throw e;
    }
    if (written) {
        // 같은 비품 객체 자리에 서버 값(stock·logs)만 맞춘다 — 부른 쪽이 가진 객체(next 등)를 그대로 쓰게
        const byId = new Map(written.map(x => [x.id, x]));
        items.forEach(it => { const w = byId.get(it.id); if (w) { it.stock = w.stock; it.logs = w.logs; } });
    }
    loadedStamp = { updatedAt, ezSyncedAt: ezSync.at };
    renderEzSync();
}

// ───────── 렌더 ─────────
function renderAll() {
    renderLedgerBar();
    renderEzSync();
    renderAlertNotice();
    renderMainItems();
    renderSummary();
    renderCategoryFilter();
    renderTable();
}

// '이지어드민 자동 반영: 10/16 19:30 (확인 N·바뀜 M)' — 문서에 ezSyncedAt 이 있을 때만
function renderEzSync() {
    const el = $('ez-sync-note');
    if (!el) return;
    const d = ezSync.at ? new Date(ezSync.at) : null;
    // 앱 기준(켜짐)이면 이지어드민 자동 반영은 재고에 쓰이지 않는다 — 한 줄을 숨긴다(켠 뒤 연동 흔적은 renderLedgerBar 빨간 띠)
    if (ledgerLive || !d || isNaN(d.getTime())) { el.classList.add('hidden'); el.textContent = ''; return; }
    const p2 = (n) => String(n).padStart(2, '0');
    const s = ezSync.summary || {};
    const parts = [];
    if (s.checked != null) parts.push(`확인 ${num(s.checked)}`);
    if (s.changed != null) parts.push(`바뀜 ${num(s.changed)}`);
    if (num(s.failed) > 0) parts.push(`건너뜀 ${num(s.failed)}`);
    el.textContent = `이지어드민 자동 반영: ${d.getMonth() + 1}/${d.getDate()} ${p2(d.getHours())}:${p2(d.getMinutes())}`
        + (parts.length ? ` (${parts.join('·')})` : '');
    el.classList.remove('hidden');
}

// 재고 기준 띠 — 관리자: 지금 기준 + [앱 기준으로 전환]/[되돌리기(비상)], 켠 뒤 연동이 돈 흔적이면 빨간 띠.
// 스위치를 못 읽으면 모두에게 경고(재고 반영도 막힌다).
function renderLedgerBar() {
    const warn = $('ledger-ez-warn'), bar = $('ledger-admin');
    if (!warn || !bar) return;
    let w = '';
    if (settingsOk === false) w = '재고 기준 설정을 불러오지 못해 재고 반영을 막았습니다 — [새로고침] 후 다시 해 주세요.';
    else if (isAdmin && ezLeftover(suppliesSettings, ezSync.at, Date.now())) {
        w = '켠 뒤에도 이지어드민 연동이 돌았습니다 — 비품 문서의 재고(items)가 이지어드민 값으로 바뀌었을 수 있습니다. 앱 재고(원장)는 그대로입니다. 연동 프로그램이 멈췄는지 확인해 주세요.';
    }
    warn.textContent = w;
    warn.classList.toggle('hidden', !w);
    const show = isAdmin && settingsOk === true;
    bar.classList.toggle('hidden', !show);
    if (!show) return;
    const at = suppliesSettings && atMs(suppliesSettings.liveAt);
    $('ledger-mode-text').textContent = ledgerLive
        ? `재고 기준: 앱(입출고 기록)${Number.isFinite(at) ? ` · ${kstDateTime(new Date(at).toISOString())} 부터` : ''}`
        : '재고 기준: 이지어드민 자동 반영(매일 19:30)';
    $('btn-ledger-cutover').classList.toggle('hidden', ledgerLive);
    $('btn-ledger-off').classList.toggle('hidden', !ledgerLive);
}

// 최근 알림 안내 — 어느 비품을 왜 봐야 하는지 한 줄씩. 사유는 서버 recentAlerts + 지금 발주 상태(js/lib/supplies-forecast-view.js alertReasons).
// 줄을 누르면 주요 비품 카드처럼 상세 창이 열린다(data-open — 아래 '행·카드 열기' 이벤트).
function renderAlertNotice() {
    const host = $('alert-notice');
    if (!host) return;
    const rows = sortAlertRows(items.map(it => ({ id: it.id, name: it.name, reasons: reasonsOf(it) })).filter(r => r.reasons.length));
    // 발주 상태를 못 읽었으면 사유 건수와 상관없이 경고 한 줄 — 발주 필요·주의·입고 지연이 빠져 있다(alertReasons ordersKnown)
    const warn = ordersOk ? '' : `<p class="text-xs font-bold text-red-600 ${rows.length ? 'mb-2' : ''}">${esc(ALERT_ORDERS_UNKNOWN)}</p>`;
    if (rows.length === 0 && !warn) { host.classList.add('hidden'); host.innerHTML = ''; return; }
    host.innerHTML = `
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-3">
            ${rows.length ? `<h2 class="text-sm font-bold text-slate-700 mb-2">확인할 비품 ${rows.length}종</h2>` : ''}${warn}
            <div class="space-y-1.5">${rows.map(r => `
                <div data-open="${esc(r.id)}" role="button" tabindex="0" aria-label="${esc(r.name)} — ${esc(r.reasons.map(x => x.label).join(', '))} · 상세·재고 열기" title="눌러서 상세·재고 열기"
                    class="sup-card cursor-pointer rounded-lg border border-slate-200 hover:border-indigo-300 px-3 py-2 transition">
                    <div class="text-[13px] font-extrabold text-slate-800 break-words">${esc(r.name)}</div>
                    ${r.reasons.map(x => `<div class="flex items-start gap-1.5 mt-1 text-xs text-slate-600">${reasonBadge(x, 'shrink-0')}<span class="min-w-0 flex-1 break-words">${esc(x.text)}</span></div>`).join('')}
                </div>`).join('')}
            </div>
        </div>`;
    host.classList.remove('hidden');
}

function renderMainItems() {
    const host = $('main-items');
    const mains = items.filter(i => i.isMain);
    if (mains.length === 0) {
        host.innerHTML = `<div class="col-span-full text-xs text-slate-400 bg-white border border-dashed border-slate-300 rounded-xl p-4 text-center">
            주요 비품으로 지정된 항목이 없습니다. 목록에서 비품을 눌러 '주요 비품으로 상단에 고정'을 켜보세요.</div>`;
        return;
    }
    host.innerHTML = mains.map(it => {
        const low = isLow(it);
        const fk = statusOf(it);
        const fb = statusBadge(fk);
        const fc = fcOf(it);
        return `
        <div data-open="${esc(it.id)}" role="button" tabindex="0" aria-label="${esc(it.name)} 상세·재고 열기" title="눌러서 상세·재고 열기"
            class="sup-card cursor-pointer bg-white rounded-xl border ${low ? 'border-red-300 hover:border-red-400' : 'border-slate-200 hover:border-indigo-300'} shadow-sm hover:shadow p-2.5 transition">
            <div class="flex items-center justify-between gap-1">
                <div class="text-[10px] font-bold text-slate-400 truncate">${esc(it.category || '비품')}</div>
                <span class="flex items-center gap-1 shrink-0">
                ${fk !== 'nocode' && fk !== 'pending' ? `<span class="text-[11px] font-bold px-1.5 py-0.5 rounded-full ${fb.cls}">${esc(fb.label)}</span>` : ''}
                ${low ? '<span class="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 shrink-0">부족</span>' : ''}
                </span>
            </div>
            <div class="text-[13px] font-extrabold text-slate-800 truncate" title="${esc(it.name)}">${esc(it.name)}</div>
            <div class="mt-1.5 flex items-end gap-1">
                <span class="text-2xl font-black leading-none ${low ? 'text-red-600' : 'text-slate-800'}">${esc(fmt(curStock(it)))}</span>
                <span class="text-[11px] font-bold text-slate-400">${esc(it.unit || '개')}</span>
            </div>
            <div class="text-[10px] text-slate-500 mt-1 leading-tight">
                ${num(it.safetyStock) > 0 ? `안전 ${esc(fmt(it.safetyStock))}${esc(it.unit || '개')}<br>` : ''}
                ${esc(num(it.unitPrice) > 0 ? `단가 ${fmt(it.unitPrice)}원` : '단가 미등록')}
                ${fc && fc.depleteDate ? `<br>소진 ${esc(mdw(fc.depleteDate).replace(/\(.\)$/, ''))}` : ''}
                ${fc && fc.reorderDate ? `<br><span class="${esc((reorderDaysLeft(fc) ?? 99) <= 0 && !['ordered', 'received'].includes(statusOf(it)) ? 'text-red-600 font-bold' : '')}">발주 ${esc(mdw(fc.reorderDate).replace(/\(.\)$/, ''))}</span>` : ''}
            </div>
        </div>`;
    }).join('');
}

function renderSummary() {
    const totalValue = items.reduce((s, i) => s + stockValueOf(i), 0);
    const lowCount = items.filter(isLow).length;
    const orderCount = items.filter(it => statusOf(it) === 'order').length;
    const categories = new Set(items.map(i => i.category || '미분류'));

    const card = (label, value, tone = 'text-slate-800') => `
        <div class="bg-white rounded-xl border border-slate-200 p-3">
            <div class="text-[11px] font-bold text-slate-400">${label}</div>
            <div class="text-lg font-black ${tone} mt-0.5">${esc(value)}</div>
        </div>`;

    // '재고 부족'·'발주 필요' 카드는 누르면 목록의 같은 체크박스(부족분만·발주 필요만)를 켜고 끈다.
    // 눌림 표시(aria-pressed)는 체크박스를 따라간다 — syncSummaryFilters(renderTable 끝에서도 부른다).
    const filterCard = (key, label, value, tone) => `
        <button type="button" data-sum-filter="${key}" aria-pressed="false" class="sum-btn text-left bg-white rounded-xl border border-slate-200 p-3"
            title="목록을 ${label} 비품만 보기 (다시 누르면 해제)">
            <div class="text-[11px] font-bold text-slate-400">${label}</div>
            <div class="text-lg font-black ${tone} mt-0.5">${esc(value)}</div>
        </button>`;

    $('summary').innerHTML =
        card('등록 비품', `${items.length}종`) +
        card('종류', `${categories.size}개`) +
        filterCard('low', '재고 부족', `${lowCount}종`, lowCount > 0 ? 'text-red-600' : 'text-slate-800') +
        filterCard('order', '발주 필요', `${orderCount}종`, orderCount > 0 ? 'text-red-600' : 'text-slate-800') +
        card('총 재고금액', `${fmt(Math.round(totalValue))}원`);
    syncSummaryFilters();
}

/** 요약 카드(재고 부족·발주 필요)의 눌림 표시를 체크박스 상태와 맞춘다 — 카드·체크박스·[필터 초기화] 어느 쪽으로 바꿔도. */
function syncSummaryFilters() {
    [['low', 'filter-low'], ['order', 'filter-order']].forEach(([key, id]) => {
        const btn = document.querySelector(`#summary [data-sum-filter="${key}"]`);
        if (btn) btn.setAttribute('aria-pressed', String($(id).checked));
    });
}

function renderCategoryFilter() {
    const sel = $('filter-category');
    const prev = sel.value;
    const cats = Array.from(new Set(items.map(i => i.category || '미분류'))).sort();
    sel.innerHTML = `<option value="">전체 종류</option>` + cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    if (cats.includes(prev)) sel.value = prev;

    $('category-list').innerHTML = cats.map(c => `<option value="${esc(c)}">`).join('');
}

/** 상단 도구모음 + 헤더 필터를 모두 통과한 항목. */
function visibleItems() {
    const cat = $('filter-category').value;
    const kw = $('filter-search').value.trim().toLowerCase();
    const lowOnly = $('filter-low').checked;
    const orderOnly = $('filter-order').checked;

    const list = items.filter(it => {
        if (cat && (it.category || '미분류') !== cat) return false;
        if (lowOnly && !isLow(it)) return false;
        if (orderOnly && statusOf(it) !== 'order') return false;
        if (kw) {
            const hay = `${it.name} ${it.category} ${it.vendor} ${it.size} ${it.memo} ${it.ezCode || ''} ${normalizeItemUnits(it).barcodes.join(' ')}`.toLowerCase();
            if (!hay.includes(kw)) return false;
        }
        // 헤더에서 고른 컬럼별 필터 — 모두 만족해야 통과(AND)
        for (const col of activeCols()) {
            const picked = textFilters[col.key];
            if (picked && picked.size > 0 && !picked.has(String(col.get(it)))) return false;
            const range = numFilters[col.key];
            if (range) {
                const v = num(col.get(it));
                if (range.min !== '' && v < num(range.min)) return false;
                if (range.max !== '' && v > num(range.max)) return false;
            }
        }
        return true;
    });

    if (sortState.key) {
        const col = colOf(sortState.key);
        const sign = sortState.dir === 'desc' ? -1 : 1;
        list.sort((a, b) => {
            const va = col.get(a), vb = col.get(b);
            const r = (col.type === 'num') ? (num(va) - num(vb)) : String(va).localeCompare(String(vb), 'ko');
            return r * sign || String(a.name).localeCompare(String(b.name), 'ko');
        });
        return list;
    }
    // 기본 정렬 — 주요 비품 먼저, 그다음 종류·품명
    return list.sort((a, b) => (b.isMain ? 1 : 0) - (a.isMain ? 1 : 0)
        || String(a.category || '').localeCompare(String(b.category || ''))
        || String(a.name).localeCompare(String(b.name)));
}

/** 헤더 — 컬럼마다 정렬 버튼과 필터 버튼을 붙인다. */
function renderHead() {
    const head = $('items-head');
    if (!head) return;
    // 머리글 글자 + 정렬(↕)·필터(▼) 버튼이 한 줄에 들어갈 최소 폭.
    // 이보다 긴 값이 있으면 그 칸은 내용 폭에 맞춰 저절로 넓어진다.
    const headMinW = (label) => label.length * 13 + 46;
    head.innerHTML = activeCols().map(c => {
        const on = sortState.key === c.key;
        const ic = on ? (sortState.dir === 'asc' ? '▲' : '▼') : '↕';
        return `<th class="${c.type === 'num' ? 'num' : ''}" style="min-width:${headMinW(c.label)}px">
            <div class="th-wrap">
                <button type="button" class="th-sort ${on ? 'active' : ''}" data-sort="${esc(c.key)}"
                    title="클릭해서 정렬 (오름차순 → 내림차순 → 해제)">${esc(c.label)} <span class="th-ic">${esc(ic)}</span></button>
                <button type="button" class="th-filter ${hasColFilter(c.key) ? 'on' : ''}" data-filter="${esc(c.key)}"
                    title="${esc(c.label)} 필터" aria-label="${esc(c.label)} 필터">▼</button>
            </div>
        </th>`;
    }).join('');

    $('btn-reset-filters').classList.toggle('hidden', !anyFilterActive());
}

function renderTable() {
    renderHead();
    const list = visibleItems();
    const body = $('items-body');
    $('empty-state').classList.toggle('hidden', list.length > 0);
    if (items.length > 0) {
        $('empty-state').innerHTML = '조건에 맞는 비품이 없습니다. 필터를 확인해 주세요.';
    }

    // 셀은 COLS의 cell()이 만든다 — 헤더와 순서가 어긋날 수 없다.
    // 행 전체가 상세 창 여는 버튼이다(누르기 · Tab 후 Enter/Space — 아래 '행·카드 열기' 이벤트).
    // 부족(발주·입고 확인 전) 또는 '발주 필요'인 행은 붉은 바탕 + 왼쪽 띠(row-warn — supplies.html)
    body.innerHTML = list.map(it => {
        const warn = (isLow(it) && !['ordered', 'received'].includes(statusOf(it))) || statusOf(it) === 'order';
        return `
        <tr data-open="${esc(it.id)}" tabindex="0"${warn ? ' class="row-warn"' : ''}>
            ${activeCols().map(c => `<td class="${esc(c.td || '')}">${c.cell(it)}</td>`).join('')}
        </tr>`;
    }).join('');
    syncSummaryFilters();
}

// ───────── 헤더 필터 팝업 ─────────
// 표가 overflow 컨테이너 안에 있어 잘리므로, 팝업은 body에 붙이고 좌표로 띄운다.
let openFilterKey = null;

function closeFilterPop() {
    document.querySelectorAll('.flt-pop').forEach(p => p.remove());
    openFilterKey = null;
}

function openFilterPop(key, anchor) {
    if (openFilterKey === key) return closeFilterPop();
    closeFilterPop();
    openFilterKey = key;

    const col = colOf(key);
    const pop = document.createElement('div');
    pop.className = 'flt-pop';
    pop.dataset.key = key;

    if (col.type === 'num') {
        const r = numFilters[key] || { min: '', max: '' };
        pop.innerHTML = `
            <div class="font-bold text-slate-600 mb-1">${esc(col.label)} 범위</div>
            ${col.hint ? `<div class="text-[11px] text-slate-400 mb-2">${esc(col.hint)}</div>` : '<div class="mb-1"></div>'}
            <div class="flex items-center gap-1">
                <input type="number" class="inp" style="padding:5px 7px;font-size:12px" data-min placeholder="최소" value="${esc(r.min)}">
                <span class="text-slate-400">~</span>
                <input type="number" class="inp" style="padding:5px 7px;font-size:12px" data-max placeholder="최대" value="${esc(r.max)}">
            </div>
            <div class="text-right mt-2"><button type="button" class="flt-btn" data-clear>초기화</button></div>`;
    } else {
        // 값 목록은 '이 컬럼을 뺀 나머지 필터'를 통과한 항목에서 뽑는다(엑셀과 같은 방식).
        const others = items.filter(it => activeCols().every(c => {
            if (c.key === key) return true;
            const picked = textFilters[c.key];
            if (picked && picked.size > 0 && !picked.has(String(c.get(it)))) return false;
            const range = numFilters[c.key];
            if (range) {
                const v = num(c.get(it));
                if (range.min !== '' && v < num(range.min)) return false;
                if (range.max !== '' && v > num(range.max)) return false;
            }
            return true;
        }));
        const counts = new Map();
        others.forEach(it => {
            const v = String(col.get(it));
            counts.set(v, (counts.get(v) || 0) + 1);
        });
        const picked = textFilters[key];
        const values = Array.from(counts.keys()).sort((a, b) => a.localeCompare(b, 'ko'));
        pop.innerHTML = `
            <div class="flex items-center justify-between gap-1 mb-1">
                <span class="font-bold text-slate-600">${esc(col.label)}</span>
                <span><button type="button" class="flt-btn" data-all>전체</button><button type="button" class="flt-btn" data-none>해제</button></span>
            </div>
            <input type="search" class="inp" style="padding:5px 7px;font-size:12px" data-q placeholder="값 검색">
            <div class="flt-list">${
                values.length === 0
                    ? '<div class="text-slate-400 text-center py-2">값이 없습니다.</div>'
                    : values.map(v => `
                    <label class="flt-row" data-v="${esc(v)}">
                        <input type="checkbox" data-val="${esc(v)}" ${(!picked || picked.size === 0 || picked.has(v)) ? 'checked' : ''}>
                        <span title="${esc(v)}">${esc(v === '' ? '(빈 값)' : v)}</span>
                        <span class="flt-cnt">${esc(counts.get(v))}</span>
                    </label>`).join('')
            }</div>`;
    }

    document.body.appendChild(pop);

    // 화면 밖으로 나가지 않게 위치 보정
    const a = anchor.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(a.left, window.innerWidth - w - 8)) + 'px';
    pop.style.top = (a.bottom + h + 8 > window.innerHeight ? Math.max(8, a.top - h - 4) : a.bottom + 4) + 'px';

    const qEl = pop.querySelector('[data-q]');
    if (qEl) setTimeout(() => qEl.focus(), 20);
}

/** 팝업의 체크 상태를 필터에 반영한다. 전부 체크면 '필터 없음'으로 둔다. */
function applyTextFilterFromPop(pop) {
    const key = pop.dataset.key;
    const boxes = [...pop.querySelectorAll('input[data-val]')];
    const checked = boxes.filter(b => b.checked).map(b => b.dataset.val);
    if (checked.length === boxes.length) delete textFilters[key];
    else textFilters[key] = new Set(checked);
    renderTable();
}

document.addEventListener('click', (e) => {
    // 정렬 — 오름차순 → 내림차순 → 해제
    const sortBtn = e.target.closest('[data-sort]');
    if (sortBtn) {
        const key = sortBtn.dataset.sort;
        if (sortState.key !== key) sortState = { key, dir: 'asc' };
        else if (sortState.dir === 'asc') sortState.dir = 'desc';
        else sortState = { key: '', dir: 'asc' };
        closeFilterPop();
        renderTable();
        return;
    }
    const fltBtn = e.target.closest('[data-filter]');
    if (fltBtn) { openFilterPop(fltBtn.dataset.filter, fltBtn); return; }
    if (!e.target.closest('.flt-pop')) closeFilterPop();
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFilterPop(); });
window.addEventListener('resize', closeFilterPop);

// 팝업 내부 조작
document.addEventListener('input', (e) => {
    const pop = e.target.closest('.flt-pop');
    if (!pop) return;
    const key = pop.dataset.key;

    if (e.target.matches('[data-q]')) {
        const q = e.target.value.trim().toLowerCase();
        pop.querySelectorAll('.flt-row').forEach(r => {
            r.style.display = r.dataset.v.toLowerCase().includes(q) ? '' : 'none';
        });
        return;
    }
    if (e.target.matches('[data-min],[data-max]')) {
        const min = pop.querySelector('[data-min]').value;
        const max = pop.querySelector('[data-max]').value;
        if (min === '' && max === '') delete numFilters[key];
        else numFilters[key] = { min, max };
        renderTable();
    }
});

document.addEventListener('change', (e) => {
    const pop = e.target.closest('.flt-pop');
    if (pop && e.target.matches('input[data-val]')) applyTextFilterFromPop(pop);
});

document.addEventListener('click', (e) => {
    const pop = e.target.closest('.flt-pop');
    if (!pop) return;
    if (e.target.matches('[data-all]')) {
        pop.querySelectorAll('input[data-val]').forEach(b => { b.checked = true; });
        applyTextFilterFromPop(pop);
    } else if (e.target.matches('[data-none]')) {
        pop.querySelectorAll('input[data-val]').forEach(b => { b.checked = false; });
        applyTextFilterFromPop(pop);
    } else if (e.target.matches('[data-clear]')) {
        pop.querySelector('[data-min]').value = '';
        pop.querySelector('[data-max]').value = '';
        delete numFilters[pop.dataset.key];
        renderTable();
    }
});

function resetAllFilters() {
    COLS.forEach(c => { delete textFilters[c.key]; delete numFilters[c.key]; });
    sortState = { key: '', dir: 'asc' };
    $('filter-category').value = '';
    $('filter-search').value = '';
    $('filter-low').checked = false;
    $('filter-order').checked = false;
    closeFilterPop();
    renderTable();
}

// ───────── 비품 상세 창(왼쪽 상세 폼 + 오른쪽 재고 패널) ─────────
function openItemModal(id = null) {
    editingId = id;
    const it = id ? items.find(x => x.id === id) : null;

    $('item-modal-title').textContent = it ? '비품 상세' : '비품 추가';
    $('btn-save-item').textContent = it ? '상세 저장' : '추가';
    $('btn-delete-item').classList.toggle('hidden', !it);
    showError('item-modal-error', '');

    // 재고 패널은 이미 있는 비품일 때만 — 새 비품은 아직 id 가 없어 재고 이력을 붙일 곳이 없다.
    stockTargetId = it ? it.id : null;
    $('stock-panel').classList.toggle('hidden', !it);
    $('stock-history-panel').classList.toggle('hidden', !it);
    $('item-detail-cell').classList.toggle('md:col-span-full', !it);   // 새 비품 추가: 상세가 전체 폭
    $('item-modal-box').classList.toggle('xl:max-w-7xl', !!it);
    $('item-modal-box').classList.toggle('max-w-5xl', !!it);
    $('item-modal-box').classList.toggle('max-w-2xl', !it);
    if (it) {
        resetStockInputs();
        renderStockPanel();
    }

    $('f-name').value = it?.name || '';
    $('f-category').value = it?.category || '';
    $('f-stock').value = it ? curStock(it) : '';
    // 이미 있는 비품의 현재고는 오른쪽 재고 패널(이력이 남는 곳)에서만 바꾼다.
    // 앱 기준(켜짐)이면 새 비품도 0 에서 시작 — 추가한 뒤 재고 패널에서 입고·실사로 넣는다(원장 밖에서 재고를 만들지 않게)
    const stockLocked = !!it || ledgerLive;
    $('f-stock').readOnly = stockLocked;
    $('f-stock').title = it ? '현재고는 재고 패널에서 바꿉니다' : (ledgerLive ? '추가한 뒤 재고 패널에서 입고·실사로 넣습니다' : '');
    $('f-stock').classList.toggle('bg-slate-100', stockLocked);
    if (!it && ledgerLive) $('f-stock').value = 0;
    $('f-unit').value = it?.unit || '';
    $('f-safety').value = it ? (num(it.safetyStock) || '') : '';
    $('f-price').value = it ? (num(it.unitPrice) || '') : '';
    renderPriceHistory(it);
    $('f-size').value = it?.size || '';
    $('f-vendor').value = it?.vendor || '';
    $('f-vendor-contact').value = it?.vendorContact || '';
    $('f-ez-code').value = it?.ezCode || '';
    $('f-order-unit').value = withThousands(it?.orderUnit || '');
    $('f-leadtime').value = it ? (num(it.leadTimeDays) || '') : '';
    $('f-leadtime-unit').value = leadTimeUnitOf(it);
    $('f-last-order').value = it ? lastOrderOf(it) : '';   // [발주함] 기록이 더 늦으면 그 날짜(저장하면 상세 값도 맞춰진다)
    $('f-memo').value = it?.memo || '';
    $('f-main').checked = !!it?.isMain;
    // 입출고 단위·바코드(2단계)
    const nu = normalizeItemUnits(it);
    formBarcodes = [...nu.barcodes];
    $('f-barcode-input').value = '';
    renderBarcodeChips();
    for (let i = 0; i < MAX_UNITS; i++) {
        const u = nu.units[i];
        $(`f-unit-name-${i}`).value = u ? u.name : '';
        $(`f-unit-qty-${i}`).value = u && Number.isFinite(u.qty) ? u.qty : '';
    }
    $('f-no-single-out').checked = nu.noSingleOut;
    $('f-favorite').checked = nu.favorite;
    renderUnitBaseLabel();
    takeItemSnapshot();

    openModal('item-modal');
    // 기존 비품은 재고 조정 수량칸부터(휴대폰에서는 재고 패널이 맨 위), 새 비품은 품명부터
    setTimeout(() => (it ? $('stock-qty') : $('f-name')).focus(), 30);
}

// ───────── 상세 창 닫기 확인 — 저장하지 않은 수정이 있으면 묻는다 ─────────
// 현재고(f-stock)는 뺀다 — 기존 비품은 읽기 전용이고, [재고 반영]이 값을 바꿔 넣는다.
// 'f-barcodes' 는 입력칸이 아니라 바코드 칩 목록(formBarcodes) — itemFieldValue 가 글자로 바꿔 비교한다.
const ITEM_FORM_IDS = ['f-name', 'f-category', 'f-unit', 'f-safety', 'f-price', 'f-size', 'f-vendor', 'f-vendor-contact',
    'f-ez-code', 'f-order-unit', 'f-leadtime', 'f-leadtime-unit', 'f-last-order', 'f-memo', 'f-main',
    'f-barcodes', 'f-barcode-input', 'f-unit-name-0', 'f-unit-qty-0', 'f-unit-name-1', 'f-unit-qty-1', 'f-unit-name-2', 'f-unit-qty-2',
    'f-unit-name-3', 'f-unit-qty-3', 'f-no-single-out', 'f-favorite'];
let itemSnapshot = {};

function itemFieldValue(id) {
    if (id === 'f-barcodes') return formBarcodes.join('\n');
    const el = $(id);
    return el.type === 'checkbox' ? el.checked : el.value;
}

// ───────── 상세 폼: 바코드 칩·단위 표 ─────────
function renderBarcodeChips() {
    $('f-barcodes').innerHTML = formBarcodes.map((b, i) => `<span class="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
        ${esc(b)}<button type="button" data-barcode-del="${esc(i)}" aria-label="바코드 ${esc(b)} 빼기" class="text-slate-400 hover:text-red-600 leading-none">&times;</button></span>`).join('');
}
/** 입력칸의 바코드를 칩으로 — 겹침·글자 검사는 저장 때 validateUnits(여기서는 빈 칸·같은 칩만 거른다) */
function addBarcodeFromInput() {
    const v = $('f-barcode-input').value.trim();
    if (!v) return;
    if (!formBarcodes.some(b => b.toUpperCase() === v.toUpperCase())) {
        if (formBarcodes.length >= MAX_BARCODES) return showError('item-modal-error', `바코드는 ${MAX_BARCODES}개까지 넣을 수 있습니다.`);
        formBarcodes.push(v);
    }
    $('f-barcode-input').value = '';
    showError('item-modal-error', '');
    renderBarcodeChips();
}
function renderUnitBaseLabel() {
    const b = $('f-unit').value.trim() || '개';
    $('f-unit-base-label').textContent = b;
    document.querySelectorAll('#f-units .f-unit-base').forEach(el => { el.textContent = b; });
}
/** 상세 폼의 단위 표 → [{ name, qty }] (이름·수량 둘 다 빈 줄은 뺀다, 수량 글자는 숫자로 — 검사는 validateUnits) */
function formUnits() {
    const out = [];
    for (let i = 0; i < MAX_UNITS; i++) {
        const name = $(`f-unit-name-${i}`).value.trim();
        const q = $(`f-unit-qty-${i}`).value.trim();
        if (!name && !q) continue;
        out.push({ name, qty: q === '' ? NaN : Number(q) });
    }
    return out;
}

/** 지금 폼 값을 '저장된 상태'로 기억한다. ids 를 주면 그 칸만(다른 칸의 미저장 수정은 그대로 둔다). */
function takeItemSnapshot(ids = [...ITEM_FORM_IDS, 'f-stock']) {
    ids.forEach(id => { itemSnapshot[id] = itemFieldValue(id); });
}

function isItemDirty() {
    if (ITEM_FORM_IDS.some(id => itemSnapshot[id] !== itemFieldValue(id))) return true;
    // 새 비품은 현재고 칸에 직접 적는다(기존 비품은 읽기 전용이라 비교하지 않는다)
    if (!stockTargetId && itemSnapshot['f-stock'] !== itemFieldValue('f-stock')) return true;
    // 재고 패널에 적어 두고 [재고 반영]을 안 누른 것(새 비품은 패널이 없다)
    return !!stockTargetId && ($('stock-qty').value !== '' || $('stock-memo').value.trim() !== '');
}

async function saveItem() {
    const name = $('f-name').value.trim();
    if (!name) return showError('item-modal-error', '품명을 입력해주세요.');

    const dup = items.find(x => x.name === name && x.id !== editingId);
    if (dup) return showError('item-modal-error', '같은 품명의 비품이 이미 있습니다.');

    // 입출고 단위·바코드 — 입력칸에 찍어 두고 [추가]를 안 누른 바코드도 넣는다
    const pendingCode = $('f-barcode-input').value.trim();
    const barcodes = [...formBarcodes];
    if (pendingCode && !barcodes.some(b => b.toUpperCase() === pendingCode.toUpperCase())) barcodes.push(pendingCode);
    const unitFields = { barcodes, units: formUnits(), noSingleOut: $('f-no-single-out').checked, favorite: $('f-favorite').checked };
    const unitErrs = validateUnits({ id: editingId, name, unit: $('f-unit').value.trim() || '개', ...unitFields }, items);
    if (unitErrs.length) return showError('item-modal-error', unitErrs.join('\n'));
    // 비품코드 — 칸을 바꿨을 때만 다른 비품과 같은 코드를 막는다(대소문자·공백 무시 — 이미 겹친 옛 코드가 있어도 이름·단위 수정은 저장되게).
    //   비어 있으면 앱 기준일 때 저장 트랜잭션에서 다음 SP 번호를 붙인다(persist assignCode)
    const prevItem = editingId ? items.find(x => x.id === editingId) : null;
    const checkCode = codeChanged(prevItem ? prevItem.ezCode : '', $('f-ez-code').value);
    const codeDup = checkCode ? findDuplicateCode(items, $('f-ez-code').value, editingId) : null;
    if (codeDup) return showError('item-modal-error', codeDupText(codeDup));

    const data = {
        name,
        category: $('f-category').value.trim() || '미분류',
        stock: num($('f-stock').value),
        unit: $('f-unit').value.trim() || '개',
        safetyStock: num($('f-safety').value),
        unitPrice: num($('f-price').value),
        size: $('f-size').value.trim(),
        vendor: $('f-vendor').value.trim(),
        vendorContact: $('f-vendor-contact').value.trim(),
        ezCode: $('f-ez-code').value.trim(),
        orderUnit: withThousands($('f-order-unit').value.trim()),
        leadTimeDays: num($('f-leadtime').value),
        leadTimeUnit: $('f-leadtime-unit').value,
        lastOrderDate: $('f-last-order').value,
        memo: $('f-memo').value.trim(),
        isMain: $('f-main').checked,
        ...unitFields,
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser
    };

    const btn = $('btn-save-item');
    btn.disabled = true;
    // 저장이 실패하면 메모리를 되돌린다 — 안 그러면 실패한 수정이 다음 저장 때 같이 올라간다.
    // 원래 객체는 건드리지 않고 사본을 만들어 바꿔 끼운다(이력 배열도 복사 — pushLog 가 unshift 한다).
    let undo = null;
    let target = null;   // 이번에 저장하는 비품 객체(비품코드 자동 번호를 붙일 자리)
    try {
        if (editingId) {
            const idx = items.findIndex(x => x.id === editingId);
            const prev = items[idx];
            // 현재고는 상세에서 바꾸지 않는다(읽기 전용) — 재고 패널이 저장한 값을 그대로 둔다.
            data.stock = num(prev.stock);
            const next = { ...prev, ...data, logs: Array.isArray(prev.logs) ? [...prev.logs] : [] };
            // 단가가 바뀌면 이력을 남긴다(누가·언제·얼마에서 얼마로). 서버 연동(비품재고연동)은 이 칸을 건드리지 않는다.
            const prevPrice = num(prev.unitPrice);
            const priceLogs = Array.isArray(prev.priceLogs) ? [...prev.priceLogs] : [];
            if (prevPrice !== data.unitPrice) {
                priceLogs.unshift({ at: data.updatedAt, by: currentUser || '', from: prevPrice, to: data.unitPrice });
            }
            next.priceLogs = priceLogs.slice(0, MAX_PRICE_LOG);
            items[idx] = next;
            target = next;
            undo = () => { const i = items.indexOf(next); if (i >= 0) items[i] = prev; };
        } else {
            if (ledgerLive) data.stock = 0;   // 앱 기준 — 재고는 추가한 뒤 재고 패널(원장)에서
            const added = { id: uid(), logs: [], ...data,
                priceLogs: data.unitPrice > 0 ? [{ at: data.updatedAt, by: currentUser || '', from: 0, to: data.unitPrice }] : [] };
            items.push(added);
            target = added;
            undo = () => { items = items.filter(x => x !== added); };
        }
        await persist({ assignCode: target, checkCode });
        formBarcodes = barcodes; $('f-barcode-input').value = '';
        takeItemSnapshot();
        closeModal('item-modal');
        renderAll();
    } catch (e) {
        // handled = 충돌 안내·다시 불러오기 끝(items 가 이미 서버 값이라 되돌릴 것이 없다)
        if (!e.handled) {
            if (undo) undo();
            showError('item-modal-error', '저장 실패: ' + (e.message || e));
        }
    } finally {
        btn.disabled = false;
    }
}

async function deleteItem() {
    const it = items.find(x => x.id === editingId);
    if (!it) return;
    // 스위치가 열어 둔 사이 바뀌었으면 다시 불러오고 멈춘다(낡은 탭이 원장 재고 검사를 건너뛰지 않게)
    try { if (!(await modeStillSame())) return; }
    catch (e) { return showError('item-modal-error', '재고 기준을 확인하지 못해 삭제를 멈췄습니다: ' + ((e && (e.code || e.message)) || e)); }
    // 앱 기준(켜짐) — 원장에 재고가 남은 비품은 지우지 않는다(지우면 그 재고를 볼 곳이 없다). 지우기 직전 서버 값으로 본다.
    if (ledgerLive) {
        let left;
        try { left = await loadStockOf(db, it.id); }
        catch (e) { return showError('item-modal-error', '앱 재고를 확인하지 못해 삭제를 멈췄습니다: ' + ((e && (e.code || e.message)) || e)); }
        if (left > 0) {
            return showAlert(`'${it.name}' 은(는) 앱 재고가 ${fmt(left)}${it.unit || '개'} 남아 있어 삭제할 수 없습니다.\n재고 패널에서 실사(=)로 0 을 먼저 맞춘 뒤 삭제해 주세요.`, { title: '삭제할 수 없음', isError: true });
        }
    }
    if (!(await showConfirm(`'${it.name}' 비품을 삭제할까요?\n재고 변동 이력도 함께 사라집니다.`, { title: '비품을 삭제할까요?', okText: '삭제하기', danger: true }))) return;
    const prevItems = items;   // 저장 실패(충돌 아님) 시 되돌린다
    items = items.filter(x => x.id !== editingId);
    try {
        await persist();
        closeModal('item-modal');
        renderAll();
    } catch (e) {
        if (!e.handled) { items = prevItems; showError('item-modal-error', '삭제 실패: ' + (e.message || e)); }
    }
}

// ───────── 현재고조회 엑셀 업로드 ─────────
// 사내 시스템의 '현재고조회' 내려받기는 확장자만 .xls 이고 실제로는 HTML 표다.
// 열: 작업일 · 작업(입고/출고/조정) · 수량 · 재고(그 작업 뒤 잔량) · 작업자 · 메모 · 전표
// 가장 최근 작업일의 '재고'가 곧 현재고이므로, 그 값으로 실사(맞춤) 처리한다.
let pendingUploadId = null;

async function readFileText(file) {
    const buf = await file.arrayBuffer();
    // 대개 UTF-8이지만 예전 내려받기는 EUC-KR인 경우가 있다.
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (_) { return new TextDecoder('euc-kr').decode(buf); }
}

function parseStockFile(text) {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const rows = [...doc.querySelectorAll('tr')];
    if (rows.length < 2) throw new Error('표를 찾지 못했습니다.');

    const cellsOf = (tr) => [...tr.querySelectorAll('td,th')]
        .map(td => (td.textContent || '').replace(/ /g, ' ').trim());

    // '재고' 칸이 있는 첫 줄을 머리글로 본다(위에 제목 줄이 붙어 있어도 괜찮다).
    let hi = -1, head = null;
    for (let i = 0; i < rows.length; i++) {
        const c = cellsOf(rows[i]);
        if (c.some(h => h === '재고')) { hi = i; head = c; break; }
    }
    if (hi < 0) throw new Error("'재고' 열을 찾지 못했습니다.");

    const iStock = head.indexOf('재고');
    const iDate = head.findIndex(h => h.includes('작업일') || h.includes('일자') || h.includes('날짜'));
    const iOp = head.findIndex(h => h === '작업' || h.includes('구분'));
    const iQty = head.indexOf('수량');
    const numText = (v) => String(v == null ? '' : v).replace(/[^0-9.-]/g, '');
    const toNum = (v) => Number(numText(v));

    const entries = [];
    for (let i = hi + 1; i < rows.length; i++) {
        const c = cellsOf(rows[i]);
        if (c.length <= iStock || c[iStock] === '') continue;
        if (numText(c[iStock]) === '') continue;   // 숫자가 하나도 없는 칸('abc')은 건너뛴다 — 예전엔 Number('') 로 0 이 됐다
        const stock = toNum(c[iStock]);
        if (!Number.isFinite(stock)) continue;
        entries.push({
            at: iDate >= 0 ? (c[iDate] || '') : '',
            op: iOp >= 0 ? (c[iOp] || '') : '',
            qty: iQty >= 0 ? (toNum(c[iQty]) || 0) : 0,
            stock
        });
    }
    if (!entries.length) throw new Error('읽을 수 있는 행이 없습니다.');

    // 파일이 최신순/과거순 어느 쪽이든 상관없도록 작업일로 정렬한다.
    entries.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    return { latest: entries[entries.length - 1], count: entries.length };
}

async function handleStockFile(file) {
    const it = items.find(x => x.id === pendingUploadId);
    // 파일을 고르는 사이 창이 닫혔거나 다른 비품으로 바뀌었으면 채우지 않는다
    if (!it || it.id !== stockTargetId || $('item-modal').classList.contains('hidden')) return;
    try {
        const { latest, count } = parseStockFile(await readFileText(file));

        // 재고 패널의 조정을 '실사(맞춤)'로 미리 채워 두고, 저장은 사용자가 확인 후 [재고 반영]을 누른다.
        showError('stock-panel-error', '');
        document.querySelector('input[name="stock-op"][value="set"]').checked = true;
        $('stock-qty').value = latest.stock;
        $('stock-memo').value = `현재고조회 업로드${latest.at ? ` · 기준 ${latest.at}` : ''}`;
        updateStockPreview();

        const diff = latest.stock - curStock(it);
        const note = $('stock-import-note');
        note.textContent = `${file.name} — ${count}건 중 가장 최근 작업(${latest.at || '날짜 없음'}) 기준 재고 `
            + `${fmt(latest.stock)}${it.unit || '개'}. 현재 ${fmt(curStock(it))} → ${fmt(latest.stock)} `
            + `(${diff > 0 ? '+' : ''}${fmt(diff)}). 확인 후 [재고 반영]을 누르세요.`;
        note.classList.remove('hidden');
        $('btn-save-stock').focus();
    } catch (e) {
        showAlert(`파일을 읽지 못했습니다.

${e.message}

'현재고조회' 엑셀(작업일 · 작업 · 수량 · 재고 열) 형식을 올려주세요.`, { title: '파일 읽기 실패', isError: true });
    }
}

// ───────── 재고 패널(상세 창 오른쪽) ─────────
/** 상세 창의 '단가 변경 이력'(접힘). 이력이 없으면 숨긴다. */
function renderPriceHistory(it) {
    const box = $('price-history'), list = $('price-history-list');
    if (!box || !list) return;
    const logs = (it && Array.isArray(it.priceLogs)) ? it.priceLogs : [];
    box.classList.toggle('hidden', logs.length === 0);
    box.open = false;
    list.innerHTML = logs.map(l =>
        `<li>${esc(kstDateTime(l.at))} · ${esc(l.from ? fmt(l.from) + '원' : '미등록')} → <b>${esc(l.to ? fmt(l.to) + '원' : '미등록')}</b>${l.by ? ` · ${esc(l.by)}` : ''}</li>`
    ).join('');
}

function pushLog(it, op, delta, after, memo) {
    if (!Array.isArray(it.logs)) it.logs = [];
    it.logs.unshift({
        at: new Date().toISOString(), by: currentUser,
        op, delta, after, memo: memo || ''
    });
    it.logs = it.logs.slice(0, MAX_LOG);
}

function currentStockOp() {
    return document.querySelector('input[name="stock-op"]:checked')?.value || 'in';
}

// 앱 기준(켜짐) 재고 패널의 방향 — 단위 단추(unitButtons)에 넘기는 값
const unitDir = (op) => (op === 'out' ? 'out' : (op === 'set' ? 'count' : 'in'));
const ledgerKindLabel = { in: '입고', out: '사용', count: '실사', revert: '되돌림' };

/** 앱 기준(켜짐) 단위 단추 — 고른 단위가 이번 방향에 없으면 가장 작은 단위로 */
function renderStockUnits() {
    const box = $('stock-units');
    const it = items.find(x => x.id === stockTargetId);
    const show = ledgerLive && !!it;
    box.classList.toggle('hidden', !show);
    box.classList.toggle('flex', show);
    if (!show) { box.innerHTML = ''; $('stock-qty-label').textContent = '수량'; return; }
    const btns = unitButtons(it, unitDir(currentStockOp()));
    if (!btns.some(u => u.qty === stockUnitQty)) stockUnitQty = btns[0].qty;
    const base = it.unit || '개';
    box.innerHTML = btns.map(u => {
        const on = u.qty === stockUnitQty;
        return `<button type="button" data-stock-unit="${esc(u.qty)}" aria-pressed="${on}"
            class="text-xs font-bold px-2.5 py-1.5 rounded-lg border ${on ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'}">${esc(u.name)}${u.qty > 1 ? ` <span class="font-normal ${on ? 'text-indigo-100' : 'text-slate-400'}">(${esc(fmt(u.qty))}${esc(base)})</span>` : ''}</button>`;
    }).join('');
    const cur = btns.find(u => u.qty === stockUnitQty);
    $('stock-qty-label').textContent = cur && cur.qty > 1 ? `수량 (${cur.name} 몇 개)` : '수량';
}

/** 앱 기준(켜짐) — 고른 단위 × 수량 칸 = { qty } 기본 단위 수량 · { error:'format'|'max' } · 빈칸이면 null */
function stockBaseQty() {
    const it = items.find(x => x.id === stockTargetId);
    if (!it) return null;
    const btns = unitButtons(it, unitDir(currentStockOp()));
    const unit = btns.find(u => u.qty === stockUnitQty) || btns[0];
    const raw = $('stock-qty').value.trim();
    return raw === '' ? null : checkBaseQty(unit, raw);
}
const baseQtyErrorText = (r, it) => (r && r.error === 'max'
    ? `한 번에 ${fmt(MAX_UNIT_QTY)}${(it && it.unit) || '개'}까지 넣을 수 있습니다.` : '수량을 0 이상 정수로 넣어 주세요.');

function updateStockPreview() {
    const it = items.find(x => x.id === stockTargetId);
    if (!it) return;
    const op = currentStockOp();
    const before = curStock(it);
    if (ledgerLive) {
        const r = stockBaseQty();
        if (!r) { $('stock-preview').textContent = '-'; return; }
        if (r.error) { $('stock-preview').textContent = baseQtyErrorText(r, it); return; }
        const q = r.qty;
        const after = op === 'in' ? before + q : (op === 'out' ? before - q : q);
        const conv = stockUnitQty > 1 ? ` · ${fmt(q)}${it.unit || '개'}` : '';
        $('stock-preview').textContent = `${fmt(Math.max(0, after))} ${it.unit || '개'}${after < 0 ? ' (재고 부족)' : ''}${conv}`;
        return;
    }
    const qty = num($('stock-qty').value);
    const after = op === 'in' ? before + qty : (op === 'out' ? before - qty : qty);
    $('stock-preview').textContent = `${fmt(Math.max(0, after))} ${it.unit || '개'}${after < 0 ? ' (재고 부족)' : ''}`;
}

/** 조정 입력(동작·수량·메모)과 안내·오류를 처음 상태로. 창을 열 때와 [재고 반영] 직후에 쓴다. */
function resetStockInputs() {
    $('stock-qty').value = '';
    $('stock-memo').value = '';
    document.querySelector('input[name="stock-op"][value="in"]').checked = true;
    stockUnitQty = 1;
    $('stock-import-note').classList.add('hidden');
    showError('stock-panel-error', '');
}

/** 현재고·부족 표시·이지어드민 연동 안내·미리보기·변동 이력을 저장된 값(items / 앱 기준이면 원장)으로 다시 그린다. */
function renderStockPanel() {
    const it = items.find(x => x.id === stockTargetId);
    if (!it) return;
    const low = isLow(it);

    $('stock-current').textContent = fmt(curStock(it));
    $('stock-current').classList.toggle('text-red-600', low);
    $('stock-current').classList.toggle('text-slate-800', !low);
    $('stock-unit').textContent = it.unit || '개';
    $('stock-low-badge').classList.toggle('hidden', !low);

    // 앱 기준(켜짐)이면 이지어드민 쪽 안내·현재고조회 파일·메모 칸을 숨긴다(메모는 원장에 칸이 없다)
    const ez = $('stock-ez-note');
    const ezOn = !ledgerLive && isEzCode(it.ezCode);   // SP 번호(앱 비품코드)는 이지어드민 연동 대상이 아니다
    ez.textContent = ezOn ? `이지어드민 연동 비품(${it.ezCode}) — 매일 19:30 이지어드민 재고로 자동 반영됩니다 · 매일 08:30 사용량 예측.` : '';
    ez.classList.toggle('hidden', !ezOn);
    $('btn-stock-excel').classList.toggle('hidden', ledgerLive);
    $('stock-memo-wrap').classList.toggle('hidden', ledgerLive);
    renderForecastBox();

    renderStockUnits();
    updateStockPreview();

    if (ledgerLive) { renderLedgerLog(it); return; }
    $('btn-stock-log-more').classList.add('hidden');
    const logs = Array.isArray(it.logs) ? it.logs : [];
    $('stock-log').innerHTML = logs.length === 0
        ? '<div class="text-[11px] text-slate-400 text-center py-2">재고 변동 이력이 없습니다.</div>'
        : oldLogsHtml(logs);
}

/** 옛(이지어드민 기준) 재고 이력 줄 — item.logs. 앱 기준으로 바꾼 뒤에도 원장 이력 아래에 읽기 전용으로 보인다(2026-11-27 사용자 요청) */
function oldLogsHtml(logs) {
    return logs.map(l => {
        const label = l.op === 'in' ? '입고' : (l.op === 'out' ? '사용' : '실사');
        const tone = l.delta > 0 ? 'text-emerald-600' : (l.delta < 0 ? 'text-red-600' : 'text-slate-500');
        return `<div class="text-[11px] text-slate-500 flex justify-between gap-2 py-0.5 border-b border-slate-100 last:border-b-0">
                <span class="min-w-0 break-words">${esc(kstDateTime(l.at))} ${label}${l.memo ? ` · ${esc(l.memo)}` : ''}</span>
                <span class="${tone} font-bold shrink-0">${l.delta > 0 ? '+' : ''}${esc(fmt(l.delta))} → ${esc(fmt(l.after))}</span>
            </div>`;
    }).join('');
}

/** 앱 기준(켜짐) 이력 — 원장에서 이 비품만(새 것부터). 되돌린 기록·되돌림 기록을 표시하고 나머지에 [되돌리기] */
function renderLedgerLog(it) {
    const mine = ledgerEntries.filter(e => e.itemId === it.id);
    const reverted = new Set(ledgerEntries.filter(e => e.kind === 'revert' && e.ref).map(e => e.ref));
    const timeOf = (e) => { const ms = atMs(e.at); return Number.isFinite(ms) ? kstDateTime(new Date(ms).toISOString()) : '방금'; };
    $('stock-log').innerHTML = mine.length === 0
        ? `<div class="text-[11px] text-slate-400 text-center py-2">${ledgerMore ? '최근 1개월 입출고 기록이 없습니다.' : '입출고 기록이 없습니다.'}</div>`
        : mine.map(e => {
            const tone = e.qty > 0 ? 'text-emerald-600' : (e.qty < 0 ? 'text-red-600' : 'text-slate-500');
            const who = ledgerWho(e, memberEmails);
            const done = reverted.has(e.id);
            const tag = e.kind === 'revert'
                ? ' <span class="text-[10px] font-bold px-1 rounded bg-slate-100 text-slate-500">되돌림 기록</span>'
                : (done ? ' <span class="text-[10px] font-bold px-1 rounded bg-amber-50 text-amber-700">되돌린 기록</span>' : '');
            const btn = e.kind !== 'revert' && !done
                ? `<button type="button" data-revert="${esc(e.id)}" class="text-[10px] font-bold px-1.5 py-0.5 rounded border border-slate-300 text-slate-500 hover:bg-red-50 hover:text-red-600">되돌리기</button>` : '';
            return `<div class="text-[11px] text-slate-500 py-0.5 border-b border-slate-100 last:border-b-0" data-ledger-row="${esc(e.id)}">
                <div class="flex justify-between gap-2">
                    <span class="min-w-0 break-words">${esc(timeOf(e))} ${esc(ledgerKindLabel[e.kind] || e.kind)}${tag}</span>
                    <span class="${tone} font-bold shrink-0">${e.qty > 0 ? '+' : ''}${esc(fmt(e.qty))} → ${esc(fmt(e.after))}</span>
                </div>
                <div class="flex justify-between items-center gap-2"><span class="text-slate-400 min-w-0 truncate">${esc(who)}</span>${btn}</div>
            </div>`;
        }).join('');
    // 앱 기준 전환 전 기록(이지어드민 기준 item.logs) — 지우지 않았으니 아래에 읽기 전용으로(되돌리기 없음)
    const old = Array.isArray(it.logs) ? it.logs : [];
    if (old.length) {
        $('stock-log').insertAdjacentHTML('beforeend',
            `<div class="text-[10px] font-bold text-slate-400 mt-2 pt-1 border-t border-slate-200">앱 기준 전환 전 기록(이지어드민 기준 · ${esc(fmt(old.length))}건, 보기만)</div>`
            + oldLogsHtml(old));
    }
    $('btn-stock-log-more').classList.toggle('hidden', !ledgerMore);
}

/** 원장 저장 결과 → 화면 기억(재고·최근 기록)에 넣는다. 서버 at 은 다음 불러오기 때 — 그때까지 지금 시각 */
function applyLedgerEntries(entries, me) {
    const now = new Date();
    for (const e of entries) {
        ledgerStock[e.itemId] = e.after;
        if (!ledgerEntries.some(x => x.id === e.id)) ledgerEntries.unshift({ ...e, byEmail: me.email, at: now });
    }
}

/** 원장 다시 읽기(이 비품 재고 + 최근 1개월) — '이미 저장됨'·다른 사람이 먼저 바꿈 뒤에 */
async function refreshLedgerFor(itemId) {
    const [st, lg] = await Promise.allSettled([loadStockOf(db, itemId), loadLedger(db, { days: 30 })]);
    if (st.status === 'fulfilled') ledgerStock[itemId] = st.value;
    if (lg.status === 'fulfilled') { ledgerEntries = lg.value; ledgerCursor = lg.value.cursor; ledgerMore = true; }
}

const ledgerMe = () => ({ email: String(currentUser || '').toLowerCase(), name: myName || '' });
const ledgerErr = (e, it) => {
    if (e && e.reason === 'write') {
        return e.code === 'permission-denied' ? '권한이 없어 저장하지 못했습니다(비품 관리 권한 확인).' : `저장하지 못했습니다(${e.code || '연결 확인'}) — 같은 값으로 다시 누르면 두 번 들어가지 않습니다.`;
    }
    return ledgerErrorText(e, () => (it ? it.name : '비품'));
};

/** 앱 기준(켜짐) [재고 반영] — 원장에 입고·출고(commitLines) 또는 실사(commitCount) */
async function saveStockLedger(it) {
    if (!ledgerStockOk) return showError('stock-panel-error', '앱 재고를 불러오지 못해 막았습니다 — [새로고침] 후 다시 해 주세요.');
    const op = currentStockOp();
    const r = stockBaseQty();
    if (!r || r.error) return showError('stock-panel-error', r ? baseQtyErrorText(r, it) : '수량을 입력해주세요.');
    const q = r.qty;
    if (op !== 'set' && q <= 0) return showError('stock-panel-error', '수량을 입력해주세요.');
    const before = curStock(it);
    const after = op === 'in' ? before + q : (op === 'out' ? before - q : q);
    if (after < 0) return showError('stock-panel-error', `재고가 모자랍니다(필요 ${fmt(q)} · 지금 ${fmt(before)}).`);
    showError('stock-panel-error', '');
    const chk = checkStockAdjust({ op, raw: String(q), before });
    if (chk.error) return showError('stock-panel-error', chk.error);
    if (chk.confirm && !(await showConfirm(chk.confirm))) return;

    const key = `${it.id}|${op}|${q}`;
    const batchId = pendingStock && pendingStock.key === key ? pendingStock.batchId : newBatchId();
    pendingStock = { key, batchId };
    const me = ledgerMe();
    const btn = $('btn-save-stock');
    btn.disabled = true;
    try {
        if (!(await modeStillSame())) return;
        let fail = null, entries = [], already = false;
        if (op === 'set') {
            const r = await commitCount(db, it.id, q, me, batchId);
            if (!r.ok) fail = r;
            else if (r.already) already = true;
            else if (r.entry) entries = [r.entry];
        } else {
            const r = await commitLines(db, [{ itemId: it.id, qty: q }], op, me, batchId);
            const bad = r.parts.find(p => !p.ok);
            if (bad) fail = (bad.errors && bad.errors[0]) || { reason: 'write' };
            else { entries = r.parts.flatMap(p => p.entries || []); already = r.parts.some(p => p.already); }
        }
        if (fail) {
            if (fail.reason !== 'write') pendingStock = null;   // 저장 안 됨이 확실 — 다음은 새 묶음
            if (fail.reason === 'short' || fail.reason === 'changed') { await refreshLedgerFor(it.id); renderStockPanel(); renderAll(); }
            return showError('stock-panel-error', ledgerErr(fail, it));
        }
        pendingStock = null;
        if (already) await refreshLedgerFor(it.id);
        else applyLedgerEntries(entries, me);
        resetStockInputs();
        renderStockPanel();
        renderAll();
        if (already) showError('stock-panel-error', '이미 저장된 입력이었습니다 — 두 번 들어가지 않았습니다.');
    } catch (e) {
        renderStockPanel();
        showError('stock-panel-error', ledgerErr({ reason: 'write', code: e && e.code }, it));
    } finally {
        btn.disabled = false;
    }
}

/** 앱 기준(켜짐) 이력의 [되돌리기] — 원 기록의 반대 기록(한 번만, 0 밑이면 거절) */
async function revertLedgerEntry(id) {
    const it = items.find(x => x.id === stockTargetId);
    const e = ledgerEntries.find(x => x.id === id);
    if (!it || !e || e.itemId !== it.id) return;
    const unit = it.unit || '개';
    const back = -e.qty;
    if (!(await showConfirm(`${ledgerKindLabel[e.kind] || e.kind} ${e.qty > 0 ? '+' : ''}${fmt(e.qty)}${unit} 기록을 되돌립니다.\n재고가 ${fmt(Math.abs(back))}${unit} ${back > 0 ? '늘어납니다' : '줄어듭니다'}. 원래 기록은 남고 되돌림 기록이 하나 더 생깁니다.`,
        { title: '기록을 되돌릴까요?', okText: '되돌리기', danger: true }))) return;
    const me = ledgerMe();
    showError('stock-panel-error', '');
    try {
        if (!(await modeStillSame())) return;
        const r = await commitRevert(db, { id: e.id, itemId: e.itemId, kind: e.kind, qty: e.qty }, me);
        if (!r.ok) {
            if (r.reason === 'already') { await refreshLedgerFor(it.id); renderStockPanel(); renderAll(); return showError('stock-panel-error', '이미 되돌린 기록입니다.'); }
            if (r.reason === 'short') { await refreshLedgerFor(it.id); renderStockPanel(); renderAll(); }
            return showError('stock-panel-error', ledgerErr(r, it));
        }
        applyLedgerEntries([r.entry], me);
        renderStockPanel();
        renderAll();
    } catch (err) {
        showError('stock-panel-error', ledgerErr({ reason: 'write', code: err && err.code }, it));
    }
}

/** 앱 기준(켜짐) 이력 [더 보기] — 지금 받은 것보다 오래된 기록 200건 더(비품 모두 섞여 온다 — 이 비품 것이 안 보이면 한 번 더) */
async function loadMoreLedger() {
    const btn = $('btn-stock-log-more');
    btn.disabled = true;
    try {
        const more = await loadLedger(db, { days: null, max: 200, before: ledgerCursor });
        const have = new Set(ledgerEntries.map(x => x.id));
        more.forEach(x => { if (!have.has(x.id)) ledgerEntries.push(x); });
        if (more.cursor) ledgerCursor = more.cursor;
        ledgerMore = more.full;
        renderStockPanel();
    } catch (e) {
        showError('stock-panel-error', '기록을 더 불러오지 못했습니다: ' + ((e && (e.code || e.message)) || e));
    } finally {
        btn.disabled = false;
    }
}

async function saveStock() {
    const it = items.find(x => x.id === stockTargetId);
    if (!it) return;
    if (!settingsOk) return showError('stock-panel-error', '재고 기준 설정을 불러오지 못해 막았습니다 — [새로고침] 후 다시 해 주세요.');
    if (ledgerLive) return saveStockLedger(it);

    const raw = $('stock-qty').value;
    const qty = num(raw);
    const op = currentStockOp();
    const before = curStock(it);
    // 빈칸·숫자 아님은 실사도 막는다(예전엔 빈 실사가 재고 0 으로 저장됐다) — js/lib/supplies-stock-check.js
    const chk = checkStockAdjust({ op, raw, before });
    if (chk.error) return showError('stock-panel-error', chk.error);
    if (qty <= 0 && op !== 'set') return showError('stock-panel-error', '수량을 입력해주세요.');

    const after = op === 'in' ? before + qty : (op === 'out' ? before - qty : qty);
    if (after < 0) return showError('stock-panel-error', '재고가 0보다 작아질 수 없습니다.');
    // 실사 0·큰 변화는 확인을 받는다(앞서 띄운 오류 문구는 지운다 — 취소해도 옛 오류가 남지 않게)
    showError('stock-panel-error', '');
    if (chk.confirm && !(await showConfirm(chk.confirm))) return;

    const btn = $('btn-save-stock');
    btn.disabled = true;
    // 사본에 바꿔 끼우고 저장한다 — 실패하면 원래 객체(it)로 되돌려 메모리에 반쯤 반영된 재고·이력이 남지 않게.
    const next = {
        ...it, stock: after, updatedAt: new Date().toISOString(), updatedBy: currentUser,
        logs: Array.isArray(it.logs) ? [...it.logs] : []
    };
    // 입고는 발주가 들어온 것으로 보고 최근 발주일을 갱신하지 않는다(발주일은 상세에서 직접 관리).
    pushLog(next, op, after - before, after, $('stock-memo').value.trim());
    const idx = items.indexOf(it);
    items[idx] = next;
    try {
        await persist({
            keepModal: true,
            conflictMsg: '다른 사람이 먼저 비품을 바꿔 재고를 다시 불러왔습니다.\n재고 반영은 저장되지 않았습니다 — 현재고를 확인하고 [재고 반영]을 다시 해 주세요.\n(왼쪽 상세에 입력해 둔 내용은 그대로 있습니다)'
        });
        // 창은 닫지 않는다. 왼쪽 상세 폼에서 아직 저장하지 않은 수정은 그대로 두고, 현재고 칸만 새 값으로 맞춘다
        // — 그래야 나중에 [상세 저장]을 눌러도 옛 재고로 되돌리지 않고, '상세 수정에서 변경' 이력도 잘못 남지 않는다.
        $('f-stock').value = num(next.stock);
        resetStockInputs();
        renderStockPanel();
        renderAll();
    } catch (e) {
        if (e.handled) {
            // 충돌 — persist 가 서버 값으로 다시 불러왔다. 창은 열어 둔 채 재고 쪽(패널·현재고 칸)만 서버 값으로.
            // 조정 수량·메모는 남겨 둬 확인 후 바로 다시 누를 수 있게 한다(미리보기는 새 현재고 기준으로 다시 계산).
            const fresh = items.find(x => x.id === stockTargetId);
            if (!fresh) {
                showAlert('이 비품은 다른 곳에서 삭제되었습니다. 창을 닫습니다.', { isError: true });
                closeModal('item-modal');
                return;
            }
            $('f-stock').value = curStock(fresh);
            renderStockPanel();
            showError('stock-panel-error', '다른 사람이 먼저 바꿔 재고를 다시 불러왔습니다. 재고 반영을 다시 해 주세요.');
        } else {
            const i = items.indexOf(next);
            if (i >= 0) items[i] = it;
            renderStockPanel();
            showError('stock-panel-error', '저장 실패: ' + (e.message || e));
        }
    } finally {
        btn.disabled = false;
    }
}

// ───────── 사용량 예측 상자(재고 패널 안) ─────────
// 계산은 서버만 한다 — 여기서는 표시와 [발주함]·[입고 확인]·[발주 취소]·안전재고 [적용]·기준 물량 선택만.
function renderForecastBox() {
    const box = $('fc-box');
    if (!box) return;
    const it = items.find(x => x.id === stockTargetId);
    if (!it) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    box.classList.remove('hidden');
    const unit = it.unit || '개';
    const fc = fcOf(it);
    const order = orderOf(it);
    const b = statusBadge(statusOf(it));
    const parts = [`<div class="flex items-center justify-between gap-2">
        <span class="text-xs font-bold text-slate-600">사용량 예측</span>
        ${b.label !== '-' ? `<span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full ${b.cls} shrink-0"${b.title ? ` title="${esc(b.title)}"` : ''}>${esc(b.label)}</span>` : ''}
    </div>`];
    const ordered = order && order.status === 'ordered';
    if (!isEzCode(it.ezCode) && !ordered && !fcOpts().ledger) {
        box.innerHTML = parts.join('') + `<p class="text-[11px] text-slate-500 leading-snug">${esc(NOCODE_HINT)}</p>`;
        return;
    }
    if (!forecastDoc) {
        parts.push('<p class="text-[11px] text-slate-400 leading-snug">예측이 아직 없습니다 — 매일 08:30 사용량 예측 뒤 표시됩니다.</p>');
    } else if (isStale(forecastDoc.generatedAt)) {
        parts.push(`<p class="text-[11px] font-bold text-amber-700">예측 오래됨 — 마지막 예측 ${esc(kstDateTime(forecastDoc.generatedAt))}</p>`);
    }
    const row = (k, v, cls = '') => `<div class="flex justify-between gap-2"><span class="text-slate-400 shrink-0">${k}</span><span class="text-right font-bold min-w-0 ${cls}">${esc(v)}</span></div>`;
    if (fc) {
        const bt = basisText(fc, unit);
        if (bt) parts.push(`<p class="leading-snug">${esc(bt)}${fc.confidence === 'low' ? ' <span class="text-amber-700 font-bold">(신뢰도 낮음)</span>' : ''}</p>`);
        if (fc.method) {
            const lt = leadTimeText(fc);
            parts.push('<div class="space-y-0.5">'
                + row('소진 예상', depleteText(fc))
                + row('발주 권장일', fc.reorderDate ? mdw(fc.reorderDate) : '-')
                + row('리드타임', lt.text, lt.warn ? 'text-amber-700' : '')
                + row('권장 발주량', recommendText(fc, unit))
                + row('기준 재고', `${fmt(fc.stock)}${unit}${fc.stockAt ? ` · ${kstDateTime(fc.stockAt).slice(5)}` : ''}`)
                + row('예측 시각', forecastDoc && forecastDoc.generatedAt ? kstDateTime(forecastDoc.generatedAt).slice(5) : '-')
                + '</div>');
        }
        // 리드타임·앱 입력 경고는 위·아래에 따로 보이므로 목록에서 뺀다
        const notes = (Array.isArray(fc.notes) ? fc.notes : []).filter(n => !/^리드타임 미등록|^앱에서만/.test(String(n)));
        if (notes.length) parts.push(`<ul class="text-[11px] text-slate-500 list-disc pl-4 space-y-0.5">${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>`);
        const warn = appOnlyWarning(fc.appOnlyOutLogs);
        if (warn) parts.push(`<p class="text-[11px] text-red-600 font-bold leading-snug">${esc(warn)}</p>`);
        const sug = safetySuggestion(fc, it);
        if (sug != null) {
            parts.push(`<div class="flex items-center justify-between gap-2 bg-slate-50 rounded-lg px-2 py-1.5">
                <span class="text-[11px] leading-snug min-w-0">안전재고 제안 <b>${esc(fmt(sug))}${esc(unit)}</b> (사용 변동·리드타임 ${esc(num(fc.leadTime && fc.leadTime.workdays))}업무일 기준)</span>
                <button type="button" data-fc-safety="${esc(sug)}" class="shrink-0 text-[11px] font-bold px-2 py-1 rounded bg-indigo-50 text-indigo-700 hover:bg-indigo-100">적용</button>
            </div>`);
        }
    } else if (forecastDoc) {
        parts.push('<p class="text-[11px] text-slate-400 leading-snug">이 비품은 아직 예측이 없습니다 — 다음 날 아침 예측부터 표시됩니다.</p>');
    }
    if (ordered) {
        parts.push(`<div class="bg-indigo-50 border border-indigo-100 rounded-lg p-2 space-y-1.5">
            <div class="text-[11px] font-bold text-indigo-700">${esc(orderSummaryText(order, unit))}</div>
            <div class="flex gap-1.5">
                <button type="button" data-fc-receive class="flex-1 text-[11px] font-bold px-2 py-1.5 rounded bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-100">입고 확인</button>
                <button type="button" data-fc-cancel class="flex-1 text-[11px] font-bold px-2 py-1.5 rounded bg-white border border-slate-300 text-slate-600 hover:bg-red-50 hover:text-red-600">발주 취소</button>
            </div>
        </div>`);
    } else {
        const q = fc && num(fc.recommendQty) > 0 ? fmt(fc.recommendQty) : '';
        parts.push(`<div class="flex items-center gap-1.5">
            <input id="fc-order-qty" type="text" inputmode="numeric" class="inp num min-w-0" style="padding:5px 7px;font-size:12px" placeholder="발주 수량" value="${esc(q)}" aria-label="발주 수량">
            <span class="text-[11px] text-slate-400 shrink-0">${esc(unit)}</span>
            <button type="button" data-fc-order class="shrink-0 text-[11px] font-bold px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white">발주함</button>
        </div>
        <p class="text-[11px] text-slate-400 leading-snug">[발주함]을 누르면 입고될 때까지 이 비품의 발주 알림을 멈춥니다.</p>`);
    }
    if (isAdmin) {
        const cur = it.forecastDriver || 'auto';
        parts.push(`<div class="flex items-center gap-1.5">
            <label for="fc-driver" class="text-[11px] text-slate-400 shrink-0">기준 물량(관리자)</label>
            <select id="fc-driver" class="inp min-w-0" style="padding:4px 6px;font-size:12px">${DRIVER_OPTIONS.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
        </div>`);
        const pk = packsProgressText(forecastDoc);
        if (pk) parts.push(`<p class="text-[11px] text-slate-400">${esc(pk)}</p>`);
    }
    if (!ordersOk) parts.push('<p class="text-[11px] text-red-600 font-bold leading-snug">발주 상태를 불러오지 못해 발주 버튼을 막았습니다 — [새로고침] 후 다시 해 주세요.</p>');
    parts.push('<p id="fc-error" class="hidden text-xs text-red-600 font-bold"></p>');
    parts.push('<p class="text-[11px] text-slate-400 leading-snug">설정 변경(안전재고·리드타임·MOQ·기준 물량)은 내일 아침 예측부터 반영됩니다.</p>');
    box.innerHTML = parts.join('');
    if (!ordersOk) box.querySelectorAll('[data-fc-order],[data-fc-receive],[data-fc-cancel],#fc-order-qty').forEach(el => { el.disabled = true; });
}

class OrderConflict extends Error {}

/** orders.<id> 한 칸만 쓴다(다른 비품의 발주 상태는 건드리지 않는다).
 *  트랜잭션 안에서 다시 읽어 지금 상태가 expect(없음 = 'none') 중 하나일 때만 쓴다 — 두 화면에서 동시에 누르거나,
 *  서버가 그 사이 입고(received)로 바꾼 것을 옛 화면이 덮어쓰지 않게. log 도 같은 트랜잭션에서 쓴다.
 *  makeValue(cur)·makeLog(cur) 는 트랜잭션에서 읽은 현재 값으로 만든다. */
async function writeOrder(id, expect, makeValue, makeLog) {
    let fresh = null, value = null;
    try {
        await runTransaction(db, async (tx) => {
            const snap = await tx.get(ORDERS_REF);
            const d = snap.exists() ? snap.data() : {};
            const orders = (d && typeof d.orders === 'object' && d.orders) || {};
            fresh = { ...d, orders };
            const cur = orders[id] || null;
            if (!expect.includes(cur && cur.status ? cur.status : 'none')) throw new OrderConflict('changed');
            value = makeValue(cur);
            const logEntry = makeLog ? makeLog(cur) : null;
            if (snap.exists()) {
                const more = logEntry ? ['log', arrayUnion(logEntry)] : [];
                tx.update(ORDERS_REF, new FieldPath('orders', id), value, ...more);
            } else {
                tx.set(ORDERS_REF, { orders: { [id]: value }, ...(logEntry ? { log: [logEntry] } : {}) });
            }
        });
    } catch (e) {
        if (e instanceof OrderConflict && fresh) { ordersDoc = fresh; ordersOk = true; }
        throw e;
    }
    ordersDoc = { ...fresh, orders: { ...fresh.orders, [id]: value } };
    ordersOk = true;
}

async function runForecastAction(fn) {
    const box = $('fc-box');
    box.querySelectorAll('button,select,input').forEach(el => { el.disabled = true; });
    try {
        await fn();
        renderStockPanel();
        renderAll();
    } catch (e) {
        if (e instanceof OrderConflict) {
            showAlert('다른 사람이 먼저 이 비품의 발주 상태를 바꿨습니다 — 최신 상태로 다시 그립니다.\n확인하고 필요하면 다시 눌러 주세요.', { title: '다른 사람이 먼저 바꿈', isError: true });
            renderStockPanel();
            renderAll();
            showError('fc-error', '다른 사람이 먼저 바꿨습니다. 지금 상태를 확인해 주세요.');
            return;
        }
        renderForecastBox();
        showError('fc-error', '저장 실패: ' + ((e && (e.code || e.message)) || e));
    }
}

function orderTarget() {
    const it = items.find(x => x.id === stockTargetId);
    return it ? { it, order: orderOf(it) } : null;
}

async function forecastOrder() {
    const t = orderTarget();
    if (!t) return;
    const qty = parseQty($('fc-order-qty') && $('fc-order-qty').value);
    if (!qty) return showError('fc-error', '발주 수량을 입력해주세요.');
    const d = todayStr();
    await runForecastAction(() => writeOrder(t.it.id, ['none', 'cancelled', 'received'], () => ({
        status: 'ordered', orderedDate: d, orderedAt: new Date().toISOString(), qty,
        expectedDate: expectedDateFor(d, t.it), by: currentUser
    })));
}

async function forecastReceive() {
    const t = orderTarget();
    if (!t || !t.order) return;
    if (!(await showConfirm('입고된 것으로 표시할까요?\n이지어드민에 입고를 입력했다면 다음 날 아침 자동으로도 확인됩니다.'))) return;
    const d = todayStr();
    await runForecastAction(() => writeOrder(t.it.id, ['ordered'],
        (cur) => ({ ...cur, status: 'received', receivedDate: d, receivedBy: currentUser, evidence: 'manual' }),
        (cur) => ({ itemId: t.it.id, orderedDate: cur.orderedDate || '', receivedDate: d, qty: num(cur.qty) })));
}

async function forecastCancel() {
    const t = orderTarget();
    if (!t || !t.order) return;
    if (!(await showConfirm('다음 날 아침부터 발주 알림이 다시 켜집니다.', { title: '발주를 취소할까요?', okText: '발주 취소하기', cancelText: '그대로 두기', danger: true }))) return;
    await runForecastAction(() => writeOrder(t.it.id, ['ordered'],
        (cur) => ({ ...cur, status: 'cancelled', cancelledAt: new Date().toISOString(), cancelledBy: currentUser })));
}

/** 비품 칸 하나(안전재고·기준 물량)를 저장 — saveStock 과 같은 충돌 처리(창은 닫지 않는다). */
async function saveItemFields(patch) {
    const it = items.find(x => x.id === stockTargetId);
    if (!it) return;
    const next = { ...it, ...patch, updatedAt: new Date().toISOString(), updatedBy: currentUser };
    const idx = items.indexOf(it);
    items[idx] = next;
    try {
        await persist({
            keepModal: true,
            conflictMsg: '다른 사람이 먼저 비품을 바꿔 다시 불러왔습니다.\n방금 바꾼 값은 저장되지 않았습니다 — 확인하고 다시 해 주세요.\n(왼쪽 상세에 입력해 둔 내용은 그대로 있습니다)'
        });
        if ('safetyStock' in patch) {
            $('f-safety').value = num(next.safetyStock) || '';
            takeItemSnapshot(['f-safety']);   // 저장된 값 — 닫기 확인에서 '수정'으로 보지 않는다
        }
        renderStockPanel();
        renderAll();
    } catch (e) {
        if (e.handled) {
            const fresh = items.find(x => x.id === stockTargetId);
            if (!fresh) {
                showAlert('이 비품은 다른 곳에서 삭제되었습니다. 창을 닫습니다.', { isError: true });
                closeModal('item-modal');
                return;
            }
            $('f-stock').value = curStock(fresh);
            renderStockPanel();
            showError('fc-error', '다른 사람이 먼저 바꿔 다시 불러왔습니다. 다시 해 주세요.');
        } else {
            const i = items.indexOf(next);
            if (i >= 0) items[i] = it;
            renderStockPanel();
            showError('fc-error', '저장 실패: ' + (e.message || e));
        }
    }
}

$('fc-box').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || btn.disabled) return;
    if (btn.hasAttribute('data-fc-order')) forecastOrder();
    else if (btn.hasAttribute('data-fc-receive')) forecastReceive();
    else if (btn.hasAttribute('data-fc-cancel')) forecastCancel();
    else if (btn.hasAttribute('data-fc-safety')) saveItemFields({ safetyStock: num(btn.getAttribute('data-fc-safety')) });
});
$('fc-box').addEventListener('change', (e) => {
    if (e.target.id === 'fc-driver') saveItemFields({ forecastDriver: e.target.value });
});
$('fc-box').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'fc-order-qty') { e.preventDefault(); forecastOrder(); }
});

// ───────── 재고 기준 스위치 지켜보기(2026-11-26 리뷰) ─────────
// 열어 둔 탭이 전환·끄기 뒤에도 옛 방식으로 쓰지 않게:
//   (a) 스위치 문서를 구독 — ledgerLive 가 이 탭이 아는 값과 달라지면 띠를 띄우고 다시 불러온다(열린 창은 닫는다)
//   (b) persist 트랜잭션이 스위치를 같이 읽어 다르면 저장하지 않는다(SuppliesConflict 'mode')
//   (c) 원장 쓰기(입출고·되돌리기)·삭제 직전에도 다시 읽어 본다 — 규칙에는 스위치 조건을 넣지 않는다(문서 확인 한도)
let settingsUnsub = null;
let selfSwitching = false;      // 이 탭이 스위치를 바꾸는 중(전환·끄기) — 구독이 '바뀌었습니다' 를 띄우지 않게
let reloadingForMode = false;

// 에뮬레이터 화면 시험용 — 이 탭만 구독을 끈다(열어 둔 낡은 탭 흉내, js/utils.js nativeDialogsForTest 와 같은 조건 + sessionStorage)
const settingsWatchOffForTest = () => {
    try {
        const h = location.hostname;
        return (h === 'localhost' || h === '127.0.0.1') && navigator.webdriver === true && sessionStorage.getItem('test.suppliesNoSettingsWatch') === '1';
    } catch (_) { return false; }
};

function showModeNotice(text) {
    const el = $('ledger-mode-notice');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('hidden', !text);
}

/** 스위치가 바뀌었을 때 — 열린 창을 닫고 다시 불러온다(입력해 두고 저장 안 한 것은 버린다) */
async function reloadForModeChange() {
    if (reloadingForMode) return;
    reloadingForMode = true;
    showModeNotice('재고 기준이 바뀌었습니다 — 다시 불러옵니다.');
    ['item-modal', 'cutover-modal'].forEach(id => { if (!$(id).classList.contains('hidden')) closeModal(id); });
    try {
        await load();
        renderAll();
    } finally {
        reloadingForMode = false;
    }
    showModeNotice(`재고 기준이 바뀌어 다시 불러왔습니다 — 지금: ${ledgerLive ? '앱(입출고 기록)' : '이지어드민 자동 반영'}. 창에 입력해 두고 저장하지 않은 것은 저장되지 않았습니다.`);
}

function watchSettings() {
    if (settingsUnsub || settingsWatchOffForTest()) return;
    settingsUnsub = onSnapshot(SETTINGS_REF, (snap) => {
        const d = snap.exists() ? snap.data() : null;
        if (!firstLoadDone || selfSwitching || reloadingForMode) return;
        if (settingsOk === true && isLive(d) === ledgerLive) { suppliesSettings = d; renderLedgerBar(); return; }
        reloadForModeChange();
    }, (e) => {
        console.warn('[supplies] 재고 기준 구독 실패:', e && e.code);
        settingsUnsub = null;   // 끝난 리스너 — 다음 [새로고침] 뒤 다시 건다
    });
}

/** (c) 원장 쓰기·삭제 직전 — 스위치가 이 탭이 아는 값 그대로인가. 다르면 다시 불러오고 false(읽기 실패는 던진다) */
async function modeStillSame() {
    const s = await getDoc(SETTINGS_REF);
    const d = s.exists() ? s.data() : null;
    if (settingsOk === true && isLive(d) === ledgerLive) return true;
    await reloadForModeChange();
    return false;
}

// ───────── 앱 기준으로 전환·되돌리기(관리자) ─────────
// 전환: ① 스위치 문서에 cutover.batchId 먼저 기록(트랜잭션 — 켜져 있거나 다른 관리자가 막 시작했으면 멈춤)
//       ② 비품마다 실사(commitCount, 같은 batchId — 끊겨도 다시 누르면 남은 것만. CUTOVER_CHECK_EVERY 건마다 스위치 다시 봄)
//       ③ 전부 성공하면 트랜잭션으로 ledgerLive:true·liveAt·liveBy(아직 꺼짐이고 cutover.batchId 가 내 묶음일 때만).
//       빈칸은 건너뜀(앱 재고가 없으면 0 에서 시작).
//   이어 하기: 끝나지 않은 전환이 있으면 같은 batchId. 시작한 지 6시간(CUTOVER_STALE_MS) 넘었으면 '새로 시작'을 묻는다.
//   미리 채우기: 처음 켜는 전환을 이어 할 때만 앱 값(이번에 저장한 값)을 채운다. 다시 켤 때(liveAt 있음)는 칸을 비우고 옛 앱 값은 참고로만.
// 쓰기 권한은 규칙이 본다(suppliesSettings = 관리자만). 화면의 isAdmin 은 단추 표시용.
const CUTOVER_CHECK_EVERY = 5;
let cutoverRunning = false;
let cutoverPlan = null;          // { resume: 이어 할 batchId | null } — openCutover 가 정하고 runCutover 가 쓴다
const kstOf = (v) => { const ms = atMs(v); return Number.isFinite(ms) ? kstDateTime(new Date(ms).toISOString()) : '시각 모름'; };

async function openCutover() {
    if (!isAdmin) return;
    const bad = items.filter(it => !ITEM_ID_RE.test(String(it.id || '')));
    if (bad.length) {
        return showAlert(`비품 ${bad.length}건의 내부 번호 모양이 맞지 않아 전환할 수 없습니다(${bad.slice(0, 5).map(it => it.name).join(', ')}${bad.length > 5 ? ' …' : ''}).\n개발 담당에게 알려 주세요.`, { title: '전환할 수 없음', isError: true });
    }
    let have = {}, cur = null;
    try {
        const [h, s] = await Promise.all([loadStock(db), getDoc(SETTINGS_REF)]);
        have = h; cur = s.exists() ? s.data() : null;
    } catch (e) { return showAlert('앱 재고를 읽지 못했습니다: ' + ((e && (e.code || e.message)) || e), { title: '불러오기 실패', isError: true }); }
    if (isLive(cur)) { await reloadForModeChange(); return; }
    let resume = resumeBatchId(cur);
    if (resume && cutoverStale(cur)) {
        const fresh = await showConfirm(`끝나지 않은 전환이 있습니다 — ${kstOf(cur.cutover.startedAt)} 에 시작(6시간 넘음).\n그 사이 재고가 바뀌었을 수 있습니다. [새로 시작]을 누르면 지금 센 수량으로 처음부터 다시 넣습니다.`,
            { title: '새로 시작할까요?', okText: '새로 시작', cancelText: '이어 하기' });
        if (fresh) resume = null;
    }
    const reEnable = Number.isFinite(atMs(cur && cur.liveAt));
    const prefill = !!resume && !reEnable;   // 처음 켜는 전환을 이어 할 때만 — 이번 묶음에서 저장한 값
    cutoverPlan = { resume };
    const list = [...items].sort((a, b) => String(a.category || '').localeCompare(String(b.category || ''), 'ko') || String(a.name).localeCompare(String(b.name), 'ko'));
    $('cutover-body').innerHTML = list.map(it => {
        const app = have[it.id];
        return `<tr>
            <td class="wrap">${esc(it.name)}</td>
            <td class="num text-slate-500">${esc(fmt(it.stock))} <span class="text-[11px]">${esc(it.unit || '개')}</span></td>
            <td class="num text-slate-500">${app != null ? esc(fmt(app)) : '-'}</td>
            <td class="num"><input type="number" min="0" step="1" inputmode="numeric" class="inp num" style="width:110px;padding:5px 7px" data-cut-id="${esc(it.id)}" value="${prefill && app != null ? esc(String(app)) : ''}" aria-label="${esc(it.name)} 센 수량"></td>
        </tr>`;
    }).join('');
    showError('cutover-error', '');
    showError('cutover-status', resume
        ? `이어 하기 — ${kstOf(cur.cutover.startedAt)} 에 시작한 전환입니다. 이미 저장한 비품은 두 번 들어가지 않습니다.`
        : (reEnable ? '다시 켜기 — 앱 값은 지난번 값(참고)입니다. 지금 센 수량을 넣어 주세요.' : ''));
    openModal('cutover-modal');
}

const CUTOVER_BLOCK_TEXT = {
    live: '다른 관리자가 이미 앱 기준으로 켰습니다 — 다시 불러옵니다.',
    busy: '다른 관리자가 방금 전환을 시작했습니다 — 창을 닫고 잠시 뒤 다시 열어 주세요.',
    changed: '그 사이 다른 관리자가 전환을 새로 시작했습니다 — 창을 닫고 다시 열어 주세요.'
};

async function runCutover() {
    if (cutoverRunning || !isAdmin) return;
    const rows = [...document.querySelectorAll('#cutover-body input[data-cut-id]')];
    const want = [], badRows = [], skippedNames = [];
    for (const el of rows) {
        const id = el.dataset.cutId, v = el.value.trim();
        const it = items.find(x => x.id === id);
        if (!it) continue;
        if (v === '') { skippedNames.push(it.name); continue; }
        if (!/^\d+$/.test(v) || Number(v) > 1000000) { badRows.push(it.name); continue; }
        want.push({ it, n: Number(v) });
    }
    if (badRows.length) return showError('cutover-error', `수량을 0 이상 정수(1,000,000 까지)로 넣어 주세요: ${badRows.join(', ')}`);
    showError('cutover-error', '');
    const SHOW = 15;
    const skipList = skippedNames.slice(0, SHOW).map(n => `· ${n}`).join('\n') + (skippedNames.length > SHOW ? `\n· 외 ${skippedNames.length - SHOW}건` : '');
    const msg = `${want.length}건의 시작 재고를 저장하고 앱 기준으로 바꿉니다.`
        + (skippedNames.length ? `\n빈칸 ${skippedNames.length}건은 건너뜁니다 — 앱 재고가 없는 비품은 0 에서 시작합니다.\n${skipList}` : '')
        + '\n저장 뒤에는 이지어드민 자동 반영이 이 화면 재고에 쓰이지 않습니다.';
    if (!(await showConfirm(msg, { title: '앱 기준으로 전환할까요?', okText: '저장하고 전환' }))) return;

    cutoverRunning = true;
    selfSwitching = true;
    const btn = $('btn-cutover-save');
    btn.disabled = true;
    const me = ledgerMe();
    const status = (t) => showError('cutover-status', t);
    const stop = async (why) => {
        showError('cutover-error', CUTOVER_BLOCK_TEXT[why] || '저장하지 못했습니다.');
        if (why === 'live') { selfSwitching = false; await reloadForModeChange(); }
    };
    try {
        const plan = cutoverPlan || { resume: null };
        const batchId = plan.resume || newBatchId();
        // ① 전환 시작 — 트랜잭션(켜져 있거나 남이 막 시작한 전환이 있으면 쓰지 않는다)
        const block = await runTransaction(db, async (tx) => {
            const s = await tx.get(SETTINGS_REF);
            const b = cutoverStartBlock(s.exists() ? s.data() : null, plan.resume, Date.now());
            if (b) return b;
            if (!plan.resume) tx.set(SETTINGS_REF, { ledgerLive: false, cutover: { batchId, startedAt: serverTimestamp() }, updatedAt: serverTimestamp() }, { merge: true });
            return null;
        });
        if (block) return await stop(block);
        cutoverPlan = { resume: batchId };   // 이 창에서 다시 누르면 같은 묶음으로 이어 한다
        // ② 비품마다 실사
        const failed = [], differ = [];
        let saved = 0, same = 0;
        for (let i = 0; i < want.length; i++) {
            if (i > 0 && i % CUTOVER_CHECK_EVERY === 0) {
                const s = await getDoc(SETTINGS_REF);
                const b = liveOnBlock(s.exists() ? s.data() : null, batchId);
                if (b) return await stop(b);
            }
            const { it, n } = want[i];
            status(`저장 중 ${i + 1}/${want.length}`);
            try {
                const r = await commitCount(db, it.id, n, me, batchId);
                if (!r.ok) failed.push(`${it.name}(${ledgerErrorText(r)})`);
                else if (r.already) {
                    // 이번 전환에서 이미 저장했는데 값을 바꿔 다시 누름 — 저장된 값을 그대로 둔다(켠 뒤 실사로 맞춤)
                    const now = await loadStockOf(db, it.id);
                    if (now !== n) differ.push(`${it.name}(저장된 값 ${fmt(now)})`); else same++;
                } else if (r.entry) saved++;
                else same++;
            } catch (e) {
                failed.push(`${it.name}(${(e && e.code) || '연결 확인'})`);
            }
        }
        if (failed.length) {
            status(`저장 ${saved}건 · 그대로 ${same}건 · 못 함 ${failed.length}건`);
            showError('cutover-error', `${failed.length}건을 저장하지 못해 아직 켜지 않았습니다 — [시작 재고 저장]을 다시 누르면 남은 것만 저장합니다.\n${failed.join('\n')}`);
            return;
        }
        // ③ 켜기 — 트랜잭션(아직 꺼짐이고 내 묶음일 때만)
        const onBlock = await runTransaction(db, async (tx) => {
            const s = await tx.get(SETTINGS_REF);
            const b = liveOnBlock(s.exists() ? s.data() : null, batchId);
            if (b) return b;
            tx.set(SETTINGS_REF, { ledgerLive: true, liveAt: serverTimestamp(), liveBy: me.email, updatedAt: serverTimestamp() }, { merge: true });
            return null;
        });
        if (onBlock) return await stop(onBlock);
        cutoverPlan = null;
        closeModal('cutover-modal');
        await load();
        renderAll();
        showModeNotice('');
        showAlert(`앱 기준으로 켰습니다 — 저장 ${saved}건 · 같은 값 ${same}건 · 빈칸 ${skippedNames.length}건.`
            + (differ.length ? `\n\n아래는 이번 전환에서 먼저 저장한 값이 남아 있습니다(바꾼 값은 안 들어감) — 재고 패널에서 실사로 맞춰 주세요.\n${differ.join('\n')}` : ''),
            { title: '전환 완료' });
    } catch (e) {
        showError('cutover-error', '저장하지 못했습니다: ' + ((e && (e.code || e.message)) || e) + '\n다시 누르면 이어서 저장합니다.');
    } finally {
        cutoverRunning = false;
        selfSwitching = false;
        btn.disabled = false;
    }
}

async function ledgerOff() {
    if (!isAdmin || !ledgerLive) return;
    if (!(await showConfirm('이지어드민 기준으로 되돌리면 이 화면 재고가 비품 문서 값(이지어드민 자동 반영)으로 돌아갑니다.\n앱에서 한 입출고는 그 값에 들어 있지 않습니다. 비상용입니다.\n앱 입출고 기록은 지워지지 않습니다.',
        { title: '이지어드민 기준으로 되돌릴까요?', okText: '되돌리기', danger: true }))) return;
    selfSwitching = true;
    try {
        try {
            await setDoc(SETTINGS_REF, { ledgerLive: false, updatedAt: serverTimestamp() }, { merge: true });
        } catch (e) {
            return showAlert('바꾸지 못했습니다: ' + ((e && (e.code || e.message)) || e), { title: '저장 실패', isError: true });
        }
        if (!$('item-modal').classList.contains('hidden')) closeModal('item-modal');
        await load();
        renderAll();
        showModeNotice('');
    } finally {
        selfSwitching = false;
    }
}

$('btn-ledger-cutover').addEventListener('click', openCutover);
$('btn-ledger-off').addEventListener('click', ledgerOff);
$('btn-cutover-save').addEventListener('click', runCutover);

// 재고 패널 — 단위 단추·이력 [되돌리기]·[더 보기]
$('stock-units').addEventListener('click', (e) => {
    const b = e.target.closest('[data-stock-unit]');
    if (!b) return;
    stockUnitQty = Number(b.dataset.stockUnit) || 1;
    renderStockUnits();
    updateStockPreview();
});
$('stock-log').addEventListener('click', (e) => {
    const b = e.target.closest('[data-revert]');
    if (b && !b.disabled) revertLedgerEntry(b.dataset.revert);
});
$('btn-stock-log-more').addEventListener('click', loadMoreLedger);

// 상세 폼 — 바코드 칩·단위 표 기본 단위 글자
$('btn-barcode-add').addEventListener('click', addBarcodeFromInput);
$('f-barcode-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addBarcodeFromInput(); } });
$('f-barcodes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-barcode-del]');
    if (!b) return;
    formBarcodes.splice(Number(b.dataset.barcodeDel), 1);
    renderBarcodeChips();
});
$('f-unit').addEventListener('input', renderUnitBaseLabel);

// 목록 검색칸에 바코드를 찍고 Enter — 그 비품 상세 창(바코드가 없는 비품은 그냥 검색)
$('filter-search').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const it = findByBarcode(items, e.target.value);
    if (!it) return;
    e.preventDefault();
    opener = null;
    openItemModal(it.id);
});

// ───────── 모달 공통 ─────────
function openModal(id) { const m = $(id); m.classList.remove('hidden'); m.classList.add('flex'); }
function closeModal(id) {
    const m = $(id);
    m.classList.add('hidden'); m.classList.remove('flex');
    if (id === 'item-modal') restoreOpenerFocus();
}

// 상세 창을 연 행·카드(data-open). 닫은 뒤 목록이 다시 그려졌을 수 있어 요소가 아니라 id 와 위치로 기억한다.
let opener = null;   // { id, host: 'items-body' | 'main-items' | 'alert-notice' }
function rememberOpener(el) {
    const host = el.closest('#items-body') ? 'items-body' : (el.closest('#main-items') ? 'main-items' : (el.closest('#alert-notice') ? 'alert-notice' : null));
    opener = host ? { id: el.dataset.open, host } : null;
}
function restoreOpenerFocus() {
    const o = opener;
    opener = null;
    if (!o) return;
    // 저장·삭제 뒤 renderAll 이 같은 흐름에서 다시 그리므로, 그다음 차례에 찾는다
    setTimeout(() => {
        const el = $(o.host)?.querySelector(`[data-open="${CSS.escape(o.id)}"]`);
        if (el) el.focus();
    }, 0);
}
function showError(id, msg) { const el = $(id); el.textContent = msg; el.classList.toggle('hidden', !msg); }
/** findDuplicateCode 결과 → 안내 글 */
const codeDupText = (d) => (d.item ? `비품코드 ${d.code} 는 '${d.item.name || '(이름 없음)'}' 이(가) 이미 쓰고 있습니다.` : `비품코드 ${d.code} 를 두 번 적었습니다.`);

// ───────── 이벤트 ─────────
$('btn-add-item').addEventListener('click', () => { opener = null; openItemModal(null); });
$('btn-save-item').addEventListener('click', saveItem);
$('btn-delete-item').addEventListener('click', deleteItem);
$('btn-save-stock').addEventListener('click', saveStock);
$('btn-refresh').addEventListener('click', async () => { await load(); renderAll(); });
$('btn-close').addEventListener('click', () => goHome());   // '닫기' → '홈으로'(2026-10-16, 같은 탭 이동)
$('btn-reset-filters').addEventListener('click', resetAllFilters);

['filter-category', 'filter-search', 'filter-low', 'filter-order'].forEach(id => {
    $(id).addEventListener('input', renderTable);
    $(id).addEventListener('change', renderTable);
});

// MOQ는 입력을 마치면 천 단위 쉼표를 찍어 보여준다.
$('f-order-unit').addEventListener('blur', (e) => { e.target.value = withThousands(e.target.value); });

$('stock-qty').addEventListener('input', updateStockPreview);
document.querySelectorAll('input[name="stock-op"]').forEach(r => r.addEventListener('change', () => { renderStockUnits(); updateStockPreview(); }));

// 요약 카드(재고 부족·발주 필요) — 목록 체크박스를 뒤집는다(눌림 표시는 renderTable 이 맞춘다)
$('summary').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sum-filter]');
    if (!btn) return;
    const box = $(btn.dataset.sumFilter === 'low' ? 'filter-low' : 'filter-order');
    box.checked = !box.checked;
    renderTable();
});

// ×·[취소]·ESC(js/modal-esc.js 가 × 를 누른다) — 상세 창에 저장 안 한 수정이 있으면 묻는다
document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', async () => {
        const m = btn.closest('.fixed');
        if (!m) return;
        if (m.id === 'item-modal' && isItemDirty() && !(await showConfirm('저장하지 않은 수정이 있습니다. 닫을까요?'))) return;
        closeModal(m.id);
    });
});

// ───────── 행·카드 열기 — 목록 행 / 주요 비품 카드(data-open)를 누르면 상세 창 ─────────
// capture 단계에서 본다: 헤더 필터 팝업이 열린 채 행을 누른 것은 '팝업 닫기'로만 쓰이게(창은 열지 않음).
// 팝업 닫기 자체는 위의 기존 click 리스너가 그대로 한다.
document.addEventListener('click', (e) => {
    const row = e.target.closest('[data-open]');
    if (!row) return;
    if (document.querySelector('.flt-pop')) return;
    // 표 글자를 끌어서 고른 경우(복사하려는 것)는 창을 열지 않는다
    const sel = window.getSelection && window.getSelection();
    if (sel && !sel.isCollapsed && row.contains(sel.anchorNode)) return;
    rememberOpener(row);
    openItemModal(row.dataset.open);
}, true);

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest && e.target.closest('[data-open]');
    if (!row || row !== e.target) return;   // 행·카드 자체에 포커스가 있을 때만
    e.preventDefault();                     // Space 로 목록이 스크롤되지 않게
    closeFilterPop();
    rememberOpener(row);
    openItemModal(row.dataset.open);
});

// 재고 패널의 [엑셀로 재고 맞추기] — 지금 보고 있는 비품에 현재고조회 엑셀을 올린다
$('btn-stock-excel').addEventListener('click', () => {
    if (!stockTargetId) return;
    pendingUploadId = stockTargetId;
    $('stock-file').value = '';   // 같은 파일을 다시 골라도 change가 뜨도록
    $('stock-file').click();
});

$('stock-file').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleStockFile(file);
});
