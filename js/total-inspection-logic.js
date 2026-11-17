// === js/total-inspection-logic.js ===
// 전량검수 '진행 목록'(2026-11-17 사용자 결정) — 끝날 때까지 남는 목록 + 고른 줄의 오늘 수량 누적 저장.
// 읽기: artifacts/team-work-logger-v2/total_inspections_accumulated where status == '진행중' (창이 열린 동안만 onSnapshot, 닫으면 해제)
//       + [완료 보기]를 켠 동안만 status == '완료'(최대 DONE_LIMIT).
// 쓰기(모두 runTransaction — 서버 값을 읽고 그 위에 더한다):
//   · 넣기(개별 추가·샘플에서 전환): 없으면 새 문서, 진행중이면 그 줄 열기, 완료면 회차 +1(누적 0).
//   · 저장: 누적 문서 + 기록 total_inspection_logs/{saveId}(있으면 건너뜀 — 다시 눌러도 두 번 더하지 않음)
//           + daily_data/{오늘}.taskQuantities[전량검수 이름] 같이(set+merge 중첩 맵 + increment — daily_data 는 읽지 않는다.
//           점 경로 문자열은 쓰지 않는다 — tests/task-qty-fieldpath.test.js). 화면 처리량은 구독이 바꾼다(직접 더하지 않음).
//           옛 문서(status 없음)는 넣을 때 진행중으로 보고 빠진 칸만 채운다(누적 유지). 같은 키에 다른 상품(옵션 원문 다름)이면 넣지 않는다.
//           누적이 총 재고를 넘으면 막고, 닿으면 자동 완료. (예전의 daily_data/{날짜}/total_inspection_logs 하위 쓰기는 없앴다)
//   · [완료 처리]·[다시 진행]·[목록에서 빼기](누적 0 인 줄만).
// 순수 규칙은 js/lib/total-insp.js. 공급처는 코드만(supplierCode) — 이름 칸은 쓰지 않는다(CLAUDE.md 3절).
// ⚠️ 이 창은 index.html·history.html 에 붙는다 — role="dialog"·data-act·end-shift-* 를 쓰지 않는다(업무마감봇 선택자).
import * as DOM from './dom-elements.js?v=202611171714';
import * as State from './state.js?v=202611171714';
import { showToast, getTodayDateString, getCurrentTime, escapeHtml, showConfirm } from './utils.js?v=202611171714';
import {
    doc, getDoc, collection, query, where, limit as fsLimit, onSnapshot, runTransaction, serverTimestamp, increment, deleteField
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { TASK, tName } from './task-names.js?v=202611171714';
import { openManualAdd } from './inspection-manual.js?v=202611171714';
import { S as PS, loadLoc, locOf, fmtDateTime, tsMs } from './products-store.js?v=202611171714';   // [재고 연동] — 위치·재고 요약(ProductLoc, IndexedDB 캐시 같이 씀)
import { getCurrentInspItem } from './inspection-logic.js?v=202611171714';
import { listKeyLogs, removeOrRevertOne } from './total-insp-edit.js?v=202611171714';   // 잘못 연 회차 되돌리기(직전 회차 기록 합산)
import {
    ON, DONE, canRevertRound, reopenConfirmText, isDoneToday, totalKey, startOrReopen, applySave, applyInfoSave, isInfoOnly, periodLabel, ymd, markDone, markReopen, progressOf, todayQtyOf,
    sortList, nextOnKey, filterRows, exactRow, logOf, fromSampleItem, stockFromLoc, infoChangedLabels, stockBasisText, removePlan, removeCounts, removeMessage
} from './lib/total-insp.js?v=202611171714';

const APP = ['artifacts', 'team-work-logger-v2'];
const COL = 'total_inspections_accumulated';
const LOG_COL = 'total_inspection_logs';
const DONE_LIMIT = 200;
const SAVE_LABEL = '저장';   // 오늘 수량이 있든 없든 같은 글자(2026-11-17 사용자 요청) — 무엇이 저장됐는지는 저장 뒤 토스트로

let rowsOn = [];             // 진행중 문서 [{ id, ...data }]
let rowsDone = [];           // [완료 보기]를 켠 동안의 완료 문서
let rowsToday = [];          // 오늘 완료된 문서 — 목록 맨 아래에 흐리게 남긴다(다음 날부터는 [완료 보기]에서만, 2026-11-17)
let unsubToday = null;
let todayKey = '';           // 구독한 날짜(자정을 넘기면 다시 구독)
let loadedOn = false;
let listError = '';
let showDone = false;
let unsubOn = null;
let unsubDone = null;
let selectedId = '';
let pendingSelect = '';      // 넣은 뒤 구독이 그 줄을 가져오면 고른다
let pendingSave = null;      // { id, saveId, date, time } — 실패 뒤 다시 눌러도 같은 기록(중복 방지). 줄이 바뀌거나 성공하면 비움
let saving = false;
let acting = false;          // 완료 처리·다시 진행·빼기 중
let filterTerm = '';
let modalObs = null;
let listCollapsed = false;   // 휴대폰 목록 접기(.total-insp-collapsed — css/style.css, PC 에선 접기 버튼이 숨어 있다)

const colRef = () => collection(State.db, ...APP, COL);
const docRef = (id) => doc(State.db, ...APP, COL, id);
const logRef = (saveId) => doc(State.db, ...APP, LOG_COL, saveId);
const dayRef = () => doc(State.db, ...APP, 'daily_data', getTodayDateString());
const me = () => String((State.appState && State.appState.currentUser) || '');
const nowIso = () => new Date().toISOString();
const newSaveId = () => (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const num = (el) => {
    if (!el || String(el.value).trim() === '') return null;
    const n = Number(el.value);
    return Number.isFinite(n) ? Math.trunc(n) : null;
};
const isTouch = () => typeof matchMedia === 'function' && matchMedia('(max-width:768px), (pointer:coarse)').matches;
const failMsg = (e, fallback) => (e && e.code === 'permission-denied' ? '권한이 없습니다.' : fallback);

/** 화면 목록 — 진행중 + 오늘 완료(+ [완료 보기]면 완료 전부). 같은 문서는 한 번(진행중 > 오늘 완료 > 완료 순). */
const mergeRows = (...lists) => {
    const seen = new Set();
    return lists.flat().filter(r => r && !seen.has(r.id) && seen.add(r.id));
};
const todayDone = () => rowsToday.filter(r => isDoneToday(r, getTodayDateString()));   // 자정이 지나면 화면에서 빠진다
const allRows = () => sortList(mergeRows(rowsOn, todayDone(), showDone ? rowsDone : []));
const rowById = (id) => (id ? (rowsOn.find(r => r.id === id) || rowsToday.find(r => r.id === id) || rowsDone.find(r => r.id === id) || null) : null);
const isModalOpen = () => !!(DOM.totalInspModal && !DOM.totalInspModal.classList.contains('hidden'));

// ── 구독 ─────────────────────────────────────────────────────────────
function subscribeOn() {
    if (unsubOn || !State.db) return;
    loadedOn = false;
    listError = '';
    renderList();
    unsubOn = onSnapshot(query(colRef(), where('status', '==', ON)), (snap) => {
        rowsOn = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        loadedOn = true;
        listError = '';
        afterRowsChanged();
    }, (err) => {
        console.error('[전량검수] 진행 목록 읽기 실패:', err && err.code ? err.code : err);
        listError = failMsg(err, '진행 목록을 읽지 못했습니다. 창을 닫았다가 다시 열어 주세요.');
        unsubOn = null;
        renderList();
    });
}

/** 오늘 완료된 문서 — status 완료 && endDate 오늘(같음 조건 둘 — 단일 필드 색인으로 된다). 창이 열린 동안만. */
function subscribeToday() {
    const today = getTodayDateString();
    if (unsubToday && todayKey === today) return;
    if (unsubToday) { unsubToday(); unsubToday = null; }
    if (!State.db) return;
    todayKey = today;
    unsubToday = onSnapshot(query(colRef(), where('status', '==', DONE), where('endDate', '==', today)), (snap) => {
        rowsToday = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        afterRowsChanged();
    }, (err) => {
        console.warn('[전량검수] 오늘 완료 읽기 실패(목록에서 바로 빠집니다):', err && err.code ? err.code : err);
        rowsToday = [];
        unsubToday = null;
        afterRowsChanged();
    });
    // 날짜가 바뀌면(창을 연 채 자정을 넘김) 오늘 완료 구독을 다시 — 1분마다 확인, 창이 닫히면 멈춘다(리뷰 5)
    if (!todayTimer) {
        todayTimer = setInterval(() => {
            if (!isModalOpen()) return;
            if (getTodayDateString() !== todayKey) { subscribeToday(); afterRowsChanged(); }
        }, 60 * 1000);
    }
}
let todayTimer = null;

function subscribeDone() {
    if (unsubDone || !State.db) return;
    unsubDone = onSnapshot(query(colRef(), where('status', '==', DONE), fsLimit(DONE_LIMIT)), (snap) => {
        rowsDone = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        afterRowsChanged();
    }, (err) => {
        console.error('[전량검수] 완료 목록 읽기 실패:', err && err.code ? err.code : err);
        showToast(failMsg(err, '완료 목록을 읽지 못했습니다.'), true);
        unsubDone = null;
    });
}

function unsubscribeDone() {
    if (unsubDone) { unsubDone(); unsubDone = null; }
    rowsDone = [];
}

function unsubscribeAll() {
    if (unsubOn) { unsubOn(); unsubOn = null; }
    if (unsubToday) { unsubToday(); unsubToday = null; }
    if (todayTimer) { clearInterval(todayTimer); todayTimer = null; }
    rowsToday = [];
    todayKey = '';
    unsubscribeDone();
    rowsOn = [];
    loadedOn = false;
}

/** 창이 닫히면(× · 닫기 · ESC · 돌아가기 — 어느 길이든) 구독을 푼다. */
function watchModal() {
    if (modalObs || !DOM.totalInspModal || typeof MutationObserver === 'undefined') return;
    modalObs = new MutationObserver(() => {
        if (!isModalOpen()) onClosed();
    });
    modalObs.observe(DOM.totalInspModal, { attributes: true, attributeFilter: ['class'] });
}

function onClosed() {
    unsubscribeAll();
    selectedId = '';
    pendingSelect = '';
    pendingSave = null;
    filterTerm = '';
    showDone = false;
    if (DOM.totalInspShowDone) DOM.totalInspShowDone.checked = false;
    if (DOM.totalInspProductName) DOM.totalInspProductName.value = '';
    if (DOM.totalInspContentArea) DOM.totalInspContentArea.classList.add('hidden');
    setListCollapsed(false);
}

/** 휴대폰 목록 접기 — 샘플검수 대기 리스트 접기(js/inspection-logic.js toggleTodoCollapsed)와 같은 방식. */
function setListCollapsed(on) {
    listCollapsed = !!on;
    if (DOM.totalInspPanel) DOM.totalInspPanel.classList.toggle('total-insp-collapsed', listCollapsed);
    if (DOM.totalInspToggle) {
        DOM.totalInspToggle.textContent = listCollapsed ? `목록 ${rowsOn.length}건 ▾` : '접기 ▴';
        DOM.totalInspToggle.setAttribute('aria-expanded', listCollapsed ? 'false' : 'true');
    }
}
export const toggleTotalListCollapsed = () => setListCollapsed(!listCollapsed);

function afterRowsChanged() {
    if (pendingSelect && rowById(pendingSelect)) {
        const id = pendingSelect;
        pendingSelect = '';
        selectRow(id);
        return;
    }
    if (selectedId && !rowById(selectedId) && !saving) {
        // 다른 기기에서 완료·빼기 — 고른 줄이 목록에서 사라졌다
        selectedId = '';
        pendingSave = null;
        if (DOM.totalInspContentArea) DOM.totalInspContentArea.classList.add('hidden');
        setListCollapsed(false);   // 휴대폰: 고른 줄이 없어지면 접힌 목록을 펼친다(찾기·개별 추가가 보이게)
    }
    renderList();
    renderSelected(false);
}

// ── 화면 ─────────────────────────────────────────────────────────────
function rowHtml(r, today) {
    const p = progressOf(r);
    const done = r.status === DONE;
    const sel = r.id === selectedId;
    const tq = todayQtyOf(r, today);
    const stock = p.total > 0
        ? `<span class="font-bold text-gray-800">${escapeHtml(p.acc.toLocaleString())} / ${escapeHtml(p.total.toLocaleString())}</span> <span class="text-gray-500">(${escapeHtml(p.pct)}%)</span>`
        : `<span class="font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5">검수수량 미입력</span>`;
    const tags = [
        done ? `<span class="text-[11px] font-bold bg-sky-100 text-sky-800 rounded px-1.5 py-0.5">${r.stopped ? '완료(중단)' : '완료 ✓'}${ymd(r.endDate) ? ` (${escapeHtml(r.endDate)})` : ''}</span>` : '',
        Number(r.round) > 1 ? `<span class="text-[11px] font-bold bg-purple-50 text-purple-800 border border-purple-200 rounded px-1.5 py-0.5">${escapeHtml(r.round)}회차</span>` : '',
        r.origin === 'sample' ? '<span class="text-[11px] font-bold bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">샘플에서</span>' : '',
        tq > 0 ? `<span class="text-[11px] font-bold bg-green-50 text-green-800 border border-green-200 rounded px-1.5 py-0.5">오늘 ${escapeHtml(tq.toLocaleString())}개</span>` : '',
    ].join('');
    const bar = p.pct == null ? '' : `<div class="h-1.5 bg-gray-100 rounded-full mt-1.5 overflow-hidden"><div class="h-full ${done ? 'bg-sky-500' : 'bg-purple-500'}" style="width:${Number(p.pct) || 0}%"></div></div>`;
    const del = done ? '' : `<button type="button" data-total-del="${escapeHtml(r.id)}" title="목록에서 내리기" aria-label="목록에서 내리기"
            class="flex-shrink-0 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded min-h-[44px] min-w-[36px] flex items-center justify-center text-lg leading-none">×</button>`;
    return `<div class="flex items-stretch border rounded-lg ${sel ? 'border-purple-500 bg-purple-50' : 'border-gray-200 bg-white hover:bg-gray-50'} ${done ? 'opacity-80' : ''}">
        <button type="button" data-total-key="${escapeHtml(r.id)}" aria-pressed="${sel ? 'true' : 'false'}" class="flex-1 min-w-0 text-left px-3 py-2 min-h-[44px]">
            <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                    <div class="font-bold text-sm text-gray-900 break-words">${escapeHtml(r.name || '-')}</div>
                    <div class="text-xs text-gray-600 break-words">${escapeHtml(r.option || '옵션 없음')}${r.reason ? ` · ${escapeHtml(r.reason)}` : ' · <span class="text-red-600 font-bold">사유 미입력</span>'}</div>
                </div>
                <div class="text-xs text-right flex-shrink-0">${stock}</div>
            </div>
            ${bar}
            ${tags ? `<div class="flex flex-wrap gap-1 mt-1.5">${tags}</div>` : ''}
        </button>${del}
    </div>`;
}

function renderList() {
    const box = DOM.totalInspList;
    if (DOM.totalInspListCount) DOM.totalInspListCount.textContent = String(rowsOn.length);
    if (DOM.totalInspClearBtn) DOM.totalInspClearBtn.disabled = acting || saving || rowsOn.length === 0;
    if (listCollapsed) setListCollapsed(true);   // 접힘 글자의 건수
    const status = DOM.totalInspListStatus;
    if (status) {
        status.textContent = listError || (!loadedOn ? '진행 목록 불러오는 중…' : '');
        status.classList.toggle('text-red-600', !!listError);
    }
    if (!box) return;
    const rows = filterRows(allRows(), filterTerm);
    if (!loadedOn && !rows.length) { box.innerHTML = ''; return; }
    if (!rows.length) {
        box.innerHTML = `<div class="text-sm text-gray-400 text-center border border-dashed border-gray-300 rounded-lg py-6">${
            filterTerm ? '찾는 상품이 목록에 없습니다 — [찾아서 추가]나 Enter 로 상품을 찾아 넣으세요.' : '진행 중인 전량검수가 없습니다. 위 칸에 상품명·코드·바코드를 넣고 [찾아서 추가]를 누르세요.'}</div>`;
        return;
    }
    const today = getTodayDateString();
    box.innerHTML = rows.map(r => rowHtml(r, today)).join('');
}

/** 고른 줄 표시. fill = 입력칸도 문서 값으로 채운다(줄을 고를 때만 — 구독 갱신 때는 입력 중인 값을 지우지 않는다). */
function renderSelected(fill) {
    const area = DOM.totalInspContentArea;
    const r = rowById(selectedId);
    if (!area) return;
    if (DOM.totalInspEmptyRight) DOM.totalInspEmptyRight.classList.toggle('hidden', !!r);
    if (!r) { area.classList.add('hidden'); return; }
    area.classList.remove('hidden');
    const done = r.status === DONE;
    if (DOM.totalInspSelName) DOM.totalInspSelName.textContent = r.name || '-';
    if (DOM.totalInspSelMeta) {
        DOM.totalInspSelMeta.textContent = [
            `${Math.max(1, Number(r.round) || 1)}회차`,
            done ? (r.stopped ? '완료(중단)' : '완료') : '진행중',
            `검수 ${periodLabel(r.startDate, r.endDate)}`,
            r.supplierCode ? `공급처 ${r.supplierCode}` : '',
            r.createdBy ? `넣은 사람 ${r.createdBy}` : '',
            ymd(r.inboundDate) ? `입고 ${r.inboundDate}` : '',   // 옛 문서의 입고일 — 읽기만(새로 쓰지 않음)
        ].filter(Boolean).join(' · ');
    }
    if (DOM.totalInspCode) DOM.totalInspCode.textContent = r.code || '-';
    if (DOM.totalInspOption) DOM.totalInspOption.textContent = r.option || '-';
    if (DOM.totalInspEndDate) DOM.totalInspEndDate.textContent = ymd(r.endDate) || (done ? '-' : '진행 중');
    if (DOM.totalInspAccumulated) {
        DOM.totalInspAccumulated.textContent = (Number(r.accumulatedTotal) || 0).toLocaleString();
    }
    // 누적 칸 — 합계(/ 총 재고) 크게, 정상·불량 따로(2026-11-17 사용자 요청: 더 눈에 띄게)
    if (DOM.totalInspAccStock) DOM.totalInspAccStock.textContent = ` / ${Number(r.totalStock) > 0 ? Number(r.totalStock).toLocaleString() : '-'}`;
    if (DOM.totalInspAccNormal) DOM.totalInspAccNormal.textContent = (Number(r.accumulatedNormal) || 0).toLocaleString();
    if (DOM.totalInspAccDefective) DOM.totalInspAccDefective.textContent = (Number(r.accumulatedDefective) || 0).toLocaleString();
    if (fill) {
        setStockNote('');
        if (DOM.totalInspReason) DOM.totalInspReason.value = r.reason || '';
        if (DOM.totalInspTotalStock) DOM.totalInspTotalStock.value = Number(r.totalStock) > 0 ? String(r.totalStock) : '';
        if (DOM.totalInspLocation) DOM.totalInspLocation.value = r.location || '';
        if (DOM.totalInspStartDate) DOM.totalInspStartDate.value = ymd(r.startDate) || getTodayDateString();   // 비었으면(옛 문서) 오늘 — 저장 때 들어간다
        if (DOM.totalInspTodayNormal) DOM.totalInspTodayNormal.value = '';
        if (DOM.totalInspTodayDefective) DOM.totalInspTodayDefective.value = '';
    }
    [DOM.totalInspReason, DOM.totalInspTotalStock, DOM.totalInspLocation, DOM.totalInspStartDate,
        DOM.totalInspTodayNormal, DOM.totalInspTodayDefective].forEach(el => { if (el) el.disabled = done; });
    if (DOM.totalInspDoneNote) DOM.totalInspDoneNote.classList.toggle('hidden', !done);
    if (DOM.totalInspSaveBtn) {
        DOM.totalInspSaveBtn.disabled = saving || done || stockBusy;   // [재고 연동] 불러오는 중엔 저장 막음
    }
    updateSaveLabel();
    if (DOM.totalInspDoneBtn) { DOM.totalInspDoneBtn.classList.toggle('hidden', done); DOM.totalInspDoneBtn.disabled = acting || saving; }
    if (DOM.totalInspReopenBtn) { DOM.totalInspReopenBtn.classList.toggle('hidden', !done); DOM.totalInspReopenBtn.disabled = acting || saving; }
    if (DOM.totalInspStockSyncBtn) {
        // 상품코드가 없는 줄(직접 입력에서 코드를 안 적음)은 찾을 수 없다
        const noCode = !String(r.code || '').trim();
        DOM.totalInspStockSyncBtn.disabled = done || saving || stockBusy || noCode;
        DOM.totalInspStockSyncBtn.title = noCode ? '상품코드가 없는 줄이라 재고를 찾을 수 없습니다' : '앱에 있는 재고 요약으로 검수수량 칸을 채웁니다(저장은 [저장])';
    }
    updateTotalInspRemaining();
}

/** 남은 수량 — 입력 중인 총 재고·오늘 수량으로. 넘으면 빨간 글자. */
/** 저장 버튼 글자 — 늘 '저장'(저장 중엔 '저장 중…'). 오늘 수량이 없으면 검수수량·정보만 저장하는 동작은 그대로. */
function updateSaveLabel() {
    if (!DOM.totalInspSaveBtn) return;
    DOM.totalInspSaveBtn.textContent = saving ? '저장 중…' : SAVE_LABEL;
}

export function updateTotalInspRemaining() {
    updateSaveLabel();
    const r = rowById(selectedId);
    const el = DOM.totalInspRemaining;
    if (!el) return;
    if (!r) { el.textContent = '-'; return; }
    const stock = num(DOM.totalInspTotalStock);
    const today = (num(DOM.totalInspTodayNormal) || 0) + (num(DOM.totalInspTodayDefective) || 0);
    const p = progressOf({ ...r, totalStock: stock == null ? r.totalStock : stock }, today);
    el.textContent = p.remaining == null ? '-' : String(p.remaining);
    el.classList.toggle('text-red-500', p.over);
    el.classList.toggle('text-blue-700', !p.over);
}

function selectRow(id) {
    if (saving) return;
    if (!rowById(id)) return;
    if (selectedId !== id) pendingSave = null;
    selectedId = id;
    if (isTouch()) setListCollapsed(true);   // 휴대폰: 줄을 고르면 목록을 접어 입력 칸이 보이게(샘플검수와 같게)
    renderList();
    renderSelected(true);
    const r = rowById(id);
    if (DOM.totalInspContentArea) DOM.totalInspContentArea.scrollIntoView({ block: 'start' });
    if (r && r.status !== DONE && !isTouch()) {
        const first = !(Number(r.totalStock) > 0) ? DOM.totalInspTotalStock : DOM.totalInspTodayNormal;
        if (first) first.focus();
    }
}

// ── 열기 ─────────────────────────────────────────────────────────────
/** 전량검수 창을 연다(대시보드 [전량검수 창 열기]·업무 시작·샘플에서 전환). selectId 가 있으면 그 줄을 고른다(구독이 가져오면). */
export function openTotalInspection({ selectId = '' } = {}) {
    if (!DOM.totalInspModal) return;
    watchModal();
    DOM.totalInspModal.classList.remove('hidden');
    subscribeOn();
    subscribeToday();
    if (selectId) {
        if (rowById(selectId)) selectRow(selectId); else pendingSelect = selectId;
    }
    renderList();
    if (!selectId && !isTouch() && DOM.totalInspProductName) DOM.totalInspProductName.focus();
}

export function closeTotalInspection() {
    if (DOM.totalInspModal) DOM.totalInspModal.classList.add('hidden');
    onClosed();   // MutationObserver 가 없는 환경 대비(두 번 불러도 같다)
}

// ── 넣기(개별 추가·샘플에서 전환) ─────────────────────────────────────
/** 진행 목록에 넣는다 — 개별 추가 창(onAdd)과 샘플 전환이 같이 쓴다. 창을 닫은 뒤 부를 함수를 돌려준다.
 *  stay = 개별 추가 창의 바로 넣기(창을 열어 둔 채 다음 스캔) — 토스트만 하고 줄은 열지 않는다(목록은 구독이 바꾼다). 돌려준 함수는 안내 글자를 돌려준다. */
async function addItems(items, { reason = '', stay = false, label = '' } = {}) {
    const seen = new Set();
    const list = (Array.isArray(items) ? items : []).map(it => ({ it, id: it ? totalKey(it.name, it.option) : '' }))
        .filter(x => x.id && !seen.has(x.id) && seen.add(x.id));
    if (!list.length) throw Object.assign(new Error('넣을 상품 없음'), { userMessage: '넣을 상품이 없습니다.' });
    // 완료된 상품을 다시 넣으면 새 회차가 된다 — 먼저 묻는다(2026-11-17 사용자 신고: 모르고 다시 넣어 2회차가 됨).
    //   연속 스캔(stay)에는 확인창을 띄우지 않고 넣지 않는다(토스트). 확인한 것만 트랜잭션에서 새 회차로 연다.
    const pre = await Promise.all(list.map(x => getDoc(docRef(x.id)).then(sn => (sn.exists() ? sn.data() : null)).catch(() => null)));
    const doneIdx = pre.map((c, i) => (c && c.status === DONE ? i : -1)).filter(i => i >= 0);
    const allowReopen = new Set();
    if (doneIdx.length) {
        if (stay) {
            const c = pre[doneIdx[0]];
            const msg = `이미 ${Math.max(1, Number(c.round) || 1)}회차가 완료된 상품 — ${label || '이 상품'}. 새 회차는 [찾아서 추가]에서 다시 골라 확인하세요.`;
            showToast(msg, true);
            if (doneIdx.length === list.length) return () => msg;
        } else {
            const text = doneIdx.length === 1
                ? `${list[doneIdx[0]].it.name}${list[doneIdx[0]].it.option ? ` / ${list[doneIdx[0]].it.option}` : ''}\n${reopenConfirmText(pre[doneIdx[0]])}`
                : `완료된 상품 ${doneIdx.length}개가 있습니다.\n${doneIdx.slice(0, 5).map(i => `· ${list[i].it.name}${list[i].it.option ? ` / ${list[i].it.option}` : ''} (${Math.max(1, Number(pre[i].round) || 1)}회차 완료)`).join('\n')}\n모두 새 회차로 다시 시작할까요?`;
            const ok = await showConfirm(text, { title: '완료된 상품', okText: '새 회차 시작', cancelText: '취소' });
            if (ok) doneIdx.forEach(i => allowReopen.add(list[i].id));
            else if (doneIdx.length === list.length) return () => { showToast('넣지 않았습니다.'); return '넣지 않았습니다.'; };
        }
    }
    const by = me(), now = nowIso();
    const res = await runTransaction(State.db, async (tx) => {
        const snaps = await Promise.all(list.map(x => tx.get(docRef(x.id))));
        return snaps.map((sn, i) => {
            const cur = sn.exists() ? sn.data() : null;
            // 확인 안 한 완료 상품(취소·연속 스캔, 또는 그사이 다른 기기에서 완료됨)은 새 회차로 열지 않는다
            if (cur && cur.status === DONE && !allowReopen.has(list[i].id)) return { id: list[i].id, action: 'keptDone' };
            const d = startOrReopen(cur, list[i].it, { reason, by, now, today: getTodayDateString() });
            if (d.doc) {
                const val = { ...d.doc, lastUpdated: serverTimestamp() };
                if (d.dropSupplier) val.supplier = deleteField();   // 옛 문서의 공급처 이름 칸은 지운다(코드만 남김)
                if (d.merge) tx.set(docRef(list[i].id), val, { merge: true });   // 옛 문서 — 누적은 그대로, 빠진 칸만
                else tx.set(docRef(list[i].id), val);
            }
            return { id: list[i].id, action: d.action };
        });
    });
    return () => {
        if (stay) {
            const a = res[0] ? res[0].action : '';
            const msg = a === 'create' ? `${label} 추가됨`
                : a === 'reopen' ? `완료였던 ${label} 새 회차로 추가됨`
                : a === 'conflict' ? `같은 목록 키의 다른 상품(옵션 표기 차이 등)이 있어 못 넣음 — ${label}`
                : a === 'keptDone' ? `이미 완료된 상품이라 넣지 않음 — ${label}`
                : `이미 진행 중 — ${label}`;
            showToast(msg, a === 'conflict');
            return msg;
        }
        const n = (a) => res.filter(r => r.action === a).length;
        const parts = [];
        if (n('create')) parts.push(`${n('create')}개 넣음`);
        if (n('reopen')) parts.push(`완료였던 ${n('reopen')}개 새 회차로`);
        if (n('open') + n('upgrade')) parts.push(`이미 진행 중 ${n('open') + n('upgrade')}개`);
        if (n('conflict')) parts.push(`같은 목록 키의 다른 상품(옵션 표기 차이 등)이 있어 못 넣음 ${n('conflict')}개`);
        if (n('keptDone')) parts.push(`완료 상품 ${n('keptDone')}개는 넣지 않음`);
        showToast(parts.join(' · ') || '진행 목록에 넣었습니다.', n('conflict') > 0 && n('conflict') === res.length);
        const first = res.find(r => r.action !== 'conflict' && r.action !== 'keptDone');
        openTotalInspection({ selectId: first ? first.id : '' });
    };
}

/** [+ 개별 추가] · 검색칸에서 목록에 없는 글자. */
export function openTotalManualAdd(text = '') {
    openManualAdd(String(text || '').trim(), { target: 'total', onAdd: addItems });
}

/** 샘플검수 [전량검수로 전환] — 지금 고른 샘플 줄을 진행 목록에 넣고(origin 'sample') 그 줄이 고른 채 전량 창을 연다. 사유가 비면 창에서 입력. */
export async function triggerTotalInspectionFromSample() {
    const it = fromSampleItem(getCurrentInspItem());
    if (!it) {
        showToast('샘플검수 리스트에서 상품을 먼저 고르세요.', true);
        return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        showToast('인터넷 연결이 끊겨 넣지 못했습니다.', true);
        return;
    }
    try {
        const after = await addItems([it], { reason: '' });
        after();
    } catch (e) {
        console.error('[전량검수] 샘플에서 전환 실패:', e && e.code ? e.code : e);
        showToast(failMsg(e, (e && e.userMessage) || '전량검수 목록에 넣지 못했습니다. 다시 눌러 주세요.'), true);
    }
}

// ── 검색칸 ───────────────────────────────────────────────────────────
export function onTotalSearchInput() {
    filterTerm = DOM.totalInspProductName ? DOM.totalInspProductName.value : '';
    renderList();
}

/** Enter·[찾기] — 목록에 딱 맞는 줄이 있으면 고르고, 없으면 그 글자로 개별 추가 창. */
export function onTotalSearchEnter() {
    const text = DOM.totalInspProductName ? DOM.totalInspProductName.value.trim() : '';
    if (!text) { openTotalManualAdd(''); return; }   // 빈 칸이면 찾기 창을 바로 연다(개별 추가 버튼을 이 버튼 하나로 합침, 2026-11-17)
    const id = exactRow(allRows(), text);
    if (id) { selectRow(id); return; }
    openTotalManualAdd(text);
}

export function onTotalListClick(e) {
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    const d = t.closest('[data-total-del]');
    if (d) { removeRows([d.dataset.totalDel]); return; }
    const b = t.closest('[data-total-key]');
    if (b) selectRow(b.dataset.totalKey);
}

export function setTotalShowDone(on) {
    showDone = !!on;
    if (showDone) subscribeDone(); else unsubscribeDone();
    afterRowsChanged();
}

// ── 저장 ─────────────────────────────────────────────────────────────
/** 정보만 저장한 뒤 토스트 — 무엇이 저장됐는지(검수수량·사유·시작일·로케이션 중 바뀐 것). */
function infoSavedText(cur, patch) {
    return infoChangedLabels(cur, patch).join('·') || '정보';   // 실제로 바뀐 칸만(lib/total-insp.js)
}

/** 오늘 수량 없이 검수수량(칸 이름 totalStock)·사유·시작일·위치만(트랜잭션, 서버 값으로 다시 판정). 기록 문서·처리량은 쓰지 않는다. */
async function saveTotalInfo(row, input) {
    const pre = applyInfoSave(row, { ...input, date: getTodayDateString() });
    if (!pre.ok) { showToast(pre.message, true); return; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        showToast('인터넷 연결이 끊겨 저장하지 못했습니다(입력은 남아 있습니다).', true);
        return;
    }
    const id = row.id;
    saving = true;
    renderSelected(false);
    try {
        const out = await runTransaction(State.db, async (tx) => {
            const ref = docRef(id);
            const snap = await tx.get(ref);
            const cur = snap.exists() ? snap.data() : null;
            const r = applyInfoSave(cur, { ...input, date: getTodayDateString(), by: me(), now: nowIso() });
            if (!r.ok) return { err: r };
            tx.update(ref, { ...r.patch, lastUpdated: serverTimestamp() });
            return { r, cur };
        });
        if (out.err) { showToast(out.err.message, true); return; }
        const saved = infoSavedText(out.cur, out.r.patch);
        showToast(out.r.done ? `저장됨 · ${saved} — 누적과 같아 완료됐습니다.` : `저장됨 · ${saved} (오늘 수량은 넣지 않음 — 검수한 수량은 정상·불량에 넣고 [저장])`);
    } catch (e) {
        console.error('[전량검수] 검수수량 저장 실패:', e && e.code ? e.code : e);
        showToast(failMsg(e, '저장하지 못했습니다. 입력은 남아 있습니다 — 다시 눌러 주세요.'), true);
    } finally {
        saving = false;
        afterRowsChanged();
    }
}

export async function saveTotalInspection() {
    if (saving || stockBusy) return;   // [재고 연동] 불러오는 중이면 칸 값이 바뀔 수 있다
    const row = rowById(selectedId);
    if (!row) { showToast('진행 목록에서 상품을 먼저 고르세요.', true); return; }
    const input = {
        normal: num(DOM.totalInspTodayNormal) || 0,
        defective: num(DOM.totalInspTodayDefective) || 0,
        totalStock: num(DOM.totalInspTotalStock),
        reason: DOM.totalInspReason ? DOM.totalInspReason.value : '',
        location: DOM.totalInspLocation ? DOM.totalInspLocation.value : '',
        startDate: DOM.totalInspStartDate ? DOM.totalInspStartDate.value : '',
    };
    if (isInfoOnly(input.normal, input.defective)) { await saveTotalInfo(row, input); return; }   // 오늘 수량이 없으면 총 재고·정보만
    const pre = applySave(row, { ...input, date: getTodayDateString() });   // 화면 값으로 먼저 — 서버에서 한 번 더 본다
    if (!pre.ok) { showToast(pre.message, true); return; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        showToast('인터넷 연결이 끊겨 저장하지 못했습니다(입력은 남아 있습니다).', true);
        return;
    }
    if (!pendingSave || pendingSave.id !== row.id) {
        pendingSave = { id: row.id, saveId: newSaveId(), date: getTodayDateString(), time: getCurrentTime() };
    }
    const ps = pendingSave;
    const by = me();
    const fullTask = tName(TASK.full);
    saving = true;
    renderSelected(false);
    try {
        const out = await runTransaction(State.db, async (tx) => {
            const ref = docRef(ps.id);
            const lref = logRef(ps.saveId);
            const dref = doc(State.db, ...APP, 'daily_data', ps.date);
            const [snap, logSnap] = await Promise.all([tx.get(ref), tx.get(lref)]);   // daily_data 는 읽지 않는다(자동저장과 다툼 줄이기)
            if (logSnap.exists()) return { dup: true };   // 앞서 누른 저장이 이미 들어갔다
            const cur = snap.exists() ? snap.data() : null;
            const now = nowIso();
            const r = applySave(cur, { ...input, date: ps.date, by, now });
            if (!r.ok) return { err: r };
            tx.update(ref, { ...r.patch, lastUpdated: serverTimestamp() });
            tx.set(lref, logOf({ saveId: ps.saveId, date: ps.date, time: ps.time, key: ps.id, cur, res: r, inspector: by, at: now }));
            // 처리량 — set+merge 의 중첩 맵 키는 경로로 해석되지 않아 업무 이름의 점('상.하차' 같은)이 쪼개지지 않는다
            //   (update 의 '점 경로 문자열'과 다르다 — tests/task-qty-fieldpath.test.js). 문서가 없어도 된다.
            tx.set(dref, { taskQuantities: { [fullTask]: increment(r.qty) } }, { merge: true });
            return { r };
        });
        if (out.err) {
            showToast(out.err.message, true);
            return;
        }
        pendingSave = null;
        if (out.dup) {
            showToast('이미 저장된 기록입니다(두 번 더하지 않았습니다).');
        } else {
            const { r } = out;
            // 화면 처리량은 오늘 문서 구독(js/app-sync.js)이 바꾼다 — 여기서 더하지 않는다(샘플검수와 같게, 두 번 더해지지 않게)
            const today = `오늘 정상 ${r.normal}·불량 ${r.defective}`;
            showToast(r.done ? `저장됨 · ${today} · 누적 ${r.accumAfter}개로 검수수량에 닿아 완료됐습니다.` : `저장됨 · ${today} · 누적 ${r.accumAfter} / ${r.patch.totalStock}개`);
        }
        if (DOM.totalInspTodayNormal) DOM.totalInspTodayNormal.value = '';
        if (DOM.totalInspTodayDefective) DOM.totalInspTodayDefective.value = '';
        saving = false;
        // 완료됐으면 다음 진행 줄로. 아직이면 그 줄에 머문다 — 예전엔 늘 다음 줄로 넘어가 방금 넣은 총 재고·누적이 화면에서 사라져
        //   '저장이 안 됐다'로 보였다(2026-11-17 사용자 신고). 머물 때 입력칸은 지우지 않은 그대로(총 재고·사유·시작일은 서버 값과 같다).
        const next = out.r && out.r.done ? nextOnKey(sortList(rowsOn), ps.id) : '';
        if (next) selectRow(next);
        else afterRowsChanged();
    } catch (e) {
        console.error('[전량검수] 저장 실패:', e && e.code ? e.code : e);
        showToast(failMsg(e, '저장하지 못했습니다. 입력은 남아 있습니다 — 다시 눌러 주세요(두 번 더해지지 않습니다).'), true);
    } finally {
        saving = false;
        renderSelected(false);
    }
}

// ── 완료 처리 · 다시 진행 · 빼기 ──────────────────────────────────────
async function act(id, fn, okMsg) {
    if (acting || saving) return;
    acting = true;
    renderSelected(false);
    try {
        const res = await runTransaction(State.db, async (tx) => {
            const ref = docRef(id);
            const snap = await tx.get(ref);
            return fn(tx, ref, snap.exists() ? snap.data() : null);
        });
        if (res && res.ok === false) { showToast(res.message, true); return; }
        showToast(okMsg);
    } catch (e) {
        console.error('[전량검수] 처리 실패:', e && e.code ? e.code : e);
        showToast(failMsg(e, '처리하지 못했습니다. 다시 눌러 주세요.'), true);
    } finally {
        acting = false;
        afterRowsChanged();
    }
}

export async function markTotalDone() {
    const r = rowById(selectedId);
    if (!r) return;
    const p = progressOf(r);
    const ok = await showConfirm(
        `'${r.name}${r.option ? ` / ${r.option}` : ''}' 을(를) 완료 처리할까요?\n누적 ${p.acc}${p.total > 0 ? ` / 검수수량 ${p.total}` : ''}\n완료 목록에서 [다시 진행]으로 되돌릴 수 있습니다.`,
        { title: '전량검수 완료 처리', okText: '완료 처리', cancelText: '취소' });
    if (!ok) return;
    const id = r.id;
    await act(id, (tx, ref, cur) => {
        const m = markDone(cur, { by: me(), now: nowIso(), date: getTodayDateString() });
        if (m.ok) tx.update(ref, { ...m.patch, lastUpdated: serverTimestamp() });
        return m;
    }, '완료 처리했습니다.');
    if (selectedId === id && !showDone) {
        const next = nextOnKey(sortList(rowsOn), id);
        if (next) selectRow(next);
    }
}

export async function reopenTotal() {
    const r = rowById(selectedId);
    if (!r) return;
    const id = r.id;
    await act(id, (tx, ref, cur) => {
        const m = markReopen(cur);
        if (m.ok) tx.update(ref, { ...m.patch, lastUpdated: serverTimestamp() });
        return m;
    }, '다시 진행 목록에 넣었습니다.');
    if (rowById(id)) { selectedId = ''; selectRow(id); }
    else pendingSelect = id;   // 진행중 구독이 곧 가져온다
}

// ── 줄 [×] · [목록 비우기] ────────────────────────────────────────────
// 아직 시작 안 한 줄(1회차·누적 0)은 문서 삭제, 누적이 있거나 2회차 이상은 기록 보존을 위해 완료(stopped)로 내린다(lib/total-insp.js removePlan).
// 확인창 숫자는 화면 값, 실제 판정은 트랜잭션 안에서 서버 값으로 다시 한다. 한 트랜잭션에 REMOVE_CHUNK 건씩.
const REMOVE_CHUNK = 100;

async function removeRows(ids, { all = false } = {}) {
    if (acting || saving) return;
    const rows = ids.map(rowById).filter(Boolean);
    // 2회차↑·누적 0 인 줄 — 그 상품 기록을 먼저 모아 직전 회차가 있는지 본다(확인창 숫자용, 실제 판정은 트랜잭션 안에서 다시)
    const prevByKey = {};
    for (const r of rows.filter(x => x.status !== DONE && canRevertRound(x))) {
        try { prevByKey[r.id] = await listKeyLogs(r.id); } catch (e) { prevByKey[r.id] = []; }
    }
    const c = removeCounts(rows, prevByKey);
    if (!c.del && !c.stop && !c.revert) {
        showToast(c.blocked ? removeMessage({ blocked: c.blocked }) : '내릴 진행 줄이 없습니다.', true);
        return;
    }
    const one = rows.length === 1 ? rows[0] : null;
    const head = one ? `'${one.name}${one.option ? ` / ${one.option}` : ''}' — ` : `진행 목록 ${rows.length}건 — `;
    const ok = await showConfirm(`${head}${removeMessage(c)}.\n기록이 있는 줄은 완료 목록([완료 보기])에 남습니다.${c.revert ? '\n되돌린 줄은 직전 회차의 누적·검수수량·종료일로 돌아갑니다.' : ''}`,
        { title: all ? '목록 비우기' : '목록에서 내리기', okText: all ? '비우기' : '내리기', cancelText: '취소', danger: true });
    if (!ok) return;
    acting = true;
    renderList();
    renderSelected(false);
    const done = { del: 0, stop: 0, revert: 0, blocked: 0, failed: 0, skip: 0 };
    let failed = false;
    try {
        const by = me(), now = nowIso();
        // 되돌리기 후보는 한 건씩(직전 회차 기록을 트랜잭션 안에서 다시 읽는다 — js/total-insp-edit.js)
        for (const id of Object.keys(prevByKey)) {
            try {   // 건별로 — 한 건이 실패해도 나머지는 처리하고 실패 건수를 알린다(리뷰 4)
                const r = await removeOrRevertOne(id, { mode: 'remove', logIds: prevByKey[id].map(l => l.id) });
                const a = r.ok ? r.action : (r.action === 'blocked' ? 'blocked' : 'skip');
                if (a === 'delete') done.del++; else if (a === 'stop') done.stop++; else if (a === 'revert') done.revert++;
                else if (a === 'blocked') done.blocked++; else done.skip++;
            } catch (e) {
                console.error('[전량검수] 되돌리기 실패:', e && e.code ? e.code : e);
                done.failed++;
            }
        }
        const list = rows.map(r => r.id).filter(id => !(id in prevByKey));
        for (let i = 0; i < list.length; i += REMOVE_CHUNK) {
            const part = list.slice(i, i + REMOVE_CHUNK);
            const res = await runTransaction(State.db, async (tx) => {
                const snaps = await Promise.all(part.map(id => tx.get(docRef(id))));
                return snaps.map((sn, k) => {
                    const p = removePlan(sn.exists() ? sn.data() : null, { by, now, date: getTodayDateString() });
                    if (p.action === 'delete') tx.delete(docRef(part[k]));
                    else if (p.action === 'stop') tx.update(docRef(part[k]), { ...p.patch, lastUpdated: serverTimestamp() });
                    return p.action;
                });
            });
            res.forEach(a => { if (a === 'delete') done.del++; else if (a === 'stop') done.stop++; else done.skip++; });
        }
    } catch (e) {
        failed = true;
        console.error('[전량검수] 목록에서 내리기 실패:', e && e.code ? e.code : e);
        showToast(failMsg(e, '목록에서 내리지 못했습니다. 다시 눌러 주세요.'), true);
    } finally {
        acting = false;
        afterRowsChanged();
    }
    if (failed && !done.del && !done.stop && !done.revert && !done.blocked && !done.failed) return;
    const msg = removeMessage(done) || '바뀐 것이 없습니다';
    showToast(`${msg}${done.skip ? ` · 그사이 바뀌어 건너뜀 ${done.skip}건` : ''}`, failed || done.failed > 0 || done.blocked > 0);
}

/** 줄 [×] — 그 줄만. */
export const removeTotalRow = (id) => removeRows([id]);

/** [목록 비우기] — 진행 중인 줄 전부(검색칸으로 거른 것과 상관없이). */
export function clearTotalList() {
    return removeRows(sortList(rowsOn).map(r => r.id), { all: true });
}

// ── 전체화면(샘플검수 #insp-fullscreen-btn 와 같은 기능 — 휴대폰에선 버튼이 숨어 있다, css/style.css) ──
export function toggleTotalFullscreen() {
    const box = DOM.totalInspModalContent;
    if (!box || !DOM.totalInspModal) return;
    const on = !box.classList.contains('total-insp-full');
    box.classList.toggle('total-insp-full', on);
    DOM.totalInspModal.classList.toggle('total-insp-full-on', on);
    if (DOM.totalInspFullscreenBtn) {
        DOM.totalInspFullscreenBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
        DOM.totalInspFullscreenBtn.title = on ? '전체화면 끄기' : '전체화면';
    }
}

// ── [재고 연동](2026-11-17 사용자 요청) — 고른 줄 상품코드의 재고를 검수수량 칸에 채운다(저장은 사람이 [저장]) ──
// 출처: ProductLoc(위치·재고 요약 — 채우기자동화가 평일 아침 채우기 지시서 때 Locations 자리 수량·이지어드민 정상/비축으로 씀).
//   Locations ZONE_* 를 직접 읽지 않는다(상품코드 하나 찾자고 구역 문서를 통째로 읽게 되고, rawDataStr 에 공급처 열이 섞인다 — CLAUDE.md 3절).
//   ProductLoc 은 상품코드·자리·수량·비축·정상/출고예정만 담는다(화이트리스트). 읽기: META 1회 + 바뀌었을 때만 Lxx(IndexedDB 캐시를 상품 관리·개별 추가와 같이 씀),
//   이 창에서는 STOCK_TTL 안에는 다시 읽지 않는다. 이지어드민 API 는 부르지 않는다.
const STOCK_TTL = 10 * 60 * 1000;
let stockLoadedAt = 0;
let stockBusy = false;

function setStockNote(text, warn = false) {
    const el = DOM.totalInspStockNote;
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('hidden', !text);
    el.classList.toggle('text-red-600', warn);
    el.classList.toggle('text-gray-600', !warn);
}

export async function syncTotalStock() {
    const r = rowById(selectedId);
    if (!r || stockBusy || saving) return;
    const code = String(r.code || '').trim();
    if (!code) { setStockNote('상품코드가 없는 줄이라 재고를 찾을 수 없습니다 — 검수수량을 직접 입력하세요.', true); return; }
    const id = r.id;
    stockBusy = true;
    renderSelected(false);
    setStockNote('재고 요약 불러오는 중…');
    try {
        if (!PS.db) PS.db = State.db;
        if (!PS.loc || Date.now() - stockLoadedAt > STOCK_TTL) {
            await loadLoc();
            stockLoadedAt = Date.now();
        }
        if (selectedId !== id) return;   // 그사이 다른 줄을 골랐다
        if (!PS.loc) { setStockNote('위치·재고 요약이 아직 없습니다 — 검수수량을 직접 입력하세요.', true); return; }
        const res = stockFromLoc(locOf(code));
        const metaAt = PS.locMeta && PS.locMeta.at ? tsMs(PS.locMeta.at) : 0;
        if (!res.found) {
            const at = stockBasisText('ez', metaAt, '', fmtDateTime);
            setStockNote(`상품코드 ${code} 의 재고를 요약에서 찾지 못했습니다${at ? `(${at})` : ''} — 직접 입력하세요.`, true);
            return;
        }
        // 기준 시각: 정상재고는 요약 시각, 로케이션 자리 합은 로케이션 업로드 시각(META.locAt)
        const at = stockBasisText(res.basis, metaAt, PS.locMeta && PS.locMeta.locAt, fmtDateTime);
        if (DOM.totalInspTotalStock) DOM.totalInspTotalStock.value = String(res.qty);
        updateTotalInspRemaining();
        const acc = Number(r.accumulatedTotal) || 0;
        setStockNote(`${at ? `${at} · ` : ''}${res.detail} = ${res.qty}개 — [저장]을 눌러야 들어갑니다.`
            + (res.qty < acc ? ` 지금까지 누적(${acc})보다 작아 그대로는 저장되지 않습니다.` : ''), res.qty < acc);
    } catch (e) {
        console.warn('[전량검수] 재고 요약 읽기 실패:', e && e.code ? e.code : e);
        setStockNote('재고 요약을 읽지 못했습니다. 잠시 뒤 다시 누르거나 직접 입력하세요.', true);
    } finally {
        stockBusy = false;
        renderSelected(false);
    }
}
