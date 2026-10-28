// === js/listeners-form-inspection.js ===
// 설명: '검수 매니저(입력)' 모달 내부의 리스너를 담당합니다.

import * as DOM from './dom-elements.js?v=202610281042';
import { 
    searchProductHistory, 
    saveInspectionAndNext, 
    toggleScanner, 
    handleExcelUpload, 
    handleImageSelect, 
    clearImageState, 
    clearTodayList,
    deleteInspectionList,
    openInspectionListWindow
} from './inspection-logic.js?v=202610281042';
import { openPackPicker } from './inspection-packs.js?v=202610281042';
import { initInspSegments } from './inspection-segments.js?v=202610281042';
// 아래 함수들은 다른 작업 묶음에서 들어온다(goPrevInspectionItem·toggleTodoCollapsed — inspection-logic.js,
// dropNewPhoto — inspection-media.js). 이름으로 import 하면 아직 없을 때 모듈 전체가 깨지므로 namespace 로 받고
// typeof 로 확인한 뒤 부른다.
import * as InspLogic from './inspection-logic.js?v=202610281042';
import * as InspMedia from './inspection-media.js?v=202610281042';

const callIfFn = (mod, name, ...args) => {
    const fn = mod[name];
    if (typeof fn === 'function') return fn(...args);
    return undefined;
};

const MOBILE_MQ = '(max-width: 768px)';

export function setupFormInspectionListeners() {

    // 1. 상품명 검색 (버튼 & 엔터키)
    if (DOM.inspSearchBtn) {
        DOM.inspSearchBtn.addEventListener('click', searchProductHistory);
    }
    if (DOM.inspProductNameInput) {
        DOM.inspProductNameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') searchProductHistory();
        });
    }

    // 1-1. 🔍 휴대폰에서 접어 둔 검색 줄 펼치기/접기
    const searchToggle = document.getElementById('insp-search-toggle');
    if (searchToggle) {
        searchToggle.addEventListener('click', () => callIfFn(InspLogic, 'toggleSearchRow'));
    }

    // 2. 바코드 스캐너 토글
    if (DOM.inspScanBtn) {
        DOM.inspScanBtn.addEventListener('click', toggleScanner);
    }
    if (DOM.inspCloseScannerBtn) {
        DOM.inspCloseScannerBtn.addEventListener('click', toggleScanner);
    }

    // 3. 저장 및 다음
    if (DOM.inspSaveNextBtn) {
        DOM.inspSaveNextBtn.addEventListener('click', saveInspectionAndNext);
    }

    // 3-1. 이전 항목 · 저장 실패 띠의 다시 저장 / 사진 빼고 저장
    const prevBtn = document.getElementById('insp-prev-btn');
    if (prevBtn) {
        prevBtn.addEventListener('click', () => callIfFn(InspLogic, 'goPrevInspectionItem'));
    }
    const listBtn = document.getElementById('insp-list-btn');
    if (listBtn) {
        listBtn.addEventListener('click', () => callIfFn(InspLogic, 'openTodoList'));
    }
    const retryBtn = document.getElementById('insp-save-retry-btn');
    if (retryBtn) {
        retryBtn.addEventListener('click', saveInspectionAndNext);
    }
    const noPhotoBtn = document.getElementById('insp-save-nophoto-btn');
    if (noPhotoBtn) {
        noPhotoBtn.addEventListener('click', () => {
            if (typeof InspMedia.dropNewPhoto !== 'function') return;
            InspMedia.dropNewPhoto();
            saveInspectionAndNext();
        });
    }

    // 3-2. 체크리스트 선택 버튼 · 모두 정상 (js/inspection-segments.js)
    initInspSegments();

    // 3-3. 입력 칸 Enter 이동: 총 입고 수량 → 샘플 수량 → 두께 → 첫 빈 선택 항목(키보드 닫음). 메모 Enter 는 키보드만 닫는다
    const focusNext = (fromId, toId) => {
        const from = document.getElementById(fromId);
        if (!from) return;
        from.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' || e.isComposing) return;
            e.preventDefault();
            const to = toId ? document.getElementById(toId) : null;
            if (to) { to.focus(); return; }
            from.blur();
            const root = document.getElementById('inspection-manager-modal');
            const emptyField = root
                ? Array.from(root.querySelectorAll('[data-insp-field]')).find(f => {
                    const sel = f.querySelector('select[data-seg]');
                    return sel && !sel.value;
                })
                : null;
            if (emptyField) emptyField.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    };
    focusNext('insp-inbound-qty', 'insp-sample-qty');
    focusNext('insp-sample-qty', 'insp-check-thickness');
    focusNext('insp-check-thickness', null);
    const notesInput = document.getElementById('insp-notes');
    if (notesInput) {
        notesInput.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' || e.isComposing) return;
            e.preventDefault();
            notesInput.blur();
        });
    }

    // 3-4. 연결 끊김 띠 (창 안) — 전역 배너는 검수 창이 열려 있는 동안 CSS 로 숨긴다
    const connBand = document.getElementById('insp-conn-band');
    if (connBand) {
        const updateConn = () => connBand.classList.toggle('hidden', navigator.onLine !== false);
        window.addEventListener('online', updateConn);
        window.addEventListener('offline', updateConn);
        updateConn();
    }

    // 4. 리스트 관리 (엑셀 업로드, 새창 열기, 삭제)
    if (DOM.inspExcelUploadInput) {
        DOM.inspExcelUploadInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleExcelUpload(e.target.files[0]);
                e.target.value = ''; // 초기화
            }
        });
    }
    // 4-1. 패킹에서 만들기 (integrations/inspPacks — js/inspection-packs.js)
    const inspPackOpenBtn = document.getElementById('insp-pack-open-btn');
    if (inspPackOpenBtn) {
        inspPackOpenBtn.addEventListener('click', openPackPicker);
    }
    if (DOM.inspOpenListWindowBtn) {
        DOM.inspOpenListWindowBtn.addEventListener('click', openInspectionListWindow);
    }
    if (DOM.inspDeleteListBtn) {
        DOM.inspDeleteListBtn.addEventListener('click', deleteInspectionList);
    }
    // 4-2. 대기 리스트 접기(휴대폰) — 글자·접힘 상태는 inspection-logic.js 가 관리
    const todoToggle = document.getElementById('insp-todo-toggle');
    if (todoToggle) {
        todoToggle.addEventListener('click', () => callIfFn(InspLogic, 'toggleTodoCollapsed'));
    }
    // 4-3. ⋯ 더보기 메뉴: 안의 버튼을 누르면 닫는다
    const moreMenu = document.getElementById('insp-more-menu');
    if (moreMenu) {
        moreMenu.addEventListener('click', (e) => {
            if (e.target.closest('button')) moreMenu.open = false;
        });
    }

    // 5. 이미지 업로드 및 삭제
    if (DOM.inspImageInput) {
        DOM.inspImageInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleImageSelect(e.target.files[0]);
            }
        });
    }
    // 5-1. 앨범에서 고르기 (#insp-image-upload 는 카메라 촬영용 capture="environment")
    const galleryInput = document.getElementById('insp-image-upload-gallery');
    if (galleryInput) {
        galleryInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleImageSelect(e.target.files[0]);
                e.target.value = ''; // 같은 사진을 다시 골라도 change 가 오게
            }
        });
    }
    if (DOM.inspRemoveImageBtn) {
        DOM.inspRemoveImageBtn.addEventListener('click', clearImageState);
    }

    // 6. 금일 목록 초기화
    if (DOM.inspClearListBtn) {
        DOM.inspClearListBtn.addEventListener('click', clearTodayList);
    }
    // 6-1. 완료 목록은 휴대폰에서 접어 둔다(PC 는 펼침)
    const todayDetails = document.getElementById('insp-today-details');
    if (todayDetails && window.matchMedia && window.matchMedia(MOBILE_MQ).matches) {
        todayDetails.open = false;
    }

    // 7. 전체화면 토글
    if (DOM.inspFullscreenBtn) {
        DOM.inspFullscreenBtn.addEventListener('click', () => {
            const modalContent = document.getElementById('insp-modal-content');
            const modal = document.getElementById('inspection-manager-modal');
            const header = document.getElementById('insp-modal-header');
            
            if (!modalContent || !modal) return;

            if (modalContent.classList.contains('fixed')) {
                // 복구 (기본 모달 스타일)
                modalContent.classList.remove('fixed', 'inset-0', 'h-full', 'w-full', 'rounded-none');
                modalContent.classList.add('rounded-2xl', 'max-w-7xl', 'max-h-[95vh]');

                // 부모 오버레이 복구
                modal.classList.add('p-4', 'flex', 'items-center', 'justify-center');

                // 헤더 모서리 복구
                if(header) header.classList.add('rounded-t-2xl');
            } else {
                // 전체화면
                modalContent.classList.add('fixed', 'inset-0', 'h-full', 'w-full', 'rounded-none');
                modalContent.classList.remove('rounded-2xl', 'max-w-7xl', 'max-h-[95vh]');
                
                // 부모 오버레이 스타일 제거 (꽉 채우기 위해)
                modal.classList.remove('p-4', 'flex', 'items-center', 'justify-center');

                // 헤더 모서리 제거 (꽉 찬 느낌 위해)
                if(header) header.classList.remove('rounded-t-2xl');
            }
        });
    }
}