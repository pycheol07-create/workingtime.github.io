// === js/listeners-history-inspection.js ===
import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { showToast, getTodayDateString } from './utils.js';

import { 
    renderInspectionHistoryTable, 
    renderInspectionLayout,
    renderInspectionListMode
} from './ui-history.js'; 

import { setSortState, renderQCStatsMode } from './ui-history-inspection.js';

import {
    loadInspectionLogs,
    prepareEditInspectionLog,
    updateInspectionLog,
    deleteInspectionLog,
    deleteProductHistory,
    deleteHistoryInspectionList,
    savePreInspectionNote,
    handleManualImageSelect, 
    clearManualImageState    
} from './inspection-logic.js';

import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let cachedInspectionData = [];

export const fetchAndRenderInspectionHistory = async () => {
    const container = DOM.inspectionHistoryViewContainer;
    if (!container) return;

    renderInspectionLayout(container);

    const contentArea = document.getElementById('inspection-content-area');
    contentArea.innerHTML = '<div class="text-center text-gray-500 py-10 flex flex-col items-center justify-center"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-2"></div>데이터를 불러오는 중입니다...</div>';

    const viewMode = State.context.inspectionViewMode || 'product';

    if (viewMode === 'product') {
        try {
            const colRef = collection(State.db, 'product_history');
            const snapshot = await getDocs(colRef);

            cachedInspectionData = []; 
            snapshot.forEach(doc => {
                cachedInspectionData.push({ id: doc.id, ...doc.data() });
            });
            renderInspectionHistoryTable(cachedInspectionData);
        } catch (e) {
            console.error("Error loading inspection history:", e);
            contentArea.innerHTML = '<div class="text-center text-red-500 py-10">데이터 로딩 실패</div>';
        }
    } else if (viewMode === 'list') {
        const dateList = [];
        State.allHistoryData.forEach(day => {
            if (day.inspectionList && day.inspectionList.length > 0) {
                dateList.push({
                    date: day.id,
                    count: day.inspectionList.length,
                    data: day.inspectionList
                });
            }
        });

        dateList.sort((a, b) => b.date.localeCompare(a.date));

        if (dateList.length > 0) {
            if (!State.context.selectedInspectionDate) {
                State.context.selectedInspectionDate = dateList[0].date;
            }
            const selectedData = dateList.find(d => d.date === State.context.selectedInspectionDate);
            renderInspectionListMode(dateList, selectedData ? selectedData.data : []);
        } else {
            renderInspectionListMode([], []);
        }
    } else if (viewMode === 'qc') {
        // ★ QC 통계 대시보드 렌더링
        renderQCStatsMode('month', '');
    }
};

export function setupHistoryInspectionListeners() {

    // 수동 추가 모달 이벤트 및 이미지 처리 연결
    const preModal = document.getElementById('pre-register-inspection-modal');
    if (preModal) {
        preModal.addEventListener('click', async (e) => {
            if (e.target.closest('#close-pre-insp-modal') || e.target.closest('#cancel-pre-insp-btn')) {
                preModal.classList.add('hidden');
                clearManualImageState(); 
            }
            if (e.target.closest('#save-pre-insp-btn')) {
                const success = await savePreInspectionNote();
                if (success) {
                    fetchAndRenderInspectionHistory(); 
                }
            }
            // 이미지 삭제 버튼 클릭 시
            if (e.target.closest('#manual-insp-image-clear-btn')) {
                clearManualImageState();
            }
        });

        // 이미지 파일 선택(첨부) 변경 이벤트
        const imageInput = document.getElementById('manual-insp-image');
        if (imageInput) {
            imageInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    handleManualImageSelect(file);
                }
            });
        }
    }

    if (DOM.inspectionHistoryViewContainer) {
        
        // QC 조회 기간 조건(월간/주간) 변경 이벤트
        DOM.inspectionHistoryViewContainer.addEventListener('change', (e) => {
            if (e.target.id === 'qc-period-type') {
                renderQCStatsMode(e.target.value, '');
            }
        });

        DOM.inspectionHistoryViewContainer.addEventListener('click', async (e) => {
            
            // 수동 검수 추가 모달 열기 (확장된 폼 초기화)
            const addPreBtn = e.target.closest('#btn-add-pre-inspection');
            if (addPreBtn) {
                const modal = document.getElementById('pre-register-inspection-modal');
                if (modal) {
                    modal.classList.remove('hidden');
                    
                    const getEl = (id) => document.getElementById(id);
                    if (getEl('manual-insp-product-name')) getEl('manual-insp-product-name').value = '';
                    if (getEl('manual-insp-code')) getEl('manual-insp-code').value = '';
                    if (getEl('manual-insp-option')) getEl('manual-insp-option').value = '';
                    if (getEl('manual-insp-qty')) getEl('manual-insp-qty').value = '';
                    if (getEl('manual-insp-check-thickness')) getEl('manual-insp-check-thickness').value = '';
                    if (getEl('manual-insp-supplier')) getEl('manual-insp-supplier').value = '';
                    if (getEl('manual-insp-note')) getEl('manual-insp-note').value = '';
                    if (getEl('manual-insp-packing-date')) getEl('manual-insp-packing-date').value = '';
                    
                    if (getEl('manual-insp-inbound-date')) getEl('manual-insp-inbound-date').value = getTodayDateString();
                    
                    const selects = modal.querySelectorAll('select');
                    selects.forEach(sel => sel.value = "정상"); 
                    
                    clearManualImageState();
                }
                return;
            }

            // QC 통계 리포트 조회 버튼
            const refreshQcBtn = e.target.closest('#btn-refresh-qc');
            if (refreshQcBtn) {
                const typeSelect = document.getElementById('qc-period-type');
                const valueSelect = document.getElementById('qc-period-value');
                if (typeSelect && valueSelect) {
                    renderQCStatsMode(typeSelect.value, valueSelect.value);
                }
                return;
            }

            // 리스트 삭제
            const deleteListBtn = e.target.closest('.btn-delete-history-list');
            if (deleteListBtn) {
                const dateKey = deleteListBtn.dataset.date;
                const success = await deleteHistoryInspectionList(dateKey);
                if (success) {
                    State.context.selectedInspectionDate = null;
                    fetchAndRenderInspectionHistory();
                }
                return;
            }

            // 상품 전체 삭제
            const deleteProductBtn = e.target.closest('.btn-delete-product');
            if (deleteProductBtn) {
                const productName = deleteProductBtn.dataset.productName;
                const success = await deleteProductHistory(productName);
                if (success) {
                    fetchAndRenderInspectionHistory();
                }
                return;
            }

            // 확장된 상세 행 닫기 버튼
            const closeExpandedBtn = e.target.closest('.btn-close-expanded');
            if (closeExpandedBtn) {
                closeExpandedBtn.closest('.expanded-detail-row').remove();
                return;
            }

            // 상세 행 내부의 수정 버튼 (수정 모달 열기)
            const editBtn = e.target.closest('.btn-edit-insp-log');
            if (editBtn) {
                const index = parseInt(editBtn.dataset.index, 10);
                const productName = editBtn.dataset.productName;
                prepareEditInspectionLog(productName, index);
                return;
            }

            // 상단 모드 변경 탭 (상품별, 리스트별, QC 통계별)
            const tabBtn = e.target.closest('button[data-insp-tab]');
            if (tabBtn) {
                const mode = tabBtn.dataset.inspTab;
                if (State.context.inspectionViewMode !== mode) {
                    State.context.inspectionViewMode = mode;
                    State.context.selectedInspectionDate = null; 
                    fetchAndRenderInspectionHistory(); 
                }
                return;
            }

            // 리스트 탭 날짜 선택
            const dateBtn = e.target.closest('.btn-select-insp-date');
            if (dateBtn) {
                const date = dateBtn.dataset.date;
                if (State.context.selectedInspectionDate !== date) {
                    State.context.selectedInspectionDate = date;
                    fetchAndRenderInspectionHistory(); 
                }
                return;
            }

            // 정렬
            const th = e.target.closest('th[data-sort-key]');
            if (th) {
                const key = th.dataset.sortKey;
                setSortState(key); 
                renderInspectionHistoryTable(cachedInspectionData);
                return;
            }

            // 행을 클릭하면 상세 내역 아코디언 펼치기
            const detailBtn = e.target.closest('.btn-view-detail');
            if (detailBtn) {
                const tr = detailBtn.tagName === 'TR' ? detailBtn : detailBtn.closest('tr');
                const productName = tr.dataset.productName;

                const nextTr = tr.nextElementSibling;
                if (nextTr && nextTr.classList.contains('expanded-detail-row')) {
                    nextTr.remove(); 
                    return;
                }

                loadInspectionLogs(productName, tr);
                return;
            }
        });
    }

    if (DOM.inspectionHistorySearchInput) {
        DOM.inspectionHistorySearchInput.addEventListener('input', () => {
            if (State.context.inspectionViewMode === 'product') {
                renderInspectionHistoryTable(cachedInspectionData);
            }
        });
    }

    if (DOM.inspectionHistoryRefreshBtn) {
        DOM.inspectionHistoryRefreshBtn.addEventListener('click', () => {
            fetchAndRenderInspectionHistory();
        });
    }

    if (DOM.saveInspLogBtn) {
        DOM.saveInspLogBtn.addEventListener('click', async () => {
            await updateInspectionLog();
            if (State.context.activeMainHistoryTab === 'inspection') {
                fetchAndRenderInspectionHistory(); 
            }
        });
    }

    if (DOM.deleteInspLogBtn) {
        DOM.deleteInspLogBtn.addEventListener('click', async () => {
            await deleteInspectionLog();
            if (State.context.activeMainHistoryTab === 'inspection') {
                fetchAndRenderInspectionHistory();
            }
        });
    }
}