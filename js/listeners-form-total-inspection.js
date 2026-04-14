// === js/listeners-form-total-inspection.js ===
// 설명: '전량 검수 매니저' 모달 내부의 리스너를 담당합니다.

import * as DOM from './dom-elements.js';
import { searchTotalInspection, updateTotalInspRemaining, saveTotalInspection, triggerTotalInspectionFromSample } from './total-inspection-logic.js';

export function setupTotalInspectionListeners() {
    
    // [신규] 샘플 검수 -> 전량 검수로 원클릭 전환 버튼
    if (DOM.inspSwitchToTotalBtn) {
        DOM.inspSwitchToTotalBtn.addEventListener('click', triggerTotalInspectionFromSample);
    }

    // [신규] 전량검수 모달에서 -> 다시 샘플검수 창으로 돌아가기(닫기)
    if (DOM.totalInspBackBtn) {
        DOM.totalInspBackBtn.addEventListener('click', () => {
            DOM.totalInspModal.classList.add('hidden');
        });
    }

    // 1. 조회 버튼 클릭 시
    if (DOM.totalInspSearchBtn) {
        DOM.totalInspSearchBtn.addEventListener('click', searchTotalInspection);
    }

    // 2. 엔터키로 조회
    if (DOM.totalInspProductName) {
        DOM.totalInspProductName.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') searchTotalInspection();
        });
    }

    // 3. 입력값 변경 시 실시간 남은 수량 계산
    const inputsToWatch = [DOM.totalInspTotalStock, DOM.totalInspTodayNormal, DOM.totalInspTodayDefective];
    inputsToWatch.forEach(input => {
        if (input) {
            input.addEventListener('input', updateTotalInspRemaining);
        }
    });

    // 4. 저장 버튼 클릭
    if (DOM.totalInspSaveBtn) {
        DOM.totalInspSaveBtn.addEventListener('click', saveTotalInspection);
    }
}