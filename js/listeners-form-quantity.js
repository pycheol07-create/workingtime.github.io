// === js/listeners-form-quantity.js ===
// 설명: 업무별 처리량 입력 모달 관련 리스너를 담당합니다.

import * as DOM from './dom-elements.js?v=202610230833';
import * as State from './state.js?v=202610230833';
import { showToast } from './utils.js?v=202610230833';
import { parseQtyInput } from './lib/qty-input.js?v=202610230833';

// 진행 중인 처리량 저장(없으면 null). 업무 마감([종료 후 마감] — listeners-modals-confirm.js)이 이것을 먼저 기다린다:
// 저장(이력 saveProgress 포함)이 떠 있는 동안 마감이 돌면, 뒤늦게 끝난 저장이 마감 전 상태로 이력을 덮을 수 있다.
// 평소(저장 없음)에는 바로 끝난다 — 업무마감봇의 #confirm-end-shift-btn 클릭도 기다리지 않는다.
let savingPromise = null;
export const waitQuantitySave = () => savingPromise || Promise.resolve();

export function setupFormQuantityListeners() {

    // 저장 중에는 창을 닫지 못하게: [취소]·[×] 비활성 + Esc 를 modal-esc.js 보다 먼저(window 캡처) 막는다
    const closeButtons = () => [DOM.cancelQuantityBtn, ...(DOM.quantityModal ? DOM.quantityModal.querySelectorAll('.modal-close-btn') : [])].filter(Boolean);
    window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !savingPromise) return;
        if (!DOM.quantityModal || DOM.quantityModal.classList.contains('hidden')) return;
        e.preventDefault();
        e.stopImmediatePropagation();
    }, true);

    // 1. 처리량 저장 (확인) 버튼
    if (DOM.confirmQuantityBtn) {
        DOM.confirmQuantityBtn.addEventListener('click', async () => {
            if (savingPromise) return;   // 두 번 누르기 방지
            const newQuantities = {};
            const confirmedZeroTasks = [];

            // 입력 필드에서 값 수집 — 0 이상 정수만(빈칸은 0). 하나라도 틀리면 버튼을 잠그기 전에 알리고 그 칸으로 간다
            let badInput = null;
            document.querySelectorAll('#modal-task-quantity-inputs input[type="number"]').forEach(input => {
                const taskName = input.dataset.task;
                if (taskName) {
                    const r = parseQtyInput(input.value, !!(input.validity && input.validity.badInput));
                    if (!r.ok && !badInput) badInput = input;
                    newQuantities[taskName] = r.value;
                }
            });
            if (badInput) {
                showToast(`처리량은 0 이상 정수만 입력할 수 있습니다: ${badInput.dataset.task}`, true);
                badInput.focus();
                return;
            }

            // 0건 확인 체크박스 수집
            document.querySelectorAll('#modal-task-quantity-inputs .confirm-zero-checkbox').forEach(checkbox => {
                if (checkbox.checked) {
                    confirmedZeroTasks.push(checkbox.dataset.task);
                }
            });

            // 컨텍스트에 저장된 콜백 실행 (일별/이력 모드에 따라 다름)
            // onConfirm 이 false 를 돌려주거나 예외가 나면 창을 닫지 않는다(입력값 유지 — 오류 안내는 콜백 쪽).
            // 그 밖의 반환값(undefined 포함 — 예전 콜백)은 예전처럼 닫는다.
            let keepOpen = false;
            const btn = DOM.confirmQuantityBtn;
            const label = btn.textContent;
            const closers = closeButtons();
            btn.disabled = true;
            btn.textContent = '저장 중…';
            closers.forEach(b => { b.disabled = true; });
            savingPromise = (async () => {
                try {
                    if (State.context.quantityModalContext && typeof State.context.quantityModalContext.onConfirm === 'function') {
                        // onConfirm 콜백에 입력값과 '0건 확인' 목록을 넘긴다
                        const res = await State.context.quantityModalContext.onConfirm(newQuantities, confirmedZeroTasks);
                        if (res === false) keepOpen = true;
                    }
                } catch (e) {
                    console.error('처리량 저장 실패:', e);
                    showToast(`처리량을 저장하지 못했습니다. 다시 시도해 주세요. (오류 코드: ${(e && e.code) || 'unknown'})`, true);
                    keepOpen = true;
                }
            })();
            try {
                await savingPromise;
            } finally {
                savingPromise = null;
                btn.disabled = false;
                btn.textContent = label;
                closers.forEach(b => { b.disabled = false; });
            }

            if (!keepOpen && DOM.quantityModal) DOM.quantityModal.classList.add('hidden');
        });
    }

    // 2. 처리량 입력 취소 버튼
    if (DOM.cancelQuantityBtn) {
        DOM.cancelQuantityBtn.addEventListener('click', () => {
            if (savingPromise) return;   // 저장 중에는 닫지 않는다(버튼도 비활성)
            if (State.context.quantityModalContext && typeof State.context.quantityModalContext.onCancel === 'function') {
                State.context.quantityModalContext.onCancel();
            }
            if (DOM.quantityModal) DOM.quantityModal.classList.add('hidden');
        });
    }
}
