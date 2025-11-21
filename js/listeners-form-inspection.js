// === js/listeners-form-inspection.js ===
// 설명: 검수 매니저 모달(입력/검색/리스트 관리) 관련 리스너를 담당합니다.

import * as DOM from './dom-elements.js';
import * as InspectionLogic from './inspection-logic.js';

export function setupFormInspectionListeners() {

    // 1. 상품명 검색 (클릭)
    if (DOM.inspSearchBtn) {
        DOM.inspSearchBtn.addEventListener('click', () => {
            InspectionLogic.searchProductHistory();
        });
    }

    // 2. 상품명 검색 (엔터키)
    if (DOM.inspProductNameInput) {
        DOM.inspProductNameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                InspectionLogic.searchProductHistory();
            }
        });
    }

    // 3. 검수 완료 및 저장 (다음 상품으로)
    if (DOM.inspSaveNextBtn) {
        DOM.inspSaveNextBtn.addEventListener('click', () => {
            InspectionLogic.saveInspectionAndNext();
        });
    }

    // 4. 금일 검수 목록 초기화 (화면에서만)
    if (DOM.inspClearListBtn) {
        DOM.inspClearListBtn.addEventListener('click', () => {
            if(confirm('오늘의 검수 목록(화면 표시)을 초기화하시겠습니까? (데이터는 삭제되지 않음)')) {
                InspectionLogic.clearTodayList();
            }
        });
    }
}