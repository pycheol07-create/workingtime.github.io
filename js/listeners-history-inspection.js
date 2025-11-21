// === js/listeners-history-inspection.js ===
// 설명: 이력 보기의 '검수 이력' 탭 관련 리스너(조회, 정렬, 상세, 수정)를 담당합니다.

import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { showToast } from './utils.js';

// UI 렌더링 함수 임포트
import { renderInspectionHistoryTable } from './ui-history.js';
import { setSortState } from './ui-history-inspection.js';

// 비즈니스 로직 임포트
import {
    loadInspectionLogs,
    prepareEditInspectionLog,
    updateInspectionLog,
    deleteInspectionLog
} from './inspection-logic.js';

import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 검수 이력 데이터 캐싱용 변수 (모듈 레벨)
let cachedInspectionData = [];

// 검수 이력 데이터 로드 및 렌더링 (외부 export: 탭 전환 시 호출용)
export const fetchAndRenderInspectionHistory = async () => {
    const container = DOM.inspectionHistoryViewContainer;
    if (!container) return;

    container.innerHTML = '<div class="text-center text-gray-500 py-10 flex flex-col items-center justify-center"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-2"></div>검수 이력을 불러오는 중입니다...</div>';

    try {
        const colRef = collection(State.db, 'product_history');
        const snapshot = await getDocs(colRef);

        cachedInspectionData = []; // 초기화
        snapshot.forEach(doc => {
            cachedInspectionData.push({
                id: doc.id,
                ...doc.data()
            });
        });

        // 초기 렌더링
        renderInspectionHistoryTable(cachedInspectionData);

    } catch (e) {
        console.error("Error loading inspection history:", e);
        container.innerHTML = '<div class="text-center text-red-500 py-10">데이터를 불러오는 중 오류가 발생했습니다.</div>';
        showToast("검수 이력 로딩 실패", true);
    }
};

export function setupHistoryInspectionListeners() {

    // 1. 검색 입력 리스너 (Input 이벤트로 실시간 필터링)
    if (DOM.inspectionHistorySearchInput) {
        DOM.inspectionHistorySearchInput.addEventListener('input', () => {
            // 캐시된 데이터로 즉시 렌더링 (필터링 로직은 render 함수 내부에 있음)
            renderInspectionHistoryTable(cachedInspectionData);
        });
    }

    // 2. 새로고침 버튼 리스너
    if (DOM.inspectionHistoryRefreshBtn) {
        DOM.inspectionHistoryRefreshBtn.addEventListener('click', () => {
            fetchAndRenderInspectionHistory();
        });
    }

    // 3. 테이블 헤더 정렬 및 상세보기 버튼 (이벤트 위임)
    if (DOM.inspectionHistoryViewContainer) {
        DOM.inspectionHistoryViewContainer.addEventListener('click', (e) => {
            // A. 정렬 클릭
            const th = e.target.closest('th[data-sort-key]');
            if (th) {
                const key = th.dataset.sortKey;
                setSortState(key); // 정렬 상태 업데이트 (ui-history-inspection.js)
                renderInspectionHistoryTable(cachedInspectionData); // 재렌더링
                return;
            }

            // B. 상세보기 (로그 관리 모달 열기)
            const detailBtn = e.target.closest('.btn-view-detail');
            if (detailBtn) {
                const productName = detailBtn.dataset.productName;
                loadInspectionLogs(productName);
            }
        });
    }

    // 4. 상세 로그 관리 모달 내부 이벤트
    // (1) 로그 수정 버튼 (테이블 내 위임)
    const inspLogTableBody = document.getElementById('inspection-log-table-body');
    if (inspLogTableBody) {
        inspLogTableBody.addEventListener('click', (e) => {
            const editBtn = e.target.closest('.btn-edit-insp-log');
            if (editBtn) {
                const index = parseInt(editBtn.dataset.index, 10);
                const productName = DOM.inspectionLogProductName.textContent;
                prepareEditInspectionLog(productName, index);
            }
        });
    }

    // (2) 수정 모달 저장 버튼 (메인 리스트 갱신 포함)
    if (DOM.saveInspLogBtn) {
        DOM.saveInspLogBtn.addEventListener('click', async () => {
            await updateInspectionLog();
            // 수정 사항(최근 불량 내역 등)이 있을 수 있으므로 메인 리스트도 갱신
            if (State.context.activeMainHistoryTab === 'inspection') {
                fetchAndRenderInspectionHistory();
            }
        });
    }

    // (3) 수정 모달 삭제 버튼
    if (DOM.deleteInspLogBtn) {
        DOM.deleteInspLogBtn.addEventListener('click', async () => {
            await deleteInspectionLog();
            // 삭제 후 메인 리스트 갱신 (입고 횟수 등 변경 반영)
            if (State.context.activeMainHistoryTab === 'inspection') {
                fetchAndRenderInspectionHistory();
            }
        });
    }
}