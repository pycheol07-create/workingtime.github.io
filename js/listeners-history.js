// === js/listeners-history.js ===

// ✅ [신규] DOM 요소와 상태 변수를 분리된 파일에서 가져옵니다.
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

    // ✅ [수정] 전체화면/기본화면 전환 로직
    const setHistoryMaximized = (maximized) => {
        isHistoryMaximized = maximized;
        const toggleBtn = document.getElementById('toggle-history-fullscreen-btn');
        const icon = toggleBtn?.querySelector('svg');

        // 1. [CRITICAL] 모든 인라인 스타일(드래그 위치/크기)을 제거
        DOM.historyModalContentBox.removeAttribute('style');
        DOM.historyModalContentBox.dataset.hasBeenUncentered = 'false';
        
        // 2. [수정] 오버레이(historyModal)와 컨텐츠(historyModalContentBox)의 스타일을 함께 변경
        
        if (maximized) {
            // ▶️ 최대화 모드
            // 오버레이: flex/padding 제거 (전체 화면을 채우도록)
            DOM.historyModal.classList.remove('flex', 'items-center', 'justify-center', 'p-4');

            // 컨텐츠: 'fixed' 관련 클래스 추가 (화면 전체 채우기)
            DOM.historyModalContentBox.classList.add('fixed', 'inset-0', 'w-full', 'h-full', 'z-[150]', 'rounded-none');
            // 컨텐츠: 'relative' 및 '고정 크기' 클래스 제거
            DOM.historyModalContentBox.classList.remove('relative', 'w-[1400px]', 'h-[880px]', 'rounded-2xl', 'shadow-2xl');
            
            if (toggleBtn) toggleBtn.title = "기본 크기로";
            if (icon) icon.innerHTML = iconMinimize;

        } else {
            // ◀️ 일반 모드 복귀
            // 오버레이: flex/padding 복원 (가운데 정렬 및 여백)
            DOM.historyModal.classList.add('flex', 'items-center', 'justify-center', 'p-4');
            
            // 컨텐츠: 'fixed' 관련 클래스 제거
            DOM.historyModalContentBox.classList.remove('fixed', 'inset-0', 'h-full', 'z-[150]', 'rounded-none');
            // 컨텐츠: 'relative' 및 '고정 크기' 클래스 추가
            DOM.historyModalContentBox.classList.add('relative', 'w-[1400px]', 'h-[880px]', 'rounded-2xl', 'shadow-2xl');

            if (toggleBtn) toggleBtn.title = "전체화면";
            if (icon) icon.innerHTML = iconMaximize;
        }
    };

    // ... (getCurrentHistoryListMode, historyFilterBtn, historyClearFilterBtn, historyDownloadPeriodExcelBtn 리스너는 변경 없음) ...
    
    const getCurrentHistoryListMode = () => {
        let activeSubTabBtn;
        if (State.context.activeMainHistoryTab === 'work') {
            activeSubTabBtn = DOM.historyTabs?.querySelector('button.font-semibold');
        } else if (State.context.activeMainHistoryTab === 'attendance') {
            activeSubTabBtn = DOM.attendanceHistoryTabs?.querySelector('button.font-semibold');
        } else if (State.context.activeMainHistoryTab === 'report') {
            activeSubTabBtn = DOM.reportTabs?.querySelector('button.font-semibold');
        }

        const activeView = activeSubTabBtn ? activeSubTabBtn.dataset.view : (State.context.activeMainHistoryTab === 'work' ? 'daily' : 'attendance-daily');

        if (activeView.includes('yearly')) return 'year';
        if (activeView.includes('weekly')) return 'week';
        if (activeView.includes('monthly')) return 'month';
        return 'day';
    };

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

    // ✅ [신규] 공통 이력 열기 로직
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
            
            // ✅ [수정] 열 때 항상 setHistoryMaximized(false) 호출하여 리셋
            setHistoryMaximized(false);
            
            // ⛔️ [제거] DOM.historyModal.classList.add('flex', 'items-center', 'justify-center');
            // (setHistoryMaximized(false) 내부에서 이미 처리함)

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
            if (DOM.navContent) DOM.navContent.classList.add('hidden'); // 모바일 메뉴 닫기
        });
    }


    if (DOM.closeHistoryBtn) {
        DOM.closeHistoryBtn.addEventListener('click', () => {
            if (DOM.historyModal) {
                DOM.historyModal.classList.add('hidden');
                
                // ✅ [수정] 닫을 때도 setHistoryMaximized(false) 호출하여 리셋
                setHistoryMaximized(false);
                
                // ⛔️ [제거] DOM.historyModal.classList.add('flex', 'items-center', 'justify-center');
                // (setHistoryMaximized(false) 내부에서 이미 처리함)
            }
        });
    }

    // ... (historyDateList, historyTabs, confirmHistoryDeleteBtn, historyMainTabs, attendanceHistoryTabs, reportTabs, historyViewContainer, attendanceHistoryViewContainer, reportViewContainer 리스너는 변경 없음) ...

    if (DOM.historyDateList) {
        DOM.historyDateList.addEventListener('click', (e) => {
            const btn = e.target.closest('.history-date-btn');
            if (btn) {
                DOM.historyDateList.querySelectorAll('button').forEach(b => b.classList.remove('bg-blue-100', 'font-bold'));
                btn.classList.add('bg-blue-100', 'font-bold');
                const dateKey = btn.dataset.key;

                let activeSubTabBtn;
                if (State.context.activeMainHistoryTab === 'work') {
                    activeSubTabBtn = DOM.historyTabs?.querySelector('button.font-semibold');
                } else if (State.context.activeMainHistoryTab === 'attendance') {
                    activeSubTabBtn = DOM.attendanceHistoryTabs?.querySelector('button.font-semibold');
                } else if (State.context.activeMainHistoryTab === 'report') {
                    activeSubTabBtn = DOM.reportTabs?.querySelector('button.font-semibold');
                }

                const activeView = activeSubTabBtn ? activeSubTabBtn.dataset.view : (State.context.activeMainHistoryTab === 'work' ? 'daily' : 'attendance-daily');

                const filteredData = (State.context.historyStartDate || State.context.historyEndDate)
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

                State.context.reportSortState = {};

                if (State.context.activeMainHistoryTab === 'work') {
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
                } else if (State.context.activeMainHistoryTab === 'attendance') {
                    if (activeView === 'attendance-daily') {
                        renderAttendanceDailyHistory(dateKey, filteredData);
                    } else if (activeView === 'attendance-weekly') {
                        renderAttendanceWeeklyHistory(dateKey, filteredData);
                    } else if (activeView === 'attendance-monthly') {
                        renderAttendanceMonthlyHistory(dateKey, filteredData);
                    }
                }
                else if (State.context.activeMainHistoryTab === 'report') {
                    if (activeView === 'report-daily') {
                        renderReportDaily(dateKey, filteredData, State.appConfig, State.context);
                    } else if (activeView === 'report-weekly') {
                        renderReportWeekly(dateKey, filteredData, State.appConfig, State.context);
                    } else if (activeView === 'report-monthly') {
                        renderReportMonthly(dateKey, filteredData, State.appConfig, State.context);
                    } else if (activeView === 'report-yearly') {
                        renderReportYearly(dateKey, filteredData, State.appConfig, State.context);
                    }
                }

            }
        });
    }

    if (DOM.historyTabs) {
        DOM.historyTabs.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-view]');
            if (btn) {
                switchHistoryView(btn.dataset.view);
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
                    console.error('Error deleting history:', e);
                    showToast('이력 삭제 중 오류 발생.', true);
                }
            }
            if (DOM.deleteHistoryModal) DOM.deleteHistoryModal.classList.add('hidden');
            State.context.historyKeyToDelete = null;
        });
    }

    if (DOM.historyMainTabs) {
        DOM.historyMainTabs.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-main-tab]');
            if (btn) {
                const tabName = btn.dataset.mainTab;
                State.context.activeMainHistoryTab = tabName;

                State.context.reportSortState = {};
                State.context.currentReportParams = null;

                document.querySelectorAll('.history-main-tab-btn').forEach(b => {
                    b.classList.remove('font-semibold', 'text-blue-600', 'border-b-2', 'border-blue-600');
                    b.classList.add('font-medium', 'text-gray-500');
                });
                btn.classList.add('font-semibold', 'text-blue-600', 'border-b-2', 'border-blue-600');
                btn.classList.remove('font-medium', 'text-gray-500');

                const dateListContainer = document.getElementById('history-date-list-container');

                if (tabName === 'work') {
                    if (DOM.workHistoryPanel) DOM.workHistoryPanel.classList.remove('hidden');
                    if (DOM.attendanceHistoryPanel) DOM.attendanceHistoryPanel.classList.add('hidden');
                    if (DOM.trendAnalysisPanel) DOM.trendAnalysisPanel.classList.add('hidden');
                    if (DOM.reportPanel) DOM.reportPanel.classList.add('hidden');
                    if (dateListContainer) dateListContainer.style.display = 'block';

                    const activeSubTabBtn = DOM.historyTabs?.querySelector('button.font-semibold');
                    const view = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'daily';
                    switchHistoryView(view);

                } else if (tabName === 'attendance') {
                    if (DOM.workHistoryPanel) DOM.workHistoryPanel.classList.add('hidden');
                    if (DOM.attendanceHistoryPanel) DOM.attendanceHistoryPanel.classList.remove('hidden');
                    if (DOM.trendAnalysisPanel) DOM.trendAnalysisPanel.classList.add('hidden');
                    if (DOM.reportPanel) DOM.reportPanel.classList.add('hidden');
                    if (dateListContainer) dateListContainer.style.display = 'block';

                    const activeSubTabBtn = DOM.attendanceHistoryTabs?.querySelector('button.font-semibold');
                    const view = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'attendance-daily';
                    switchHistoryView(view);

                } else if (tabName === 'trends') {
                    if (DOM.workHistoryPanel) DOM.workHistoryPanel.classList.add('hidden');
                    if (DOM.attendanceHistoryPanel) DOM.attendanceHistoryPanel.classList.add('hidden');
                    if (DOM.trendAnalysisPanel) DOM.trendAnalysisPanel.classList.remove('hidden');
                    if (DOM.reportPanel) DOM.reportPanel.classList.add('hidden');
                    if (dateListContainer) dateListContainer.style.display = 'none';

                    renderTrendAnalysisCharts(State.allHistoryData, State.appConfig, trendCharts);

                } else if (tabName === 'report') {
                    if (DOM.workHistoryPanel) DOM.workHistoryPanel.classList.add('hidden');
                    if (DOM.attendanceHistoryPanel) DOM.attendanceHistoryPanel.classList.add('hidden');
                    if (DOM.trendAnalysisPanel) DOM.trendAnalysisPanel.classList.add('hidden');
                    if (DOM.reportPanel) DOM.reportPanel.classList.remove('hidden');

                    const activeSubTabBtn = DOM.reportTabs?.querySelector('button.font-semibold');
                    const view = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'report-daily';
                    switchHistoryView(view);
                }
            }
        });
    }

    if (DOM.attendanceHistoryTabs) {
        DOM.attendanceHistoryTabs.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-view]');
            if (btn) {
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
                switchHistoryView(btn.dataset.view);
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
            } else if (action === 'download-history-excel') {
                downloadHistoryAsExcel(dateKey);
            } else if (action === 'request-history-deletion') {
                setHistoryMaximized(false); 
                requestHistoryDeletion(dateKey);
            }
        });
    }

    if (DOM.attendanceHistoryViewContainer) {
        DOM.attendanceHistoryViewContainer.addEventListener('click', (e) => {

            const editBtn = e.target.closest('button[data-action="edit-attendance"]');
            if (editBtn) {
                const dateKey = editBtn.dataset.dateKey;
                const index = parseInt(editBtn.dataset.index, 10);
                if (!dateKey || isNaN(index)) { return; }

                const dayData = State.allHistoryData.find(d => d.id === dateKey);

                if (!dayData || !dayData.onLeaveMembers || !dayData.onLeaveMembers[index]) {
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
                
                // ✅ [수정] '조퇴'와 '외출'을 구분하여 필드 표시
                const isTimeBased = (record.type === '외출' || record.type === '조퇴');
                const isDateBased = (record.type === '연차' || record.type === '출장' || record.type === '결근');
                const isOuting = (record.type === '외출'); // '외출'만 종료 시간 있음

                if (DOM.editAttendanceTimeFields) {
                    DOM.editAttendanceTimeFields.classList.toggle('hidden', !isTimeBased);
                    
                    // ✅ [수정] '조퇴'일 때 종료 시간 필드 숨김
                    const endTimeWrapper = document.getElementById('edit-attendance-end-time-wrapper');
                    if (endTimeWrapper) {
                        endTimeWrapper.classList.toggle('hidden', !isOuting);
                    }
                    
                    if (DOM.editAttendanceStartTimeInput) DOM.editAttendanceStartTimeInput.value = record.startTime || '';
                    if (DOM.editAttendanceEndTimeInput) DOM.editAttendanceEndTimeInput.value = record.endTime || '';
                }
                if (DOM.editAttendanceDateFields) {
                    DOM.editAttendanceDateFields.classList.toggle('hidden', !isDateBased);
                    if (DOM.editAttendanceStartDateInput) DOM.editAttendanceStartDateInput.value = record.startDate || '';
                    if (DOM.editAttendanceEndDateInput) DOM.editAttendanceEndDateInput.value = record.endDate || '';
                }
                if (DOM.editAttendanceDateKeyInput) DOM.editAttendanceDateKeyInput.value = dateKey;
                if (DOM.editAttendanceRecordIndexInput) DOM.editAttendanceRecordIndexInput.value = index;

                setHistoryMaximized(false); 
                if (DOM.editAttendanceRecordModal) DOM.editAttendanceRecordModal.classList.remove('hidden');
                return;
            }

            const deleteBtn = e.target.closest('button[data-action="delete-attendance"]');
            if (deleteBtn) {
                const dateKey = deleteBtn.dataset.dateKey;
                const index = parseInt(deleteBtn.dataset.index, 10);
                if (!dateKey || isNaN(index)) { return; }

                const dayData = State.allHistoryData.find(d => d.id === dateKey);
                const record = dayData?.onLeaveMembers?.[index];

                if (!record) { showToast('삭제할 근태 기록을 찾을 수 없습니다.', true); return; }

                State.context.deleteMode = 'attendance';
                State.context.attendanceRecordToDelete = { dateKey, index };

                const msgEl = document.getElementById('delete-confirm-message');
                if (msgEl) msgEl.textContent = `${record.member}님의 '${record.type}' 기록을 삭제하시겠습니까?`;

                setHistoryMaximized(false);
                if (DOM.deleteConfirmModal) DOM.deleteConfirmModal.classList.remove('hidden');
                return;
            }

            const addBtn = e.target.closest('button[data-action="open-add-attendance-modal"]');
            if (addBtn) {
                const dateKey = addBtn.dataset.dateKey;
                if (!dateKey) { showToast('날짜 정보를 찾을 수 없습니다.', true); return; }
                if (DOM.addAttendanceForm) DOM.addAttendanceForm.reset();
                if (DOM.addAttendanceDateKeyInput) DOM.addAttendanceDateKeyInput.value = dateKey;
                if (DOM.addAttendanceStartDateInput) DOM.addAttendanceStartDateInput.value = dateKey;
                if (DOM.addAttendanceEndDateInput) DOM.addAttendanceEndDateInput.value = '';

                if (DOM.addAttendanceMemberDatalist) {
                    DOM.addAttendanceMemberDatalist.innerHTML = '';
                    const staffMembers = (State.appConfig.teamGroups || []).flatMap(g => g.members);
                    const partTimerMembers = (State.appState.partTimers || []).map(p => p.name);
                    const allMembers = [...new Set([...staffMembers, ...partTimerMembers])].sort();
                    allMembers.forEach(member => {
                        const option = document.createElement('option');
                        option.value = member;
                        DOM.addAttendanceMemberDatalist.appendChild(option);
                    });
                }

                if (DOM.addAttendanceTypeSelect) {
                    DOM.addAttendanceTypeSelect.innerHTML = '';
                    State.LEAVE_TYPES.forEach((type, index) => {
                        const option = document.createElement('option');
                        option.value = type;
                        option.textContent = type;
                        if (index === 0) option.selected = true;
                        DOM.addAttendanceTypeSelect.appendChild(option);
                    });
                }
                const firstType = State.LEAVE_TYPES[0] || '';
                
                // ✅ [수정] '조퇴'와 '외출'을 구분하여 필드 표시
                const isTimeBased = (firstType === '외출' || firstType === '조퇴');
                const isDateBased = (firstType === '연차' || firstType === '출장' || firstType === '결근');
                const isOuting = (firstType === '외출');

                if (DOM.addAttendanceTimeFields) DOM.addAttendanceTimeFields.classList.toggle('hidden', !isTimeBased);
                
                // ✅ [수정] '조퇴'일 때 종료 시간 필드 숨김
                const endTimeWrapper = document.getElementById('add-attendance-end-time-wrapper');
                if (endTimeWrapper) {
                    endTimeWrapper.classList.toggle('hidden', !isOuting);
                }

                if (DOM.addAttendanceDateFields) DOM.addAttendanceDateFields.classList.toggle('hidden', !isDateBased);

                setHistoryMaximized(false);
                if (DOM.addAttendanceRecordModal) DOM.addAttendanceRecordModal.classList.remove('hidden');
                return;
            }
        });
    }

    if (DOM.reportViewContainer) {
        DOM.reportViewContainer.addEventListener('click', (e) => {
            const coqButton = e.target.closest('div[data-action="show-coq-modal"]');
            if (coqButton) {
                e.stopPropagation();
                setHistoryMaximized(false);
                if (DOM.coqExplanationModal) {
                    DOM.coqExplanationModal.classList.remove('hidden');
                }
                return;
            }

            const applyRevenueBtn = e.target.closest('#report-apply-revenue-btn');
            if (applyRevenueBtn) {
                const revenueInput = document.getElementById('report-monthly-revenue-input');
                if (revenueInput && State.context.currentReportParams && State.context.currentReportParams.monthKey) {
                    const rawRevenue = revenueInput.value.replace(/,/g, '');
                    const revenue = Number(rawRevenue) || 0;
                    const monthKey = State.context.currentReportParams.monthKey;
                    State.context.monthlyRevenues = State.context.monthlyRevenues || {};
                    State.context.monthlyRevenues[monthKey] = revenue;
                    renderReportMonthly(monthKey, State.allHistoryData, State.appConfig, State.context);
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
                const currentSort = State.context.reportSortState[tableKey] || { key: null, dir: 'asc' };
                let newDir = 'desc';
                if (currentSort.key === sortKey) {
                    newDir = (currentSort.dir === 'desc') ? 'asc' : 'desc';
                }
                State.context.reportSortState[tableKey] = { key: sortKey, dir: newDir };
                if (!State.context.currentReportParams) return;
                const { dateKey, weekKey, monthKey, yearKey } = State.context.currentReportParams;
                // ✅ [수정] allHistoryData, appConfig를 context에서 가져오지 않고 State에서 직접 참조
                const activeView = DOM.reportTabs?.querySelector('button.font-semibold')?.dataset.view || 'report-daily';
                if (activeView === 'report-daily') renderReportDaily(dateKey, State.allHistoryData, State.appConfig, State.context);
                else if (activeView === 'report-weekly') renderReportWeekly(weekKey, State.allHistoryData, State.appConfig, State.context);
                else if (activeView === 'report-monthly') renderReportMonthly(monthKey, State.allHistoryData, State.appConfig, State.context);
                else if (activeView === 'report-yearly') renderReportYearly(yearKey, State.allHistoryData, State.appConfig, State.context);
                return;
            }
        });
    }

    const historyHeader = document.getElementById('history-modal-header');
    if (DOM.historyModal && historyHeader && DOM.historyModalContentBox) {
        makeDraggable(DOM.historyModal, historyHeader, DOM.historyModalContentBox);
    }

    const toggleFullscreenBtn = document.getElementById('toggle-history-fullscreen-btn');
    if (toggleFullscreenBtn && DOM.historyModal && DOM.historyModalContentBox) {
        // 초기 아이콘 설정
        const icon = toggleFullscreenBtn.querySelector('svg');
        if (icon) icon.innerHTML = iconMaximize;

        toggleFullscreenBtn.addEventListener('click', (e) => {
            e.stopImmediatePropagation();
            setHistoryMaximized(!isHistoryMaximized);
        });
    }

    // ... (confirmEditAttendanceBtn, cancelEditAttendanceBtn, confirmAddAttendanceBtn, cancelAddAttendanceBtn, addAttendanceTypeSelect, editAttendanceTypeSelect 리스너는 변경 없음) ...
    if (DOM.confirmEditAttendanceBtn) {
        DOM.confirmEditAttendanceBtn.addEventListener('click', async () => {
            const dateKey = DOM.editAttendanceDateKeyInput?.value;
            const indexStr = DOM.editAttendanceRecordIndexInput?.value;
            if (!dateKey || indexStr === '') { showToast('수정할 기록 정보를 찾을 수 없습니다.', true); return; }
            const index = parseInt(indexStr, 10);
            const dayDataIndex = State.allHistoryData.findIndex(d => d.id === dateKey);
            if (dayDataIndex === -1) { showToast('해당 날짜의 이력 데이터를 찾을 수 없습니다.', true); return; }
            const dayData = State.allHistoryData[dayDataIndex];
            if (!dayData.onLeaveMembers || !dayData.onLeaveMembers[index]) { showToast('수정할 근태 기록을 찾을 수 없습니다.', true); return; }
            
            const newType = DOM.editAttendanceTypeSelect?.value;
            
            // ✅ [수정] '조퇴'와 '외출' 구분
            const isTimeBased = (newType === '외출' || newType === '조퇴');
            const isOuting = (newType === '외출');
            
            const updatedRecord = { ...dayData.onLeaveMembers[index], type: newType };
            
            if (isTimeBased) {
                updatedRecord.startTime = DOM.editAttendanceStartTimeInput?.value || null;
                // ✅ [수정] '외출'일 때만 종료시간 저장
                if (isOuting) {
                    updatedRecord.endTime = DOM.editAttendanceEndTimeInput?.value || null;
                } else {
                    updatedRecord.endTime = null; // '조퇴'는 종료 시간 없음
                }
                delete updatedRecord.startDate; delete updatedRecord.endDate;
            } else {
                updatedRecord.startDate = DOM.editAttendanceStartDateInput?.value || null;
                updatedRecord.endDate = DOM.editAttendanceEndDateInput?.value || null;
                delete updatedRecord.startTime; delete updatedRecord.endTime;
            }
            
            if (isTimeBased && !updatedRecord.startTime) { showToast('시작 시간을 입력해주세요.', true); return; }
            if (!isTimeBased && !updatedRecord.startDate) { showToast('시작일을 입력해주세요.', true); return; }
            
            dayData.onLeaveMembers[index] = updatedRecord;
            try {
                const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
                await setDoc(historyDocRef, { onLeaveMembers: dayData.onLeaveMembers }, { merge: true });
                showToast('근태 기록이 수정되었습니다.');
                if (DOM.editAttendanceRecordModal) DOM.editAttendanceRecordModal.classList.add('hidden');
                renderAttendanceDailyHistory(dateKey, State.allHistoryData);
            } catch (e) {
                console.error('Error updating attendance history:', e);
                showToast('근태 기록 저장 중 오류가 발생했습니다.', true);
            }
        });
    }
    if (DOM.cancelEditAttendanceBtn) {
        DOM.cancelEditAttendanceBtn.addEventListener('click', () => {
            if (DOM.editAttendanceRecordModal) DOM.editAttendanceRecordModal.classList.add('hidden');
        });
    }
    if (DOM.confirmAddAttendanceBtn) {
        DOM.confirmAddAttendanceBtn.addEventListener('click', async () => {
            const dateKey = DOM.addAttendanceDateKeyInput?.value;
            if (!dateKey) { showToast('날짜 정보를 찾을 수 없습니다.', true); return; }
            const memberName = DOM.addAttendanceMemberNameInput?.value.trim();
            const type = DOM.addAttendanceTypeSelect?.value;
            if (!memberName || !type) { showToast('이름과 유형을 모두 입력해주세요.', true); return; }
            
            // ✅ [수정] '조퇴'와 '외출' 구분
            const isTimeBased = (type === '외출' || type === '조퇴');
            const isOuting = (type === '외출');
            
            const newRecord = { member: memberName, type: type };
            if (isTimeBased) {
                newRecord.startTime = DOM.addAttendanceStartTimeInput?.value || null;
                // ✅ [수정] '외출'일 때만 종료시간 저장
                if (isOuting) {
                    newRecord.endTime = DOM.addAttendanceEndTimeInput?.value || null;
                } else {
                    newRecord.endTime = null;
                }
                if (!newRecord.startTime) { showToast('시작 시간을 입력해주세요.', true); return; }
            } else {
                newRecord.startDate = DOM.addAttendanceStartDateInput?.value || null;
                newRecord.endDate = DOM.addAttendanceEndDateInput?.value || null;
                if (!newRecord.startDate) { showToast('시작일을 입력해주세요.', true); return; }
            }
            let dayData = State.allHistoryData.find(d => d.id === dateKey);
            let isNewDay = false;
            if (!dayData) {
                dayData = { id: dateKey, workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [] };
                State.allHistoryData.push(dayData);
                State.allHistoryData.sort((a, b) => b.id.localeCompare(a.id));
                isNewDay = true;
            }
            if (!dayData.onLeaveMembers) dayData.onLeaveMembers = [];
            dayData.onLeaveMembers.push(newRecord);
            try {
                const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
                await setDoc(historyDocRef, { onLeaveMembers: dayData.onLeaveMembers }, { merge: true });

                showToast(`${memberName}님의 근태 기록이 추가되었습니다.`);
                if (DOM.addAttendanceRecordModal) DOM.addAttendanceRecordModal.classList.add('hidden');
                renderAttendanceDailyHistory(dateKey, State.allHistoryData);
            } catch (e) {
                console.error('Error adding attendance history:', e);
                showToast('근태 기록 추가 중 오류가 발생했습니다.', true);
                dayData.onLeaveMembers.pop(); // 롤백
                if (isNewDay) { // 새 날짜였다면 롤백
                    State.allHistoryData.shift(); 
                }
            }
        });
    }
    if (DOM.cancelAddAttendanceBtn) {
        DOM.cancelAddAttendanceBtn.addEventListener('click', () => {
            if (DOM.addAttendanceRecordModal) DOM.addAttendanceRecordModal.classList.add('hidden');
        });
    }
    if (DOM.addAttendanceTypeSelect) {
        DOM.addAttendanceTypeSelect.addEventListener('change', (e) => {
            // ✅ [수정] '조퇴'와 '외출' 구분
            const newType = e.target.value;
            const isTimeBased = (newType === '외출' || newType === '조퇴');
            const isOuting = (newType === '외출');

            if (DOM.addAttendanceTimeFields) DOM.addAttendanceTimeFields.classList.toggle('hidden', !isTimeBased);
            
            // ✅ [수정] '조퇴'일 때 종료 시간 필드 숨김
            const endTimeWrapper = document.getElementById('add-attendance-end-time-wrapper');
            if (endTimeWrapper) {
                endTimeWrapper.classList.toggle('hidden', !isOuting);
            }

            if (DOM.addAttendanceDateFields) DOM.addAttendanceDateFields.classList.toggle('hidden', isTimeBased);
        });
    }
    if (DOM.editAttendanceTypeSelect) {
        DOM.editAttendanceTypeSelect.addEventListener('change', (e) => {
            // ✅ [수정] '조퇴'와 '외출' 구분
            const newType = e.target.value;
            const isTimeBased = (newType === '외출' || newType === '조퇴');
            const isOuting = (newType === '외출');

            if (DOM.editAttendanceTimeFields) DOM.editAttendanceTimeFields.classList.toggle('hidden', !isTimeBased);
            
            // ✅ [수정] '조퇴'일 때 종료 시간 필드 숨김
            const endTimeWrapper = document.getElementById('edit-attendance-end-time-wrapper');
            if (endTimeWrapper) {
                endTimeWrapper.classList.toggle('hidden', !isOuting);
            }

            if (DOM.editAttendanceDateFields) DOM.editAttendanceDateFields.classList.toggle('hidden', isTimeBased);
        });
    }

}

// ✅ [수정] makeDraggable 함수 (width/height 고정 로직 복원)
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
            
            // ✅ [수정] 너비와 높이를 인라인 스타일로 고정 (창 축소 방지)
            contentBox.style.width = `${rect.width}px`;
            contentBox.style.height = `${rect.height}px`;

            contentBox.style.transform = 'none';
            contentBox.dataset.hasBeenUncentered = 'true';
        }

        // mousedown 시점의 좌표를 다시 계산 (스타일이 변경되었으므로)
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