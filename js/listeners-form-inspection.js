// === js/listeners-form-inspection.js ===
// 설명: 검수 매니저 모달(입력/검색/리스트/스캔/이미지) 관련 리스너를 담당합니다.

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

    // [신규] 5. 엑셀 업로드 리스너
    if (DOM.inspExcelUploadInput) {
        DOM.inspExcelUploadInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                InspectionLogic.handleExcelUpload(e.target.files[0]);
                e.target.value = ''; // 재사용을 위해 초기화
            }
        });
    }

    // [신규] 6. 바코드 스캔 토글 리스너
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

    // [신규] 7. 이미지 업로드 및 삭제 리스너
    if (DOM.inspImageInput) {
        DOM.inspImageInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                InspectionLogic.handleImageSelect(e.target.files[0]);
            }
        });
    }
    if (DOM.inspRemoveImageBtn) {
        DOM.inspRemoveImageBtn.addEventListener('click', () => {
            const previewDiv = document.getElementById('insp-image-preview-box');
            const fileInput = document.getElementById('insp-image-upload');
            if(previewDiv) previewDiv.classList.add('hidden');
            if(fileInput) fileInput.value = '';
            
            // 로직 내 이미지 데이터도 초기화하기 위해 로직 함수 호출을 고려할 수 있으나,
            // 현재 구조상 UI만 초기화하고 저장 시 null 처리되도록 하거나,
            // 필요하다면 InspectionLogic에 clearImage() 함수를 추가하여 호출할 수 있습니다.
            // 여기서는 간단히 UI 초기화만 수행합니다. (저장 시 이미지가 없으면 null로 저장됨)
        });
    }
}