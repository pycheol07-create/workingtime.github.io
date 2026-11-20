// === js/listeners-form-total-inspection.js ===
// 설명: 전량검수 창(진행 목록, 2026-11-17) 리스너 + 샘플검수 [전량검수로 전환] 버튼. 동작은 js/total-inspection-logic.js.

import * as DOM from './dom-elements.js?v=202611201655';
import {
    triggerTotalInspectionFromSample,
    closeTotalInspection,
    onTotalSearchInput,
    onTotalSearchEnter,
    openTotalManualAdd,
    onTotalListClick,
    setTotalShowDone,
    updateTotalInspRemaining,
    saveTotalInspection,
    markTotalDone,
    reopenTotal,
    clearTotalList,
    toggleTotalListCollapsed,
    toggleTotalFullscreen,
    syncTotalStock
} from './total-inspection-logic.js?v=202611201655';

export function setupTotalInspectionListeners() {

    // 샘플검수 → 지금 고른 줄을 전량검수 진행 목록에 넣고 그 줄을 연다
    if (DOM.inspSwitchToTotalBtn) {
        DOM.inspSwitchToTotalBtn.addEventListener('click', () => {
            triggerTotalInspectionFromSample();
        });
    }

    // 닫기(× · 아래 닫기 · 샘플검수로 돌아가기) — 창을 숨기면 목록 구독도 푼다(ESC 로 닫혀도 total-inspection-logic 이 class 변화를 보고 푼다)
    [DOM.totalInspBackBtn, DOM.totalInspCloseBtn, DOM.totalInspFooterCloseBtn].forEach(btn => {
        if (btn) btn.addEventListener('click', closeTotalInspection);
    });

    // 검색칸 — 입력하면 목록을 거르고, Enter·메뉴 [개별 추가]는 목록에 없으면 그 글자로 개별 추가 창
    if (DOM.totalInspProductName) {
        DOM.totalInspProductName.addEventListener('input', onTotalSearchInput);
        DOM.totalInspProductName.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); onTotalSearchEnter(); }
        });
    }
    if (DOM.totalInspSearchBtn) DOM.totalInspSearchBtn.addEventListener('click', onTotalSearchEnter);
    setupTotalMenu();
    // [엑셀 업로드] — 머리글 상품코드·수량(js/total-insp-excel-ui.js)
    const excelBtn = document.getElementById('total-insp-excel-btn');
    const excelFile = document.getElementById('total-insp-excel-file');
    if (excelBtn && excelFile) {
        excelBtn.addEventListener('click', () => { excelFile.value = ''; excelFile.click(); });
        excelFile.addEventListener('change', () => {
            const f = excelFile.files && excelFile.files[0];
            if (f) import('./total-insp-excel-ui.js?v=202611201655').then(m => m.uploadTotalExcel(f));
        });
    }

    // 목록 줄 고르기(위임 한 번) · 완료 보기
    if (DOM.totalInspList) DOM.totalInspList.addEventListener('click', onTotalListClick);
    if (DOM.totalInspShowDone) {
        DOM.totalInspShowDone.addEventListener('change', () => setTotalShowDone(DOM.totalInspShowDone.checked));
    }

    // 수량 입력 시 '남은 수량' 바로 반영
    [DOM.totalInspTotalStock, DOM.totalInspTodayNormal, DOM.totalInspTodayDefective].forEach(input => {
        if (input) input.addEventListener('input', updateTotalInspRemaining);
    });

    if (DOM.totalInspSaveBtn) DOM.totalInspSaveBtn.addEventListener('click', saveTotalInspection);
    if (DOM.totalInspDoneBtn) DOM.totalInspDoneBtn.addEventListener('click', markTotalDone);
    if (DOM.totalInspReopenBtn) DOM.totalInspReopenBtn.addEventListener('click', reopenTotal);
    // 목록 비우기(시작 전 줄은 삭제, 기록이 있는 줄은 완료로 내림 — 줄의 [×] 는 목록 클릭 위임이 받는다) · 휴대폰 목록 접기
    if (DOM.totalInspClearBtn) DOM.totalInspClearBtn.addEventListener('click', clearTotalList);
    if (DOM.totalInspToggle) DOM.totalInspToggle.addEventListener('click', toggleTotalListCollapsed);
    if (DOM.totalInspFullscreenBtn) DOM.totalInspFullscreenBtn.addEventListener('click', toggleTotalFullscreen);
    // [재고 연동] — 검수수량 칸에 앱 안 재고 요약을 채운다(저장은 [저장])
    if (DOM.totalInspStockSyncBtn) DOM.totalInspStockSyncBtn.addEventListener('click', syncTotalStock);
}

/** [목록 관리 ▾] 펼침 메뉴(2026-11-20) — 개별 추가·엑셀 업로드·목록 비우기. 항목을 누르면(각자 리스너가 동작) 닫고, 밖을 누르거나 ESC 면 닫는다. */
function setupTotalMenu() {
    const wrap = document.getElementById('total-insp-menu-wrap');
    const btn = document.getElementById('total-insp-menu-btn');
    const menu = document.getElementById('total-insp-menu');
    if (!wrap || !btn || !menu) return;
    const isOpen = () => !menu.classList.contains('hidden');
    const setOpen = (on) => {
        menu.classList.toggle('hidden', !on);
        btn.setAttribute('aria-expanded', on ? 'true' : 'false');
        if (on) { const first = menu.querySelector('[role="menuitem"]:not(:disabled)'); if (first) first.focus(); }
    };
    btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!isOpen()); });
    // 메뉴 안 어디를 눌러도 닫는다 — 꺼진 항목(목록이 비어 회색인 [목록 비우기])은 pointer-events-none 이라 클릭이 메뉴 칸으로 온다
    menu.addEventListener('click', () => setOpen(false));
    // Tab 으로 메뉴 밖으로 나가면 닫는다
    wrap.addEventListener('focusout', (e) => { if (isOpen() && e.relatedTarget && !wrap.contains(e.relatedTarget)) setOpen(false); });
    // 창이 어떤 경로로 닫혀도 메뉴는 접어 둔다(다시 열 때 펼쳐진 채 보이거나 ESC 를 가로채지 않게)
    const modal = DOM.totalInspModal;
    if (modal) new MutationObserver(() => { if (modal.classList.contains('hidden') && isOpen()) setOpen(false); })
        .observe(modal, { attributes: true, attributeFilter: ['class'] });
    const modalOpen = () => !modal || !modal.classList.contains('hidden');
    document.addEventListener('click', (e) => { if (isOpen() && !wrap.contains(e.target)) setOpen(false); });
    // ESC — 창 닫기(js/modal-esc.js, document 캡처)보다 먼저 메뉴만 닫는다
    window.addEventListener('keydown', (e) => {
        if ((e.key === 'Escape' || e.key === 'Esc') && isOpen() && modalOpen()) { e.preventDefault(); e.stopPropagation(); setOpen(false); btn.focus(); }
    }, true);
    // 위아래 화살표로 항목 옮기기
    menu.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        const items = [...menu.querySelectorAll('[role="menuitem"]:not(:disabled)')];
        const i = items.indexOf(document.activeElement);
        const n = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
        if (n) { e.preventDefault(); n.focus(); }
    });
}
