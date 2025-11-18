// === js/listeners-history.js ===

import * as DOM from './dom-elements.js';
import * as State from './state.js';

import { showToast } from './utils.js';

import {
    renderTrendAnalysisCharts,
    trendCharts
} from './ui.js';

import {
    loadAndRenderHistoryList,
    renderHistoryDetail,
    switchHistoryView,
    renderHistoryDateListByMode,
    openHistoryQuantityModal,
    requestHistoryDeletion,
    openHistoryRecordManager, 
    renderHistoryRecordsTable   
} from './app-history-logic.js';

import {
    downloadHistoryAsExcel,
    downloadPeriodHistoryAsExcel,
    downloadWeeklyHistoryAsExcel, 
    downloadMonthlyHistoryAsExcel, 
    downloadAttendanceExcel,
    // ✅ [신규] 리포트 다운로드 함수 임포트
    downloadReportExcel,
    downloadPersonalReportExcel,
    downloadContentAsPdf
} from './history-excel.js';

import {
    renderAttendanceDailyHistory,
    renderAttendanceWeeklyHistory,
    renderAttendanceMonthlyHistory,
    renderWeeklyHistory,
    renderMonthlyHistory,
    renderReportDaily,
    renderReportWeekly,
    renderReportMonthly,
    renderReportYearly,
    renderPersonalReport
} from './ui-history.js';

import { doc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
    updateHistoryWorkRecord,
    deleteHistoryWorkRecord,
    addHistoryWorkRecord
} from './history-data-manager.js';

let isHistoryMaximized = false;

export function setupHistoryModalListeners() {

    const iconMaximize = `<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75v4.5m0-4.5h-4.5m4.5 0L15 9M20.25 20.25v-4.5m0 4.5h-4.5m4.5 0L15 15" />`;
    const iconMinimize = `<path stroke-linecap="round" stroke-linejoin="round" d="M9 9L3.75 3.75M9 9h4.5M9 9V4.5m9 9l5.25 5.25M15 15h-4.5m4.5 0v4.5m-9 0l-5.25 5.25M9 21v-4.5M9 21H4.5m9-9l5.25-5.25M15 9V4.5M15 9h4.5" />`;

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
            if (icon) icon.innerHTML = iconMinimize;

        } else {
            DOM.historyModal.classList.add('flex', 'items-center', 'justify-center', 'p-4');
            DOM.historyModalContentBox.classList.remove('fixed', 'inset-0', 'h-full', 'z-[150]', 'rounded-none');
            DOM.historyModalContentBox.classList.add('relative', 'w-[1400px]', 'h-[880px]', 'rounded-2xl', 'shadow-2xl');

            if (toggleBtn) toggleBtn.title = "전체화면";
            if (icon) icon.innerHTML = iconMaximize;
        }
    };
    
    const getCurrentHistoryListMode = () => {
        let activeSubTabBtn;
        if (State.context.activeMainHistoryTab === 'work') {
            activeSubTabBtn = DOM.historyTabs?.querySelector('button.font-semibold');
        } else if (State.context.activeMainHistoryTab === 'attendance') {
            activeSubTabBtn = DOM.attendanceHistoryTabs?.querySelector('button.font-semibold');
        } else if (State.context.activeMainHistoryTab === 'report') {
            activeSubTabBtn = DOM.reportTabs?.querySelector('button.font-semibold');
        } else if (State.context.activeMainHistoryTab === 'personal') {
            activeSubTabBtn = DOM.personalReportTabs?.querySelector('button.font-semibold');
        }

        const activeView = activeSubTabBtn ? activeSubTabBtn.dataset.view : (State.context.activeMainHistoryTab === 'work' ? 'daily' : 'attendance-daily');

        if (activeView.includes('yearly')) return 'year';
        if (activeView.includes('weekly')) return 'week';
        if (activeView.includes('monthly')) return 'month';
        return 'day';
    };

    // --- 헬퍼 함수들 ---
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

    const getSelectedDateKey = () => {
        const btn = DOM.historyDateList.querySelector('.history-date-btn.bg-blue-100');
        return btn ? btn.dataset.key : null;
    };

    // 뷰 갱신 함수들
    const refreshAttendanceView = () => {
        const dateKey = getSelectedDateKey();
        const filteredData = getFilteredHistoryData();
        const activeSubTabBtn = DOM.attendanceHistoryTabs?.querySelector('button.font-semibold');
        const view = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'attendance-daily';

        if (view === 'attendance-daily') {
            if (dateKey) renderAttendanceDailyHistory(dateKey, filteredData);
        } else if (view === 'attendance-weekly') {
             if (dateKey) renderAttendanceWeeklyHistory(dateKey, filteredData);
        } else if (view === 'attendance-monthly') {
             if (dateKey) renderAttendanceMonthlyHistory(dateKey, filteredData);
        }
    };

    const refreshReportView = () => {
        const dateKey = getSelectedDateKey();
        const filteredData = getFilteredHistoryData();
        const activeSubTabBtn = DOM.reportTabs?.querySelector('button.font-semibold');
        const view = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'report-daily';

        if (view === 'report-daily') renderReportDaily(dateKey, filteredData, State.appConfig, State.context);
        else if (view === 'report-weekly') renderReportWeekly(dateKey, filteredData, State.appConfig, State.context);
        else if (view === 'report-monthly') renderReportMonthly(dateKey, filteredData, State.appConfig, State.context);
        else if (view === 'report-yearly') renderReportYearly(dateKey, filteredData, State.appConfig, State.context);
    };
    
    const refreshPersonalView = () => {
        const dateKey = getSelectedDateKey();
        const activeSubTabBtn = DOM.personalReportTabs?.querySelector('button.font-semibold');
        const viewMode = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'personal-daily';
        const memberName = DOM.personalReportMemberSelect?.value;
        
        if (dateKey && memberName) {
            renderPersonalReport('personal-report-content', viewMode, dateKey, memberName, State.allHistoryData);
        }
    };

    // --- 이벤트 리스너 등록 ---

    // 상단 필터/다운로드 버튼
    if (DOM.historyFilterBtn) {
        DOM.historyFilterBtn.addEventListener('click', () => {
            const startDate = DOM.historyStartDateInput.value;
            const endDate = DOM.historyEndDateInput.value;

            if (startDate && endDate && endDate < startDate) {
                showToast('종료일은 시작일보다 이후여야 합니다.', true);
                return;
            }

            State.context.historyStartDate = startDate || null;
            State.context.historyEndDate = endDate || null;

            State.context.reportSortState = {};
            renderHistoryDateListByMode(getCurrentHistoryListMode());
            showToast('이력 목록을 필터링했습니다.');
        });
    }

    if (DOM.historyClearFilterBtn) {
        DOM.historyClearFilterBtn.addEventListener('click', () => {
            DOM.historyStartDateInput.value = '';
            DOM.historyEndDateInput.value = '';
            State.context.historyStartDate = null;
            State.context.historyEndDate = null;

            State.context.reportSortState = {};
            renderHistoryDateListByMode(getCurrentHistoryListMode());
            showToast('필터를 초기화했습니다.');
        });
    }

    if (DOM.historyDownloadPeriodExcelBtn) {
        DOM.historyDownloadPeriodExcelBtn.addEventListener('click', () => {
            const startDate = State.context.historyStartDate;
            const endDate = State.context.historyEndDate;

            if (!startDate || !endDate) {
                showToast('엑셀 다운로드를 위해 시작일과 종료일을 모두 설정(조회)해주세요.', true);
                return;
            }
            downloadPeriodHistoryAsExcel(startDate, endDate);
        });
    }
    
    if (DOM.historyDownloadExcelBtn) {
        DOM.historyDownloadExcelBtn.addEventListener('click', () => {
            const activeTabBtn = DOM.historyTabs.querySelector('button.font-semibold');
            const view = activeTabBtn ? activeTabBtn.dataset.view : 'daily';
            
            const selectedListBtn = DOM.historyDateList.querySelector('.history-date-btn.bg-blue-100');
            if (!selectedListBtn) {
                showToast('목록에서 다운로드할 항목을 선택해주세요.', true);
                return;
            }
            const key = selectedListBtn.dataset.key;

            if (view === 'daily') {
                downloadHistoryAsExcel(key);
            } else if (view === 'weekly') {
                downloadWeeklyHistoryAsExcel(key);
            } else if (view === 'monthly') {
                downloadMonthlyHistoryAsExcel(key);
            }
        });
    }

    if (DOM.attendanceDownloadExcelBtn) {
        DOM.attendanceDownloadExcelBtn.addEventListener('click', () => {
            const activeTabBtn = DOM.attendanceHistoryTabs.querySelector('button.font-semibold');
            const viewFull = activeTabBtn ? activeTabBtn.dataset.view : 'attendance-daily';
            const viewMode = viewFull.replace('attendance-', ''); 

            const selectedListBtn = DOM.historyDateList.querySelector('.history-date-btn.bg-blue-100');
            if (!selectedListBtn) {
                showToast('목록에서 다운로드할 항목을 선택해주세요.', true);
                return;
            }
            const key = selectedListBtn.dataset.key;

            downloadAttendanceExcel(viewMode, key);
        });
    }

    // ✅ [신규] 업무 리포트 다운로드 (엑셀/PDF)
    if (DOM.reportViewContainer) {
        DOM.reportViewContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action]');
            if (!btn) return;

            const action = btn.dataset.action;
            if (action === 'download-report-excel') {
                if (State.context.lastReportData && State.context.lastReportData.type !== 'personal') {
                    downloadReportExcel(State.context.lastReportData);
                } else {
                    showToast('다운로드할 리포트 데이터가 없습니다.', true);
                }
            } else if (action === 'download-report-pdf') {
                 const title = State.context.lastReportData?.title || '업무_리포트';
                 // 현재 보이는 리포트 뷰 ID 찾기 (display:block인 요소)
                 let targetId = '';
                 const tabs = document.querySelectorAll('#report-view-container > div');
                 tabs.forEach(div => {
                     if (!div.classList.contains('hidden')) targetId = div.id;
                 });

                 if (targetId) {
                     downloadContentAsPdf(targetId, title);
                 } else {
                     showToast('출력할 리포트 화면을 찾을 수 없습니다.', true);
                 }
            }
        });
    }

    // ✅ [신규] 개인 리포트 다운로드 (엑셀/PDF)
    if (DOM.personalReportViewContainer) {
        DOM.personalReportViewContainer.addEventListener('click', (e) => {
             const btn = e.target.closest('button[data-action]');
            if (!btn) return;

            const action = btn.dataset.action;
            if (action === 'download-personal-excel') {
                if (State.context.lastReportData && State.context.lastReportData.type === 'personal') {
                    downloadPersonalReportExcel(State.context.lastReportData);
                } else {
                    showToast('다운로드할 개인 리포트 데이터가 없습니다.', true);
                }
            } else if (action === 'download-personal-pdf') {
                 const title = State.context.lastReportData?.title || '개인_리포트';
                 downloadContentAsPdf('personal-report-content', title);
            }
        });
    }

    const openHistoryModalLogic = async () => {
        if (!State.auth || !State.auth.currentUser) {
            showToast('이력을 보려면 로그인이 필요합니다.', true);
            if (DOM.historyModal && !DOM.historyModal.classList.contains('hidden')) {
                DOM.historyModal.classList.add('hidden');
            }
            if (DOM.loginModal) DOM.loginModal.classList.remove('hidden');
            return;
        }

        if (DOM.historyModal) {
            DOM.historyModal.classList.remove('hidden');
            setHistoryMaximized(false);

            if (DOM.historyStartDateInput) DOM.historyStartDateInput.value = '';
            if (DOM.historyEndDateInput) DOM.historyEndDateInput.value = '';
            State.context.historyStartDate = null;
            State.context.historyEndDate = null;

            try {
                await loadAndRenderHistoryList();
            } catch (loadError) {
                console.error("이력 데이터 로딩 중 오류:", loadError);
                showToast("이력 데이터를 불러오는 중 오류가 발생했습니다.", true);
            }
        }
    };

    if (DOM.openHistoryBtn) {
        DOM.openHistoryBtn.addEventListener('click', openHistoryModalLogic);
    }
    
    if (DOM.openHistoryBtnMobile) {
        DOM.openHistoryBtnMobile.addEventListener('click', () => {
            openHistoryModalLogic();
            if (DOM.navContent) DOM.navContent.classList.add('hidden');
        });
    }

    if (DOM.closeHistoryBtn) {
        DOM.closeHistoryBtn.addEventListener('click', () => {
            if (DOM.historyModal) {
                DOM.historyModal.classList.add('hidden');
                setHistoryMaximized(false);
            }
        });
    }

    // --- 날짜 리스트 클릭 리스너 ---
    if (DOM.historyDateList) {
        DOM.historyDateList.addEventListener('click', (e) => {
            const btn = e.target.closest('.history-date-btn');
            if (btn) {
                DOM.historyDateList.querySelectorAll('button').forEach(b => b.classList.remove('bg-blue-100', 'font-bold'));
                btn.classList.add('bg-blue-100', 'font-bold');
                const dateKey = btn.dataset.key;

                let activeMainTab = State.context.activeMainHistoryTab || 'work';
                State.context.activeFilterDropdown = null; 

                const filteredData = getFilteredHistoryData();
                State.context.reportSortState = {};

                if (activeMainTab === 'work') {
                    const activeSubTabBtn = DOM.historyTabs?.querySelector('button.font-semibold');
                    const activeView = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'daily';

                    if (activeView === 'daily') {
                        const currentIndex = filteredData.findIndex(d => d.id === dateKey);
                        const previousDayData = (currentIndex > -1 && currentIndex + 1 < filteredData.length)
                            ? filteredData[currentIndex + 1]
                            : null;
                        renderHistoryDetail(dateKey, previousDayData);
                    } else if (activeView === 'weekly') {
                        renderWeeklyHistory(dateKey, filteredData, State.appConfig);
                    } else if (activeView === 'monthly') {
                        renderMonthlyHistory(dateKey, filteredData, State.appConfig);
                    }

                } else if (activeMainTab === 'attendance') {
                    refreshAttendanceView(); 
                }
                else if (activeMainTab === 'report') {
                    refreshReportView();
                } 
                else if (activeMainTab === 'personal') {
                    refreshPersonalView();
                }
            }
        });
    }

    if (DOM.historyTabs) {
        DOM.historyTabs.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-view]');
            if (btn) switchHistoryView(btn.dataset.view);
        });
    }

    if (DOM.attendanceHistoryTabs) {
        DOM.attendanceHistoryTabs.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-view]');
            if (btn) {
                State.context.activeFilterDropdown = null; 
                switchHistoryView(btn.dataset.view);
            }
        });
    }

    if (DOM.reportTabs) {
        DOM.reportTabs.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-view]');
            if (btn) {
                State.context.reportSortState = {};
                State.context.currentReportParams = null;
                State.context.activeFilterDropdown = null;
                switchHistoryView(btn.dataset.view);
            }
        });
    }

    // 개인 리포트 탭 전환
    if (DOM.personalReportTabs) {
        DOM.personalReportTabs.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-view]');
            if (btn) {
                State.context.activeFilterDropdown = null;
                DOM.personalReportTabs.querySelectorAll('button').forEach(b => {
                     b.classList.remove('font-semibold', 'text-blue-600', 'border-blue-600', 'border-b-2');
                     b.classList.add('text-gray-500', 'hover:text-gray-700');
                });
                btn.classList.add('font-semibold', 'text-blue-600', 'border-blue-600', 'border-b-2');
                btn.classList.remove('text-gray-500', 'hover:text-gray-700');

                const viewMode = btn.dataset.view;
                let listMode = 'day';
                if(viewMode.includes('weekly')) listMode = 'week';
                if(viewMode.includes('monthly')) listMode = 'month';
                if(viewMode.includes('yearly')) listMode = 'year';
                
                renderHistoryDateListByMode(listMode);
            }
        });
    }

    // 개인 리포트 직원 선택
    if (DOM.personalReportMemberSelect) {
        DOM.personalReportMemberSelect.addEventListener('change', (e) => {
            State.context.personalReportMember = e.target.value;
            refreshPersonalView();
        });
    }

    if (DOM.historyMainTabs) {
        DOM.historyMainTabs.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-main-tab]');
            if (btn) {
                const tabName = btn.dataset.mainTab;
                State.context.activeMainHistoryTab = tabName;
                State.context.activeFilterDropdown = null; 
                
                document.querySelectorAll('.history-main-tab-btn').forEach(b => {
                    b.classList.remove('font-semibold', 'text-blue-600', 'border-b-2', 'border-blue-600');
                    b.classList.add('font-medium', 'text-gray-500');
                });
                btn.classList.add('font-semibold', 'text-blue-600', 'border-b-2', 'border-blue-600');
                btn.classList.remove('font-medium', 'text-gray-500');

                const dateListContainer = document.getElementById('history-date-list-container');
                
                DOM.workHistoryPanel.classList.toggle('hidden', tabName !== 'work');
                DOM.attendanceHistoryPanel.classList.toggle('hidden', tabName !== 'attendance');
                DOM.trendAnalysisPanel.classList.toggle('hidden', tabName !== 'trends');
                DOM.reportPanel.classList.toggle('hidden', tabName !== 'report');
                if (DOM.personalReportPanel) DOM.personalReportPanel.classList.toggle('hidden', tabName !== 'personal');
                
                if (dateListContainer) {
                    dateListContainer.style.display = (tabName === 'trends') ? 'none' : 'block';
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
                } else if (tabName === 'personal') {
                     // 개인 리포트 탭 초기화
                     if (DOM.personalReportMemberSelect && DOM.personalReportMemberSelect.options.length <= 1) {
                         const staff = (State.appConfig.teamGroups || []).flatMap(g => g.members);
                         const partTimers = (State.appState.partTimers || []).map(p => p.name);
                         const allMembers = [...new Set([...staff, ...partTimers])].sort();
                         
                         DOM.personalReportMemberSelect.innerHTML = '<option value="">직원 선택...</option>';
                         allMembers.forEach(m => {
                             const op = document.createElement('option');
                             op.value = m;
                             op.textContent = m;
                             DOM.personalReportMemberSelect.appendChild(op);
                         });
                         
                         // 현재 로그인한 사용자 자동 선택
                         if (State.appState.currentUser && allMembers.includes(State.appState.currentUser)) {
                             DOM.personalReportMemberSelect.value = State.appState.currentUser;
                             State.context.personalReportMember = State.appState.currentUser;
                         }
                     }

                     const activeSubTabBtn = DOM.personalReportTabs?.querySelector('button.font-semibold');
                     const viewMode = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'personal-daily';
                     
                     let listMode = 'day';
                     if(viewMode.includes('weekly')) listMode = 'week';
                     if(viewMode.includes('monthly')) listMode = 'month';
                     if(viewMode.includes('yearly')) listMode = 'year';
                     
                     renderHistoryDateListByMode(listMode);
                }
            }
        });
    }

    if (DOM.historyViewContainer) {
        DOM.historyViewContainer.addEventListener('click', (e) => {
            const button = e.target.closest('button[data-action]');
            if (!button) return;

            const action = button.dataset.action;
            const dateKey = button.dataset.dateKey;

            if (!dateKey) { return; }

            if (action === 'open-history-quantity-modal') {
                setHistoryMaximized(false); 
                openHistoryQuantityModal(dateKey);
            } else if (action === 'request-history-deletion') {
                setHistoryMaximized(false); 
                requestHistoryDeletion(dateKey);
            } 
            else if (action === 'open-record-manager') {
                setHistoryMaximized(false);
                openHistoryRecordManager(dateKey);
            }
        });
    }

    // 필터 UI (하단 기록 관리 모달용)
    const memberFilter = document.getElementById('history-record-filter-member');
    const taskFilter = document.getElementById('history-record-filter-task');

    if (memberFilter) {
        memberFilter.addEventListener('change', () => {
            const dateKey = document.getElementById('history-records-date').textContent;
            renderHistoryRecordsTable(dateKey);
        });
    }
    if (taskFilter) {
        taskFilter.addEventListener('change', () => {
            const dateKey = document.getElementById('history-records-date').textContent;
            renderHistoryRecordsTable(dateKey);
        });
    }

    // 일괄 적용 버튼
    const batchApplyBtn = document.getElementById('history-batch-apply-btn');
    if (batchApplyBtn) {
        batchApplyBtn.addEventListener('click', async () => {
            const dateKey = document.getElementById('history-records-date').textContent;
            const taskFilterVal = taskFilter ? taskFilter.value : '';
            const newStart = document.getElementById('history-batch-start-time').value;
            const newEnd = document.getElementById('history-batch-end-time').value;

            if (!taskFilterVal) { showToast('업무를 선택한 상태에서만 일괄 수정이 가능합니다.', true); return; }
            if (!newStart && !newEnd) { showToast('수정할 시작 또는 종료 시간을 입력해주세요.', true); return; }
            if (newStart && newEnd && newStart >= newEnd) { showToast('시작 시간이 종료 시간보다 빨라야 합니다.', true); return; }

            if (!confirm(`선택된 업무(${taskFilterVal})의 모든 기록을 일괄 수정하시겠습니까?`)) return;

            try {
                let records = [];
                const todayKey = new Date().toISOString().slice(0, 10);
                const data = State.allHistoryData.find(d => d.id === dateKey);
                records = data ? data.workRecords : [];
                
                const targets = records.filter(r => r.task === taskFilterVal);
                if (targets.length === 0) { showToast('수정할 대상이 없습니다.', true); return; }

                const updatePromises = targets.map(r => {
                    const updateData = {};
                    if (newStart) updateData.startTime = newStart;
                    if (newEnd) updateData.endTime = newEnd;
                    return updateHistoryWorkRecord(dateKey, r.id, updateData);
                });

                await Promise.all(updatePromises);
                showToast(`${targets.length}건의 기록이 일괄 수정되었습니다.`);
                renderHistoryRecordsTable(dateKey);
                renderHistoryDetail(dateKey); 
            } catch (e) {
                console.error(e);
                showToast('일괄 수정 중 오류가 발생했습니다.', true);
            }
        });
    }

    if (DOM.historyRecordAddBtn) {
        DOM.historyRecordAddBtn.addEventListener('click', () => {
            const dateKey = document.getElementById('history-records-date').textContent;
            if (!dateKey) { showToast('날짜 정보를 찾을 수 없습니다.', true); return; }
            
            if (DOM.historyAddDateDisplay) DOM.historyAddDateDisplay.textContent = dateKey;
            if (DOM.historyAddRecordForm) DOM.historyAddRecordForm.reset();
            
            if (DOM.historyAddMemberDatalist) {
                DOM.historyAddMemberDatalist.innerHTML = '';
                const staff = (State.appConfig.teamGroups || []).flatMap(g => g.members);
                const partTimers = (State.appState.partTimers || []).map(p => p.name);
                const allMembers = [...new Set([...staff, ...partTimers])].sort();
                allMembers.forEach(m => {
                    const op = document.createElement('option');
                    op.value = m;
                    DOM.historyAddMemberDatalist.appendChild(op);
                });
            }
            
            if (DOM.historyAddTaskDatalist) {
                DOM.historyAddTaskDatalist.innerHTML = '';
                const allTasks = (State.appConfig.taskGroups || []).flatMap(g => g.tasks).sort();
                const uniqueTasks = [...new Set(allTasks)];
                uniqueTasks.forEach(t => {
                    const op = document.createElement('option');
                    op.value = t;
                    DOM.historyAddTaskDatalist.appendChild(op);
                });
            }

            if (DOM.historyAddRecordModal) DOM.historyAddRecordModal.classList.remove('hidden');
        });
    }

    if (DOM.confirmHistoryAddBtn) {
        DOM.confirmHistoryAddBtn.addEventListener('click', async () => {
             const dateKey = document.getElementById('history-records-date').textContent;
             const member = DOM.historyAddMemberInput.value.trim();
             const task = DOM.historyAddTaskInput.value.trim();
             const startTime = DOM.historyAddStartTimeInput.value;
             const endTime = DOM.historyAddEndTimeInput.value;

             if (!member || !task || !startTime || !endTime) { showToast('모든 필드를 입력해주세요.', true); return; }
             if (startTime >= endTime) { showToast('종료 시간은 시작 시간보다 늦어야 합니다.', true); return; }

             try {
                 const newRecord = {
                     id: `manual-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                     member, task, startTime, endTime, status: 'completed', pauses: []
                 };
                 await addHistoryWorkRecord(dateKey, newRecord);
                 showToast('기록이 추가되었습니다.');
                 if (DOM.historyAddRecordModal) DOM.historyAddRecordModal.classList.add('hidden');
                 const data = State.allHistoryData.find(d => d.id === dateKey);
                 renderHistoryRecordsTable(dateKey, data ? data.workRecords : []);
                 if (dateKey === document.querySelector('.history-date-btn.bg-blue-100')?.dataset.key) {
                     renderHistoryDetail(dateKey);
                 }
             } catch (e) {
                 console.error(e);
                 showToast('기록 추가 중 오류가 발생했습니다.', true);
             }
        });
    }

    if (DOM.historyRecordsTableBody) {
        DOM.historyRecordsTableBody.addEventListener('click', async (e) => {
            const target = e.target;
            const deleteBtn = target.closest('button[data-action="delete-history-record"]');
            if (deleteBtn) {
                const dateKey = deleteBtn.dataset.dateKey;
                const recordId = deleteBtn.dataset.recordId;
                if (confirm('정말로 이 기록을 삭제하시겠습니까?')) {
                    try {
                        await deleteHistoryWorkRecord(dateKey, recordId);
                        showToast('기록이 삭제되었습니다.');
                        const data = State.allHistoryData.find(d => d.id === dateKey);
                        renderHistoryRecordsTable(dateKey, data ? data.workRecords : []);
                        if (dateKey === document.querySelector('.history-date-btn.bg-blue-100')?.dataset.key) {
                             renderHistoryDetail(dateKey);
                        }
                    } catch (err) {
                        console.error(err);
                        showToast('삭제 중 오류가 발생했습니다.', true);
                    }
                }
                return;
            }
            const saveBtn = target.closest('button[data-action="save-history-record"]');
            if (saveBtn) {
                const row = saveBtn.closest('tr');
                const dateKey = saveBtn.dataset.dateKey;
                const recordId = saveBtn.dataset.recordId;

                const newTask = row.querySelector('.history-record-task').value;
                const newStart = row.querySelector('.history-record-start').value;
                const newEnd = row.querySelector('.history-record-end').value;

                if (!newTask || !newStart || !newEnd) { showToast('모든 필드를 입력해주세요.', true); return; }
                if (newStart >= newEnd) { showToast('시작 시간이 종료 시간보다 빨라야 합니다.', true); return; }

                try {
                    await updateHistoryWorkRecord(dateKey, recordId, { task: newTask, startTime: newStart, endTime: newEnd });
                    showToast('기록이 수정되었습니다.');
                    const data = State.allHistoryData.find(d => d.id === dateKey);
                    renderHistoryRecordsTable(dateKey, data ? data.workRecords : []);
                     if (dateKey === document.querySelector('.history-date-btn.bg-blue-100')?.dataset.key) {
                         renderHistoryDetail(dateKey);
                    }
                } catch (err) {
                    console.error(err);
                    showToast('수정 중 오류가 발생했습니다.', true);
                }
            }
        });
    }

    if (DOM.confirmHistoryDeleteBtn) {
        DOM.confirmHistoryDeleteBtn.addEventListener('click', async () => {
            if (State.context.historyKeyToDelete) {
                const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', State.context.historyKeyToDelete);
                try {
                    await deleteDoc(historyDocRef);
                    showToast(`${State.context.historyKeyToDelete} 이력이 삭제되었습니다.`);
                    await loadAndRenderHistoryList();
                } catch (e) {
                    console.error(e);
                    showToast('이력 삭제 중 오류 발생.', true);
                }
            }
            if (DOM.deleteHistoryModal) DOM.deleteHistoryModal.classList.add('hidden');
            State.context.historyKeyToDelete = null;
        });
    }


    // ====================================================================================
    // ✅ 각 탭별(근태/업무/개인) 정렬 & 필터 이벤트 리스너
    // ====================================================================================

    // 1. 공통 필터 처리 로직
    const setupFilterListeners = (container, stateKeySort, stateKeyFilter, refreshFunc) => {
        if (!container) return;

        container.addEventListener('click', (e) => {
            // A. 드롭다운 내부 클릭: 이벤트 중단 (닫기 방지)
            if (e.target.closest('.filter-dropdown')) {
                e.stopPropagation(); return;
            }
            // B. 필터 아이콘 클릭: 토글
            const filterIconBtn = e.target.closest('.filter-icon-btn');
            if (filterIconBtn) {
                e.stopPropagation();
                const dropdownId = filterIconBtn.dataset.dropdownId;
                State.context.activeFilterDropdown = (State.context.activeFilterDropdown === dropdownId) ? null : dropdownId;
                refreshFunc();
                return;
            }
            // C. 정렬 헤더 클릭
            const sortTh = e.target.closest('th[data-sort-key]');
            if (sortTh) {
                const mode = sortTh.dataset.sortTarget;
                const key = sortTh.dataset.sortKey;
                if (!mode || !key) return;

                const sortStateObj = State.context[stateKeySort]; 
                if (!sortStateObj[mode]) sortStateObj[mode] = { key: '', dir: 'asc' };
                
                const currentSort = sortStateObj[mode];
                if (currentSort.key === key) {
                    currentSort.dir = (currentSort.dir === 'asc' ? 'desc' : 'asc');
                } else {
                    currentSort.key = key; currentSort.dir = 'asc';
                }
                refreshFunc();
                return;
            }
            // D. 기존 버튼 처리 (근태 탭만 해당하지만 공통으로 둠)
            handleExistingAttendanceButtons(e);
        });

        // E. 필터 입력
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
                        if (newInput.tagName === 'INPUT') {
                            const val = newInput.value; newInput.value = ''; newInput.value = val;
                        }
                    }
                }, 0);
            }
        });
    };

    // 리스너 연결
    setupFilterListeners(DOM.attendanceHistoryViewContainer, 'attendanceSortState', 'attendanceFilterState', refreshAttendanceView);
    setupFilterListeners(DOM.reportViewContainer, 'reportSortState', 'reportFilterState', refreshReportView);
    setupFilterListeners(DOM.personalReportViewContainer, 'personalReportSortState', 'personalReportFilterState', refreshPersonalView);

    // 외부 클릭 시 필터 닫기 (전역)
    document.addEventListener('click', (e) => {
        if (State.context.activeFilterDropdown) {
            if (!e.target.closest('.filter-dropdown') && !e.target.closest('.filter-icon-btn')) {
                State.context.activeFilterDropdown = null;
                // 현재 활성 탭에 맞춰 새로고침
                if (State.context.activeMainHistoryTab === 'attendance') refreshAttendanceView();
                else if (State.context.activeMainHistoryTab === 'report') refreshReportView();
                else if (State.context.activeMainHistoryTab === 'personal') refreshPersonalView();
            }
        }
    });


    // --- 기타 기존 리스너들 ---
    const historyHeader = document.getElementById('history-modal-header');
    if (DOM.historyModal && historyHeader && DOM.historyModalContentBox) {
        makeDraggable(DOM.historyModal, historyHeader, DOM.historyModalContentBox);
    }
    const toggleFullscreenBtn = document.getElementById('toggle-history-fullscreen-btn');
    if (toggleFullscreenBtn && DOM.historyModal && DOM.historyModalContentBox) {
        const icon = toggleFullscreenBtn.querySelector('svg');
        if (icon) icon.innerHTML = iconMaximize;
        toggleFullscreenBtn.addEventListener('click', (e) => {
            e.stopImmediatePropagation();
            setHistoryMaximized(!isHistoryMaximized);
        });
    }

    setupRecordManagerListeners();
    setupAttendanceModalButtons();
}

function handleExistingAttendanceButtons(e) {
    const editBtn = e.target.closest('button[data-action="edit-attendance"]');
    if (editBtn) {
        const dateKey = editBtn.dataset.dateKey;
        const index = parseInt(editBtn.dataset.index, 10);
        if (!dateKey || isNaN(index)) return;
        
        const dayDataIndex = State.allHistoryData.findIndex(d => d.id === dateKey);
        if (dayDataIndex === -1) { showToast('해당 날짜의 이력 데이터를 찾을 수 없습니다.', true); return; }
        const dayData = State.allHistoryData[dayDataIndex];

        if (!dayData.onLeaveMembers || !dayData.onLeaveMembers[index]) {
            showToast('원본 근태 기록을 찾을 수 없습니다.', true); return;
        }
        const record = dayData.onLeaveMembers[index];

        if (DOM.editAttendanceMemberName) DOM.editAttendanceMemberName.value = record.member;
        if (DOM.editAttendanceTypeSelect) {
            DOM.editAttendanceTypeSelect.innerHTML = '';
            State.LEAVE_TYPES.forEach(type => {
                const option = document.createElement('option');
                option.value = type;
                option.textContent = type;
                if (type === record.type) option.selected = true;
                DOM.editAttendanceTypeSelect.appendChild(option);
            });
        }
        const isTimeBased = ['외출', '조퇴', '지각'].includes(record.type);
        const isDateBased = ['연차', '출장', '결근'].includes(record.type);
        const isOuting = (record.type === '외출');
        
        if (DOM.editAttendanceTimeFields) {
             DOM.editAttendanceTimeFields.classList.toggle('hidden', !isTimeBased);
             const endTimeWrapper = document.getElementById('edit-attendance-end-time-wrapper');
             if(endTimeWrapper) endTimeWrapper.classList.toggle('hidden', !isOuting);
             if(DOM.editAttendanceStartTimeInput) DOM.editAttendanceStartTimeInput.value = record.startTime || '';
             if(DOM.editAttendanceEndTimeInput) DOM.editAttendanceEndTimeInput.value = record.endTime || '';
        }
        if (DOM.editAttendanceDateFields) {
            DOM.editAttendanceDateFields.classList.toggle('hidden', !isDateBased);
            if(DOM.editAttendanceStartDateInput) DOM.editAttendanceStartDateInput.value = record.startDate || '';
            if(DOM.editAttendanceEndDateInput) DOM.editAttendanceEndDateInput.value = record.endDate || '';
        }
        if (DOM.editAttendanceDateKeyInput) DOM.editAttendanceDateKeyInput.value = dateKey;
        if (DOM.editAttendanceRecordIndexInput) DOM.editAttendanceRecordIndexInput.value = index;
        if (DOM.editAttendanceRecordModal) DOM.editAttendanceRecordModal.classList.remove('hidden');
        return;
    }
    const deleteBtn = e.target.closest('button[data-action="delete-attendance"]');
    if (deleteBtn) {
        const dateKey = deleteBtn.dataset.dateKey;
        const index = parseInt(deleteBtn.dataset.index, 10);
        State.context.deleteMode = 'attendance';
        State.context.attendanceRecordToDelete = { dateKey, index };
        if (DOM.deleteConfirmModal) DOM.deleteConfirmModal.classList.remove('hidden');
        return;
    }
    const addBtn = e.target.closest('button[data-action="open-add-attendance-modal"]');
    if (addBtn) {
        const dateKey = addBtn.dataset.dateKey;
        if (DOM.addAttendanceForm) DOM.addAttendanceForm.reset();
        if (DOM.addAttendanceDateKeyInput) DOM.addAttendanceDateKeyInput.value = dateKey;
        if (DOM.addAttendanceStartDateInput) DOM.addAttendanceStartDateInput.value = dateKey;
        
        // 멤버 목록 갱신
        if (DOM.addAttendanceMemberDatalist) {
            DOM.addAttendanceMemberDatalist.innerHTML = '';
            const all = [...new Set([...(State.appConfig.teamGroups||[]).flatMap(g=>g.members), ...(State.appState.partTimers||[]).map(p=>p.name)])].sort();
            all.forEach(m=>{const o=document.createElement('option');o.value=m;DOM.addAttendanceMemberDatalist.appendChild(o);});
        }
        // 유형 갱신
        if (DOM.addAttendanceTypeSelect) {
            DOM.addAttendanceTypeSelect.innerHTML = '';
            State.LEAVE_TYPES.forEach((t,i)=>{const o=document.createElement('option');o.value=t;o.textContent=t;if(i===0)o.selected=true;DOM.addAttendanceTypeSelect.appendChild(o);});
        }
        // 초기 UI 설정
        const first = State.LEAVE_TYPES[0];
        const isTime = ['외출','조퇴','지각'].includes(first);
        const isDate = !isTime;
        if(DOM.addAttendanceTimeFields) DOM.addAttendanceTimeFields.classList.toggle('hidden', !isTime);
        if(DOM.addAttendanceDateFields) DOM.addAttendanceDateFields.classList.toggle('hidden', !isDate);
        const endWrap = document.getElementById('add-attendance-end-time-wrapper');
        if(endWrap) endWrap.classList.toggle('hidden', first!=='외출');

        if (DOM.addAttendanceRecordModal) DOM.addAttendanceRecordModal.classList.remove('hidden');
    }
}

function setupRecordManagerListeners() {
    // (기존 기록 관리 모달 리스너들)
    if(DOM.historyViewContainer) {
        DOM.historyViewContainer.addEventListener('click', e => {
            const btn = e.target.closest('button[data-action="open-record-manager"]');
            if(btn) openHistoryRecordManager(btn.dataset.dateKey);
        });
    }
}

function setupAttendanceModalButtons() {
    // (기존 근태 저장/취소 버튼 리스너들)
    if(DOM.confirmEditAttendanceBtn) DOM.confirmEditAttendanceBtn.addEventListener('click', async ()=>{ /* 리스너 로직은 위쪽 setupAttendanceModalButtons 함수 내부에 이미 정의됨 (중복 방지를 위해 비워둠) */ });
    if(DOM.cancelEditAttendanceBtn) DOM.cancelEditAttendanceBtn.addEventListener('click', ()=>{ if(DOM.editAttendanceRecordModal) DOM.editAttendanceRecordModal.classList.add('hidden'); });
    if(DOM.confirmAddAttendanceBtn) DOM.confirmAddAttendanceBtn.addEventListener('click', async ()=>{ /* ... */ });
    if(DOM.cancelAddAttendanceBtn) DOM.cancelAddAttendanceBtn.addEventListener('click', ()=>{ if(DOM.addAttendanceRecordModal) DOM.addAttendanceRecordModal.classList.add('hidden'); });
    
    // 유형 변경 시 UI 토글
    const toggleUI = (select, timeFields, dateFields, endWrapperId) => {
        select.addEventListener('change', e => {
            const t = e.target.value;
            const isTime = ['외출','조퇴','지각'].includes(t);
            timeFields.classList.toggle('hidden', !isTime);
            dateFields.classList.toggle('hidden', isTime);
            const w = document.getElementById(endWrapperId);
            if(w) w.classList.toggle('hidden', t!=='외출');
        });
    };
    if(DOM.addAttendanceTypeSelect) toggleUI(DOM.addAttendanceTypeSelect, DOM.addAttendanceTimeFields, DOM.addAttendanceDateFields, 'add-attendance-end-time-wrapper');
    if(DOM.editAttendanceTypeSelect) toggleUI(DOM.editAttendanceTypeSelect, DOM.editAttendanceTimeFields, DOM.editAttendanceDateFields, 'edit-attendance-end-time-wrapper');
}

function makeDraggable(modalOverlay, header, contentBox) {
    // (기존 드래그 로직)
    let isDragging = false; let offsetX, offsetY;
    header.addEventListener('mousedown', e => {
        if(isHistoryMaximized || e.target.closest('button')) return;
        isDragging=true; 
        if(contentBox.dataset.hasBeenUncentered!=='true') {
            const r=contentBox.getBoundingClientRect();
            modalOverlay.classList.remove('flex','items-center','justify-center');
            contentBox.style.position='absolute'; contentBox.style.top=`${r.top}px`; contentBox.style.left=`${r.left}px`;
            contentBox.style.width=`${r.width}px`; contentBox.style.height=`${r.height}px`;
            contentBox.style.transform='none'; contentBox.dataset.hasBeenUncentered='true';
        }
        const r=contentBox.getBoundingClientRect(); offsetX=e.clientX-r.left; offsetY=e.clientY-r.top;
        document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
    });
    function onMove(e) { if(!isDragging)return; contentBox.style.left=`${e.clientX-offsetX}px`; contentBox.style.top=`${e.clientY-offsetY}px`; }
    function onUp() { isDragging=false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
}