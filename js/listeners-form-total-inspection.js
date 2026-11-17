// === js/listeners-form-total-inspection.js ===
// 설명: 전량검수 창(진행 목록, 2026-11-17) 리스너 + 샘플검수 [전량검수로 전환] 버튼. 동작은 js/total-inspection-logic.js.

import * as DOM from './dom-elements.js?v=202611171714';
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
} from './total-inspection-logic.js?v=202611171714';

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

    // 검색칸 — 입력하면 목록을 거르고, Enter·[찾기]는 목록에 없으면 그 글자로 개별 추가 창
    if (DOM.totalInspProductName) {
        DOM.totalInspProductName.addEventListener('input', onTotalSearchInput);
        DOM.totalInspProductName.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); onTotalSearchEnter(); }
        });
    }
    if (DOM.totalInspSearchBtn) DOM.totalInspSearchBtn.addEventListener('click', onTotalSearchEnter);

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
