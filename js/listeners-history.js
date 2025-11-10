// === js/listeners-history.js ===
import {
    appState, appConfig, db, auth,
    allHistoryData,
    context,
    LEAVE_TYPES,

    addAttendanceRecordModal, addAttendanceForm, confirmAddAttendanceBtn, cancelAddAttendanceBtn,
    addAttendanceMemberNameInput, addAttendanceMemberDatalist, addAttendanceTypeSelect,
    addAttendanceStartTimeInput, addAttendanceEndTimeInput, addAttendanceStartDateInput,
    addAttendanceEndDateInput, addAttendanceDateKeyInput, addAttendanceTimeFields,
    addAttendanceDateFields,

    editAttendanceRecordModal, confirmEditAttendanceBtn, cancelEditAttendanceBtn,
    editAttendanceMemberName, editAttendanceTypeSelect,
    editAttendanceStartTimeInput, editAttendanceEndTimeInput, editAttendanceStartDateInput,
    editAttendanceEndDateInput, editAttendanceDateKeyInput, editAttendanceRecordIndexInput,
    editAttendanceTimeFields, editAttendanceDateFields,

    deleteConfirmModal, historyModal,
    historyModalContentBox,
    openHistoryBtn, closeHistoryBtn, historyDateList, historyViewContainer, historyTabs,
    historyMainTabs, workHistoryPanel, attendanceHistoryPanel, attendanceHistoryTabs,
    attendanceHistoryViewContainer, trendAnalysisPanel,

    reportPanel, reportTabs, reportViewContainer,

    coqExplanationModal,
    deleteHistoryModal, confirmHistoryDeleteBtn,

    historyStartDateInput, historyEndDateInput, historyFilterBtn,
    historyClearFilterBtn, historyDownloadPeriodExcelBtn,

    loginModal,

} from './app.js';

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
    requestHistoryDeletion
} from './app-history-logic.js';

import {
    downloadHistoryAsExcel,
    downloadPeriodHistoryAsExcel
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
    renderReportYearly
} from './ui-history.js';

import { doc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ✨ 이력 창 최대화 상태 추적 변수
let isHistoryMaximized = false;

export function setupHistoryModalListeners() {

    const iconMaximize = `<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75v4.5m0-4.5h-4.5m4.5 0L15 9M20.25 20.25v-4.5m0 4.5h-4.5m4.5 0L15 15" />`;
    const iconMinimize = `<path stroke-linecap="round" stroke-linejoin="round" d="M9 9L3.75 3.75M9 9h4.5M9 9V4.5m9 9l5.25 5.25M15 15h-4.5m4.5 0v4.5m-9 0l-5.25 5.25M9 21v-4.5M9 21H4.5m9-9l5.25-5.25M15 9V4.5M15 9h4.5" />`;

    // ✨ [수정] 더 안정적인 전체화면 전환 로직 (부모 레이아웃 제어 방식)
    const setHistoryMaximized = (maximized) => {
        isHistoryMaximized = maximized;
        const toggleBtn = document.getElementById('toggle-history-fullscreen-btn');
        const icon = toggleBtn?.querySelector('svg');

        // 1. 드래그로 인한 위치 스타일 강제 초기화 (중요)
        historyModalContentBox.style.removeProperty('top');
        historyModalContentBox.style.removeProperty('left');
        historyModalContentBox.style.removeProperty('transform');
        historyModalContentBox.style.removeProperty('position');
        historyModalContentBox.dataset.hasBeenUncentered = 'false';

        if (maximized) {
            // ▶️ 최대화 모드
            // 오버레이(부모)의 Flex 중앙 정렬 및 패딩 해제 -> 자식이 꽉 찰 수 있게 함
            historyModal.classList.remove('p-4', 'flex', 'items-center', 'justify-center');
            
            // 컨텐츠 박스(자식)를 꽉 채움
            historyModalContentBox.classList.remove('max-w-7xl', 'h-[90vh]', 'rounded-2xl');
            historyModalContentBox.classList.add('w-full', 'h-full', 'rounded-none');

            if (toggleBtn) toggleBtn.title = "기본 크기로";
            if (icon) icon.innerHTML = iconMinimize;

        } else {
            // ◀️ 일반 모드 복귀
            // 오버레이 원래대로 복구
            historyModal.classList.add('p-4', 'flex', 'items-center', 'justify-center');
            
            // 컨텐츠 박스 원래대로 복구
            historyModalContentBox.classList.remove('w-full', 'h-full', 'rounded-none');
            historyModalContentBox.classList.add('max-w-7xl', 'h-[90vh]', 'rounded-2xl');

            if (toggleBtn) toggleBtn.title = "전체화면";
            if (icon) icon.innerHTML = iconMaximize;
        }
    };

    const getCurrentHistoryListMode = () => {
        let activeSubTabBtn;
        if (context.activeMainHistoryTab === 'work') {
            activeSubTabBtn = historyTabs?.querySelector('button.font-semibold');
        } else if (context.activeMainHistoryTab === 'attendance') {
            activeSubTabBtn = attendanceHistoryTabs?.querySelector('button.font-semibold');
        } else if (context.activeMainHistoryTab === 'report') {
            activeSubTabBtn = reportTabs?.querySelector('button.font-semibold');
        }

        const activeView = activeSubTabBtn ? activeSubTabBtn.dataset.view : (context.activeMainHistoryTab === 'work' ? 'daily' : 'attendance-daily');

        if (activeView.includes('yearly')) return 'year';
        if (activeView.includes('weekly')) return 'week';
        if (activeView.includes('monthly')) return 'month';
        return 'day';
    };

    if (historyFilterBtn) {
        historyFilterBtn.addEventListener('click', () => {
            const startDate = historyStartDateInput.value;
            const endDate = historyEndDateInput.value;

            if (startDate && endDate && endDate < startDate) {
                showToast('종료일은 시작일보다 이후여야 합니다.', true);
                return;
            }

            context.historyStartDate = startDate || null;
            context.historyEndDate = endDate || null;

            context.reportSortState = {};
            renderHistoryDateListByMode(getCurrentHistoryListMode());
            showToast('이력 목록을 필터링했습니다.');
        });
    }

    if (historyClearFilterBtn) {
        historyClearFilterBtn.addEventListener('click', () => {
            historyStartDateInput.value = '';
            historyEndDateInput.value = '';
            context.historyStartDate = null;
            context.historyEndDate = null;

            context.reportSortState = {};
            renderHistoryDateListByMode(getCurrentHistoryListMode());
            showToast('필터를 초기화했습니다.');
        });
    }

    if (historyDownloadPeriodExcelBtn) {
        historyDownloadPeriodExcelBtn.addEventListener('click', () => {
            const startDate = context.historyStartDate;
            const endDate = context.historyEndDate;

            if (!startDate || !endDate) {
                showToast('엑셀 다운로드를 위해 시작일과 종료일을 모두 설정(조회)해주세요.', true);
                return;
            }
            downloadPeriodHistoryAsExcel(startDate, endDate);
        });
    }

    if (openHistoryBtn) {
        openHistoryBtn.addEventListener('click', async () => {
            if (!auth || !auth.currentUser) {
                showToast('이력을 보려면 로그인이 필요합니다.', true);
                if (historyModal && !historyModal.classList.contains('hidden')) {
                    historyModal.classList.add('hidden');
                }
                if (loginModal) loginModal.classList.remove('hidden');
                return;
            }

            if (historyModal) {
                historyModal.classList.remove('hidden');
                
                // ✨ 항상 기본 크기로 열기
                setHistoryMaximized(false);

                if (historyStartDateInput) historyStartDateInput.value = '';
                if (historyEndDateInput) historyEndDateInput.value = '';
                context.historyStartDate = null;
                context.historyEndDate = null;

                try {
                    await loadAndRenderHistoryList();
                } catch (loadError) {
                    console.error("이력 데이터 로딩 중 오류:", loadError);
                    showToast("이력 데이터를 불러오는 중 오류가 발생했습니다.", true);
                }
            }
        });
    }

    if (closeHistoryBtn) {
        closeHistoryBtn.addEventListener('click', () => {
            if (historyModal) {
                historyModal.classList.add('hidden');
                setHistoryMaximized(false); // 닫을 때 초기화
            }
        });
    }

    if (historyDateList) {
        historyDateList.addEventListener('click', (e) => {
            const btn = e.target.closest('.history-date-btn');
            if (btn) {
                historyDateList.querySelectorAll('button').forEach(b => b.classList.remove('bg-blue-100', 'font-bold'));
                btn.classList.add('bg-blue-100', 'font-bold');
                const dateKey = btn.dataset.key;

                let activeSubTabBtn;
                if (context.activeMainHistoryTab === 'work') {
                    activeSubTabBtn = historyTabs?.querySelector('button.font-semibold');
                } else if (context.activeMainHistoryTab === 'attendance') {
                    activeSubTabBtn = attendanceHistoryTabs?.querySelector('button.font-semibold');
                } else if (context.activeMainHistoryTab === 'report') {
                    activeSubTabBtn = reportTabs?.querySelector('button.font-semibold');
                }

                const activeView = activeSubTabBtn ? activeSubTabBtn.dataset.view : (context.activeMainHistoryTab === 'work' ? 'daily' : 'attendance-daily');

                const filteredData = (context.historyStartDate || context.historyEndDate)
                    ? allHistoryData.filter(d => {
                        const date = d.id;
                        const start = context.historyStartDate;
                        const end = context.historyEndDate;
                        if (start && end) return date >= start && date <= end;
                        if (start) return date >= start;
                        if (end) return date <= end;
                        return true;
                    })
                    : allHistoryData;

                context.reportSortState = {};

                if (context.activeMainHistoryTab === 'work') {
                    if (activeView === 'daily') {
                        const currentIndex = filteredData.findIndex(d => d.id === dateKey);
                        const previousDayData = (currentIndex > -1 && currentIndex + 1 < filteredData.length)
                            ? filteredData[currentIndex + 1]
                            : null;
                        renderHistoryDetail(dateKey, previousDayData);
                    } else if (activeView === 'weekly') {
                        renderWeeklyHistory(dateKey, filteredData, appConfig);
                    } else if (activeView === 'monthly') {
                        renderMonthlyHistory(dateKey, filteredData, appConfig);
                    }
                } else if (context.activeMainHistoryTab === 'attendance') {
                    if (activeView === 'attendance-daily') {
                        renderAttendanceDailyHistory(dateKey, filteredData);
                    } else if (activeView === 'attendance-weekly') {
                        renderAttendanceWeeklyHistory(dateKey, filteredData);
                    } else if (activeView === 'attendance-monthly') {
                        renderAttendanceMonthlyHistory(dateKey, filteredData);
                    }
                }
                else if (context.activeMainHistoryTab === 'report') {
                    if (activeView === 'report-daily') {
                        renderReportDaily(dateKey, filteredData, appConfig, context);
                    } else if (activeView === 'report-weekly') {
                        renderReportWeekly(dateKey, filteredData, appConfig, context);
                    } else if (activeView === 'report-monthly') {
                        renderReportMonthly(dateKey, filteredData, appConfig, context);
                    } else if (activeView === 'report-yearly') {
                        renderReportYearly(dateKey, filteredData, appConfig, context);
                    }
                }

            }
        });
    }

    if (historyTabs) {
        historyTabs.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-view]');
            if (btn) {
                switchHistoryView(btn.dataset.view);
            }
        });
    }

    if (confirmHistoryDeleteBtn) {
        confirmHistoryDeleteBtn.addEventListener('click', async () => {
            if (context.historyKeyToDelete) {
                const historyDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'history', context.historyKeyToDelete);
                try {
                    await deleteDoc(historyDocRef);
                    showToast(`${context.historyKeyToDelete} 이력이 삭제되었습니다.`);
                    await loadAndRenderHistoryList();
                } catch (e) {
                    console.error('Error deleting history:', e);
                    showToast('이력 삭제 중 오류 발생.', true);
                }
            }
            if (deleteHistoryModal) deleteHistoryModal.classList.add('hidden');
            context.historyKeyToDelete = null;
        });
    }

    if (historyMainTabs) {
        historyMainTabs.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-main-tab]');
            if (btn) {
                const tabName = btn.dataset.mainTab;
                context.activeMainHistoryTab = tabName;

                context.reportSortState = {};
                context.currentReportParams = null;

                document.querySelectorAll('.history-main-tab-btn').forEach(b => {
                    b.classList.remove('font-semibold', 'text-blue-600', 'border-b-2', 'border-blue-600');
                    b.classList.add('font-medium', 'text-gray-500');
                });
                btn.classList.add('font-semibold', 'text-blue-600', 'border-b-2', 'border-blue-600');
                btn.classList.remove('font-medium', 'text-gray-500');

                const dateListContainer = document.getElementById('history-date-list-container');

                if (tabName === 'work') {
                    if (workHistoryPanel) workHistoryPanel.classList.remove('hidden');
                    if (attendanceHistoryPanel) attendanceHistoryPanel.classList.add('hidden');
                    if (trendAnalysisPanel) trendAnalysisPanel.classList.add('hidden');
                    if (reportPanel) reportPanel.classList.add('hidden');
                    if (dateListContainer) dateListContainer.style.display = 'block';

                    const activeSubTabBtn = historyTabs?.querySelector('button.font-semibold');
                    const view = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'daily';
                    switchHistoryView(view);

                } else if (tabName === 'attendance') {
                    if (workHistoryPanel) workHistoryPanel.classList.add('hidden');
                    if (attendanceHistoryPanel) attendanceHistoryPanel.classList.remove('hidden');
                    if (trendAnalysisPanel) trendAnalysisPanel.classList.add('hidden');
                    if (reportPanel) reportPanel.classList.add('hidden');
                    if (dateListContainer) dateListContainer.style.display = 'block';

                    const activeSubTabBtn = attendanceHistoryTabs?.querySelector('button.font-semibold');
                    const view = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'attendance-daily';
                    switchHistoryView(view);

                } else if (tabName === 'trends') {
                    if (workHistoryPanel) workHistoryPanel.classList.add('hidden');
                    if (attendanceHistoryPanel) attendanceHistoryPanel.classList.add('hidden');
                    if (trendAnalysisPanel) trendAnalysisPanel.classList.remove('hidden');
                    if (reportPanel) reportPanel.classList.add('hidden');
                    if (dateListContainer) dateListContainer.style.display = 'none';

                    renderTrendAnalysisCharts(allHistoryData, appConfig, trendCharts);

                } else if (tabName === 'report') {
                    if (workHistoryPanel) workHistoryPanel.classList.add('hidden');
                    if (attendanceHistoryPanel) attendanceHistoryPanel.classList.add('hidden');
                    if (trendAnalysisPanel) trendAnalysisPanel.classList.add('hidden');
                    if (reportPanel) reportPanel.classList.remove('hidden');

                    const activeSubTabBtn = reportTabs?.querySelector('button.font-semibold');
                    const view = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'report-daily';
                    switchHistoryView(view);
                }
            }
        });
    }

    if (attendanceHistoryTabs) {
        attendanceHistoryTabs.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-view]');
            if (btn) {
                switchHistoryView(btn.dataset.view);
            }
        });
    }

    if (reportTabs) {
        reportTabs.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-view]');
            if (btn) {
                context.reportSortState = {};
                context.currentReportParams = null;
                switchHistoryView(btn.dataset.view);
            }
        });
    }

    if (historyViewContainer) {
        historyViewContainer.addEventListener('click', (e) => {
            const button = e.target.closest('button[data-action]');
            if (!button) return;

            const action = button.dataset.action;
            const dateKey = button.dataset.dateKey;

            if (!dateKey) { return; }

            if (action === 'open-history-quantity-modal') {
                setHistoryMaximized(false); 
                openHistoryQuantityModal(dateKey);
            } else if (action === 'download-history-excel') {
                downloadHistoryAsExcel(dateKey);
            } else if (action === 'request-history-deletion') {
                setHistoryMaximized(false); 
                requestHistoryDeletion(dateKey);
            }
        });
    }

    if (attendanceHistoryViewContainer) {
        attendanceHistoryViewContainer.addEventListener('click', (e) => {

            const editBtn = e.target.closest('button[data-action="edit-attendance"]');
            if (editBtn) {
                const dateKey = editBtn.dataset.dateKey;
                const index = parseInt(editBtn.dataset.index, 10);
                if (!dateKey || isNaN(index)) { return; }

                const dayData = allHistoryData.find(d => d.id === dateKey);

                if (!dayData || !dayData.onLeaveMembers || !dayData.onLeaveMembers[index]) {
                    showToast('원본 근태 기록을 찾을 수 없습니다.', true); return;
                }
                const record = dayData.onLeaveMembers[index];

                if (editAttendanceMemberName) editAttendanceMemberName.value = record.member;
                if (editAttendanceTypeSelect) {
                    editAttendanceTypeSelect.innerHTML = '';
                    LEAVE_TYPES.forEach(type => {
                        const option = document.createElement('option');
                        option.value = type;
                        option.textContent = type;
                        if (type === record.type) option.selected = true;
                        editAttendanceTypeSelect.appendChild(option);
                    });
                }
                const isTimeBased = (record.type === '외출' || record.type === '조퇴');
                const isDateBased = (record.type === '연차' || record.type === '출장' || record.type === '결근');

                if (editAttendanceTimeFields) {
                    editAttendanceTimeFields.classList.toggle('hidden', !isTimeBased);
                    if (editAttendanceStartTimeInput) editAttendanceStartTimeInput.value = record.startTime || '';
                    if (editAttendanceEndTimeInput) editAttendanceEndTimeInput.value = record.endTime || '';
                }
                if (editAttendanceDateFields) {
                    editAttendanceDateFields.classList.toggle('hidden', !isDateBased);
                    if (editAttendanceStartDateInput) editAttendanceStartDateInput.value = record.startDate || '';
                    if (editAttendanceEndDateInput) editAttendanceEndDateInput.value = record.endDate || '';
                }
                if (editAttendanceDateKeyInput) editAttendanceDateKeyInput.value = dateKey;
                if (editAttendanceRecordIndexInput) editAttendanceRecordIndexInput.value = index;

                setHistoryMaximized(false); 
                if (editAttendanceRecordModal) editAttendanceRecordModal.classList.remove('hidden');
                return;
            }

            const deleteBtn = e.target.closest('button[data-action="delete-attendance"]');
            if (deleteBtn) {
                const dateKey = deleteBtn.dataset.dateKey;
                const index = parseInt(deleteBtn.dataset.index, 10);
                if (!dateKey || isNaN(index)) { return; }

                const dayData = allHistoryData.find(d => d.id === dateKey);
                const record = dayData?.onLeaveMembers?.[index];

                if (!record) { showToast('삭제할 근태 기록을 찾을 수 없습니다.', true); return; }

                context.deleteMode = 'attendance';
                context.attendanceRecordToDelete = { dateKey, index };

                const msgEl = document.getElementById('delete-confirm-message');
                if (msgEl) msgEl.textContent = `${record.member}님의 '${record.type}' 기록을 삭제하시겠습니까?`;

                setHistoryMaximized(false);
                if (deleteConfirmModal) deleteConfirmModal.classList.remove('hidden');
                return;
            }

            const addBtn = e.target.closest('button[data-action="open-add-attendance-modal"]');
            if (addBtn) {
                const dateKey = addBtn.dataset.dateKey;
                if (!dateKey) { showToast('날짜 정보를 찾을 수 없습니다.', true); return; }
                if (addAttendanceForm) addAttendanceForm.reset();
                if (addAttendanceDateKeyInput) addAttendanceDateKeyInput.value = dateKey;
                if (addAttendanceStartDateInput) addAttendanceStartDateInput.value = dateKey;
                if (addAttendanceEndDateInput) addAttendanceEndDateInput.value = '';

                if (addAttendanceMemberDatalist) {
                    addAttendanceMemberDatalist.innerHTML = '';
                    const staffMembers = (appConfig.teamGroups || []).flatMap(g => g.members);
                    const partTimerMembers = (appState.partTimers || []).map(p => p.name);
                    const allMembers = [...new Set([...staffMembers, ...partTimerMembers])].sort();
                    allMembers.forEach(member => {
                        const option = document.createElement('option');
                        option.value = member;
                        addAttendanceMemberDatalist.appendChild(option);
                    });
                }

                if (addAttendanceTypeSelect) {
                    addAttendanceTypeSelect.innerHTML = '';
                    LEAVE_TYPES.forEach((type, index) => {
                        const option = document.createElement('option');
                        option.value = type;
                        option.textContent = type;
                        if (index === 0) option.selected = true;
                        addAttendanceTypeSelect.appendChild(option);
                    });
                }
                const firstType = LEAVE_TYPES[0] || '';
                const isTimeBased = (firstType === '외출' || firstType === '조퇴');
                const isDateBased = (firstType === '연차' || firstType === '출장' || firstType === '결근');
                if (addAttendanceTimeFields) addAttendanceTimeFields.classList.toggle('hidden', !isTimeBased);
                if (addAttendanceDateFields) addAttendanceDateFields.classList.toggle('hidden', !isDateBased);

                setHistoryMaximized(false);
                if (addAttendanceRecordModal) addAttendanceRecordModal.classList.remove('hidden');
                return;
            }
        });
    }

    if (reportViewContainer) {
        reportViewContainer.addEventListener('click', (e) => {
            const coqButton = e.target.closest('div[data-action="show-coq-modal"]');
            if (coqButton) {
                e.stopPropagation();
                setHistoryMaximized(false);
                if (coqExplanationModal) {
                    coqExplanationModal.classList.remove('hidden');
                }
                return;
            }

            const applyRevenueBtn = e.target.closest('#report-apply-revenue-btn');
            if (applyRevenueBtn) {
                const revenueInput = document.getElementById('report-monthly-revenue-input');
                if (revenueInput && context.currentReportParams && context.currentReportParams.monthKey) {
                    const rawRevenue = revenueInput.value.replace(/,/g, '');
                    const revenue = Number(rawRevenue) || 0;
                    const monthKey = context.currentReportParams.monthKey;
                    context.monthlyRevenues = context.monthlyRevenues || {};
                    context.monthlyRevenues[monthKey] = revenue;
                    renderReportMonthly(monthKey, allHistoryData, appConfig, context);
                    showToast('매출액 분석이 적용되었습니다.');
                }
                return;
            }
            const header = e.target.closest('.sortable-header');
            if (header) {
                e.stopPropagation();
                const sortKey = header.dataset.sortKey;
                if (!sortKey) return;
                const tableId = header.closest('table')?.id;
                let tableKey;
                if (tableId === 'report-table-part') tableKey = 'partSummary';
                else if (tableId === 'report-table-member') tableKey = 'memberSummary';
                else if (tableId === 'report-table-task') tableKey = 'taskSummary';
                else return;
                const currentSort = context.reportSortState[tableKey] || { key: null, dir: 'asc' };
                let newDir = 'desc';
                if (currentSort.key === sortKey) {
                    newDir = (currentSort.dir === 'desc') ? 'asc' : 'desc';
                }
                context.reportSortState[tableKey] = { key: sortKey, dir: newDir };
                if (!context.currentReportParams) return;
                const { dateKey, weekKey, monthKey, yearKey, allHistoryData, appConfig } = context.currentReportParams;
                const activeView = reportTabs?.querySelector('button.font-semibold')?.dataset.view || 'report-daily';
                if (activeView === 'report-daily') renderReportDaily(dateKey, allHistoryData, appConfig, context);
                else if (activeView === 'report-weekly') renderReportWeekly(weekKey, allHistoryData, appConfig, context);
                else if (activeView === 'report-monthly') renderReportMonthly(monthKey, allHistoryData, appConfig, context);
                else if (activeView === 'report-yearly') renderReportYearly(yearKey, allHistoryData, appConfig, context);
                return;
            }
        });
    }

    const historyHeader = document.getElementById('history-modal-header');
    if (historyModal && historyHeader && historyModalContentBox) {
        makeDraggable(historyModal, historyHeader, historyModalContentBox);
    }

    const toggleFullscreenBtn = document.getElementById('toggle-history-fullscreen-btn');
    if (toggleFullscreenBtn && historyModal && historyModalContentBox) {
        // 초기 아이콘 설정
        const icon = toggleFullscreenBtn.querySelector('svg');
        if (icon) icon.innerHTML = iconMaximize;

        toggleFullscreenBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            setHistoryMaximized(!isHistoryMaximized);
        });
    }

    if (confirmEditAttendanceBtn) {
        confirmEditAttendanceBtn.addEventListener('click', async () => {
            const dateKey = editAttendanceDateKeyInput?.value;
            const indexStr = editAttendanceRecordIndexInput?.value;
            if (!dateKey || indexStr === '') { showToast('수정할 기록 정보를 찾을 수 없습니다.', true); return; }
            const index = parseInt(indexStr, 10);
            const dayDataIndex = allHistoryData.findIndex(d => d.id === dateKey);
            if (dayDataIndex === -1) { showToast('해당 날짜의 이력 데이터를 찾을 수 없습니다.', true); return; }
            const dayData = allHistoryData[dayDataIndex];
            if (!dayData.onLeaveMembers || !dayData.onLeaveMembers[index]) { showToast('수정할 근태 기록을 찾을 수 없습니다.', true); return; }
            const newType = editAttendanceTypeSelect?.value;
            const isTimeBased = (newType === '외출' || newType === '조퇴');
            const updatedRecord = { ...dayData.onLeaveMembers[index], type: newType };
            if (isTimeBased) {
                updatedRecord.startTime = editAttendanceStartTimeInput?.value || null;
                updatedRecord.endTime = editAttendanceEndTimeInput?.value || null;
                delete updatedRecord.startDate; delete updatedRecord.endDate;
            } else {
                updatedRecord.startDate = editAttendanceStartDateInput?.value || null;
                updatedRecord.endDate = editAttendanceEndDateInput?.value || null;
                delete updatedRecord.startTime; delete updatedRecord.endTime;
            }
            if (isTimeBased && !updatedRecord.startTime) { showToast('시작 시간을 입력해주세요.', true); return; }
            if (!isTimeBased && !updatedRecord.startDate) { showToast('시작일을 입력해주세요.', true); return; }
            dayData.onLeaveMembers[index] = updatedRecord;
            try {
                const historyDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
                await setDoc(historyDocRef, dayData);
                showToast('근태 기록이 수정되었습니다.');
                if (editAttendanceRecordModal) editAttendanceRecordModal.classList.add('hidden');
                renderAttendanceDailyHistory(dateKey, allHistoryData);
            } catch (e) {
                console.error('Error updating attendance history:', e);
                showToast('근태 기록 저장 중 오류가 발생했습니다.', true);
            }
        });
    }
    if (cancelEditAttendanceBtn) {
        cancelEditAttendanceBtn.addEventListener('click', () => {
            if (editAttendanceRecordModal) editAttendanceRecordModal.classList.add('hidden');
        });
    }
    if (confirmAddAttendanceBtn) {
        confirmAddAttendanceBtn.addEventListener('click', async () => {
            const dateKey = addAttendanceDateKeyInput?.value;
            if (!dateKey) { showToast('날짜 정보를 찾을 수 없습니다.', true); return; }
            const memberName = addAttendanceMemberNameInput?.value.trim();
            const type = addAttendanceTypeSelect?.value;
            if (!memberName || !type) { showToast('이름과 유형을 모두 입력해주세요.', true); return; }
            const isTimeBased = (type === '외출' || type === '조퇴');
            const newRecord = { member: memberName, type: type };
            if (isTimeBased) {
                newRecord.startTime = addAttendanceStartTimeInput?.value || null;
                newRecord.endTime = addAttendanceEndTimeInput?.value || null;
                if (!newRecord.startTime) { showToast('시작 시간을 입력해주세요.', true); return; }
            } else {
                newRecord.startDate = addAttendanceStartDateInput?.value || null;
                newRecord.endDate = addAttendanceEndDateInput?.value || null;
                if (!newRecord.startDate) { showToast('시작일을 입력해주세요.', true); return; }
            }
            let dayData = allHistoryData.find(d => d.id === dateKey);
            if (!dayData) {
                dayData = { id: dateKey, workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [] };
                allHistoryData.push(dayData);
                allHistoryData.sort((a, b) => b.id.localeCompare(a.id));
            }
            if (!dayData.onLeaveMembers) dayData.onLeaveMembers = [];
            dayData.onLeaveMembers.push(newRecord);
            try {
                const historyDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
                await setDoc(historyDocRef, dayData);
                showToast(`${memberName}님의 근태 기록이 추가되었습니다.`);
                if (addAttendanceRecordModal) addAttendanceRecordModal.classList.add('hidden');
                renderAttendanceDailyHistory(dateKey, allHistoryData);
            } catch (e) {
                console.error('Error adding attendance history:', e);
                showToast('근태 기록 추가 중 오류가 발생했습니다.', true);
                dayData.onLeaveMembers.pop();
            }
        });
    }
    if (cancelAddAttendanceBtn) {
        cancelAddAttendanceBtn.addEventListener('click', () => {
            if (addAttendanceRecordModal) addAttendanceRecordModal.classList.add('hidden');
        });
    }
    if (addAttendanceTypeSelect) {
        addAttendanceTypeSelect.addEventListener('change', (e) => {
            const isTimeBased = (e.target.value === '외출' || e.target.value === '조퇴');
            if (addAttendanceTimeFields) addAttendanceTimeFields.classList.toggle('hidden', !isTimeBased);
            if (addAttendanceDateFields) addAttendanceDateFields.classList.toggle('hidden', isTimeBased);
        });
    }
    if (editAttendanceTypeSelect) {
        editAttendanceTypeSelect.addEventListener('change', (e) => {
            const isTimeBased = (e.target.value === '외출' || e.target.value === '조퇴');
            if (editAttendanceTimeFields) editAttendanceTimeFields.classList.toggle('hidden', !isTimeBased);
            if (editAttendanceDateFields) editAttendanceDateFields.classList.toggle('hidden', isTimeBased);
        });
    }

}

function makeDraggable(modalOverlay, header, contentBox) {
    let isDragging = false;
    let offsetX, offsetY;

    header.addEventListener('mousedown', (e) => {
        if (isHistoryMaximized || e.target.closest('button')) {
            return;
        }
        isDragging = true;

        if (contentBox.dataset.hasBeenUncentered !== 'true') {
            const rect = contentBox.getBoundingClientRect();
            modalOverlay.classList.remove('flex', 'items-center', 'justify-center');
            contentBox.style.position = 'absolute';
            contentBox.style.top = `${rect.top}px`;
            contentBox.style.left = `${rect.left}px`;
            contentBox.style.transform = 'none';
            contentBox.dataset.hasBeenUncentered = 'true';
        }

        const rect = contentBox.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    function onMouseMove(e) {
        if (!isDragging) return;
        let newLeft = e.clientX - offsetX;
        let newTop = e.clientY - offsetY;

        contentBox.style.left = `${newLeft}px`;
        contentBox.style.top = `${newTop}px`;
    }

    function onMouseUp() {
        isDragging = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }
}