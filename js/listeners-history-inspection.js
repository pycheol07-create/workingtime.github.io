// === js/listeners-history-inspection.js ===
import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { showToast, getTodayDateString } from './utils.js';

import { 
    renderInspectionHistoryTable, 
    renderInspectionLogTable,
    renderInspectionLayout,
    renderInspectionListMode
} from './ui-history.js'; 

import { setSortState } from './ui-history-inspection.js';

import {
    loadInspectionLogs,
    prepareEditInspectionLog,
    updateInspectionLog,
    deleteInspectionLog,
    deleteProductHistory,
    deleteHistoryInspectionList,
    savePreInspectionNote // ✅ 신규 함수 임포트
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
    } else {
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
    }
};

export function setupHistoryInspectionListeners() {

    // ✅ [신규] 사전 특이사항 등록 모달 관련 이벤트 리스너
    const preModal = document.getElementById('pre-register-inspection-modal');
    if (preModal) {
        preModal.addEventListener('click', async (e) => {
            if (e.target.closest('#close-pre-insp-modal') || e.target.closest('#cancel-pre-insp-btn')) {
                preModal.classList.add('hidden');
            }
            if (e.target.closest('#save-pre-insp-btn')) {
                const success = await savePreInspectionNote();
                if (success) {
                    fetchAndRenderInspectionHistory(); // 목록 새로고침
                }
            }
        });
    }

    if (DOM.inspectionHistoryViewContainer) {
        DOM.inspectionHistoryViewContainer.addEventListener('click', async (e) => {
            
            // ✅ [신규] 입고예정 특이사항 등록 버튼 클릭 (모달 열기)
            const addPreBtn = e.target.closest('#btn-add-pre-inspection');
            if (addPreBtn) {
                const modal = document.getElementById('pre-register-inspection-modal');
                if (modal) {
                    modal.classList.remove('hidden');
                    document.getElementById('pre-insp-product-name').value = '';
                    document.getElementById('pre-insp-note').value = '';
                }
                return;
            }

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

            const dateBtn = e.target.closest('.btn-select-insp-date');
            if (dateBtn) {
                const date = dateBtn.dataset.date;
                if (State.context.selectedInspectionDate !== date) {
                    State.context.selectedInspectionDate = date;
                    fetchAndRenderInspectionHistory(); 
                }
                return;
            }

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

            const th = e.target.closest('th[data-sort-key]');
            if (th) {
                const key = th.dataset.sortKey;
                setSortState(key); 
                renderInspectionHistoryTable(cachedInspectionData);
                return;
            }

            const detailBtn = e.target.closest('.btn-view-detail');
            if (detailBtn) {
                const productName = detailBtn.dataset.productName;
                loadInspectionLogs(productName);
                return;
            }

            const deleteProductBtn = e.target.closest('.btn-delete-product');
            if (deleteProductBtn) {
                const productName = deleteProductBtn.dataset.productName;
                const success = await deleteProductHistory(productName);
                if (success) {
                    fetchAndRenderInspectionHistory();
                }
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

    if (DOM.saveInspLogBtn) {
        DOM.saveInspLogBtn.addEventListener('click', async () => {
            await updateInspectionLog();
            if (State.context.activeMainHistoryTab === 'inspection' && State.context.inspectionViewMode === 'product') {
                fetchAndRenderInspectionHistory();
            }
        });
    }

    if (DOM.deleteInspLogBtn) {
        DOM.deleteInspLogBtn.addEventListener('click', async () => {
            await deleteInspectionLog();
            if (State.context.activeMainHistoryTab === 'inspection' && State.context.inspectionViewMode === 'product') {
                fetchAndRenderInspectionHistory();
            }
        });
    }
}