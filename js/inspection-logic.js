// === js/inspection-logic.js ===
import * as DOM from './dom-elements.js?v=202610261448';
import * as State from './state.js?v=202610261448';
import { updateDailyData } from './app-data.js?v=202610261448';
import { showToast, getCurrentTime, getTodayDateString, escapeHtml, showConfirm } from './utils.js?v=202610261448';
import { doc, getDoc, updateDoc, arrayUnion, serverTimestamp, increment, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 분리된 모듈 가져오기
import { clearImageState, setExistingPhoto, resolvePhotoForSave, isPhotoBusy, bumpPhotoEpoch } from './inspection-media.js?v=202610261448';
import { syncInspSegments } from './inspection-segments.js?v=202610261448';
import {
    CHECK_KEYS, LABELS, judge, missingFields, nextPendingIndex, prevIndex, progress,
    logIdentity, upsertLog, findLogForItem, addDefectSummary, defectSummaryOf, uniqueInboundCount,
    applyDoneToList, todoCardHtml, doneCardHtml
} from './lib/insp-flow.js?v=202610261448';

// 상태 변수
export let todayInspectionList = [];
export let currentTodoIndex = -1;
export let editingLogIndex = -1;
let editingIdentity = '';     // 수정 중인 기록의 logIdentity — 저장 때 index 대신 이걸로 다시 찾는다
let pendingSave = null;       // { key, saveId, date, time, inspector } — 저장 실패 뒤 다시 저장해도 같은 기록으로 (상품이 바뀌거나 성공하면 비움)
let shownList = null;         // 저장 직후 화면에만 쓰는 대기 리스트(State 는 실시간 구독이 바꾼다). 인자 없는 renderTodoList() 때 비움
let todoCollapsed = false;    // 휴대폰 대기 리스트 접힘 — app-sync 실시간 재렌더 때도 유지
let openedSnapshot = '';      // 상품을 열었을 때의 입력값(이전 이동 때 '바뀐 내용 버릴까' 확인용)
let saving = false;
let selectSeq = 0;           // 상품을 고를 때마다 +1 — 늦게 끝난 앞 상품 불러오기가 지금 상품을 덮지 않게
let historySeq = 0;          // 이력 조회마다 +1 — 늦게 온 앞 조회 결과가 지금 상품의 이력 칸을 덮지 않게

// js/inspection-editor.js 가 이 이름으로 import 한다
export const getUniqueInboundCount = uniqueInboundCount;

/** 화면이 보는 대기 리스트 — 저장 직후 구독이 오기 전에는 저장 결과(shownList), 그 밖에는 State. */
const currentList = () => shownList || State.appState.inspectionList || [];

const newSaveId = () => (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const FIELD_LABELS = { thickness: '두께', ...LABELS };
const SAVE_LABEL = '저장하고 다음 ▶';
const EDIT_LABEL = '수정 저장';
const OFFLINE_MSG = '연결이 끊겨 저장하지 못했습니다(입력은 남아 있습니다)';

const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
};
/** 'YYYY-MM-DD…' → 'MM-DD'(그 밖의 모양은 그대로). */
const mmdd = (d) => {
    const s = String(d || '').trim();
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(5, 10) : (s || '-');
};
const stripLabel = (el, label) => (el ? el.textContent.replace(label, '').trim() : '') || '-';

/** 휴대폰 맨 위 줄(#insp-cur-bar)·상품 정보 칸(#insp-info-card) — 보이기는 CSS(휴대폰만), 여기서는 글자와
 *  #insp-modal-content 의 .insp-has-item(입력칸이 열려 있을 때)만 맞춘다. 값은 칩(#insp-*-display)·리스트 항목에서 읽는다. */
const updateMobileSummary = () => {
    const content = document.getElementById('insp-modal-content');
    if (!content) return;
    const hasItem = !!(DOM.inspCurrentInputArea && !DOM.inspCurrentInputArea.classList.contains('hidden'));
    content.classList.toggle('insp-has-item', hasItem);
    if (!hasItem) content.classList.remove('insp-search-open');
    const toggle = document.getElementById('insp-search-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', content.classList.contains('insp-search-open') ? 'true' : 'false');
    if (!hasItem) return;

    const list = currentList();
    const item = currentTodoIndex >= 0 ? list[currentTodoIndex] : null;
    setText('insp-cur-name', (DOM.inspReportTitle && DOM.inspReportTitle.textContent.trim()) || '-');
    const meta = [stripLabel(DOM.inspOptionDisplay, '옵션: ')];
    if (list.length > 0) {
        const p = progress(list);
        meta.push(`${p.done}/${p.total} 진행`);
    }
    setText('insp-cur-meta', meta.join(' · '));
    const editBadge = document.getElementById('insp-cur-edit');
    if (editBadge) editBadge.classList.toggle('hidden', editingLogIndex === -1);

    const code = item ? (item.code || '') : stripLabel(DOM.inspCodeDisplay, '코드: ');
    const line1 = [code && code !== '-' ? code : ''];
    if (item) {
        if (item.location) line1.push(item.location);
        if (item.sampleLocation) line1.push(`샘플 ${item.sampleLocation}`);
        if (item.packingDate) line1.push(`출고 ${mmdd(item.packingDate)}`);
    }
    setText('insp-info-line1', line1.filter(Boolean).join(' · ') || '-');
    setText('insp-info-line2', `공급처 ${item ? (item.supplierCode || item.supplierName || '-') : '-'}`);
};

/** 휴대폰 이력 한 줄(#insp-report-line). warn 이면 빨간 글자. */
const setReportLine = (text, warn = false) => {
    const el = document.getElementById('insp-report-line');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('text-red-700', warn);
    el.classList.toggle('text-blue-800', !warn);
};

/** 🔍 — 휴대폰에서 접어 둔 '상품명 검색' 줄을 펼치기/접기. */
export const toggleSearchRow = () => {
    const content = document.getElementById('insp-modal-content');
    if (!content) return;
    const open = content.classList.toggle('insp-search-open');
    updateMobileSummary();
    if (open) {
        const row = document.getElementById('insp-search-row');
        if (row) row.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
};

const setSaveBtnLabel = () => {
    const btn = document.getElementById('insp-save-next-btn');
    updateMobileSummary();   // 수정 중 배지
    if (!btn) return;
    const editing = editingLogIndex !== -1;
    btn.innerHTML = `<span>${editing ? EDIT_LABEL : SAVE_LABEL}</span>`;
    btn.classList.toggle('bg-blue-600', editing);
    btn.classList.toggle('hover:bg-blue-700', editing);
    btn.classList.toggle('bg-green-600', !editing);
    btn.classList.toggle('hover:bg-green-700', !editing);
};

/** 아래 바 버튼 사용 가능 여부 — 저장: 입력칸이 보일 때, 이전: 리스트에서 고른 상품 앞에 칸이 있을 때. */
const updateNavButtons = () => {
    const list = currentList();
    const inputShown = !!(DOM.inspCurrentInputArea && !DOM.inspCurrentInputArea.classList.contains('hidden'));
    const saveBtn = document.getElementById('insp-save-next-btn');
    if (saveBtn) saveBtn.disabled = saving || !inputShown || isPhotoBusy();   // 사진을 읽고 줄이는 동안에도 막는다
    const prevBtn = document.getElementById('insp-prev-btn');
    if (prevBtn) prevBtn.disabled = saving || currentTodoIndex < 0 || prevIndex(list, currentTodoIndex) === -1;
    updateMobileSummary();
};

/** 대기 리스트 접힘 표시(휴대폰만 CSS 가 숨긴다) + 토글 글자 '3/10 완료 ▾'. */
const updateTodoPanel = () => {
    const list = currentList();
    const collapsed = todoCollapsed && list.length > 0;
    const panel = document.getElementById('insp-todo-panel');
    if (panel) panel.classList.toggle('insp-todo-collapsed', collapsed);
    const toggle = document.getElementById('insp-todo-toggle');
    if (toggle) {
        toggle.textContent = `${progress(list).text} ${collapsed ? '▾' : '▴'}`;
        toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }
};

// 사진 처리 시작·끝(js/inspection-media.js) → 저장 버튼 다시 판단
if (typeof document !== 'undefined') {
    document.addEventListener('insp:photo-busy', () => updateNavButtons());
}

export const toggleTodoCollapsed = () => {
    todoCollapsed = !todoCollapsed;
    updateTodoPanel();
};

/** [☰ 목록] — 대기 리스트를 펼치고 그 자리로 스크롤(다른 상품을 고르려고 위로 올라갈 필요 없게). */
export const openTodoList = () => {
    todoCollapsed = false;
    updateTodoPanel();
    const panel = document.getElementById('insp-todo-panel');
    if (panel) panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
};

const hideSaveError = () => {
    const box = document.getElementById('insp-save-error');
    if (box) box.classList.add('hidden');
    const noPhoto = document.getElementById('insp-save-nophoto-btn');
    if (noPhoto) noPhoto.classList.add('hidden');
};

const showSaveError = (msg, offerNoPhoto = false) => {
    const box = document.getElementById('insp-save-error');
    const msgEl = document.getElementById('insp-save-error-msg');
    if (msgEl) msgEl.textContent = msg;
    const noPhoto = document.getElementById('insp-save-nophoto-btn');
    if (noPhoto) noPhoto.classList.toggle('hidden', !offerNoPhoto);
    if (box) box.classList.remove('hidden');
};

const saveErrorMessage = (e) => {
    const code = String((e && e.code) || '');
    if (code === 'insp/edit-missing') return '기록이 바뀌었습니다. 다시 불러오세요';
    if ((typeof navigator !== 'undefined' && navigator.onLine === false) || code === 'unavailable' || code === 'storage/retry-limit-exceeded') return OFFLINE_MSG;
    if (code === 'storage/unauthorized') return '사진을 올릴 권한이 없어 저장하지 못했습니다(입력은 남아 있습니다). 사진 빼고 저장할 수 있습니다';
    if (code.startsWith('storage/')) return '사진을 올리지 못해 저장하지 못했습니다(입력은 남아 있습니다)';
    if (code === 'permission-denied') return '저장 권한이 없어 저장하지 못했습니다(입력은 남아 있습니다)';
    return '저장하지 못했습니다(입력은 남아 있습니다). 다시 저장을 눌러 주세요';
};

const clearMissingMarks = () => {
    document.querySelectorAll('#inspection-manager-modal [data-insp-field].insp-missing')
        .forEach(f => f.classList.remove('insp-missing'));
};

/** 입력값 묶음(이전 이동 때 바뀌었는지 비교용). 사진은 미리보기 주소로 본다. */
const formSnapshot = () => {
    const ids = ['insp-inbound-date', 'insp-inbound-qty', 'insp-sample-qty', 'insp-notes', 'insp-check-thickness',
        ...CHECK_KEYS.map(k => `insp-check-${k}`)];
    const vals = ids.map(id => { const el = document.getElementById(id); return el ? el.value : ''; });
    const box = DOM.inspImagePreviewBox;
    const img = DOM.inspImagePreviewImg;
    vals.push(box && img && !box.classList.contains('hidden') ? (img.getAttribute('src') || '') : '');
    return JSON.stringify(vals);
};

export const resetEditingState = () => {
    editingLogIndex = -1;
    editingIdentity = '';
    setSaveBtnLabel();
    clearImageState();
};

export const initializeInspectionSession = async () => {
    todayInspectionList = [];
    currentTodoIndex = -1;
    pendingSave = null;
    todoCollapsed = false;
    hideSaveError();
    clearMissingMarks();
    clearImageState();
    resetEditingState();

    if (DOM.inspProductNameInput) DOM.inspProductNameInput.value = '';
    const qtyInput = document.getElementById('insp-inbound-qty');
    if (qtyInput) qtyInput.value = '';

    const sampleQtyInput = document.getElementById('insp-sample-qty');
    if (sampleQtyInput) sampleQtyInput.value = '1';

    const notesInput = document.getElementById('insp-notes');
    if (notesInput) notesInput.value = '';
    const thickInput = document.getElementById('insp-check-thickness');
    if (thickInput) thickInput.value = '';

    const packingDateInput = document.getElementById('insp-packing-date');
    if (packingDateInput) packingDateInput.value = '';

    const inboundDateInput = document.getElementById('insp-inbound-date');
    if (inboundDateInput) {
        inboundDateInput.value = getTodayDateString();
    }

    if (DOM.inspOptionDisplay) DOM.inspOptionDisplay.textContent = '옵션: -';
    if (DOM.inspCodeDisplay) DOM.inspCodeDisplay.textContent = '코드: -';
    if (DOM.inspSupplierDisplay) DOM.inspSupplierDisplay.textContent = '공급처: -';
    if (DOM.inspThicknessRef) DOM.inspThicknessRef.textContent = '기준: -';

    const selects = document.querySelectorAll('#insp-current-input-area select');
    selects.forEach(sel => sel.value = "");
    syncInspSegments();

    if (DOM.inspImageInput) DOM.inspImageInput.value = '';

    if (DOM.inspHistoryReport) DOM.inspHistoryReport.classList.add('hidden');
    if (DOM.inspCurrentInputArea) DOM.inspCurrentInputArea.classList.add('hidden');
    if (DOM.inspAlertBox) DOM.inspAlertBox.classList.add('hidden');

    renderTodayInspectionList();

    const list = State.appState.inspectionList || [];
    if (list.length > 0) {
        const isAllCompleted = list.every(item => item.status === '완료');
        if (isAllCompleted) {
            State.appState.inspectionList = [];
            await updateDailyData({ inspectionList: [] });
            renderTodoList();
            showToast("이전 검수 리스트가 모두 완료되어 초기화되었습니다.");
        } else {
            renderTodoList();
        }
    } else {
        renderTodoList();
    }
    updateNavButtons();
};

export const deleteInspectionList = async () => {
    const list = State.appState.inspectionList || [];
    if (list.length === 0) {
        showToast("삭제할 리스트가 없습니다.", true);
        return;
    }
    const ok = await showConfirm("현재 검수 대기 리스트를 모두 삭제하시겠습니까?\n(검수 완료된 이력 데이터는 유지됩니다)", { title: '대기 리스트 삭제', okText: '삭제', danger: true });
    if (!ok) return;
    try {
        await updateDailyData({ inspectionList: [] });
        State.appState.inspectionList = [];
        renderTodoList();

        if (DOM.inspProductNameInput) DOM.inspProductNameInput.value = '';
        const qtyInput = document.getElementById('insp-inbound-qty');
        if (qtyInput) qtyInput.value = '';
        const sampleQtyInput = document.getElementById('insp-sample-qty');
        if (sampleQtyInput) sampleQtyInput.value = '1';

        if (DOM.inspOptionDisplay) DOM.inspOptionDisplay.textContent = '옵션: -';
        if (DOM.inspCodeDisplay) DOM.inspCodeDisplay.textContent = '코드: -';
        if (DOM.inspSupplierDisplay) DOM.inspSupplierDisplay.textContent = '공급처: -';
        if (DOM.inspThicknessRef) DOM.inspThicknessRef.textContent = '기준: -';

        currentTodoIndex = -1;
        pendingSave = null;
        hideSaveError();
        resetEditingState();
        // 입력칸·이력 칸을 닫는다 — updateNavButtons 가 휴대폰 맨 위 줄(.insp-has-item)도 함께 푼다
        if (DOM.inspHistoryReport) DOM.inspHistoryReport.classList.add('hidden');
        if (DOM.inspCurrentInputArea) DOM.inspCurrentInputArea.classList.add('hidden');
        if (DOM.inspAlertBox) DOM.inspAlertBox.classList.add('hidden');
        updateNavButtons();

        showToast("검수 리스트가 초기화되었습니다.");
    } catch (e) {
        console.error("Error deleting list:", e);
        showToast("리스트 삭제 중 오류가 발생했습니다.", true);
    }
};

export const deleteHistoryInspectionList = async (dateKey) => {
    if (!dateKey) return false;
    if (!confirm(`${dateKey} 출고일자 리스트를 삭제하시겠습니까?\n(이미 완료된 검수 이력 데이터는 삭제되지 않습니다)`)) {
        return false;
    }
    const todayKey = getTodayDateString();
    try {
        const dayData = State.allHistoryData.find(d => d.id === dateKey);
        if (dayData) {
            dayData.inspectionList = [];
        }
        if (dateKey === todayKey) {
            State.appState.inspectionList = [];
            await updateDailyData({ inspectionList: [] });
        } else {
            const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
            await updateDoc(docRef, { inspectionList: [] });
        }
        showToast(`${dateKey} 리스트가 삭제되었습니다.`);
        return true;
    } catch (e) {
        console.error("Error deleting history list:", e);
        showToast("리스트 삭제 중 오류가 발생했습니다.", true);
        return false;
    }
};

/** 카드 목록(data-index)에 클릭·Enter/Space 위임을 한 번만 붙인다. */
const bindCardDelegation = (container, onPick) => {
    if (!container || container.dataset.inspCardsBound) return;
    container.dataset.inspCardsBound = '1';
    const pick = (e) => {
        const card = e.target.closest('[data-index]');
        if (!card || !container.contains(card)) return null;
        const index = parseInt(card.dataset.index, 10);
        return Number.isInteger(index) ? index : null;
    };
    container.addEventListener('click', (e) => {
        const index = pick(e);
        if (index !== null) onPick(index);
    });
    container.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const index = pick(e);
        if (index === null) return;
        e.preventDefault();
        onPick(index);
    });
};

export const openInspectionListWindow = () => {
    const list = currentList();
    if (list.length === 0) {
        showToast("리스트 데이터가 없습니다.", true);
        return;
    }

    const packingDate = list[0].packingDate || getTodayDateString();
    const existingModal = document.getElementById('dynamic-inspection-list-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'dynamic-inspection-list-modal';
    modal.className = 'fixed inset-0 bg-gray-900 bg-opacity-90 flex items-center justify-center z-[200] p-2';

    const cardsHtml = list.map((item, idx) => todoCardHtml(item, idx)).join('');

    modal.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden animate-fade-in-up">
            <div class="p-4 bg-white border-b border-gray-200 flex justify-between items-center shrink-0">
                <div>
                    <h2 class="text-lg font-bold text-gray-900 flex items-center gap-2">
                        검수 대기 리스트
                        <span class="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full font-extrabold">${escapeHtml(progress(list).text)}</span>
                    </h2>
                    <p class="text-xs text-gray-500 mt-1">출고일자: <span class="font-bold text-gray-900">${escapeHtml(packingDate)}</span></p>
                </div>
                <button id="close-dynamic-modal-btn" class="text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-full p-2 transition min-h-[44px] min-w-[44px]" aria-label="닫기">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>
            <div class="flex-grow overflow-y-auto bg-gray-50 p-2">
                <div id="dynamic-insp-list-cards" class="divide-y divide-gray-100 bg-white border border-gray-200 rounded-lg">${cardsHtml}</div>
            </div>
            <div class="p-3 bg-gray-100 text-center border-t border-gray-200 text-xs text-gray-500 shrink-0">
                항목을 누르면 입력창에 자동 선택됩니다.
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('close-dynamic-modal-btn').addEventListener('click', () => modal.remove());
    bindCardDelegation(modal.querySelector('#dynamic-insp-list-cards'), (index) => {
        selectTodoItem(index);
        modal.remove();
    });
};

/** listOverride — 저장 직후 화면에만 쓰는 리스트(State 는 건드리지 않는다). 인자 없이 부르면(실시간 구독 등) State 로 돌아간다. */
export const renderTodoList = (listOverride) => {
    shownList = Array.isArray(listOverride) ? listOverride : null;
    const list = currentList();
    const todoArea = document.getElementById('insp-todo-list-area');
    const todoBody = document.getElementById('insp-todo-list-body');
    const placeholder = document.getElementById('insp-todo-empty-placeholder');
    updateTodoPanel();
    updateNavButtons();
    if (!todoArea || !todoBody) return;

    if (list.length > 0) {
        todoArea.classList.remove('hidden');
        if (placeholder) placeholder.classList.add('hidden');
    } else {
        todoArea.classList.add('hidden');
        if (placeholder) placeholder.classList.remove('hidden');
        todoBody.innerHTML = '';
        return;
    }

    // 카드 HTML 은 js/lib/insp-flow.js todoCardHtml(값은 전부 escape). 클릭은 위임으로 한 번만 붙인다
    todoBody.innerHTML = list.map((item, idx) => todoCardHtml(item, idx)).join('');
    bindCardDelegation(todoBody, (index) => selectTodoItem(index));
};

/** 대기 상품을 새 검수로 채운다(출고일·입고일·수량, 샘플 1, 메모·두께 비움). */
const fillNewInputs = (item) => {
    resetEditingState();

    const packingDateInput = document.getElementById('insp-packing-date');
    if (packingDateInput) packingDateInput.value = item.packingDate || '';

    const inboundDateInput = document.getElementById('insp-inbound-date');
    if (inboundDateInput) {
        inboundDateInput.value = item.inboundDate || getTodayDateString();
    }

    const qtyInput = document.getElementById('insp-inbound-qty');
    if (qtyInput) qtyInput.value = item.qty > 0 ? item.qty : '';

    const sampleQtyInput = document.getElementById('insp-sample-qty');
    if (sampleQtyInput) sampleQtyInput.value = '1';

    const notesInput = document.getElementById('insp-notes');
    if (notesInput) notesInput.value = '';

    const thickInput = document.getElementById('insp-check-thickness');
    if (thickInput) thickInput.value = '';
};

/** opts.silent — '선택됨' 토스트를 띄우지 않는다(저장 뒤 다음 상품으로 넘어갈 때 '저장됨 → 다음' 토스트와 겹치지 않게). */
export const selectTodoItem = async (index, opts = {}) => {
    if (saving) return;   // 저장 중에는 다른 상품으로 옮기지 않는다(저장이 끝나며 입력을 지운다)
    const item = currentList()[index];
    if (!item) return;
    const seq = ++selectSeq;

    currentTodoIndex = index;
    pendingSave = null;
    hideSaveError();
    clearMissingMarks();
    resetEditingState();   // 앞 상품의 수정 모드·선택값이 남지 않게(검색이 선택칸을 비운다)

    if (DOM.inspProductNameInput) DOM.inspProductNameInput.value = item.name;
    if (DOM.inspOptionDisplay) DOM.inspOptionDisplay.textContent = `옵션: ${item.option || '-'}`;
    if (DOM.inspCodeDisplay) DOM.inspCodeDisplay.textContent = `코드: ${item.code || '-'}`;

    let supplierText = `공급처: ${item.supplierCode || item.supplierName || '-'}`;
    if (item.location) supplierText += ` / 📦 Loc: ${item.location}`;
    if (item.sampleLocation) supplierText += ` / 📌 샘플: ${item.sampleLocation}`;
    if (item.packingDate) supplierText += ` / 📅 출고: ${item.packingDate}`;

    if (DOM.inspSupplierDisplay) DOM.inspSupplierDisplay.textContent = supplierText;
    if (DOM.inspThicknessRef) DOM.inspThicknessRef.textContent = `기준: ${item.thickness || '-'}`;

    await searchProductHistory();
    if (seq !== selectSeq) return;   // 그사이 다른 상품을 골랐다

    if (item.status === '완료') {
        // 그 옵션의 기록을 못 찾으면 수정 모드로 들어가지 않고 새 검수로(다른 색상 기록을 덮어쓰지 않게)
        const loaded = await loadCompletedInspectionData(item, seq);
        if (seq !== selectSeq) return;
        if (!loaded) fillNewInputs(item);
    } else {
        fillNewInputs(item);
    }

    todoCollapsed = true;
    updateTodoPanel();
    syncInspSegments();
    // 휴대폰은 상품 정보 칸(#insp-info-card)부터, PC 는 그 칸이 숨어 있으니 이력 칸부터 보이게
    const infoCard = document.getElementById('insp-info-card');
    const report = (infoCard && infoCard.offsetParent !== null) ? infoCard : document.getElementById('insp-history-report');
    if (report) report.scrollIntoView({ block: 'start' });
    updateNavButtons();
    openedSnapshot = formSnapshot();
    if (!(opts && opts.silent)) showToast(`'${item.name}' 선택됨`);
};
window.selectInspectionTodoItem = selectTodoItem;

/** ◀ 이전 — 리스트 바로 앞 상품으로. 입력이 열었을 때와 다르면 먼저 묻는다. 완료 상품이면 수정 모드로 불러온다. */
export const goPrevInspectionItem = async () => {
    if (saving) return;
    const list = currentList();
    const target = currentTodoIndex >= 0 ? prevIndex(list, currentTodoIndex) : -1;
    if (target === -1) {
        showToast('이전 상품이 없습니다.');
        return;
    }
    const inputShown = !!(DOM.inspCurrentInputArea && !DOM.inspCurrentInputArea.classList.contains('hidden'));
    if (inputShown && formSnapshot() !== openedSnapshot) {
        const ok = await showConfirm('입력한 내용이 아직 저장되지 않았습니다.\n이전 상품으로 이동하면 지금 입력이 사라집니다.', { title: '이전 상품으로', okText: '이동', cancelText: '머무르기' });
        if (!ok) return;
    }
    await selectTodoItem(target);
};

/** 완료 상품의 기록을 수정 모드로 불러온다. 출고일+옵션(+코드)이 맞는 기록이 없으면 false(부르는 쪽이 새 검수로 채움). */
const loadCompletedInspectionData = async (item, seq = selectSeq) => {
    try {
        const docRef = doc(State.db, 'product_history', item.name);
        const docSnap = await getDoc(docRef);
        if (seq !== selectSeq) return false;   // 늦게 도착 — 지금 상품이 아니면 수정 모드를 켜지 않는다

        if (docSnap.exists()) {
            const data = docSnap.data();
            const logs = data.logs || [];

            const realIndex = findLogForItem(logs, item);

            if (realIndex !== -1) {
                const log = logs[realIndex];

                const qtyInput = document.getElementById('insp-inbound-qty');
                if (qtyInput) qtyInput.value = log.inboundQty || 0;

                const sampleQtyInput = document.getElementById('insp-sample-qty');
                if (sampleQtyInput) sampleQtyInput.value = log.sampleQty || 1;

                const notesInput = document.getElementById('insp-notes');
                if (notesInput) notesInput.value = log.note || '';

                const packingDateInput = document.getElementById('insp-packing-date');
                if (packingDateInput) packingDateInput.value = log.packingDate || log.inboundDate || '';

                const inboundDateInput = document.getElementById('insp-inbound-date');
                if (inboundDateInput) inboundDateInput.value = log.inboundDate || '';

                const cl = log.checklist || {};
                const setSelect = (id, val) => {
                    const el = document.getElementById(id);
                    if (el) el.value = val || (el.options && el.options.length > 0 ? el.options[0].value : '');
                };

                const thickEl = document.getElementById('insp-check-thickness');
                if (thickEl) thickEl.value = cl.thickness || '';

                setSelect('insp-check-fabric', cl.fabric);
                setSelect('insp-check-color', cl.color);
                setSelect('insp-check-distortion', cl.distortion);
                setSelect('insp-check-unraveling', cl.unraveling);
                setSelect('insp-check-finishing', cl.finishing);
                setSelect('insp-check-zipper', cl.zipper);
                setSelect('insp-check-button', cl.button);
                setSelect('insp-check-lining', cl.lining);
                setSelect('insp-check-pilling', cl.pilling);
                setSelect('insp-check-dye', cl.dye);
                syncInspSegments();

                setExistingPhoto(log.image || null);

                editingLogIndex = realIndex;
                editingIdentity = logIdentity(log);
                setSaveBtnLabel();
                showToast("이전 검수 기록을 불러왔습니다. 수정 가능합니다.");
                return true;
            }
        }
        showToast("이 옵션의 이전 검수 기록을 찾지 못했습니다. 새 검수로 입력합니다.", true);
        resetEditingState();
        return false;
    } catch (e) {
        console.error("Error loading completed item details:", e);
        showToast("이전 검수 기록을 불러오지 못했습니다. 새 검수로 입력합니다.", true);
        resetEditingState();
        return false;
    }
};

export const searchProductHistory = async () => {
    let searchTerm = DOM.inspProductNameInput ? DOM.inspProductNameInput.value.trim() : document.getElementById('insp-product-name').value.trim();
    if (!searchTerm) {
        showToast('상품명 또는 상품코드를 입력해주세요.', true);
        return;
    }
    // 직접 검색으로 다른 상품을 열면 앞 상품의 수정 모드·저장 대기 기록을 버린다
    if (editingLogIndex !== -1) resetEditingState();
    bumpPhotoEpoch();   // 읽는 중이던 사진은 이 상품에 붙이지 않는다
    pendingSave = null;
    hideSaveError();
    clearMissingMarks();

    const list = currentList();
    let matchedIndex = -1;

    if (currentTodoIndex >= 0 && list[currentTodoIndex] && list[currentTodoIndex].name === searchTerm) {
        matchedIndex = currentTodoIndex;
    } else {
        matchedIndex = list.findIndex(item =>
            (item.code && item.code.trim() === searchTerm) ||
            (item.name && item.name.trim() === searchTerm)
        );
    }

    let targetProductName = searchTerm;

    if (matchedIndex > -1) {
        const matchedItem = list[matchedIndex];
        targetProductName = matchedItem.name;
        currentTodoIndex = matchedIndex;

        if(DOM.inspProductNameInput) DOM.inspProductNameInput.value = targetProductName;
        if (DOM.inspOptionDisplay) DOM.inspOptionDisplay.textContent = `옵션: ${matchedItem.option || '-'}`;
        if (DOM.inspCodeDisplay) DOM.inspCodeDisplay.textContent = `코드: ${matchedItem.code || '-'}`;

        let supplierText = `공급처: ${matchedItem.supplierCode || matchedItem.supplierName || '-'}`;
        if (matchedItem.location) supplierText += ` / 📦 Loc: ${matchedItem.location}`;
        if (matchedItem.sampleLocation) supplierText += ` / 📌 샘플: ${matchedItem.sampleLocation}`;
        if (matchedItem.packingDate) supplierText += ` / 📅 출고: ${matchedItem.packingDate}`;

        if (DOM.inspSupplierDisplay) DOM.inspSupplierDisplay.textContent = supplierText;
        if (DOM.inspThicknessRef) DOM.inspThicknessRef.textContent = `기준: ${matchedItem.thickness || '-'}`;

        const packingDateInput = document.getElementById('insp-packing-date');
        if (packingDateInput) packingDateInput.value = matchedItem.packingDate || '';

        const inboundDateInput = document.getElementById('insp-inbound-date');
        if (inboundDateInput) inboundDateInput.value = matchedItem.inboundDate || getTodayDateString();

        const qtyInput = document.getElementById('insp-inbound-qty');
        if (matchedItem.status !== '완료' && qtyInput) {
             qtyInput.value = matchedItem.qty > 0 ? matchedItem.qty : '';
        }
    } else {
        currentTodoIndex = -1;
        resetEditingState();

        if (DOM.inspOptionDisplay) DOM.inspOptionDisplay.textContent = '옵션: -';
        if (DOM.inspCodeDisplay) DOM.inspCodeDisplay.textContent = '코드: -';
        if (DOM.inspSupplierDisplay) DOM.inspSupplierDisplay.textContent = '공급처: -';
        if (DOM.inspThicknessRef) DOM.inspThicknessRef.textContent = '기준: -';

        const packingDateInput = document.getElementById('insp-packing-date');
        if (packingDateInput) packingDateInput.value = '';

        const inboundDateInput = document.getElementById('insp-inbound-date');
        if (inboundDateInput) inboundDateInput.value = getTodayDateString();

        const qtyInput = document.getElementById('insp-inbound-qty');
        if (qtyInput) qtyInput.value = '';
    }

    if(DOM.inspHistoryReport) DOM.inspHistoryReport.classList.remove('hidden');
    if(DOM.inspCurrentInputArea) DOM.inspCurrentInputArea.classList.remove('hidden');
    if(DOM.inspAlertBox) DOM.inspAlertBox.classList.add('hidden');
    if(DOM.inspReportTitle) DOM.inspReportTitle.textContent = targetProductName;
    setReportLine('이력 불러오는 중…');
    const contentEl = document.getElementById('insp-modal-content');
    if (contentEl) contentEl.classList.remove('insp-search-open');   // 휴대폰: 상품을 열면 검색 줄을 접는다

    if (editingLogIndex === -1) {
        const selects = document.querySelectorAll('#insp-current-input-area select');
        selects.forEach(sel => sel.value = "");
        syncInspSegments();
    }
    updateNavButtons();
    openedSnapshot = formSnapshot();

    const seq = ++historySeq;
    try {
        const docRef = doc(State.db, 'product_history', targetProductName);
        const docSnap = await getDoc(docRef);
        if (seq !== historySeq) return;   // 그사이 다른 상품을 조회했다 — 이력 칸을 덮지 않는다

        if (docSnap.exists()) {
            const data = docSnap.data();
            if(DOM.inspReportCount) DOM.inspReportCount.textContent = data.totalInbound || 0;
            // 최근 검수일 = 당일(오늘)을 제외한 가장 최근 검수 날짜
            if (DOM.inspReportDate) {
                const todayStr = getTodayDateString();
                const logs = Array.isArray(data.logs) ? data.logs : [];
                const pastDates = logs
                    .map(l => String(l.date || l.inboundDate || '').slice(0, 10))
                    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d !== todayStr)
                    .sort();
                let lastDate = pastDates.length ? pastDates[pastDates.length - 1] : '';
                if (!lastDate && data.lastInspectionDate && String(data.lastInspectionDate).slice(0, 10) !== todayStr) {
                    lastDate = data.lastInspectionDate; // 로그가 없어도 과거 검수일이 있으면 사용
                }
                DOM.inspReportDate.textContent = lastDate || '-';
            }

            let specialIssues = [];

            if (data.logs && data.logs.length > 0) {
                specialIssues = data.logs
                    .filter(log => {
                        const hasDefects = log.status === '불량' || (log.defects && log.defects.length > 0);
                        const hasNote = log.note && log.note.trim() !== '';
                        return hasDefects || hasNote;
                    })
                    .map(log => {
                        const date = log.date || log.inboundDate || '날짜미상';
                        const defectStr = (log.defects && log.defects.length > 0) ? log.defects.join(', ') : '';
                        const noteStr = log.note ? `[메모: ${log.note}]` : '';
                        const content = [defectStr, noteStr].filter(Boolean).join(' ');
                        return `${date}: ${content}`;
                    });
            }
            else if (data.defectSummary && data.defectSummary.length > 0) {
                specialIssues = data.defectSummary;
            }

            setReportLine(
                `총 ${data.totalInbound || 0}회 · 최근 ${mmdd(DOM.inspReportDate ? DOM.inspReportDate.textContent : '')} · `
                + (specialIssues.length > 0 ? `특이사항 있음 ${specialIssues.length}건` : '특이사항 없음'),
                specialIssues.length > 0
            );

            if (specialIssues.length > 0) {
                // 예전 alert 대신 빨간 상자를 굵게 — 건수 + 최근 3건(textContent 로만 넣는다)
                if (DOM.inspAlertBox) {
                    DOM.inspAlertBox.classList.remove('hidden', 'border-red-200');
                    DOM.inspAlertBox.classList.add('border-2', 'border-red-500');
                }
                if (DOM.inspAlertMsg) {
                    const recentIssues = specialIssues.slice(-3).reverse();
                    DOM.inspAlertMsg.replaceChildren();
                    const countLine = document.createElement('div');
                    countLine.className = 'font-bold';
                    countLine.textContent = `특이사항(불량/메모) ${specialIssues.length}건 — 최근 ${recentIssues.length}건:`;
                    DOM.inspAlertMsg.appendChild(countLine);
                    recentIssues.forEach(issue => {
                        const line = document.createElement('div');
                        line.className = 'break-words';
                        line.textContent = `· ${issue}`;
                        DOM.inspAlertMsg.appendChild(line);
                    });
                }
            }

            const newBadge = document.getElementById('insp-new-product-badge');
            if (newBadge) newBadge.classList.add('hidden');

        } else {
            if(DOM.inspReportCount) DOM.inspReportCount.textContent = '0 (신규)';
            setReportLine('최초 입고 상품 · 이력 없음');

            const newBadge = document.getElementById('insp-new-product-badge');
            if (newBadge) newBadge.classList.remove('hidden');

            if (editingLogIndex === -1) showToast('신규 상품입니다. (최초 입고)');
        }
    } catch (e) {
        console.error("Error searching product history:", e);
        if (seq !== historySeq) return;
        setReportLine('이력을 불러오지 못했습니다', true);
        showToast("이력 조회 중 오류가 발생했습니다.", true);
    }
};

/** 빈 칸 표시 — 빨간 테두리, 첫 칸으로 스크롤(두께면 커서), 짧은 토스트. */
const markMissing = (missing) => {
    clearMissingMarks();
    const root = document.getElementById('inspection-manager-modal') || document;
    missing.forEach(key => {
        const field = root.querySelector(`[data-insp-field="${key}"]`);
        if (field) field.classList.add('insp-missing');
    });
    const first = missing[0];
    const firstField = root.querySelector(`[data-insp-field="${first}"]`);
    if (firstField) firstField.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (first === 'thickness') {
        const thickInput = document.getElementById('insp-check-thickness');
        if (thickInput) {
            thickInput.focus({ preventScroll: true });
            // 두께는 선택 버튼이 아니라 segments 가 표시를 떼지 않는다 — 입력하면 뗀다
            thickInput.addEventListener('input', () => {
                const f = thickInput.closest('[data-insp-field]');
                if (f) f.classList.remove('insp-missing');
            }, { once: true });
        }
    }
    const firstLabel = FIELD_LABELS[first] || first;
    showToast(missing.length > 1 ? `${firstLabel} 외 ${missing.length - 1}개 미선택` : `${firstLabel} 미선택`, true);
};

export const saveInspectionAndNext = async () => {
    if (saving) return;
    if (isPhotoBusy()) {
        showToast('사진을 처리하는 중입니다. 잠시 뒤 저장해 주세요.', true);
        return;
    }
    const getVal = (id) => {
        const el = document.getElementById(id);
        return el ? el.value : '';
    };

    const rawName = (DOM.inspProductNameInput ? DOM.inspProductNameInput.value : getVal('insp-product-name')).trim();
    if (!rawName) {
        showToast('상품 조회를 먼저 진행해주세요.', true);
        return;
    }
    const productName = rawName.replace(/\//g, '-');

    const checklist = { thickness: getVal('insp-check-thickness') };
    CHECK_KEYS.forEach(k => { checklist[k] = getVal(`insp-check-${k}`); });

    const missing = missingFields({ thickness: checklist.thickness, checklist });
    if (missing.length > 0) {
        markMissing(missing);
        return;
    }
    clearMissingMarks();

    const inboundDate = getVal('insp-inbound-date') || getTodayDateString();
    const packingDate = getVal('insp-packing-date') || '-';
    const inboundQty = getVal('insp-inbound-qty');
    const sampleQty = getVal('insp-sample-qty') || 1;
    const note = getVal('insp-notes');

    let currentItem = null;
    if (currentTodoIndex >= 0 && currentList()[currentTodoIndex]) {
        currentItem = currentList()[currentTodoIndex];
    }

    const { defects: defectsFound, status } = judge(checklist);

    // 초기화하기 전에 잡아 둔다(예전에는 초기화 뒤에 보고 있어서 수정 저장 뒤에도 다음 상품으로 넘어갔다)
    const wasEditing = editingLogIndex !== -1;
    const editIdentity = wasEditing ? editingIdentity : '';

    // 저장 시도 한 번에 saveId·날짜·시각·검수자를 한 번만 정한다 — 실패 뒤 다시 저장해도 같은 saveId 라 두 번 쌓이지 않는다
    // (분 단위 logIdentity 는 옛 기록 수정 때만 쓴다)
    const key = [productName, currentTodoIndex, editIdentity].join('#');
    if (!pendingSave || pendingSave.key !== key) {
        pendingSave = {
            key,
            saveId: newSaveId(),
            date: getTodayDateString(),
            time: getCurrentTime(),
            inspector: State.appState.currentUser || 'Unknown'
        };
    }
    const today = pendingSave.date;
    const nowTime = pendingSave.time;

    const btn = document.getElementById('insp-save-next-btn');
    saving = true;
    hideSaveError();
    if (btn) { btn.disabled = true; btn.innerHTML = '<span>저장 중…</span>'; }
    updateNavButtons();

    try {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            throw Object.assign(new Error('offline'), { code: 'unavailable' });
        }

        const image = await resolvePhotoForSave();

        const inspectionRecord = {
            saveId: pendingSave.saveId,   // 새 저장 재시도 판정용(수정 저장이면 옛 기록의 값이 남는다 — upsertLog)
            date: today,
            time: nowTime,
            inspector: pendingSave.inspector,
            inboundDate: inboundDate,
            packingDate: packingDate,
            inboundQty: Number(inboundQty) || 0,
            sampleQty: Number(sampleQty) || 1,
            option: currentItem ? currentItem.option : '-',
            code: currentItem ? currentItem.code : '-',
            supplierName: currentItem ? currentItem.supplierName : '-',
            supplierCode: currentItem ? (currentItem.supplierCode || '') : '', // 패킹에서 만든 항목의 공급처 코드(실명 대신)
            location: currentItem ? currentItem.location : '-',
            checklist,
            defects: defectsFound,
            note,
            status,
            image: image || null
        };

        const productRef = doc(State.db, 'product_history', productName);
        const dailyRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', today);

        // 상품 이력 + 오늘 처리량 + 대기 리스트 완료 표시를 한 번에(하나만 반영되는 일이 없게). 선례 js/app-logic.js 업무 시작
        let outcome = null;
        await runTransaction(State.db, async (tx) => {
            const productSnap = await tx.get(productRef);
            const dailySnap = await tx.get(dailyRef);
            const productData = productSnap.exists() ? productSnap.data() : {};
            const logs = Array.isArray(productData.logs) ? productData.logs : [];

            // 수정 저장은 identity 를 옛 값으로 지키므로(upsertLog), 응답만 못 받고 다시 저장해도 같은 기록을 찾는다(차이 0)
            const r = upsertLog(logs, inspectionRecord, { editIdentity: editIdentity || undefined, today });
            if (r.mode === 'missing') {
                throw Object.assign(new Error('기록이 바뀌었습니다. 다시 불러오세요'), { code: 'insp/edit-missing' });
            }

            if (r.mode === 'append') {
                const updates = {
                    lastInspectionDate: today,
                    totalInbound: uniqueInboundCount(r.logs),
                    logs: arrayUnion(inspectionRecord),
                    updatedAt: serverTimestamp()
                };
                if (currentItem) {
                    updates.lastCode = currentItem.code;
                    updates.lastOption = currentItem.option;
                    updates.lastSupplierCode = currentItem.supplierCode || ''; // 비면 표시가 이름 쪽으로 넘어간다
                    if (currentItem.supplierName) updates.lastSupplierName = currentItem.supplierName; // 빈 값으로 옛 값을 덮지 않는다
                }
                if (defectsFound.length > 0) {
                    updates.defectSummary = addDefectSummary(productData.defectSummary, today, defectsFound);
                }
                tx.set(productRef, updates, { merge: true });
            } else {
                tx.set(productRef, {
                    logs: r.logs,
                    defectSummary: defectSummaryOf(r.logs),
                    totalInbound: uniqueInboundCount(r.logs),
                    updatedAt: serverTimestamp()
                }, { merge: true });
            }

            const dailyData = dailySnap.exists() ? dailySnap.data() : {};
            const done = applyDoneToList(Array.isArray(dailyData.inspectionList) ? dailyData.inspectionList : [], {
                index: currentTodoIndex,
                name: currentItem ? currentItem.name : rawName,
                option: currentItem ? currentItem.option : undefined,
                packingDate,
                sampleQty,
                inboundQty,
                editing: wasEditing
            });
            const dailyUpdates = {};
            if (r.qtyDelta !== 0) dailyUpdates.taskQuantities = { '샘플검수': increment(r.qtyDelta) };
            if (done.changed) dailyUpdates.inspectionList = done.list;
            if (Object.keys(dailyUpdates).length > 0) tx.set(dailyRef, dailyUpdates, { merge: true });

            outcome = { qtyDelta: r.qtyDelta, done };
        });

        // ── 여기부터는 저장이 끝난 뒤에만 ──
        pendingSave = null;
        hideSaveError();

        // 처리량·대기 리스트의 State 는 실시간 구독(js/app-sync.js)이 서버 값으로 바꾼다 — 여기서 더하면 이중으로 세고
        // 1분 자동저장(saveStateToFirestore)이 그 값을 확정할 수 있다. 화면만 저장 결과로 먼저 그린다(shownList).
        const afterList = outcome.done.changed ? outcome.done.list : currentList();

        // 지난 날짜 리스트 갱신(기다리지 않음)
        //   오늘 리스트와 같은 규칙(applyDoneToList — 상품명+옵션+출고일로 한 칸)으로 고치고, 배열은 새로 만들어 바꿔 끼운다.
        for (let i = 0; i < State.allHistoryData.length; i++) {
            const dayData = State.allHistoryData[i];
            if (!Array.isArray(dayData.inspectionList) || dayData.inspectionList.length === 0) continue;
            const res = applyDoneToList(dayData.inspectionList, {
                name: currentItem ? currentItem.name : rawName,
                option: currentItem ? currentItem.option : undefined,
                packingDate,
                sampleQty,
                inboundQty,
                editing: wasEditing
            });
            if (res.changed) {
                dayData.inspectionList = res.list;
                const pastDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dayData.id);
                updateDoc(pastDocRef, { inspectionList: dayData.inspectionList }).catch(e => console.error("과거 리스트 갱신 실패", e));
            }
        }

        if (!wasEditing) {
            todayInspectionList.unshift({
                productName,
                inboundDate: packingDate !== '-' ? packingDate : inboundDate,
                status,
                defects: defectsFound,
                note,
                time: nowTime
            });
        }
        renderTodayInspectionList();

        resetInspectionForm(true);
        resetEditingState();
        renderTodoList(outcome.done.changed ? afterList : undefined);

        const next = wasEditing ? -1 : nextPendingIndex(afterList, currentTodoIndex);
        if (wasEditing) {
            showToast('수정 저장됨');
        } else {
            if (typeof navigator !== 'undefined') navigator.vibrate?.(30);   // 지원하는 기기만(아이폰·PC 는 조용히 넘어감)
            showToast(next !== -1 ? `저장됨 → 다음: ${afterList[next].name}` : '저장됨 · 모두 검수 완료');
        }
        if (next !== -1) {
            selectTodoItem(next, { silent: true });
        } else {
            if (DOM.inspHistoryReport) DOM.inspHistoryReport.classList.add('hidden');
            if (DOM.inspCurrentInputArea) DOM.inspCurrentInputArea.classList.add('hidden');
            currentTodoIndex = -1;
            todoCollapsed = false;
            updateTodoPanel();
        }
    } catch (e) {
        console.error("Error saving inspection:", e);
        const code = String((e && e.code) || '');
        showSaveError(saveErrorMessage(e), code.startsWith('storage/'));
        showToast("저장하지 못했습니다. 입력은 남아 있습니다.", true);
    } finally {
        saving = false;
        if (btn) btn.disabled = false;
        setSaveBtnLabel();
        updateNavButtons();
    }
};

const resetInspectionForm = (clearProductName = false) => {
    const pNameInput = document.getElementById('insp-product-name');
    if (clearProductName && pNameInput) pNameInput.value = '';

    const qtyInput = document.getElementById('insp-inbound-qty');
    if (qtyInput) qtyInput.value = '';

    const sampleQtyInput = document.getElementById('insp-sample-qty');
    if (sampleQtyInput) sampleQtyInput.value = '1';

    const notesInput = document.getElementById('insp-notes');
    if (notesInput) notesInput.value = '';

    const thickInput = document.getElementById('insp-check-thickness');
    if (thickInput) thickInput.value = '';

    const packingDateInput = document.getElementById('insp-packing-date');
    if (packingDateInput) packingDateInput.value = '';

    const inboundDateInput = document.getElementById('insp-inbound-date');
    if (inboundDateInput) inboundDateInput.value = getTodayDateString();

    if (DOM.inspOptionDisplay) DOM.inspOptionDisplay.textContent = '옵션: -';
    if (DOM.inspCodeDisplay) DOM.inspCodeDisplay.textContent = '코드: -';
    if (DOM.inspSupplierDisplay) DOM.inspSupplierDisplay.textContent = '공급처: -';
    if (DOM.inspThicknessRef) DOM.inspThicknessRef.textContent = '기준: -';

    const selects = document.querySelectorAll('#insp-current-input-area select');
    selects.forEach(sel => sel.value = "");
    syncInspSegments();
    clearMissingMarks();
};

export const renderTodayInspectionList = () => {
    const body = document.getElementById('insp-today-list-body');
    const countEl = document.getElementById('insp-today-count');
    if (!body) return;
    if (countEl) countEl.textContent = todayInspectionList.length;

    if (todayInspectionList.length === 0) {
        body.innerHTML = '<div class="p-4 text-center text-gray-400 text-xs">아직 검수된 상품이 없습니다.</div>';
        return;
    }
    // 카드 HTML 은 js/lib/insp-flow.js doneCardHtml(값은 전부 escape)
    body.innerHTML = todayInspectionList.map(item => doneCardHtml(item)).join('');
};

export const clearTodayList = async () => {
    if (todayInspectionList.length === 0) {
        showToast("비울 완료 목록이 없습니다.");
        return;
    }
    const ok = await showConfirm("오늘 검수 완료 목록(이 화면)을 비우시겠습니까?\n(저장된 검수 기록은 지워지지 않습니다)", { title: '완료 목록 초기화', okText: '비우기', danger: true });
    if (!ok) return;
    todayInspectionList = [];
    renderTodayInspectionList();
};

export { handleExcelUpload } from './inspection-excel.js?v=202610261448';
export { toggleScanner, handleImageSelect, clearImageState, handleManualImageSelect, clearManualImageState } from './inspection-media.js?v=202610261448';
export { loadAllInspectionHistory, loadInspectionLogs, prepareEditInspectionLog, updateInspectionLog, deleteInspectionLog, deleteProductHistory, savePreInspectionNote } from './inspection-editor.js?v=202610261448';
