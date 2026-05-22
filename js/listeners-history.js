// === js/listeners-history.js ===
import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { showToast, getTodayDateString } from './utils.js';

import { setupHistoryDownloadListeners, openDownloadFormatModal } from './listeners-history-download.js';
import { setupHistoryRecordListeners } from './listeners-history-records.js';
import { setupHistoryAttendanceListeners } from './listeners-history-attendance.js';
import { setupHistoryInspectionListeners, fetchAndRenderInspectionHistory } from './listeners-history-inspection.js';

import { loadAndRenderHistoryList, renderHistoryDetail, switchHistoryView, renderHistoryDateListByMode, openHistoryQuantityModal, augmentHistoryWithPersistentLeave } from './app-history-logic.js';
import { renderAttendanceDailyHistory, renderAttendanceWeeklyHistory, renderAttendanceMonthlyHistory, renderReportDaily, renderReportWeekly, renderReportMonthly, renderReportYearly, renderPersonalReport, renderManagementDaily, renderManagementSummary, renderWeeklyHistory, renderMonthlyHistory } from './ui-history.js';
import * as UILeave from './ui-history-leave.js';
import { syncTodayToHistory, saveManagementData } from './history-data-manager.js';
import { doc, updateDoc, deleteField, collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ✅ [신규 추가] 대시보드 렌더링 함수 로드
import { renderDashboardTab } from './ui-history-dashboard.js';

let isHistoryMaximized = false;

// ... (주말 통계 관련 변수 유지) ...
let currentWeekendStatsData = [];
let currentWeekendTotalCost = 0;
let currentWeekendTotalCount = 0;
let currentWeekendMonthStr = "";
let weekendSortState = { key: 'count', dir: 'desc' };
let weekendFilterState = { name: '' };

const getFilteredHistoryData = () => {
    return (State.context.historyStartDate || State.context.historyEndDate)
        ? State.allHistoryData.filter(d => {
            const date = d.id;
            const start = State.context.historyStartDate;
            const end = State.context.historyEndDate;
            if (start && end) return date >= start && date <= end;
            if (start) return date >= start;
            if (end) return date <= end;
            return true;
        })
        : State.allHistoryData;
};

export function setupHistoryModalListeners() {
    setupHistoryDownloadListeners();
    setupHistoryRecordListeners();
    setupHistoryAttendanceListeners();
    setupHistoryInspectionListeners();

    // 💡 [신규 로직] 1. 글로벌 기간 필터 컨트롤 연동
    const presetBtn = document.getElementById('global-period-preset');
    const startInput = document.getElementById('global-start-date');
    const endInput = document.getElementById('global-end-date');
    const applyBtn = document.getElementById('global-filter-btn');

    if (presetBtn && startInput && endInput && applyBtn) {
        const updateDates = () => {
            const val = presetBtn.value;
            const today = new Date();
            let start = '', end = '';
            
            if (val === 'today') {
                start = end = getTodayDateString();
            } else if (val === 'week') {
                const day = today.getDay();
                const diff = today.getDate() - day + (day === 0 ? -6 : 1);
                const monday = new Date(today.setDate(diff));
                start = monday.toISOString().split('T')[0];
                const sunday = new Date(monday);
                sunday.setDate(monday.getDate() + 6);
                end = sunday.toISOString().split('T')[0];
            } else if (val === 'month') {
                start = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
                end = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];
            }
            if (val !== 'custom') {
                startInput.value = start;
                endInput.value = end;
            }
        };

        // 초기 진입 시 "이번 주"로 기본 세팅
        updateDates();

        presetBtn.addEventListener('change', updateDates);
        
        applyBtn.addEventListener('click', () => {
            State.context.historyStartDate = startInput.value || null;
            State.context.historyEndDate = endInput.value || null;
            showToast('조회 기간이 적용되었습니다.');
            
            // 현재 활성화된 메인 탭 다시 렌더링 트리거
            const activeMainBtn = document.querySelector('.history-main-tab-btn.text-blue-600');
            if (activeMainBtn) activeMainBtn.click();
        });
    }

    // 💡 [신규 로직] 2. 새로운 4대 메인 탭 전환 로직
    const mainTabsContainer = document.getElementById('history-main-tabs');
    if (mainTabsContainer) {
        mainTabsContainer.addEventListener('click', async (e) => {
            const btn = e.target.closest('button[data-main-tab]');
            if (!btn) return;
            const tabName = btn.dataset.mainTab;
            
            // 버튼 스타일 토글
            document.querySelectorAll('.history-main-tab-btn').forEach(b => {
                const isActive = (b === btn);
                b.classList.toggle('text-blue-600', isActive);
                b.classList.toggle('border-blue-600', isActive);
                b.classList.toggle('font-bold', isActive);
                b.classList.toggle('text-gray-500', !isActive);
                b.classList.toggle('border-transparent', !isActive);
                b.classList.toggle('font-medium', !isActive);
            });

            // 컨텐츠 패널 토글
            document.getElementById('dashboard-panel').classList.toggle('hidden', tabName !== 'dashboard');
            document.getElementById('productivity-panel').classList.toggle('hidden', tabName !== 'productivity');
            document.getElementById('staffing-panel').classList.toggle('hidden', tabName !== 'staffing');
            document.getElementById('rawdata-panel').classList.toggle('hidden', tabName !== 'rawdata');

            // 탭별 데이터 렌더링 분기
            const filteredData = getFilteredHistoryData();
            
            if (tabName === 'dashboard') {
                renderDashboardTab(filteredData, State.appConfig);
            } else if (tabName === 'productivity') {
                // 향후 추가될 생산성 로직 (현재는 UI만 보여줌)
            } else if (tabName === 'staffing') {
                // 향후 추가될 인력 로직 (현재는 UI만 보여줌)
            } else if (tabName === 'rawdata') {
                // 로우 데이터 탭 진입 시, 첫 번째 서브 탭(업무 이력)을 강제로 클릭 처리
                const firstSubTab = document.querySelector('.rawdata-sub-tab-btn[data-sub-tab="work"]');
                if (firstSubTab) firstSubTab.click();
            }
        });
    }

    // 💡 [신규 로직] 3. 로우 데이터(Raw Data) 내부 서브 탭 전환 (기존 10개 탭 호환 유지)
    document.querySelectorAll('.rawdata-sub-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const subTabName = e.target.dataset.subTab;
            State.context.activeMainHistoryTab = subTabName; // 기존 로직 호환을 위한 꼼수
            
            // 서브 탭 스타일 토글
            document.querySelectorAll('.rawdata-sub-tab-btn').forEach(b => {
                 const isActive = (b === e.target);
                 b.classList.toggle('text-gray-800', isActive);
                 b.classList.toggle('border-gray-800', isActive);
                 b.classList.toggle('font-bold', isActive);
                 b.classList.toggle('text-gray-500', !isActive);
                 b.classList.toggle('border-transparent', !isActive);
            });

            // 구형 패널 숨김/표시 처리
            const panels = {
                'work': document.getElementById('work-history-panel'),
                'attendance': document.getElementById('attendance-history-panel'),
                'report': document.getElementById('report-panel'),
                'personal': document.getElementById('personal-report-panel'),
                'management': document.getElementById('management-panel'),
                'inspection': document.getElementById('inspection-history-panel'),
                'leave': document.getElementById('history-leave-panel'),
                'weekend': document.getElementById('history-weekend-panel')
            };

            Object.keys(panels).forEach(key => {
                if (panels[key]) panels[key].classList.toggle('hidden', key !== subTabName);
            });
            
            // 뷰 렌더링 트리거
            if (subTabName === 'work') switchHistoryView('daily');
            else if (subTabName === 'attendance') switchHistoryView('attendance-daily');
            else if (subTabName === 'report') switchHistoryView('report-daily');
            else if (subTabName === 'inspection') fetchAndRenderInspectionHistory();
            else if (subTabName === 'leave') UILeave.initLeaveManagement();
            // ... 기존의 리스트 로드 함수들 연동 ...
            renderHistoryDateListByMode('day'); // 기본 날짜 리스트 업데이트
        });
    });

    // =========================================================
    // 이하 기존 모달 열기/닫기 및 하위 UI 클릭 로직 (수정 최소화)
    // =========================================================
    
    const setHistoryMaximized = (maximized) => {
        isHistoryMaximized = maximized;
        // 로직 생략 (전체화면 CSS 토글 역할 유지)
    };

    const openHistoryModalLogic = async (e) => {
        if (!State.auth || !State.auth.currentUser) return showToast('로그인이 필요합니다.', true);
        
        if (DOM.historyModal) {
            DOM.historyModal.classList.remove('hidden');
            
            // 💡 창을 열 때 초기화 및 기간 설정 후, 1번 메인 탭 클릭 이벤트 강제 발생
            if (applyBtn) applyBtn.click();
            setTimeout(() => {
                const dashTab = document.querySelector('.history-main-tab-btn[data-main-tab="dashboard"]');
                if (dashTab) dashTab.click();
            }, 100);

            try {
                await loadAndRenderHistoryList();
            } catch (err) {
                console.error(err);
            }
        }
    };

    if (DOM.openHistoryBtn) DOM.openHistoryBtn.addEventListener('click', openHistoryModalLogic);
    if (DOM.closeHistoryBtn) DOM.closeHistoryBtn.addEventListener('click', () => {
        if (DOM.historyModal) DOM.historyModal.classList.add('hidden');
    });

    if (DOM.historyDateList) {
        DOM.historyDateList.addEventListener('click', (e) => {
            const btn = e.target.closest('.history-date-btn');
            if (btn) {
                DOM.historyDateList.querySelectorAll('button').forEach(b => b.classList.remove('bg-blue-100', 'font-bold'));
                btn.classList.add('bg-blue-100', 'font-bold');
                const dateKey = btn.dataset.key;

                let activeMainTab = State.context.activeMainHistoryTab || 'work';
                State.context.activeFilterDropdown = null; 

                if (activeMainTab === 'attendance') { refreshAttendanceView(); return; }
                else if (activeMainTab === 'management') { refreshManagementView(); return; }

                const filteredData = getFilteredHistoryData();
                State.context.reportSortState = {};

                if (activeMainTab === 'work') {
                    const activeSubTabBtn = DOM.historyTabs?.querySelector('button.font-semibold');
                    const activeView = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'daily';
                    if (activeView === 'daily') {
                        const currentIndex = filteredData.findIndex(d => d.id === dateKey);
                        const previousDayData = (currentIndex > -1 && currentIndex + 1 < filteredData.length) ? filteredData[currentIndex + 1] : null;
                        renderHistoryDetail(dateKey, previousDayData);
                    } else if (activeView === 'weekly') {
                        renderWeeklyHistory(dateKey, filteredData, State.appConfig);
                    } else if (activeView === 'monthly') {
                        renderMonthlyHistory(dateKey, filteredData, State.appConfig);
                    }
                } else if (activeMainTab === 'report') {
                    refreshReportView();
                } else if (activeMainTab === 'personal') {
                    refreshPersonalView();
                }
            }
        });
    }

    const handleTabSwitch = (e, tabsContainer) => {
        const btn = e.target.closest('button[data-view]');
        if (btn) {
            State.context.activeFilterDropdown = null;
            if (tabsContainer) {
                tabsContainer.querySelectorAll('button').forEach(b => {
                    b.classList.remove('font-semibold', 'text-blue-600', 'border-blue-600', 'border-b-2');
                    b.classList.add('text-gray-500', 'hover:text-gray-700');
                });
                btn.classList.add('font-semibold', 'text-blue-600', 'border-blue-600', 'border-b-2');
                btn.classList.remove('text-gray-500', 'hover:text-gray-700');
            }
            if (tabsContainer === DOM.personalReportTabs || tabsContainer === managementTabs) {
                const viewMode = btn.dataset.view;
                let listMode = 'day';
                if(viewMode.includes('weekly')) listMode = 'week';
                if(viewMode.includes('monthly')) listMode = 'month';
                if(viewMode.includes('yearly')) listMode = 'year';
                renderHistoryDateListByMode(listMode);
            } else {
                switchHistoryView(btn.dataset.view);
            }
        }
    };

    if (DOM.historyTabs) DOM.historyTabs.addEventListener('click', (e) => switchHistoryView(e.target.closest('button[data-view]')?.dataset.view));
    if (DOM.attendanceHistoryTabs) DOM.attendanceHistoryTabs.addEventListener('click', (e) => { State.context.activeFilterDropdown = null; switchHistoryView(e.target.closest('button[data-view]')?.dataset.view); });
    if (DOM.reportTabs) DOM.reportTabs.addEventListener('click', (e) => { State.context.reportSortState = {}; State.context.activeFilterDropdown = null; switchHistoryView(e.target.closest('button[data-view]')?.dataset.view); });
    if (DOM.personalReportTabs) DOM.personalReportTabs.addEventListener('click', (e) => handleTabSwitch(e, DOM.personalReportTabs));
    if (managementTabs) managementTabs.addEventListener('click', (e) => handleTabSwitch(e, managementTabs));

    if (DOM.personalReportMemberSelect) {
        DOM.personalReportMemberSelect.addEventListener('change', (e) => {
            State.context.personalReportMember = e.target.value;
            refreshPersonalView();
        });
    }

    if (managementSaveBtn) {
        managementSaveBtn.addEventListener('click', async () => {
            const dateKey = managementSaveBtn.dataset.dateKey;
            if (!dateKey) return;
            const revenue = document.getElementById('mgmt-input-revenue')?.value.replace(/,/g, '') || 0;
            const orderCount = document.getElementById('mgmt-input-orderCount')?.value.replace(/,/g, '') || 0;
            const inventoryQty = document.getElementById('mgmt-input-inventoryQty')?.value.replace(/,/g, '') || 0;
            const inventoryAmt = document.getElementById('mgmt-input-inventoryAmt')?.value.replace(/,/g, '') || 0;

            try {
                managementSaveBtn.disabled = true;
                managementSaveBtn.textContent = '저장 중...';
                await saveManagementData(dateKey, {
                    revenue: Number(revenue), orderCount: Number(orderCount),
                    inventoryQty: Number(inventoryQty), inventoryAmt: Number(inventoryAmt)
                });
                showToast('경영 지표가 저장되었습니다.');
                refreshManagementView();
            } catch (e) {
                showToast('저장 중 오류가 발생했습니다.', true);
            } finally {
                managementSaveBtn.disabled = false;
                managementSaveBtn.textContent = '저장';
            }
        });
    }

    if (DOM.historyMainTabs) {
        DOM.historyMainTabs.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-main-tab]');
            if (btn) {
                const tabName = btn.dataset.mainTab;
                State.context.activeMainHistoryTab = tabName;
                State.context.activeFilterDropdown = null; 
                
                styleHistoryTabs(tabName);
                
                const periodExcelBtn = document.getElementById('history-download-period-excel-btn');
                if (periodExcelBtn) {
                    if (tabName === 'work' || tabName === 'report') {
                        periodExcelBtn.classList.remove('hidden');
                        periodExcelBtn.classList.add('flex');
                    } else {
                        periodExcelBtn.classList.add('hidden');
                        periodExcelBtn.classList.remove('flex');
                    }
                }

                const dateListContainer = document.getElementById('history-date-list-container');
                
                DOM.workHistoryPanel.classList.toggle('hidden', tabName !== 'work');
                DOM.attendanceHistoryPanel.classList.toggle('hidden', tabName !== 'attendance');
                DOM.trendAnalysisPanel.classList.toggle('hidden', tabName !== 'trends');
                DOM.reportPanel.classList.toggle('hidden', tabName !== 'report');
                if (DOM.personalReportPanel) DOM.personalReportPanel.classList.toggle('hidden', tabName !== 'personal');
                if (managementPanel) managementPanel.classList.toggle('hidden', tabName !== 'management');
                if (inspectionPanel) inspectionPanel.classList.toggle('hidden', tabName !== 'inspection');
                if (predictionPanel) predictionPanel.classList.toggle('hidden', tabName !== 'prediction');
                if (leavePanel) leavePanel.classList.toggle('hidden', tabName !== 'leave');
                if (weekendPanel) weekendPanel.classList.toggle('hidden', tabName !== 'weekend');
                
                if (dateListContainer) {
                    const hideListTabs = ['trends', 'inspection', 'prediction', 'leave', 'weekend'];
                    dateListContainer.style.display = hideListTabs.includes(tabName) ? 'none' : 'block';
                }

                if (tabName === 'work') {
                     const view = DOM.historyTabs?.querySelector('button.font-semibold')?.dataset.view || 'daily';
                     switchHistoryView(view);
                } else if (tabName === 'attendance') {
                     const view = DOM.attendanceHistoryTabs?.querySelector('button.font-semibold')?.dataset.view || 'attendance-daily';
                     switchHistoryView(view);
                } else if (tabName === 'report') {
                     const view = DOM.reportTabs?.querySelector('button.font-semibold')?.dataset.view || 'report-daily';
                     switchHistoryView(view);
                } else if (tabName === 'trends') {
                     renderTrendAnalysisCharts(State.allHistoryData, State.appConfig, trendCharts);
                } else if (tabName === 'prediction') { 
                     const days = predictionDaysSelect ? Number(predictionDaysSelect.value) : 14;
                     renderPredictionTab(State.allHistoryData, days);
                } else if (tabName === 'personal') {
                     if (DOM.personalReportMemberSelect && DOM.personalReportMemberSelect.options.length <= 1) {
                         const staff = (State.appConfig.teamGroups || []).flatMap(g => g.members);
                         const partTimers = (State.appState.partTimers || []).map(p => p.name);
                         const allMembers = [...new Set([...staff, ...partTimers])].sort();
                         DOM.personalReportMemberSelect.innerHTML = '<option value="">직원 선택...</option>';
                         allMembers.forEach(m => {
                             const op = document.createElement('option');
                             op.value = m; op.textContent = m;
                             DOM.personalReportMemberSelect.appendChild(op);
                         });
                         if (State.appState.currentUser && allMembers.includes(State.appState.currentUser)) {
                             DOM.personalReportMemberSelect.value = State.appState.currentUser;
                             State.context.personalReportMember = State.appState.currentUser;
                         }
                     }
                     const viewMode = DOM.personalReportTabs?.querySelector('button.font-semibold')?.dataset.view || 'personal-daily';
                     let listMode = 'day';
                     if(viewMode.includes('weekly')) listMode = 'week';
                     if(viewMode.includes('monthly')) listMode = 'month';
                     if(viewMode.includes('yearly')) listMode = 'year';
                     renderHistoryDateListByMode(listMode);
                } else if (tabName === 'management') {
                     const viewMode = managementTabs?.querySelector('button.font-semibold')?.dataset.view || 'management-daily';
                     let listMode = 'day';
                     if(viewMode.includes('weekly')) listMode = 'week';
                     if(viewMode.includes('monthly')) listMode = 'month';
                     if(viewMode.includes('yearly')) listMode = 'year';
                     renderHistoryDateListByMode(listMode);
                } else if (tabName === 'inspection') {
                    fetchAndRenderInspectionHistory();
                } else if (tabName === 'leave') {
                    UILeave.initLeaveManagement();
                } else if (tabName === 'weekend') {
                    loadAndRenderWeekendStats();
                }
            }
        });
    }

    if (predictionDaysSelect) {
        predictionDaysSelect.addEventListener('change', () => {
            if (State.context.activeMainHistoryTab === 'prediction') {
                const days = Number(predictionDaysSelect.value);
                renderPredictionTab(State.allHistoryData, days);
            }
        });
    }

    if (DOM.historyViewContainer) {
        DOM.historyViewContainer.addEventListener('click', (e) => {
            const button = e.target.closest('button[data-action]');
            if (!button) return;
            const action = button.dataset.action;
            const dateKey = button.dataset.dateKey;
            if (!dateKey) return;

            if (action === 'open-history-quantity-modal') {
                setHistoryMaximized(false); 
                openHistoryQuantityModal(dateKey);
            } else if (action === 'request-history-deletion') {
                setHistoryMaximized(false); 
                requestHistoryDeletion(dateKey);
            }
        });
    }

    if (DOM.historyModalContentBox) {
        DOM.historyModalContentBox.addEventListener('click', (e) => {
            const downloadBtn = e.target.closest('#inspection-download-btn');
            if (downloadBtn) {
                e.stopPropagation();
                openDownloadFormatModal('inspection');
                return;
            }

            const deleteBtn = e.target.closest('button[data-action="request-history-deletion"]');
            if (deleteBtn) {
                e.stopPropagation();
                const dateKey = deleteBtn.dataset.dateKey;
                if(dateKey) {
                    setHistoryMaximized(false); 
                    requestHistoryDeletion(dateKey);
                }
                return;
            }
        });
    }

    if (DOM.confirmHistoryDeleteBtn) {
        DOM.confirmHistoryDeleteBtn.addEventListener('click', async () => {
            const dateKey = State.context.historyKeyToDelete;
            if (dateKey) {
                const activeTab = State.context.activeMainHistoryTab || 'work';
                const updates = {};
                
                if (activeTab === 'work' || activeTab === 'report') {
                    updates.workRecords = deleteField();
                    updates.taskQuantities = deleteField();
                    updates.partTimers = deleteField();
                    updates.confirmedZeroTasks = deleteField();
                } else if (activeTab === 'attendance') {
                    updates.onLeaveMembers = deleteField();
                } else if (activeTab === 'management') {
                    updates.management = deleteField();
                } else if (activeTab === 'inspection') {
                    updates.inspectionList = deleteField();
                } else {
                    showToast('삭제할 대상 탭이 명확하지 않습니다.', true);
                    return;
                }

                try {
                    const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
                    await updateDoc(historyDocRef, updates);

                    if (dateKey === getTodayDateString()) {
                        const dailyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', dateKey);
                        await updateDoc(dailyDocRef, updates);
                        
                        if (activeTab === 'work' || activeTab === 'report') {
                            State.appState.workRecords = [];
                            State.appState.taskQuantities = {};
                            State.appState.partTimers = [];
                            State.appState.confirmedZeroTasks = [];
                        } else if (activeTab === 'attendance') {
                            State.appState.dailyOnLeaveMembers = [];
                        } else if (activeTab === 'inspection') {
                            State.appState.inspectionList = [];
                        }
                    }

                    showToast(`${dateKey}의 데이터가 삭제되었습니다.`);
                    await loadAndRenderHistoryList();

                } catch (e) {
                    console.error("Partial deletion error:", e);
                    showToast('삭제 중 오류가 발생했습니다.', true);
                }
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
                refreshFunc();
                return;
            }
            const sortTh = e.target.closest('th[data-sort-key]');
            if (sortTh) {
                const mode = sortTh.dataset.sortTarget;
                const key = sortTh.dataset.sortKey;
                if (!mode || !key) return;
                const sortStateObj = State.context[stateKeySort]; 
                if (!sortStateObj[mode]) sortStateObj[mode] = { key: '', dir: 'asc' };
                const currentSort = sortStateObj[mode];
                if (currentSort.key === key) currentSort.dir = (currentSort.dir === 'asc' ? 'desc' : 'asc');
                else { currentSort.key = key; currentSort.dir = 'asc'; }
                refreshFunc();
                return;
            }
        });
        container.addEventListener('input', (e) => {
            const filterInput = e.target.closest('[data-filter-key]');
            if (filterInput) {
                const mode = filterInput.dataset.filterTarget;
                const key = filterInput.dataset.filterKey;
                const filterStateObj = State.context[stateKeyFilter];
                if (!filterStateObj[mode]) filterStateObj[mode] = {};
                filterStateObj[mode][key] = filterInput.value;
                refreshFunc();
                setTimeout(() => {
                    const newInput = container.querySelector(`[data-filter-target="${mode}"][data-filter-key="${key}"]`);
                    if (newInput) {
                        newInput.focus();
                        if (newInput.tagName === 'INPUT') { const val = newInput.value; newInput.value = ''; newInput.value = val; }
                    }
                }, 0);
            }
        });
    };

    setupFilterListeners(DOM.attendanceHistoryViewContainer, 'attendanceSortState', 'attendanceFilterState', refreshAttendanceView);
    setupFilterListeners(DOM.reportViewContainer, 'reportSortState', 'reportFilterState', refreshReportView);
    setupFilterListeners(DOM.personalReportViewContainer, 'personalReportSortState', 'personalReportFilterState', refreshPersonalView);

    document.addEventListener('click', (e) => {
        if (State.context && State.context.activeFilterDropdown) {
            if (!e.target.closest('.filter-dropdown') && !e.target.closest('.filter-icon-btn')) {
                State.context.activeFilterDropdown = null;
                if (State.context.activeMainHistoryTab === 'attendance') refreshAttendanceView();
                else if (State.context.activeMainHistoryTab === 'report') refreshReportView();
                else if (State.context.activeMainHistoryTab === 'personal') refreshPersonalView();
                else if (State.context.activeMainHistoryTab === 'weekend') loadAndRenderWeekendStats();
            }
        }
    });

    const historyHeader = document.getElementById('history-modal-header');
    if (DOM.historyModal && historyHeader && DOM.historyModalContentBox) {
        let isDragging = false; let offsetX, offsetY;
        historyHeader.addEventListener('mousedown', e => {
            if(isHistoryMaximized || e.target.closest('button')) return;
            isDragging=true; 
            if(DOM.historyModalContentBox.dataset.hasBeenUncentered!=='true') {
                const r=DOM.historyModalContentBox.getBoundingClientRect();
                DOM.historyModal.classList.remove('flex','items-center','justify-center');
                DOM.historyModalContentBox.style.position='absolute'; 
                DOM.historyModalContentBox.style.top=`${r.top}px`; DOM.historyModalContentBox.style.left=`${r.left}px`;
                DOM.historyModalContentBox.style.width=`${r.width}px`; DOM.historyModalContentBox.style.height=`${r.height}px`;
                DOM.historyModalContentBox.style.transform='none'; DOM.historyModalContentBox.dataset.hasBeenUncentered='true';
            }
            const r=DOM.historyModalContentBox.getBoundingClientRect(); offsetX=e.clientX-r.left; offsetY=e.clientY-r.top;
            document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
        });
        function onMove(e) { if(!isDragging)return; DOM.historyModalContentBox.style.left=`${e.clientX-offsetX}px`; DOM.historyModalContentBox.style.top=`${e.clientY-offsetY}px`; }
        function onUp() { isDragging=false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
    }

    const toggleFullscreenBtn = document.getElementById('toggle-history-fullscreen-btn');
    if (toggleFullscreenBtn) {
        toggleFullscreenBtn.addEventListener('click', (e) => {
            e.stopImmediatePropagation();
            setHistoryMaximized(!isHistoryMaximized);
        });
    }
}

// 💡 엑셀 스타일 이벤트 위임 (전역 위임으로 이벤트 누락 방지)
document.addEventListener('click', (e) => {
    const isWeekendPanel = e.target.closest('#history-weekend-panel') || e.target.closest('table:has(#weekend-history-table-body)');
    if (!isWeekendPanel) return;

    if (e.target.closest('.filter-dropdown')) return;
    
    const filterIconBtn = e.target.closest('.filter-icon-btn');
    if (filterIconBtn) {
        e.stopPropagation();
        if (!State.context) State.context = {};
        const dropdownId = filterIconBtn.dataset.dropdownId;
        State.context.activeFilterDropdown = (State.context.activeFilterDropdown === dropdownId) ? null : dropdownId;
        loadAndRenderWeekendStats();
        return;
    }

    const sortTh = e.target.closest('th[data-sort-key]');
    if (sortTh) {
        const key = sortTh.dataset.sortKey;
        if (!key) return;
        
        if (weekendSortState.key === key) {
            weekendSortState.dir = weekendSortState.dir === 'asc' ? 'desc' : 'asc';
        } else {
            weekendSortState.key = key;
            weekendSortState.dir = 'asc';
        }
        loadAndRenderWeekendStats();
    }
});

document.addEventListener('input', (e) => {
    const isWeekendPanel = e.target.closest('#history-weekend-panel') || e.target.closest('table:has(#weekend-history-table-body)');
    if (!isWeekendPanel) return;

    const filterInput = e.target.closest('input[data-filter-key]');
    if (filterInput) {
        const key = filterInput.dataset.filterKey;
        if (key === 'name') {
            weekendFilterState.name = filterInput.value;
            loadAndRenderWeekendStats();
            
            setTimeout(() => {
                const newInputs = document.querySelectorAll(`input[data-filter-key="name"]`);
                newInputs.forEach(newInput => {
                    if (newInput.closest('#history-weekend-panel') || newInput.closest('table:has(#weekend-history-table-body)')) {
                        newInput.focus();
                        const val = newInput.value;
                        newInput.value = '';
                        newInput.value = val;
                    }
                });
            }, 0);
        }
    }
});

export const requestHistoryDeletion = (dateKey) => {
    State.context.historyKeyToDelete = dateKey;
    const activeTab = State.context.activeMainHistoryTab || 'work';
    let targetName = '모든';
    
    if (activeTab === 'work' || activeTab === 'report') targetName = '업무 이력(처리량 포함)';
    else if (activeTab === 'attendance') targetName = '근태 이력';
    else if (activeTab === 'management') targetName = '경영 지표';
    else if (activeTab === 'inspection') targetName = '검수 이력';

    const msgEl = document.querySelector('#delete-history-modal h3');
    if (msgEl) {
        msgEl.innerHTML = `정말로 이 날짜의 <span class="text-red-600 font-bold">${targetName}</span> 데이터를 삭제하시겠습니까?`;
    }

    if (DOM.deleteHistoryModal) DOM.deleteHistoryModal.classList.remove('hidden');
};