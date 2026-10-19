// === js/listeners-modals.js ===
// 설명: 모든 모달의 '공통' 리스너 (예: 닫기 버튼)를 담당합니다.
// (개별 모달 로직은 'listeners-modals-confirm.js', 'listeners-modals-form.js'로 분리됨)

// ✅ [신규] DOM 임포트
import * as DOM from './dom-elements.js?v=202610191644';

const OVERLAY_SELECTOR = '.modal-overlay, .fixed.inset-0';

// 버튼이 속한 '모달 오버레이'를 찾는다.
// 검수 전체화면처럼 상자 자체에 fixed inset-0 이 붙는 경우, 가장 가까운 것만 보면 오버레이 대신
// 상자에 hidden 이 붙어 다음에 열 때 빈 가림막만 보였다. → 가까운 것부터 올라가며
// 가운데 정렬(justify-center, modal-esc.js 와 같은 기준)이거나 컨테이너·body 직계인 것을 고른다.
const isModalRoot = (el) => {
    const parent = el.parentElement;
    return el.classList.contains('modal-overlay') || el.classList.contains('justify-center')
        || !parent || parent === document.body || parent.id.startsWith('modals-container-');
};
const findModalOverlay = (btn) => {
    const nearest = btn.closest(OVERLAY_SELECTOR);
    for (let el = nearest; el; el = el.parentElement && el.parentElement.closest(OVERLAY_SELECTOR)) {
        if (isModalRoot(el)) return el;
    }
    return nearest;
};

export function setupGeneralModalListeners() {

    // 범용 닫기/취소 버튼 리스너
    document.querySelectorAll('.modal-close-btn, .modal-cancel-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const modal = findModalOverlay(btn);
            if (modal) {
                modal.classList.add('hidden');
            }
        });
    });
}