// === js/listeners-modals.js ===
// 설명: 모든 모달의 '공통' 리스너 (예: 닫기 버튼)를 담당합니다.
// (개별 모달 로직은 'listeners-modals-sim.js', 'listeners-modals-confirm.js', 'listeners-modals-form.js'로 분리됨)

// ✅ [신규] DOM 임포트
import * as DOM from './dom-elements.js';

export function setupGeneralModalListeners() {

    // 범용 닫기/취소 버튼 리스너
    document.querySelectorAll('.modal-close-btn, .modal-cancel-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const modal = btn.closest('.modal-overlay, .fixed.inset-0');
            if (modal) {
                modal.classList.add('hidden');

                // ✅ [신규] 시뮬레이션 모달 닫을 때 위치 리셋
                if (modal.id === 'cost-simulation-modal') {
                    const contentBox = document.getElementById('sim-modal-content-box');
                    if (contentBox) {
                        // 1. 인라인 스타일(위치, 크기) 제거
                        contentBox.removeAttribute('style'); 
                        // 2. 드래그 상태 리셋
                        contentBox.dataset.hasBeenUncentered = 'false'; 
                    }
                    // 3. 오버레이의 flex-center 복원
                    modal.classList.add('flex', 'items-center', 'justify-center');
                }
            }
        });
    });
}