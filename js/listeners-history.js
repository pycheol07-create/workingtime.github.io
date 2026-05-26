// === js/listeners-history.js ===
import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { showToast, getTodayDateString } from './utils.js';

import { setupHistoryDownloadListeners, openDownloadFormatModal } from './listeners-history-download.js';
import { setupHistoryRecordListeners } from './listeners-history-records.js';
import { setupHistoryAttendanceListeners } from './listeners-history-attendance.js';
import { setupHistoryInspectionListeners } from './listeners-history-inspection.js';

// 💡 수정됨: renderHistoryDateListByMode를 app-history-logic.js에서 불러옵니다.
import { loadAndRenderHistoryList, renderHistoryDetail, switchHistoryView, openHistoryQuantityModal, augmentHistoryWithPersistentLeave, renderHistoryDateListByMode } from './app-history-logic.js';
import { renderAttendanceDailyHistory, renderAttendanceWeeklyHistory, renderAttendanceMonthlyHistory, renderReportDaily, renderReportWeekly, renderReportMonthly, renderReportYearly, renderPersonalReport, renderManagementDaily, renderManagementSummary, renderWeeklyHistory, renderMonthlyHistory, renderPredictionTab } from './ui-history.js';
// 💡 수정됨: history-data-manager에서는 필요한 것만 불러옵니다.
import { syncTodayToHistory, saveManagementData } from './history-data-manager.js';
import { doc, updateDoc, deleteField } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { setupGlobalFilterListeners, setupHistoryTabsListeners, getFilteredHistoryData } from './listeners-history-tabs.js';
import { setupWeekendListeners, loadAndRenderWeekendStats } from './ui-history-weekend.js';

let isHistoryMaximized = false;

export function setupHistoryModalListeners() {
    setupHistoryDownloadListeners();
    setupHistoryRecordListeners();
    setupHistoryAttendanceListeners();
    setupHistoryInspectionListeners();

    setupGlobalFilterListeners(); 
    setupHistoryTabsListeners();  
    setupWeekendListeners();      

    const managementTabs = document.getElementById('management-tabs');
    const managementSaveBtn = document.getElementById('management-save-btn');
    const predictionDaysSelect = document.getElementById('prediction-days-select');

    const setHistoryMaximized = (maximized) => {
        isHistoryMaximized = maximized;
        const toggleBtn = document.getElementById('toggle-history-fullscreen-btn');
        const icon = toggleBtn?.querySelector('svg');

        DOM.historyModalContentBox.removeAttribute('style');
        DOM.historyModalContentBox.dataset.hasBeenUncentered = 'false';
        
        if (maximized) {
            DOM.historyModal.classList.remove('flex', 'items-center', 'justify-center', 'p-4');
            DOM.historyModalContentBox.classList.add('fixed', 'inset-0', 'w-full', 'h-full', 'z-[150]', 'rounded-none');
            DOM.historyModalContentBox.classList.remove('relative', 'w-[1400px]', 'h-[880px]', 'rounded-2xl', 'shadow-2xl');
            if (toggleBtn) toggleBtn.title = "기본 크기로";
            if (icon) icon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5M15 15l5.25 5.25" />`;
        } else {
            DOM.historyModal.classList.add('flex', 'items-center', 'justify-center', 'p-4');
            DOM.historyModalContentBox.classList.remove('fixed', 'inset-0', 'h-full', 'z-[150]', 'rounded-none');
            DOM.historyModalContentBox.classList.add('relative', 'w-[1400px]', 'h-[880px]', 'rounded-2xl', 'shadow-2xl');
            if (toggleBtn) toggleBtn.title = "전체화면";
            if (icon) icon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m0 0V4m0 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5h-4m0 0v-4m0 0l-5-5" />`;
        }
    };

    const getSelectedDateKey = () => DOM.historyDateList.querySelector('.history-date-btn.bg-blue-100')?.dataset.key || null;

    const refreshAttendanceView = async () => {
        const dateKey = getSelectedDateKey();
        if (dateKey === getTodayDateString()) {
            await syncTodayToHistory();
            augmentHistoryWithPersistentLeave(State.allHistoryData, State.persistentLeaveSchedule);
        }
        const filteredData = getFilteredHistoryData();
        const viewMode = document.querySelector('.global-view-btn.font-bold')?.dataset.viewMode || 'daily';

        if (viewMode === 'daily') { if (dateKey) renderAttendanceDailyHistory(dateKey, filteredData); } 
        else if (viewMode === 'weekly') { if (dateKey) renderAttendanceWeeklyHistory(dateKey, filteredData); } 
        else if (viewMode === 'monthly') { if (dateKey) renderAttendanceMonthlyHistory(dateKey, filteredData); }
    };

    const refreshReportView = () => {
        const dateKey = getSelectedDateKey();
        const filteredData = getFilteredHistoryData();
        const viewMode = document.querySelector('.global-view-btn.font-bold')?.dataset.viewMode || 'daily';

        if (viewMode === 'daily') renderReportDaily(dateKey, filteredData, State.appConfig, State.context);
        else if (viewMode === 'weekly') renderReportWeekly(dateKey, filteredData, State.appConfig, State.context);
        else if (viewMode === 'monthly') renderReportMonthly(dateKey, filteredData, State.appConfig, State.context);
        else if (viewMode === 'yearly') renderReportYearly(dateKey, filteredData, State.appConfig, State.context);
    };
    
    const refreshPersonalView = () => {
        const dateKey = getSelectedDateKey();
        const viewMode = document.querySelector('.global-view-btn.font-bold')?.dataset.viewMode || 'daily';
        const memberName = DOM.personalReportMemberSelect?.value;
        const mappedMode = `personal-${viewMode.replace('ily', 'y').replace('ly', 'ly')}`; 
        if (dateKey && memberName) renderPersonalReport('personal-report-content', mappedMode, dateKey, memberName, State.allHistoryData);
    };

    const refreshManagementView = () => {
        const dateKey = getSelectedDateKey();
        const viewMode = document.querySelector('.global-view-btn.font-bold')?.dataset.viewMode || 'daily';
        if (!dateKey) return;
        if (viewMode === 'daily') renderManagementDaily(dateKey, State.allHistoryData);
        else renderManagementSummary(`management-${viewMode.replace('ily','y').replace('ly','ly')}`, dateKey, State.allHistoryData);
    };

    // ✨ [신규] 전역 보기 모드 컨트롤러 통합
    document.getElementById('global-view-mode-tabs')?.addEventListener('click', async (e) => {
        const btn = e.target.closest('.global-view-btn');
        if (!btn) return;
        
        // 버튼 스타일 전환
        document.querySelectorAll('.global-view-btn').forEach(b => {
            b.classList.remove('bg-white', 'text-blue-600', 'shadow-sm', 'font-bold');
            b.classList.add('text-gray-600', 'dark:text-gray-300', 'font-medium');
        });
        btn.classList.remove('text-gray-600', 'dark:text-gray-300', 'font-medium');
        btn.classList.add('bg-white', 'text-blue-600', 'shadow-sm', 'font-bold');

        const viewMode = btn.dataset.viewMode; // daily, weekly, monthly, yearly
        const listModeMap = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' };
        
        // 1. 좌측 폴더 리스트 형태(일/주/월/년) 즉각 변경
        renderHistoryDateListByMode(listModeMap[viewMode]);

        // 2. 우측 패널이 로우 데이터라면 뷰 전환 트리거
        const activeTopTab = document.querySelector('.history-main-tab-btn.text-blue-600')?.dataset.mainTab;
        if (activeTopTab === 'rawdata') {
            const activeSubTab = document.querySelector('.rawdata-sub-tab-btn.font-bold')?.dataset.subTab || 'work';
            const modeMap = { daily: 'daily', weekly: 'weekly', monthly: 'monthly', yearly: 'yearly' };
            const subTabPrefixes = { work: '', attendance: 'attendance-', report: 'report-', personal: 'personal-', management: 'management-' };
            
            if (['work', 'attendance', 'report', 'personal', 'management'].includes(activeSubTab)) {
                let viewString = modeMap[viewMode];
                if (activeSubTab !== 'work' && subTabPrefixes[activeSubTab] !== undefined) {
                    viewString = subTabPrefixes[activeSubTab] + modeMap[viewMode];
                }
                switchHistoryView(viewString);
            }
        }
    });

    const openHistoryModalLogic = async (e) => {
        if (!State.auth || !State.auth.currentUser) {
            showToast('이력을 보려면 로그인이 필요합니다.', true);
            if (DOM.historyModal) DOM.historyModal.classList.add('hidden');
            if (DOM.loginModal) DOM.loginModal.classList.remove('hidden');
            return;
        }

        if (window.innerWidth >= 768) {
            if (e) e.preventDefault();
            window.open('history.html', '_blank');
            return;
        }

        if (DOM.historyModal) {
            DOM.historyModal.classList.remove('hidden');
            setHistoryMaximized(true); 

            try { 
                await loadAndRenderHistoryList(); 
                
                // 오픈 시 뷰 엔진 깨우기 (대시보드 강제 렌더링)
                setTimeout(() => {
                    const dashboardTab = document.querySelector('[data-main-tab="dashboard"]');
                    if(dashboardTab) dashboardTab.click();
                }, 100);
            } 
            catch (loadError) { console.error(loadError); }
        }
    };

    if (DOM.openHistoryBtn) {
        DOM.openHistoryBtn.addEventListener('click', openHistoryModalLogic);
    }
    
    if (DOM.openHistoryBtnMobile) {
        DOM.openHistoryBtnMobile.addEventListener('click', (e) => { 
            e.preventDefault(); e.stopPropagation();
            openHistoryModalLogic(e); 
            if (DOM.navContent) DOM.navContent.classList.add('hidden'); 
        });
    }

    if (DOM.closeHistoryBtn) DOM.closeHistoryBtn.addEventListener('click', () => { if (DOM.historyModal) { DOM.historyModal.classList.add('hidden'); setHistoryMaximized(false); } });

    // ✨ 날짜 목록 클릭 시 처리 로직
    if (DOM.historyDateList) {
        DOM.historyDateList.addEventListener('click', (e) => {
            const btn = e.target.closest('.history-date-btn');
            if (btn) {
                DOM.historyDateList.querySelectorAll('button').forEach(b => b.classList.remove('bg-blue-100', 'font-bold'));
                btn.classList.add('bg-blue-100', 'font-bold');
                const dateKey = btn.dataset.key;

                // 좌측 날짜를 누르면 자동으로 '로우 데이터' 탭으로 점프
                const activeTopTab = document.querySelector('.history-main-tab-btn.text-blue-600')?.dataset.mainTab;
                if (activeTopTab !== 'rawdata') {
                    const rawTabBtn = document.querySelector('[data-main-tab="rawdata"]');
                    if (rawTabBtn) rawTabBtn.click();
                }

                const activeSubTab = document.querySelector('.rawdata-sub-tab-btn.font-bold')?.dataset.subTab || 'work';
                State.context.activeMainHistoryTab = activeSubTab; 
                State.context.activeFilterDropdown = null; 

                const viewMode = document.querySelector('.global-view-btn.font-bold')?.dataset.viewMode || 'daily';
                const filteredData = getFilteredHistoryData();
                State.context.reportSortState = {};

                if (activeSubTab === 'work') {
                    if (viewMode === 'daily') {
                        const currentIndex = filteredData.findIndex(d => d.id === dateKey);
                        const previousDayData = (currentIndex > -1 && currentIndex + 1 < filteredData.length) ? filteredData[currentIndex + 1] : null;
                        renderHistoryDetail(dateKey, previousDayData);
                    } else if (viewMode === 'weekly') renderWeeklyHistory(dateKey, filteredData, State.appConfig);
                    else if (viewMode === 'monthly') renderMonthlyHistory(dateKey, filteredData, State.appConfig);
                } else if (activeSubTab === 'attendance') { refreshAttendanceView(); }
                else if (activeSubTab === 'report') { refreshReportView(); }
                else if (activeSubTab === 'personal') { refreshPersonalView(); }
                else if (activeSubTab === 'management') { refreshManagementView(); }
            }
        });
    }

    if (DOM.personalReportMemberSelect) DOM.personalReportMemberSelect.addEventListener('change', (e) => { State.context.personalReportMember = e.target.value; refreshPersonalView(); });

    if (managementSaveBtn) {
        managementSaveBtn.addEventListener('click', async () => {
            const dateKey = managementSaveBtn.dataset.dateKey;
            if (!dateKey) return;
            const revenue = document.getElementById('mgmt-input-revenue')?.value.replace(/,/g, '') || 0;
            const orderCount = document.getElementById('mgmt-input-orderCount')?.value.replace(/,/g, '') || 0;
            const inventoryQty = document.getElementById('mgmt-input-inventoryQty')?.value.replace(/,/g, '') || 0;
            const inventoryAmt = document.getElementById('mgmt-input-inventoryAmt')?.value.replace(/,/g, '') || 0;

            try {
                managementSaveBtn.disabled = true; managementSaveBtn.textContent = '저장 중...';
                await saveManagementData(dateKey, { revenue: Number(revenue), orderCount: Number(orderCount), inventoryQty: Number(inventoryQty), inventoryAmt: Number(inventoryAmt) });
                showToast('경영 지표가 저장되었습니다.'); refreshManagementView();
            } catch (e) { showToast('저장 중 오류가 발생했습니다.', true); } 
            finally { managementSaveBtn.disabled = false; managementSaveBtn.textContent = '저장'; }
        });
    }

    if (predictionDaysSelect) predictionDaysSelect.addEventListener('change', () => { if (State.context.activeMainHistoryTab === 'prediction') renderPredictionTab(State.allHistoryData, Number(predictionDaysSelect.value)); });

    if (DOM.historyViewContainer) {
        DOM.historyViewContainer.addEventListener('click', (e) => {
            const button = e.target.closest('button[data-action]');
            if (!button || !button.dataset.dateKey) return;
            if (button.dataset.action === 'open-history-quantity-modal') { setHistoryMaximized(false); openHistoryQuantityModal(button.dataset.dateKey); } 
            else if (button.dataset.action === 'request-history-deletion') { setHistoryMaximized(false); requestHistoryDeletion(button.dataset.dateKey); }
        });
    }

    if (DOM.historyModalContentBox) {
        DOM.historyModalContentBox.addEventListener('click', (e) => {
            if (e.target.closest('#inspection-download-btn')) { e.stopPropagation(); openDownloadFormatModal('inspection'); return; }
            const deleteBtn = e.target.closest('button[data-action="request-history-deletion"]');
            if (deleteBtn && deleteBtn.dataset.dateKey) { e.stopPropagation(); setHistoryMaximized(false); requestHistoryDeletion(deleteBtn.dataset.dateKey); }
        });
    }

    if (DOM.confirmHistoryDeleteBtn) {
        DOM.confirmHistoryDeleteBtn.addEventListener('click', async () => {
            const dateKey = State.context.historyKeyToDelete;
            if (dateKey) {
                const activeTab = State.context.activeMainHistoryTab || 'work';
                const updates = {};
                
                if (activeTab === 'work' || activeTab === 'report') { updates.workRecords = deleteField(); updates.taskQuantities = deleteField(); updates.partTimers = deleteField(); updates.confirmedZeroTasks = deleteField(); } 
                else if (activeTab === 'attendance') { updates.onLeaveMembers = deleteField(); } 
                else if (activeTab === 'management') { updates.management = deleteField(); } 
                else if (activeTab === 'inspection') { updates.inspectionList = deleteField(); } 
                else { showToast('삭제할 대상 탭이 명확하지 않습니다.', true); return; }

                try {
                    await updateDoc(doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey), updates);
                    if (dateKey === getTodayDateString()) {
                        await updateDoc(doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', dateKey), updates);
                        if (activeTab === 'work' || activeTab === 'report') { State.appState.workRecords = []; State.appState.taskQuantities = {}; State.appState.partTimers = []; State.appState.confirmedZeroTasks = []; } 
                        else if (activeTab === 'attendance') { State.appState.dailyOnLeaveMembers = []; } 
                        else if (activeTab === 'inspection') { State.appState.inspectionList = []; }
                    }
                    showToast(`${dateKey}의 데이터가 삭제되었습니다.`);
                    await loadAndRenderHistoryList();
                } catch (e) { showToast('삭제 중 오류가 발생했습니다.', true); }
            }
            if (DOM.deleteHistoryModal) DOM.deleteHistoryModal.classList.add('hidden');
            State.context.historyKeyToDelete = null;
        });
    }

    const setupFilterListeners = (container, stateKeySort, stateKeyFilter, refreshFunc) => {
        if (!container) return;
        container.addEventListener('click', (e) => {
            if (e.target.closest('.filter-dropdown')) { e.stopPropagation(); return; }
            const filterIconBtn = e.target.closest('.filter-icon-btn');
            if (filterIconBtn) {
                e.stopPropagation();
                const dropdownId = filterIconBtn.dataset.dropdownId;
                State.context.activeFilterDropdown = (State.context.activeFilterDropdown === dropdownId) ? null : dropdownId;
                refreshFunc(); return;
            }
            const sortTh = e.target.closest('th[data-sort-key]');
            if (sortTh && sortTh.dataset.sortTarget && sortTh.dataset.sortKey) {
                const mode = sortTh.dataset.sortTarget, key = sortTh.dataset.sortKey;
                if (!State.context[stateKeySort][mode]) State.context[stateKeySort][mode] = { key: '', dir: 'asc' };
                const currentSort = State.context[stateKeySort][mode];
                if (currentSort.key === key) currentSort.dir = (currentSort.dir === 'asc' ? 'desc' : 'asc');
                else { currentSort.key = key; currentSort.dir = 'asc'; }
                refreshFunc(); return;
            }
        });
        container.addEventListener('input', (e) => {
            const filterInput = e.target.closest('[data-filter-key]');
            if (filterInput) {
                const mode = filterInput.dataset.filterTarget, key = filterInput.dataset.filterKey;
                if (!State.context[stateKeyFilter][mode]) State.context[stateKeyFilter][mode] = {};
                State.context[stateKeyFilter][mode][key] = filterInput.value;
                refreshFunc();
                setTimeout(() => {
                    const newInput = container.querySelector(`[data-filter-target="${mode}"][data-filter-key="${key}"]`);
                    if (newInput) { newInput.focus(); if (newInput.tagName === 'INPUT') { const val = newInput.value; newInput.value = ''; newInput.value = val; } }
                }, 0);
            }
        });
    };

    setupFilterListeners(DOM.attendanceHistoryViewContainer, 'attendanceSortState', 'attendanceFilterState', refreshAttendanceView);
    setupFilterListeners(DOM.reportViewContainer, 'reportSortState', 'reportFilterState', refreshReportView);
    setupFilterListeners(DOM.personalReportViewContainer, 'personalReportSortState', 'personalReportFilterState', refreshPersonalView);

    document.addEventListener('click', (e) => {
        if (State.context && State.context.activeFilterDropdown && !e.target.closest('.filter-dropdown') && !e.target.closest('.filter-icon-btn')) {
            State.context.activeFilterDropdown = null;
            if (State.context.activeMainHistoryTab === 'attendance') refreshAttendanceView();
            else if (State.context.activeMainHistoryTab === 'report') refreshReportView();
            else if (State.context.activeMainHistoryTab === 'personal') refreshPersonalView();
            else if (State.context.activeMainHistoryTab === 'weekend') loadAndRenderWeekendStats();
        }
    });

    const historyHeader = document.getElementById('history-modal-header');
    if (DOM.historyModal && historyHeader && DOM.historyModalContentBox) {
        let isDragging = false, offsetX, offsetY;
        historyHeader.addEventListener('mousedown', e => {
            if(isHistoryMaximized || e.target.closest('button')) return;
            isDragging = true; 
            if(DOM.historyModalContentBox.dataset.hasBeenUncentered !== 'true') {
                const r = DOM.historyModalContentBox.getBoundingClientRect();
                DOM.historyModal.classList.remove('flex','items-center','justify-center');
                DOM.historyModalContentBox.style.position = 'absolute'; 
                DOM.historyModalContentBox.style.top = `${r.top}px`; DOM.historyModalContentBox.style.left = `${r.left}px`;
                DOM.historyModalContentBox.style.width = `${r.width}px`; DOM.historyModalContentBox.style.height = `${r.height}px`;
                DOM.historyModalContentBox.style.transform = 'none'; DOM.historyModalContentBox.dataset.hasBeenUncentered = 'true';
            }
            const r = DOM.historyModalContentBox.getBoundingClientRect(); offsetX = e.clientX - r.left; offsetY = e.clientY - r.top;
            document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
        });
        function onMove(e) { if(!isDragging)return; DOM.historyModalContentBox.style.left = `${e.clientX - offsetX}px`; DOM.historyModalContentBox.style.top = `${e.clientY - offsetY}px`; }
        function onUp() { isDragging = false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
    }

    const toggleFullscreenBtn = document.getElementById('toggle-history-fullscreen-btn');
    if (toggleFullscreenBtn) toggleFullscreenBtn.addEventListener('click', (e) => { e.stopImmediatePropagation(); setHistoryMaximized(!isHistoryMaximized); });

    if (window.location.pathname.includes('history.html')) {
        setTimeout(() => { const dashTab = document.querySelector('.history-main-tab-btn[data-main-tab="dashboard"]'); if (dashTab) dashTab.click(); }, 300);
    }
}

export const requestHistoryDeletion = (dateKey) => {
    State.context.historyKeyToDelete = dateKey;
    const activeTab = State.context.activeMainHistoryTab || 'work';
    let targetName = '모든';
    
    if (activeTab === 'work' || activeTab === 'report') targetName = '업무 이력(처리량 포함)';
    else if (activeTab === 'attendance') targetName = '근태 이력';
    else if (activeTab === 'management') targetName = '경영 지표';
    else if (activeTab === 'inspection') targetName = '검수 이력';

    const msgEl = document.querySelector('#delete-history-modal h3');
    if (msgEl) msgEl.innerHTML = `정말로 이 날짜의 <span class="text-red-600 font-bold">${targetName}</span> 데이터를 삭제하시겠습니까?`;
    if (DOM.deleteHistoryModal) DOM.deleteHistoryModal.classList.remove('hidden');
};