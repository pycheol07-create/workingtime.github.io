// === js/inspection-manual.js ===
// 샘플검수 [+ 개별 추가](2026-11-17) — 상품명(부분일치)·상품코드·바코드로 상품을 찾아 오늘 검수 대기 리스트에 넣는다.
//   리스트가 있으면 줄이 붙고, 없으면 그 줄들이 새 리스트가 된다. 상품 DB 에 없으면 상품명 직접 입력(필수), 옵션·상품코드는 선택.
// 읽기: ProductCatalog META·Bxx · ProductLoc META·Lxx (js/products-store.js loadCatalog·loadLoc — IndexedDB 'ggsing-products' 를
//       상품 관리 화면과 같이 쓴다, 이 창을 처음 열 때만 읽는다) · product_history/{상품명}(두께·지난 검수 횟수)
//       · 이력 문서가 없으면 product_history where lastCode in [...](최대 30) 로 한 번 더. 원가·공급처 문서는 읽지 않는다.
// 쓰기: daily_data/{오늘}.inspectionList 를 runTransaction 으로 서버 값을 읽고 붙인다. 다른 날 리스트는 건드리지 않는다.
//   보호 범위: inspectionList 를 쓰는 곳(개별 추가·검수 저장·패킹에서 만들기·지난 리스트 가져오기·리스트 비우기)이 모두 트랜잭션이라 서로 지우지 않는다.
//   1분 자동저장(js/app-data.js saveStateToFirestore)은 2026-11-17 부터 inspectionList 를 싣지 않는다. 예외 — 리스트 '삭제'(대기 리스트 삭제·
//   데이터관리 날짜 삭제)는 일부러 통째로 비운다.
// 순수 규칙은 js/lib/insp-manual.js.
// ⚠️ 이 창은 index.html·history.html 에 붙는다 — 업무마감봇 선택자와 겹치지 않게 role="dialog"·data-act·end-shift-* 를 쓰지 않는다. id 는 모두 insp-manual-*.
// ⚠️ 유형(샘플 / 요청확인)은 선택형만. 고객 이름·연락처·주문번호·후기 원문을 적을 칸을 만들지 않는다(CLAUDE.md 3절) — 요청확인을 고르면 안내를 보인다.
// 전량검수도 이 창을 쓴다(2026-11-17, openManualAdd(글자, { target: 'total', onAdd })) — 유형 대신 사유(필수, 고른 상품 공통) + 고객 정보 안내,
//   카메라는 이 창 안의 스캐너(inspection-media.js startInlineScanner — 전량 창에는 샘플검수 스캐너가 없다).
//   넣기(트랜잭션)·넣은 뒤 화면은 부르는 쪽이 넘기는 onAdd(items, { reason, stay, label }) 가 한다 — 샘플 쪽은 아래 addToSampleList.
// 바로 넣기(2026-11-17): 바코드·옵션 상품코드로 옵션 하나가 정해지면(lib quickPick) 고르기 없이 넣는다 — 유형/사유가 비었으면 그 칸에 초점을 두고
//   고르는 순간(사유는 Enter) 넣는다. 이때는 창을 닫지 않고 검색칸을 비워 다음 스캔을 받는다(stay — 넣는 쪽은 토스트만, 줄을 열지 않음).
//   유형·사유는 창이 열린 동안 그대로 둔다. 보통 [추가](여러 옵션 고르기)는 예전처럼 넣고 닫은 뒤 첫 줄을 연다.
// 옵션 칩(2026-11-17): 색상별 묶음 + 사이즈 순서(lib groupOptions), 옵션이 MANY_OPTIONS 개 넘으면 거르기 칸·묶음별 [전체], 사라진 옵션은 접어 둔다.
import * as State from './state.js?v=c7f5fc984ef9-a2ce38c0';
import { showToast, getTodayDateString, escapeHtml } from './utils.js?v=a8117fdf6a07-c756d71e';
import { renderTodoList, selectTodoItem } from './inspection-logic.js?v=30b1a904a623-e1d61ac2';
import { toggleScanner, startInlineScanner } from './inspection-media.js?v=30b1a904a623-cad5241c';
import { S as PS, loadCatalog, loadLoc, locOf } from './products-store.js?v=12e37e026ce6-ee5ce71b';
import { thicknessFromHistoryDoc } from './lib/insp-packs.js?v=e3fa3546a650-16eb76b5';
import {
    KINDS, findCandidates, manualItem, typedItem, addToList, historyId, historyCodes, pickHistoryByCode,
    totalItemOf, typedTotalItem, quickPick, groupOptions, optionMatches, MANY_OPTIONS
} from './lib/insp-manual.js?v=25e0bc0396d2-21f87941';
import { doc, getDoc, getDocs, collection, query, where, limit as fsLimit, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const PICKER_ID = 'insp-manual-picker';
const NAME_LIMIT = 30;
const MATCH_LABEL = { barcode: '바코드 일치', option: '상품코드 일치', code: '자체코드 일치', name: '' };

let catalogP = null;          // 상품 DB 불러오기(페이지에서 한 번 — 실패하면 다음에 다시)
let locWarn = false;          // 위치(ProductLoc)를 못 읽음 — 로케이션 칸은 비운다
let mode = 'find';            // 'find' 상품 DB 에서 찾기 | 'typed' 직접 입력
let cands = [];               // 지금 후보(findCandidates items)
let more = false;
let expanded = new Set();     // 옵션 칩을 펼친 후보 칸 번호
let picked = new Set();       // 고른 옵션 'ci:oi'
let kind = '';               // 유형(필수) — KINDS id
let busy = false;
let hiddenForScan = false;    // 카메라 스캔 동안 이 창을 숨겼다(스캐너는 검수 창 안에 있다)
let typedHist = { id: '', state: '', count: 0, thickness: '' };   // state: ''|loading|found|none|error
let typedSeq = 0;
let typedP = null;            // 읽는 중인 이력 확인 { id, promise } — [추가]가 같은 이름이면 이걸 기다린다(읽기 경쟁 방지)
let managerObs = null;        // 카메라로 숨긴 동안 검수 창이 닫히면 이 창도 닫는다
let typedTimer = null;
let target = 'sample';        // 'sample' 샘플검수 대기 리스트 | 'total' 전량검수 진행 목록
let onAddFn = null;           // 넣기 — (items, { reason, stay, label }) => Promise<(() => void) | void>, 돌려준 함수는 창을 닫은 뒤(stay 면 열어 둔 채) 부른다
let inlineScan = null;        // 전량 쪽 창 안 스캐너 { stop }
let quickKey = '';            // 바로 넣을 옵션 'ci:oi'(찾은 결과가 옵션 하나로 정해짐) — 고른 것이 이것 하나일 때만 바로 넣는다
const BUSY_SCAN_MSG = '앞 상품을 넣는 중입니다 — 다시 스캔해 주세요';   // 넣는 중 들어온 스캔·검색은 받지 않는다(대기시키면 닫힐 때 조용히 빠진다)
let searchSeq = 0;            // 찾기 회차 — 넣는 사이 새로 찾았으면 넣은 뒤 화면을 비우지 않는다
let optFilter = new Map();    // 후보 칸 → 옵션 거르기 글자
let goneOpen = new Set();     // 사라진 옵션을 펼친 후보 칸

const el = (id) => document.getElementById(id);
const isOpen = () => !!el(PICKER_ID);

/** 카메라 스캔이 이 창으로 와야 하나(js/inspection-media.js onScanSuccess). 스캔 때문에 숨겨 둔 상태도 열린 것으로 본다. */
export const isManualAddOpen = () => {
    if (!isOpen() || target !== 'sample') return false;   // 전량 쪽은 창 안 스캐너를 쓴다
    if (!hiddenForScan) return true;
    const sc = document.getElementById('insp-scanner-container');
    return !!(sc && !sc.classList.contains('hidden'));   // 숨겨 둔 채 스캐너도 닫혔으면 열린 것으로 보지 않는다
};

/** 스캔 결과를 이 창 검색칸으로. text 가 null 이면 스캔 없이 스캐너를 닫은 것 — 숨겨 둔 창만 다시 보인다. */
export function feedManualScan(text) {
    const root = el(PICKER_ID);
    if (!root) return;
    if (hiddenForScan) { root.classList.remove('hidden'); hiddenForScan = false; }
    if (managerObs) { managerObs.disconnect(); managerObs = null; }
    if (text == null) return;
    setMode('find');
    const q = el('insp-manual-q');
    if (q) q.value = String(text).trim();
    runSearch();
}

function ensureCatalog() {
    if (catalogP) return catalogP;
    if (!PS.db) PS.db = State.db;
    catalogP = (async () => {
        await loadCatalog();
        try { await loadLoc(); locWarn = false; } catch (e) {
            locWarn = true;
            console.warn('[개별 추가] 위치 읽기 실패(로케이션 없이 넣음):', e && e.code ? e.code : e);
        }
        return true;
    })().catch((e) => { catalogP = null; throw e; });
    return catalogP;
}

function stopInlineScan() {
    if (inlineScan) { inlineScan.stop(); inlineScan = null; }
    const box = el('insp-manual-scan-box');
    if (box) box.classList.add('hidden');
}

function closePicker() {
    if (busy) return;
    stopInlineScan();
    const root = el(PICKER_ID);
    if (root) root.remove();
    hiddenForScan = false;
    if (managerObs) { managerObs.disconnect(); managerObs = null; }
    typedP = null;
    cands = []; more = false; expanded = new Set(); picked = new Set();
    quickKey = ''; optFilter = new Map(); goneOpen = new Set();
    typedHist = { id: '', state: '', count: 0, thickness: '' };
    clearTimeout(typedTimer);
}

function ensureShell() {
    let root = el(PICKER_ID);
    if (root) return root;
    const isTotal = target === 'total';
    root = document.createElement('div');
    root.id = PICKER_ID;
    root.dataset.target = target;
    // modal-esc.js 가 ESC 후보로 보는 모양(.fixed.inset-0 + justify-center). 닫기 버튼 id 에 close 가 있어 ESC 가 그것을 누른다.
    // 휴대폰은 전체 화면(p-0 · h-full), PC 는 가운데 창.
    root.className = 'fixed inset-0 bg-gray-900 bg-opacity-60 flex items-center justify-center z-[70] p-0 sm:p-4';
    const kindsHtml = KINDS.map(r => `
        <label class="flex items-center gap-2 border border-gray-300 rounded-lg px-3 min-h-[44px] cursor-pointer hover:bg-gray-50">
            <input type="radio" name="insp-manual-kind" value="${escapeHtml(r.id)}" class="w-4 h-4">
            <span class="text-sm font-bold text-gray-700">${escapeHtml(r.label)}</span>
        </label>`).join('');
    root.innerHTML = `
        <div class="bg-white shadow-2xl w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-2xl sm:rounded-2xl flex flex-col">
            <div class="p-4 border-b border-gray-200 flex justify-between items-center flex-shrink-0">
                <div class="min-w-0">
                    <h3 class="text-lg font-bold text-gray-900">개별 추가</h3>
                    <p class="text-xs text-gray-500 mt-0.5">${isTotal ? '상품명·상품코드·바코드로 찾아 전량검수 진행 목록에 넣습니다.' : '상품명·상품코드·바코드로 찾아 오늘 검수 대기 리스트 맨 아래에 넣습니다.'}</p>
                </div>
                <button id="insp-manual-close-btn" type="button" class="text-gray-400 hover:text-gray-700 p-1 min-h-[44px] min-w-[44px] flex items-center justify-center" title="닫기" aria-label="닫기">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>
            <div class="p-4 overflow-y-auto flex-grow min-h-[160px] space-y-4">
                <div id="insp-manual-find" class="space-y-2">
                    <div class="flex gap-2">
                        <input type="text" id="insp-manual-q" class="flex-grow min-w-0 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 outline-none font-medium"
                               placeholder="상품명 일부 · 상품코드 · 바코드" autocomplete="off" enterkeyhint="search">
                        <button id="insp-manual-cam-btn" type="button" class="bg-white border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-lg min-h-[44px] min-w-[44px] px-2" title="카메라로 바코드 스캔" aria-label="카메라로 바코드 스캔">📷</button>
                        <button id="insp-manual-find-btn" type="button" class="bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-lg min-h-[44px] px-4">찾기</button>
                    </div>
                    ${isTotal ? `<div id="insp-manual-scan-box" class="hidden border border-gray-200 rounded-lg p-2 bg-gray-50 space-y-2">
                        <div id="insp-manual-reader" class="w-full max-w-sm mx-auto"></div>
                        <button id="insp-manual-scan-close-btn" type="button" class="w-full text-sm bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-bold rounded min-h-[44px]">카메라 닫기</button>
                    </div>` : ''}
                    <div id="insp-manual-status" class="text-xs text-gray-500" aria-live="polite"></div>
                    <div id="insp-manual-results" class="space-y-2"></div>
                </div>
                <div id="insp-manual-typed" class="hidden space-y-2">
                    <label class="block text-sm font-bold text-gray-700" for="insp-manual-t-name">상품명 <span class="text-red-600">(필수)</span></label>
                    <input type="text" id="insp-manual-t-name" class="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 outline-none" autocomplete="off" maxlength="200">
                    <div id="insp-manual-t-hist" class="text-xs text-gray-500" aria-live="polite"></div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                            <label class="block text-xs font-bold text-gray-600" for="insp-manual-t-option">옵션 (선택)</label>
                            <input type="text" id="insp-manual-t-option" class="w-full p-2.5 border border-gray-300 rounded-lg outline-none min-h-[44px]" autocomplete="off" maxlength="200">
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-gray-600" for="insp-manual-t-code">상품코드 (선택)</label>
                            <input type="text" id="insp-manual-t-code" class="w-full p-2.5 border border-gray-300 rounded-lg outline-none min-h-[44px]" autocomplete="off" maxlength="60">
                        </div>
                    </div>
                </div>
                <button id="insp-manual-mode-btn" type="button" class="text-sm font-bold text-teal-700 hover:underline min-h-[44px]"></button>
                ${isTotal ? `<div class="border-t border-gray-200 pt-3 space-y-2">
                    <label class="block text-sm font-bold text-gray-700" for="insp-manual-reason">전량검수 사유 <span class="text-red-600">(필수 · 고른 상품 모두에 같이 들어갑니다)</span></label>
                    <input type="text" id="insp-manual-reason" class="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none" autocomplete="off" maxlength="200" placeholder="예: 지퍼 불량 접수로 전량 검수">
                    <p class="text-xs font-bold text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">고객 이름·연락처·주문번호는 적지 마세요.</p>
                </div>` : `<div class="border-t border-gray-200 pt-3 space-y-2">
                    <div class="text-sm font-bold text-gray-700">유형 <span class="text-red-600">(필수)</span></div>
                    <div class="grid grid-cols-2 gap-2">${kindsHtml}</div>
                    <p id="insp-manual-kind-note" class="hidden text-xs font-bold text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">고객 이름·연락처·주문번호·후기 원문은 적지 마세요.</p>
                </div>`}
            </div>
            <div class="p-4 border-t border-gray-200 flex-shrink-0 flex justify-between items-center gap-3">
                <span id="insp-manual-summary" class="text-sm font-bold text-gray-700 min-w-0"></span>
                <div class="flex gap-2 flex-shrink-0">
                    <button id="insp-manual-cancel-btn" type="button" class="text-sm bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-bold px-4 rounded min-h-[44px]">취소</button>
                    <button id="insp-manual-add-btn" type="button" class="text-sm bg-teal-600 hover:bg-teal-700 text-white font-bold px-4 rounded min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed" disabled>추가</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(root);

    root.querySelector('#insp-manual-close-btn').addEventListener('click', closePicker);
    root.querySelector('#insp-manual-cancel-btn').addEventListener('click', closePicker);
    root.querySelector('#insp-manual-find-btn').addEventListener('click', runSearch);
    root.querySelector('#insp-manual-q').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); runSearch(); }
    });
    root.querySelector('#insp-manual-cam-btn').addEventListener('click', startScan);
    root.querySelector('#insp-manual-mode-btn').addEventListener('click', () => {
        if (mode === 'find') {
            const t = el('insp-manual-t-name');
            const q = el('insp-manual-q');
            if (t && !t.value.trim() && q) t.value = q.value.trim();   // 찾던 글자를 상품명 칸에(고칠 수 있음)
            setMode('typed');
            if (t) { t.focus(); scheduleTypedHist(0); }
        } else {
            setMode('find');
        }
    });
    root.querySelector('#insp-manual-t-name').addEventListener('input', () => { scheduleTypedHist(500); renderSummary(); });
    root.querySelector('#insp-manual-t-name').addEventListener('blur', () => scheduleTypedHist(0));
    root.querySelectorAll('input[name="insp-manual-kind"]').forEach(r => r.addEventListener('change', () => {
        kind = r.checked ? r.value : kind;
        const note = el('insp-manual-kind-note');
        if (note) note.classList.toggle('hidden', kind !== 'request');   // 요청확인일 때만 고객 정보 안내
        renderSummary();
        if (quickReady()) tryQuick();   // 옵션이 정해진 채 유형을 기다리던 중 — 고르는 순간 넣는다
    }));
    const reasonEl = root.querySelector('#insp-manual-reason');
    if (reasonEl) {
        reasonEl.addEventListener('input', renderSummary);
        // 사유는 글자 칸이라 '고르는 순간'이 없다 — 옵션이 정해진 채 기다리던 중이면 Enter 로 넣는다
        reasonEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.isComposing && quickReady()) { e.preventDefault(); tryQuick(); }
        });
    }
    const scanClose = root.querySelector('#insp-manual-scan-close-btn');
    if (scanClose) scanClose.addEventListener('click', stopInlineScan);
    root.querySelector('#insp-manual-add-btn').addEventListener('click', addSelected);
    // 후보 펼치기·옵션 칩 — 위임 한 번
    const results = root.querySelector('#insp-manual-results');
    results.addEventListener('input', (e) => {
        const f = e.target.closest('[data-mfilter]');
        if (!f) return;
        const ci = Number(f.dataset.mfilter);
        optFilter.set(ci, f.value);
        applyFilter(ci);
    });
    results.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.closest('[data-mfilter]')) e.preventDefault();
    });
    results.addEventListener('click', (e) => {
        const all = e.target.closest('[data-mgall]');
        if (all) {
            const [ci, gi] = all.dataset.mgall.split(':').map(Number);
            toggleGroup(ci, gi);
            renderResults();
            renderSummary();
            return;
        }
        const goneBtn = e.target.closest('[data-mgone]');
        if (goneBtn) {
            const ci = Number(goneBtn.dataset.mgone);
            if (goneOpen.has(ci)) goneOpen.delete(ci); else goneOpen.add(ci);
            renderResults();
            return;
        }
        const opt = e.target.closest('[data-mopt]');
        if (opt) {
            const k = opt.dataset.mopt;
            if (picked.has(k)) picked.delete(k); else picked.add(k);
            renderResults();
            renderSummary();
            return;
        }
        const head = e.target.closest('[data-mcand]');
        if (head) {
            const ci = Number(head.dataset.mcand);
            if (expanded.has(ci)) expanded.delete(ci); else expanded.add(ci);
            renderResults();
        }
    });
    return root;
}

function setMode(next) {
    mode = next === 'typed' ? 'typed' : 'find';
    const f = el('insp-manual-find'), t = el('insp-manual-typed'), b = el('insp-manual-mode-btn');
    if (f) f.classList.toggle('hidden', mode !== 'find');
    if (t) t.classList.toggle('hidden', mode !== 'typed');
    if (b) b.textContent = mode === 'find' ? '상품 DB 에 없나요? 직접 입력 →' : '← 상품 DB 에서 찾기';
    renderSummary();
}

function setStatus(text, warn = false) {
    const s = el('insp-manual-status');
    if (!s) return;
    s.textContent = text;
    s.classList.toggle('text-red-600', warn);
    s.classList.toggle('text-gray-500', !warn);
}

/** 고른 옵션 → [{ cand, opts: [...] }] (후보 순서대로) */
function pickedGroups() {
    const out = [];
    cands.forEach((c, ci) => {
        const opts = c.opts.filter((o, oi) => picked.has(`${ci}:${oi}`));
        if (opts.length) out.push({ cand: c, opts });
    });
    return out;
}

const reasonText = () => (el('insp-manual-reason') ? el('insp-manual-reason').value.trim() : '');
/** 넣기 전에 꼭 고를 것 — 샘플은 유형, 전량은 사유. */
const needText = () => (target === 'total' ? (reasonText() ? '' : '사유를 입력해 주세요') : (kind ? '' : '유형을 골라 주세요'));

function renderSummary() {
    const sum = el('insp-manual-summary');
    const btn = el('insp-manual-add-btn');
    let n = 0;
    if (mode === 'find') n = pickedGroups().reduce((a, g) => a + g.opts.length, 0);
    else n = (el('insp-manual-t-name') && el('insp-manual-t-name').value.trim()) ? 1 : 0;
    const need = needText();
    if (sum) {
        sum.textContent = busy ? '넣는 중…'
            : n === 0 ? (mode === 'find' ? '옵션을 골라 주세요' : '상품명을 입력해 주세요')
            : need ? `${n}개 선택 · ${need}` : `${n}개 추가`;
    }
    if (btn) {
        btn.disabled = busy || n === 0 || !!need;
        btn.textContent = busy ? '넣는 중…' : (n > 0 ? `${n}개 추가` : '추가');
    }
}

// ── 옵션 칩 — 색상 묶음·거르기·[전체]·사라진 옵션 접기 ─────────────────────
const optOf = (ci, oi) => (cands[ci] && cands[ci].opts[oi]) || null;

function chipHtml(ci, it, o) {
    const key = `${ci}:${it.oi}`;
    const on = picked.has(key);
    const f = optFilter.get(ci) || '';
    const hide = f && !optionMatches(o, f);
    return `<button type="button" data-mopt="${escapeHtml(key)}" aria-pressed="${on ? 'true' : 'false'}" title="${escapeHtml(o.option || '(옵션 없음)')}"
        class="${hide ? 'hidden ' : ''}text-left text-xs font-bold border rounded-lg px-2.5 py-1.5 min-h-[44px] min-w-[52px] ${on ? 'bg-teal-600 border-teal-600 text-white' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'} ${o.gone ? 'opacity-60' : ''}">
        <span class="${o.gone ? 'line-through' : ''}">${escapeHtml(it.label)}</span>
        <span class="block font-mono font-normal text-[11px] ${on ? 'text-teal-50' : 'text-gray-500'}">${escapeHtml(o.code)}${o.gone ? ' · 사라짐' : ''}</span></button>`;
}

/** 펼친 후보의 옵션 칩. 묶음 머리 = 색상(묶을 게 없으면 머리 없이 한 줄), 옵션이 MANY_OPTIONS 개 넘으면 거르기 칸 + 묶음별 [전체]. */
function optionsHtml(c, ci) {
    const g = groupOptions(c.opts);
    const many = c.opts.length > MANY_OPTIONS;
    const f = optFilter.get(ci) || '';
    const vis = (it) => !f || optionMatches(c.opts[it.oi], f);
    let nVis = 0;   // 그린 칩 가운데 보이는 것(접힌 사라진 옵션은 안 셈 — applyFilter 와 같게)
    const groupHtml = (grp, gi, { head = true, gone = false } = {}) => {
        const items = grp.items;
        const nOn = items.filter(it => picked.has(`${ci}:${it.oi}`)).length;
        const visItems = items.filter(vis);
        nVis += visItems.length;
        const allOn = visItems.length > 0 && visItems.every(it => picked.has(`${ci}:${it.oi}`));
        const allBtn = many && !gone ? `<button type="button" data-mgall="${escapeHtml(`${ci}:${gi}`)}" class="text-[11px] font-bold text-teal-700 border border-teal-300 bg-white hover:bg-teal-50 rounded px-2 min-h-[32px]">${allOn ? '전체 해제' : '전체'}</button>` : '';
        const headHtml = head ? `<div class="flex items-center gap-2 mb-1">
                <span class="text-xs font-bold text-gray-800">${escapeHtml(grp.color || '(색상 없음)')}</span>
                <span class="text-[11px] text-gray-500">${escapeHtml(items.length)}개${nOn ? ` · ${escapeHtml(nOn)}개 고름` : ''}</span>${allBtn}</div>` : (allBtn ? `<div class="mb-1">${allBtn}</div>` : '');
        return `<div data-mgroup="${escapeHtml(gi)}" class="${visItems.length ? '' : 'hidden'}">${headHtml}
            <div class="flex flex-wrap gap-1.5">${items.map(it => chipHtml(ci, it, c.opts[it.oi])).join('')}</div></div>`;
    };
    const live = g.groups.map((grp, gi) => groupHtml(grp, gi, { head: g.grouped })).join('');
    let goneHtml = '';
    if (g.gone.length) {
        const goneGrp = { color: '', items: g.gone };
        if (!g.groups.length) {
            goneHtml = groupHtml(goneGrp, 'gone', { head: false, gone: true });   // 살아 있는 옵션이 없으면 접지 않는다
        } else {
            const open = goneOpen.has(ci) || g.gone.some(it => picked.has(`${ci}:${it.oi}`));
            goneHtml = `<div class="border-t border-dashed border-gray-200 pt-2">
                <button type="button" data-mgone="${escapeHtml(ci)}" aria-expanded="${open ? 'true' : 'false'}" class="text-xs font-bold text-gray-500 hover:text-gray-700 min-h-[32px]">사라진 옵션 ${escapeHtml(g.gone.length)}개 ${open ? '▴' : '▾'}</button>
                ${open ? groupHtml(goneGrp, 'gone', { head: false, gone: true }) : ''}</div>`;
        }
    }
    const filterHtml = many ? `<input type="text" data-mfilter="${escapeHtml(ci)}" value="${escapeHtml(f)}" autocomplete="off" maxlength="40"
            class="w-full p-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-teal-500 min-h-[44px]"
            placeholder="옵션 ${escapeHtml(c.opts.length)}개 — 색상·사이즈로 거르기 (예: 블랙 M)">` : '';
    return `<div data-mwrap="${escapeHtml(ci)}" class="px-3 pb-3 space-y-2">${filterHtml}${live}${goneHtml}
        <div data-mnone class="${!f || nVis ? 'hidden ' : ''}text-xs text-gray-500">거르기에 맞는 옵션이 없습니다.</div></div>`;
}

/** 거르기 글자가 바뀜 — 다시 그리지 않고 숨김만 바꾼다(입력 중인 한글 조합·초점이 끊기지 않게). */
function applyFilter(ci) {
    const box = el('insp-manual-results');
    const wrap = box && box.querySelector(`[data-mwrap="${ci}"]`);
    if (!wrap) return;
    const f = optFilter.get(ci) || '';
    let any = false;
    wrap.querySelectorAll('[data-mgroup]').forEach(gEl => {
        let n = 0;
        gEl.querySelectorAll('[data-mopt]').forEach(b => {
            const o = optOf(ci, Number(b.dataset.mopt.split(':')[1]));
            const show = !!o && (!f || optionMatches(o, f));
            b.classList.toggle('hidden', !show);
            if (show) n++;
        });
        gEl.classList.toggle('hidden', n === 0);
        if (n) any = true;
    });
    const none = wrap.querySelector('[data-mnone]');
    if (none) none.classList.toggle('hidden', any || !f);
}

/** 묶음 [전체] — 거르기에 맞는(보이는) 살아 있는 옵션을 다 고르거나, 다 골라져 있으면 다 푼다. */
function toggleGroup(ci, gi) {
    const c = cands[ci];
    if (!c) return;
    const grp = groupOptions(c.opts).groups[gi];
    if (!grp) return;
    const f = optFilter.get(ci) || '';
    const keys = grp.items.filter(it => !f || optionMatches(c.opts[it.oi], f)).map(it => `${ci}:${it.oi}`);
    const allOn = keys.length > 0 && keys.every(k => picked.has(k));
    keys.forEach(k => { if (allOn) picked.delete(k); else picked.add(k); });
}

function renderResults() {
    const box = el('insp-manual-results');
    if (!box) return;
    if (!cands.length) { box.innerHTML = ''; return; }
    box.innerHTML = cands.map((c, ci) => {
        const open = expanded.has(ci);
        const nPicked = c.opts.filter((o, oi) => picked.has(`${ci}:${oi}`)).length;
        const tag = MATCH_LABEL[c.match] ? `<span class="text-[11px] font-bold text-teal-800 bg-teal-50 px-1.5 py-0.5 rounded-full whitespace-nowrap">${escapeHtml(MATCH_LABEL[c.match])}</span>` : '';
        const gone = c.gone ? '<span class="text-[11px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full whitespace-nowrap">사라진 상품</span>' : '';
        const cnt = nPicked ? `<span class="text-[11px] font-bold text-white bg-teal-600 px-1.5 py-0.5 rounded-full whitespace-nowrap">${escapeHtml(nPicked)}개 고름</span>` : '';
        const chips = open ? optionsHtml(c, ci) : '';
        return `<div class="border ${nPicked ? 'border-teal-400' : 'border-gray-200'} rounded-lg ${c.gone ? 'bg-gray-50' : 'bg-white'}">
            <button type="button" data-mcand="${escapeHtml(ci)}" aria-expanded="${open ? 'true' : 'false'}" class="w-full text-left px-3 py-2 min-h-[44px] flex items-start gap-2">
                <span class="min-w-0 flex-1">
                    <span class="block font-bold text-sm text-gray-900 break-words">${escapeHtml(c.name || '(상품명 없음)')}</span>
                    <span class="flex flex-wrap items-center gap-1 mt-0.5 text-[11px] text-gray-500"><span class="font-mono">${escapeHtml(c.code2 || c.pid)}</span> · 옵션 ${escapeHtml(c.opts.length)}개 ${tag}${gone}${cnt}</span>
                </span>
                <span class="text-gray-400 text-sm flex-shrink-0">${open ? '▴' : '▾'}</span>
            </button>${chips}
        </div>`;
    }).join('') + (more ? `<div class="text-[11px] text-gray-500 text-center py-1">상품명 후보는 ${NAME_LIMIT}개까지만 보입니다 — 더 자세히 입력해 주세요.</div>` : '');
}

async function runSearch() {
    const q = el('insp-manual-q');
    const term = q ? q.value.trim() : '';
    if (!term) { setStatus('상품명·상품코드·바코드를 입력해 주세요.', true); return; }
    if (busy) { refuseBusy(); return; }   // 검색칸 글자는 남겨 둔다
    if (!catalogP) setStatus('상품 목록 불러오는 중…');
    try {
        await ensureCatalog();
    } catch (e) {
        console.warn('[개별 추가] 상품 목록 읽기 실패:', e && e.code ? e.code : e);
        if (!isOpen()) return;
        setStatus('상품 목록을 읽지 못했습니다. 잠시 뒤 다시 찾거나 [직접 입력]을 쓰세요.', true);
        return;
    }
    if (!isOpen()) return;
    if (!el('insp-manual-q') || el('insp-manual-q').value.trim() !== term) return;   // 그사이 다른 글자로 찾았다
    if (busy) { refuseBusy(); return; }   // 상품 목록을 기다리는 사이 넣기가 시작됐다
    const r = findCandidates(PS.products, term, { limit: NAME_LIMIT });
    searchSeq++;
    cands = r.items;
    more = r.more;
    expanded = new Set();
    picked = new Set();
    optFilter = new Map();
    goneOpen = new Set();
    cands.forEach((c, ci) => {
        if (c.match !== 'name') {
            expanded.add(ci);
            c.opts.forEach((o, oi) => { if (c.pre.includes(o.code)) picked.add(`${ci}:${oi}`); });
        }
    });
    if (cands.length === 1) expanded.add(0);
    const qp = quickPick(cands);   // 바코드·옵션 상품코드로 옵션 하나가 정해짐 → 바로 넣기
    quickKey = qp ? `${qp.ci}:${qp.oi}` : '';
    if (quickKey) picked = new Set([quickKey]);
    const nExact = cands.filter(c => c.match !== 'name').length;
    if (quickKey) setStatus(needText() ? `옵션이 하나로 정해졌습니다(${pickLabel()}) — ${target === 'total' ? '사유를 적고 Enter(또는 [1개 추가])를 누르면' : '유형을 고르면'} 바로 넣습니다.`
        : `${pickLabel()} 넣는 중…`);
    else if (!PS.meta) setStatus('상품 DB 가 비어 있습니다 — [직접 입력]을 쓰세요.', true);
    else if (!cands.length) setStatus('찾는 상품이 없습니다 — 상품 DB 에 없으면 [직접 입력]으로 넣을 수 있습니다.', true);
    else setStatus(`후보 ${cands.length}개${nExact ? ` (코드·바코드 일치 ${nExact}개)` : ''} — 상품을 눌러 옵션을 고르세요(여러 개 가능).`
        + (locWarn ? ' · 위치를 읽지 못해 로케이션은 비워서 넣습니다.' : ''));
    renderResults();
    renderSummary();
    if (quickKey) tryQuick();
}

// ── 바로 넣기 ─────────────────────────────────────────────────────────
/** 바로 넣을 옵션이 그대로 골라져 있나(그 뒤 칩을 더 고르거나 풀었으면 보통 [추가] 흐름). */
function quickReady() {
    return !!quickKey && mode === 'find' && picked.size === 1 && picked.has(quickKey);
}

/** 고른 옵션 하나의 표시 이름 '상품명 / 옵션' */
function pickLabel() {
    const [ci, oi] = quickKey.split(':').map(Number);
    const c = cands[ci], o = c && c.opts[oi];
    if (!c || !o) return '';
    return o.option ? `${c.name} / ${o.option}` : c.name;
}

/** 필수 칸(유형·사유)이 차 있으면 바로 넣고, 비었으면 그 칸에 초점(고르는 순간·Enter 에 다시 불린다). */
function tryQuick() {
    if (!quickReady()) return;
    if (needText()) { focusNeed(); return; }
    if (busy) { refuseBusy(); return; }
    addPicked({ stay: true });
}

/** 넣는 중(바로 넣기·[N개 추가] 모두)에 들어온 스캔·검색 — 거절하고 알린다. 검색칸 글자는 그대로. */
function refuseBusy() {
    showToast(BUSY_SCAN_MSG, true);
    setStatus(BUSY_SCAN_MSG, true);
}

function focusNeed() {
    const f = target === 'total' ? el('insp-manual-reason')
        : (document.querySelector('input[name="insp-manual-kind"]:checked') || document.querySelector('input[name="insp-manual-kind"]'));
    if (!f) return;
    f.scrollIntoView({ block: 'nearest' });
    f.focus();
}

/** 바로 넣은 뒤 — 창은 열어 둔 채 결과를 비우고 검색칸에 초점(다음 스캔). 유형·사유는 그대로. */
function readyForNext(msg, term) {
    cands = []; more = false; expanded = new Set(); picked = new Set();
    quickKey = ''; optFilter = new Map(); goneOpen = new Set();
    renderResults();
    const q = el('insp-manual-q');
    if (q && q.value.trim() === term) q.value = '';
    if (q) q.focus();
    setStatus(`${msg || '넣었습니다'} — 다음 상품을 찾거나 스캔하세요. 끝나면 [닫기].`);
    const cancel = el('insp-manual-cancel-btn');
    if (cancel) cancel.textContent = '닫기';
}

function startScan() {
    if (target === 'total') {   // 전량 쪽 — 이 창 안에서 카메라를 켠다(누르면 켜고, 켜져 있으면 끈다)
        const box = el('insp-manual-scan-box');
        if (!box) { showToast('카메라 스캔을 쓸 수 없습니다.', true); return; }
        if (inlineScan) { stopInlineScan(); return; }
        box.classList.remove('hidden');
        inlineScan = startInlineScanner('insp-manual-reader', (text) => {
            inlineScan = null;
            box.classList.add('hidden');
            if (!isOpen()) return;
            setMode('find');
            const q = el('insp-manual-q');
            if (q) q.value = String(text).trim();
            runSearch();
        }, () => { inlineScan = null; box.classList.add('hidden'); });
        box.scrollIntoView({ block: 'nearest' });
        return;
    }
    const root = el(PICKER_ID);
    const sc = document.getElementById('insp-scanner-container');
    if (!root || !sc) { showToast('카메라 스캔을 쓸 수 없습니다.', true); return; }
    hiddenForScan = true;
    root.classList.add('hidden');
    // 숨긴 동안 검수 창을 닫으면(× · ESC) 이 창도 같이 닫는다 — 숨은 창이 남아 다음 스캔을 가로채지 않게
    const manager = document.getElementById('inspection-manager-modal');
    if (manager && !managerObs && typeof MutationObserver !== 'undefined') {
        managerObs = new MutationObserver(() => {
            if (manager.classList.contains('hidden') && hiddenForScan) closePicker();
        });
        managerObs.observe(manager, { attributes: true, attributeFilter: ['class'] });
    }
    if (sc.classList.contains('hidden')) toggleScanner();
    sc.scrollIntoView({ block: 'center' });
}

// ── 직접 입력: 그 이름의 이력 문서를 한 번 읽어 '지난 검수 n회 / 처음' ────────
function renderTypedHist() {
    const h = el('insp-manual-t-hist');
    if (!h) return;
    const t = typedHist;
    h.textContent = t.state === 'loading' ? '지난 검수 기록 확인 중…'
        : t.state === 'found' ? `지난 검수 ${t.count}회${t.thickness ? ` · 지난 두께 ${t.thickness}` : ''}`
        : t.state === 'none' ? '처음 검수하는 상품입니다(이 이름의 검수 기록 없음)'
        : t.state === 'error' ? '지난 검수 기록을 확인하지 못했습니다' : '';
}

function scheduleTypedHist(ms) {
    clearTimeout(typedTimer);
    typedTimer = setTimeout(() => { checkTypedHist(); }, ms);
}

function checkTypedHist() {
    const input = el('insp-manual-t-name');
    const id = historyId(input ? input.value : '');
    if (typedP && typedP.id === id) return typedP.promise;   // 같은 이름을 읽는 중이면 그 결과를 같이 기다린다
    if (id === typedHist.id && typedHist.state && typedHist.state !== 'error' && typedHist.state !== 'loading') return Promise.resolve(typedHist);
    const promise = readTypedHist(id);
    typedP = { id, promise };
    promise.finally(() => { if (typedP && typedP.promise === promise) typedP = null; });
    return promise;
}

async function readTypedHist(id) {
    const seq = ++typedSeq;
    typedHist = { id, state: id ? 'loading' : '', count: 0, thickness: '' };
    renderTypedHist();
    if (!id) return typedHist;
    let next;
    try {
        const snap = await getDoc(doc(State.db, 'product_history', id));
        next = snap.exists()
            ? { id, state: 'found', count: Number(snap.data().totalInbound) || 0, thickness: thicknessFromHistoryDoc(snap.data()) }
            : { id, state: 'none', count: 0, thickness: '' };
    } catch (e) {
        console.warn('[개별 추가] 이력 확인 실패:', e && e.code ? e.code : e);
        next = { id, state: 'error', count: 0, thickness: '' };
    }
    if (seq === typedSeq) { typedHist = next; renderTypedHist(); }
    return next;
}

/** 상품 DB 후보의 이력 문서 — 상품명(`/`→`-`) 문서가 있으면 그 두께. 없으면 lastCode 로 찾아 그 문서 id 를 상품명으로 쓴다.
 *  @returns {{ name: string, thickness: string }} name '' = 상품 DB 상품명 그대로 */
export async function resolveHistory(cand, codes) {
    try {
        const id = historyId(cand.name);
        if (id) {
            const snap = await getDoc(doc(State.db, 'product_history', id));
            if (snap.exists()) return { name: '', thickness: thicknessFromHistoryDoc(snap.data()) };
        }
        const list = historyCodes(cand, codes);
        if (!list.length) return { name: '', thickness: '' };
        const qs = await getDocs(query(collection(State.db, 'product_history'), where('lastCode', 'in', list), fsLimit(10)));
        const docs = [];
        const byId = new Map();
        qs.forEach(d => { const x = d.data() || {}; docs.push({ id: d.id, lastCode: x.lastCode }); byId.set(d.id, x); });
        const hit = pickHistoryByCode(docs, codes);
        return hit ? { name: hit, thickness: thicknessFromHistoryDoc(byId.get(hit)) } : { name: '', thickness: '' };
    } catch (e) {
        console.warn('[개별 추가] 이력 찾기 실패(두께 없이 넣음):', e && e.code ? e.code : e);
        return { name: '', thickness: '' };
    }
}

/** 샘플검수 대기 리스트에 넣기(예전 addSelected 안의 트랜잭션·화면 처리를 그대로 옮김) — 창을 닫은 뒤 부를 함수를 돌려준다.
 *  stay = 바로 넣기(창을 열어 둔 채 다음 스캔) — 리스트만 다시 그리고 토스트만, 줄은 열지 않는다. 돌려준 함수는 안내 글자를 돌려준다. */
async function addToSampleList(items, { stay = false, label = '' } = {}) {
    const ref = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString());
    const res = await runTransaction(State.db, async (tx) => {
        const snap = await tx.get(ref);
        const cur = snap.exists() && Array.isArray(snap.data().inspectionList) ? snap.data().inspectionList : [];
        const out = addToList(cur, items);
        if (out.added.length) tx.set(ref, { inspectionList: out.list }, { merge: true });
        return out;
    });
    // 실시간 구독(js/app-sync.js)도 곧 같은 값으로 바꾼다 — 화면은 먼저 서버 결과로
    State.appState.inspectionList = res.list;
    return () => {
        renderTodoList();
        if (stay) {
            const msg = res.added.length ? `${label} 추가됨` : `이미 리스트에 있음 — ${label}`;
            showToast(msg);
            return msg;
        }
        if (res.added.length) {
            showToast(`${res.added.length}개 추가 (총 ${res.list.length}개)` + (res.dup.length ? ` · 이미 리스트에 있음 ${res.dup.length}개` : ''));
        } else {
            showToast('이미 리스트에 있음 — 그 줄을 엽니다.');
        }
        if (res.open !== -1) selectTodoItem(res.open, { silent: true });
    };
}

/** [추가] 버튼 — 바로 넣을 옵션 하나만 골라져 있으면 바로 넣기(창을 열어 둠), 아니면 보통 넣기(넣고 닫음). */
async function addSelected() {
    return addPicked({ stay: quickReady() });
}

async function addPicked({ stay = false } = {}) {
    if (busy) return;
    const seq = searchSeq;
    const term = el('insp-manual-q') ? el('insp-manual-q').value.trim() : '';
    const label = stay ? pickLabel() : '';   // 넣는 사이 새로 찾으면 cands 가 바뀌므로 먼저
    const isTotal = target === 'total';
    const reason = reasonText();
    if (isTotal && !reason) { showToast('전량검수 사유를 입력해 주세요.', true); return; }
    if (!isTotal && !kind) { showToast('유형(샘플 / 요청확인)을 골라 주세요.', true); return; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        showToast('인터넷 연결이 끊겨 넣지 못했습니다. 연결을 확인한 뒤 다시 눌러 주세요.', true);
        return;
    }
    busy = true;
    renderSummary();
    try {
        const now = new Date().toISOString();
        const items = [];
        if (mode === 'find') {
            const groups = pickedGroups();
            if (!groups.length) { showToast('옵션을 골라 주세요.', true); return; }
            for (const g of groups) {
                const h = await resolveHistory(g.cand, g.opts.map(o => o.code));
                g.opts.forEach(o => items.push(isTotal
                    ? totalItemOf(g.cand, o, { loc: locOf(o.code), historyName: h.name })
                    : manualItem(g.cand, o, { kind, loc: locOf(o.code), thickness: h.thickness, historyName: h.name, now })));
            }
        } else {
            const nameEl = el('insp-manual-t-name');
            if (!nameEl || !historyId(nameEl.value)) { showToast('상품명을 입력해 주세요.', true); return; }
            const typed = {
                name: nameEl.value,
                option: el('insp-manual-t-option') ? el('insp-manual-t-option').value : '',
                code: el('insp-manual-t-code') ? el('insp-manual-t-code').value : '',
            };
            let it;
            if (isTotal) {
                it = typedTotalItem(typed);   // 전량은 두께·지난 검수 횟수를 쓰지 않는다
            } else {
                clearTimeout(typedTimer);   // 입력 직후 눌렀으면 대기 중인 확인을 지금 하고 그 결과를 기다린다
                const h = await checkTypedHist();
                it = typedItem({ ...typed, kind, thickness: h && h.state === 'found' ? h.thickness : '', now });
            }
            if (!it) { showToast('상품명을 입력해 주세요.', true); return; }
            items.push(it);
        }

        const add = onAddFn || addToSampleList;
        const after = await add(items.filter(Boolean), { reason, stay, label });
        busy = false;
        if (stay) {
            const msg = typeof after === 'function' ? after() : '';
            // 넣는 동안 검색은 거절되지만(refuseBusy) 혹시 회차가 바뀌었으면 그 화면은 비우지 않는다
            if (isOpen() && seq === searchSeq) readyForNext(typeof msg === 'string' ? msg : '', term);
        } else {
            closePicker();
            if (typeof after === 'function') after();
        }
    } catch (e) {
        console.error('[개별 추가] 넣기 실패:', e && e.code ? e.code : e);
        showToast(e && e.code === 'permission-denied' ? '넣을 권한이 없습니다.'
            : (e && e.userMessage) || (isTotal ? '전량검수 목록에 넣지 못했습니다. 다시 눌러 주세요.' : '검수 리스트에 넣지 못했습니다. 다시 눌러 주세요.'), true);
    } finally {
        busy = false;
        if (isOpen()) renderSummary();
    }
}

/** [+ 개별 추가]·[조회]에서 리스트에 없는 글자 — initial 이 있으면 그 글자로 바로 찾는다. 이미 열려 있으면 검색칸만 바꾼다.
 *  opts.target 'total' = 전량검수 진행 목록(사유 필수), opts.onAdd = 넣기 함수(없으면 샘플 대기 리스트).
 *  openManualAdd({ target, onAdd, text }) 처럼 첫 인자로 옵션만 줘도 된다. 다른 target 으로 열려 있으면 닫고 새로 연다. */
export function openManualAdd(initial = '', opts = {}) {
    if (initial && typeof initial === 'object') { opts = initial; initial = initial.text || ''; }
    const nextTarget = opts && opts.target === 'total' ? 'total' : 'sample';
    const text = String(initial || '').trim();
    if (isOpen() && el(PICKER_ID).dataset.target !== nextTarget) {
        if (busy) return;
        closePicker();
    }
    const existed = isOpen();
    target = nextTarget;
    onAddFn = opts && typeof opts.onAdd === 'function' ? opts.onAdd : null;
    const root = ensureShell();
    if (hiddenForScan) { root.classList.remove('hidden'); hiddenForScan = false; }
    if (!existed) {
        kind = '';
        setMode('find');
        setStatus(catalogP ? '' : '처음 찾을 때 상품 목록을 불러옵니다.');
        renderTypedHist();
        renderSummary();
        ensureCatalog().catch(() => { /* 찾기 때 안내 */ });
    }
    const q = el('insp-manual-q');
    if (text) {
        setMode('find');
        if (q) q.value = text;
        runSearch();
    } else if (q && !existed) {
        q.focus();
    }
}
