// === js/listeners-modals.js ===
// 설명: 모든 모달의 '공통' 리스너 (예: 닫기 버튼)를 담당합니다.
// (개별 모달 로직은 'listeners-modals-sim.js', 'listeners-modals-confirm.js', 'listeners-modals-form.js'로 분리됨)

export function setupGeneralModalListeners() {

    // 범용 닫기/취소 버튼 리스너
    document.querySelectorAll('.modal-close-btn, .modal-cancel-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const modal = btn.closest('.modal-overlay, .fixed.inset-0');
            if (modal) {
                modal.classList.add('hidden');
            }
        });
    });

    // ⛔️ [삭제] 'form' 관련 모달 리스너 (listeners-modals-form.js로 이동)
}