// === js/listeners-form-quantity.js ===
// 설명: 업무별 처리량 입력 모달 관련 리스너를 담당합니다.

import * as DOM from './dom-elements.js';
import * as State from './state.js';

export function setupFormQuantityListeners() {

    // 1. 처리량 저장 (확인) 버튼
    if (DOM.confirmQuantityBtn) {
        DOM.confirmQuantityBtn.addEventListener('click', async () => {
            const newQuantities = {};
            const confirmedZeroTasks = [];

            // 입력 필드에서 값 수집
            document.querySelectorAll('#modal-task-quantity-inputs input[type="number"]').forEach(input => {
                const taskName = input.dataset.task;
                if (taskName) {
                    newQuantities[taskName] = Number(input.value) || 0;
                }
            });

            // 0건 확인 체크박스 수집
            document.querySelectorAll('#modal-task-quantity-inputs .confirm-zero-checkbox').forEach(checkbox => {
                if (checkbox.checked) {
                    confirmedZeroTasks.push(checkbox.dataset.task);
                }
            });

            // 컨텍스트에 저장된 콜백 실행 (일별/이력 모드에 따라 다름)
            if (State.context.quantityModalContext && typeof State.context.quantityModalContext.onConfirm === 'function') {
                await State.context.quantityModalContext.onConfirm(newQuantities, confirmedZeroTasks);
            }

            if (DOM.quantityModal) DOM.quantityModal.classList.add('hidden');
        });
    }

    // 2. 처리량 입력 취소 버튼
    if (DOM.cancelQuantityBtn) {
        DOM.cancelQuantityBtn.addEventListener('click', () => {
            if (State.context.quantityModalContext && typeof State.context.quantityModalContext.onCancel === 'function') {
                State.context.quantityModalContext.onCancel();
            }
            if (DOM.quantityModal) DOM.quantityModal.classList.add('hidden');
        });
    }
}