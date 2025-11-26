// === js/listeners-form-inspection.js ===
// 설명: 검수 매니저 모달(입력/검색/리스트/스캔/이미지/전체화면) 관련 리스너를 담당합니다.

import * as DOM from './dom-elements.js';
import * as InspectionLogic from './inspection-logic.js';

let isInspectionMaximized = false; // 전체화면 상태 추적 변수

// ✅ [신규] 레이아웃 리셋 헬퍼 (닫힐 때 초기화용)
const resetInspectionLayout = () => {
    const fullscreenBtn = DOM.inspFullscreenBtn || document.getElementById('insp-fullscreen-btn');
    const modalContent = DOM.inspModalContent || document.getElementById('insp-modal-content');

    if (!modalContent || !isInspectionMaximized) return;

    // 상태 변수 초기화
    isInspectionMaximized = false;
    const btnIcon = fullscreenBtn ? fullscreenBtn.querySelector('svg') : null;

    // 1. 스타일 초기화 (기본 크기로 복귀)
    modalContent.classList.add('relative', 'w-full', 'max-w-4xl', 'max-h-[95vh]', 'rounded-2xl');
    modalContent.classList.remove('fixed', 'inset-0', 'h-full', 'rounded-none', 'max-h-none', 'z-[200]');

    // 2. 아이콘 초기화 (확대 아이콘으로 복구)
    if (btnIcon) {
        btnIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m0 0V4m0 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5h-4m0 0v-4m0 0l-5-5" />`;
    }
    if (fullscreenBtn) fullscreenBtn.title = "전체화면";
};

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

    // 5. 엑셀 업로드 리스너
    if (DOM.inspExcelUploadInput) {
        DOM.inspExcelUploadInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                InspectionLogic.handleExcelUpload(e.target.files[0]);
                e.target.value = ''; // 재사용을 위해 초기화
            }
        });
    }

    // 6. 바코드 스캔 토글 리스너
    if (DOM.inspScanBtn) {
        DOM.inspScanBtn.addEventListener('click', () => {
            InspectionLogic.toggleScanner();
        });
    }
    if (DOM.inspCloseScannerBtn) {
        DOM.inspCloseScannerBtn.addEventListener('click', () => {
            InspectionLogic.toggleScanner();
        });
    }

    // 7. 이미지 업로드 및 삭제 리스너
    if (DOM.inspImageInput) {
        DOM.inspImageInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                InspectionLogic.handleImageSelect(e.target.files[0]);
            }
        });
    }
    if (DOM.inspRemoveImageBtn) {
        DOM.inspRemoveImageBtn.addEventListener('click', () => {
            // UI 초기화뿐만 아니라 로직 내부의 이미지 상태도 초기화
            InspectionLogic.clearImageState();
        });
    }

    // 8. 전체화면 토글 리스너
    // DOM.inspFullscreenBtn이 import 시점에 null일 경우를 대비해 직접 조회 시도
    const fullscreenBtn = DOM.inspFullscreenBtn || document.getElementById('insp-fullscreen-btn');
    const modalContent = DOM.inspModalContent || document.getElementById('insp-modal-content');

    if (fullscreenBtn && modalContent) {
        fullscreenBtn.addEventListener('click', () => {
            isInspectionMaximized = !isInspectionMaximized;
            const btnIcon = fullscreenBtn.querySelector('svg');

            if (isInspectionMaximized) {
                // 전체화면 적용
                modalContent.classList.remove('rounded-2xl', 'w-full', 'max-w-4xl', 'max-h-[95vh]', 'relative');
                modalContent.classList.add('fixed', 'inset-0', 'w-full', 'h-full', 'rounded-none', 'max-h-none', 'z-[200]');
                // 아이콘 변경 (축소)
                if (btnIcon) btnIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 9L3.75 3.75M9 9h4.5M9 9V4.5m9 9l5.25 5.25M15 15h-4.5m4.5 0v4.5m-9 0l-5.25 5.25M9 21v-4.5M9 21H4.5m9-9l5.25-5.25M15 9V4.5M15 9h4.5" />`;
                fullscreenBtn.title = "기본 크기로";
            } else {
                // 기본 크기로 복귀
                modalContent.classList.add('relative', 'w-full', 'max-w-4xl', 'max-h-[95vh]', 'rounded-2xl');
                modalContent.classList.remove('fixed', 'inset-0', 'h-full', 'rounded-none', 'max-h-none', 'z-[200]');
                // 아이콘 변경 (확대)
                if (btnIcon) btnIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m0 0V4m0 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5h-4m0 0v-4m0 0l-5-5" />`;
                fullscreenBtn.title = "전체화면";
            }
        });
    } else {
        console.warn("검수창 전체화면 버튼 또는 컨텐츠 영역을 찾을 수 없습니다.");
    }

    // ✅ [추가] 모달 닫힘 감지 및 레이아웃 초기화 (Observer)
    const modal = DOM.inspectionManagerModal || document.getElementById('inspection-manager-modal');
    if (modal) {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    // 모달이 숨겨질 때(hidden 클래스 추가됨)
                    if (modal.classList.contains('hidden')) {
                        resetInspectionLayout();
                    }
                }
            });
        });
        observer.observe(modal, { attributes: true });
    }

    // 9. 검수 리스트 새창 열기 리스너
    if (DOM.inspOpenListWindowBtn) {
        DOM.inspOpenListWindowBtn.addEventListener('click', () => {
            InspectionLogic.openInspectionListWindow();
        });
    }

    // ✅ [추가] 검수 리스트 삭제 리스너
    if (DOM.inspDeleteListBtn) {
        DOM.inspDeleteListBtn.addEventListener('click', () => {
            InspectionLogic.deleteInspectionList();
        });
    }
}