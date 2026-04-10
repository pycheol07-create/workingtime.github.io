// === js/listeners-modals-form.js ===
import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { showToast, getTodayDateString } from './utils.js';
import { startTask, stopTask } from './app-logic.js';
import { fetchFullInspectionStatus, saveFullInspectionData } from './inspection-logic.js';

export const setupModalsFormListeners = () => {
    // 1. 업무 종류 선택 버튼 클릭 이벤트 (위임 방식)
    if (DOM.taskModalContent) {
        DOM.taskModalContent.addEventListener('click', async (e) => {
            const btn = e.target.closest('.task-select-btn');
            if (!btn) return;

            const taskName = btn.dataset.task;
            const memberNames = State.appState.selectedMembersForTask;

            // ✅ 전량검수 업무를 선택한 경우
            if (taskName === '전량검수') {
                DOM.taskSelectModal.classList.add('hidden');
                const fullInspModal = document.getElementById('full-inspection-modal');
                if (fullInspModal) {
                    fullInspModal.classList.remove('hidden');
                    // 초기화
                    document.getElementById('full-insp-product-name').value = '';
                    document.getElementById('full-insp-status-board').classList.add('hidden');
                    document.getElementById('full-insp-total-qty').value = '';
                    document.getElementById('full-insp-total-qty').classList.remove('bg-gray-200');
                    document.getElementById('full-insp-total-qty').readOnly = false;
                    document.getElementById('full-insp-reason').value = '';
                    document.getElementById('full-insp-part').value = '';
                }
                return;
            }

            // 일반 업무 시작 로직
            if (memberNames && memberNames.length > 0) {
                const success = await startTask(memberNames, taskName);
                if (success) {
                    DOM.taskSelectModal.classList.add('hidden');
                    DOM.teamSelectModal.classList.add('hidden');
                }
            }
        });
    }

    // 2. 전량검수 모달 내 [진행상태 조회] 버튼
    const fullInspSearchBtn = document.getElementById('full-insp-search-btn');
    if (fullInspSearchBtn) {
        fullInspSearchBtn.addEventListener('click', async () => {
            const productName = document.getElementById('full-insp-product-name').value.trim();
            if (!productName) {
                showToast("상품명을 입력해주세요.", true);
                return;
            }

            const status = await fetchFullInspectionStatus(productName);
            const statusBoard = document.getElementById('full-insp-status-board');
            const totalQtyInput = document.getElementById('full-insp-total-qty');
            const reasonInput = document.getElementById('full-insp-reason');
            const partInput = document.getElementById('full-insp-part');

            if (status) {
                // 이어하기 모드
                statusBoard.classList.remove('hidden');
                document.getElementById('fi-total-stock').textContent = status.totalStock;
                document.getElementById('fi-completed-qty').textContent = status.completedQty;
                document.getElementById('fi-remain-qty').textContent = status.totalStock - status.completedQty;

                totalQtyInput.value = status.totalStock;
                totalQtyInput.readOnly = true;
                totalQtyInput.classList.add('bg-gray-200');
                
                reasonInput.value = status.reason || '';
                partInput.value = status.inspectionPart || '';
                
                showToast("기존 진행 데이터를 불러왔습니다. 이어서 기록하세요.");
            } else {
                // 신규 모드
                statusBoard.classList.add('hidden');
                totalQtyInput.value = '';
                totalQtyInput.readOnly = false;
                totalQtyInput.classList.remove('bg-gray-200');
                showToast("신규 전량검수 상품입니다. 총 재고를 입력해주세요.");
            }
        });
    }

    // 3. 전량검수 [기록 저장] 버튼
    const saveFullInspBtn = document.getElementById('save-full-insp-btn');
    if (saveFullInspBtn) {
        saveFullInspBtn.addEventListener('click', async () => {
            const data = {
                productName: document.getElementById('full-insp-product-name').value.trim(),
                reason: document.getElementById('full-insp-reason').value.trim(),
                part: document.getElementById('full-insp-part').value.trim(),
                totalStock: parseInt(document.getElementById('full-insp-total-qty').value) || 0,
                todayNormal: parseInt(document.getElementById('full-insp-today-normal').value) || 0,
                todayDefect: parseInt(document.getElementById('full-insp-today-defect').value) || 0,
                note: document.getElementById('full-insp-today-note').value.trim()
            };

            if (!data.productName || data.totalStock <= 0) {
                showToast("상품명과 총 재고를 확인해주세요.", true);
                return;
            }

            if (data.todayNormal + data.todayDefect <= 0) {
                showToast("금일 검수 수량을 입력해주세요.", true);
                return;
            }

            const success = await saveFullInspectionData(data);
            if (success) {
                document.getElementById('full-inspection-modal').classList.add('hidden');
                // 입력 필드 초기화
                document.getElementById('full-insp-today-normal').value = '';
                document.getElementById('full-insp-today-defect').value = '';
                document.getElementById('full-insp-today-note').value = '';
            }
        });
    }

    // 기존 모달 닫기 버튼들 처리
    document.querySelectorAll('.modal-close-btn, .modal-cancel-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const modal = btn.closest('.fixed');
            if (modal) modal.classList.add('hidden');
        });
    });
};