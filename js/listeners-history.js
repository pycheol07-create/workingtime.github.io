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
    openHistoryRecordManager, // 기록 관리 모달 열기
    renderHistoryRecordsTable   // 테이블 리렌더링
} from './app-history-logic.js';

import {
    downloadHistoryAsExcel,
    downloadPeriodHistoryAsExcel,
    downloadWeeklyHistoryAsExcel, // ✅ [신규] 주간 업무 다운로드
    downloadMonthlyHistoryAsExcel, // ✅ [신규] 월간 업무 다운로드
    downloadAttendanceExcel       // ✅ [신규] 근태 다운로드 (통합)
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
    
    // ✅ [신규] 업무 이력 엑셀 다운로드 버튼 (상단 탭)
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

    // ✅ [신규] 근태 이력 엑셀 다운로드 버튼 (상단 탭)
    if (DOM.attendanceDownloadExcelBtn) {
        DOM.attendanceDownloadExcelBtn.addEventListener('click', () => {
            const activeTabBtn = DOM.attendanceHistoryTabs.querySelector('button.font-semibold');
            // 뷰 모드 추출 (attendance-daily -> daily)
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

    // ✅ [신규] 근태 이력 뷰 컨테이너 이벤트 위임 (정렬 & 필터)
    if (DOM.attendanceHistoryViewContainer) {
        // 1. 클릭 이벤트 (정렬 헤더, 버튼 등)
        DOM.attendanceHistoryViewContainer.addEventListener('click', (e) => {
            // 정렬 헤더 클릭
            const header = e.target.closest('.sortable-attendance-header');
            if (header) {
                const sortKey = header.dataset.sortKey;
                const viewType = header.dataset.viewType; // 'daily', 'weekly', 'monthly'

                if (sortKey && viewType) {
                    const currentSort = State.context.attendanceSortState[viewType] || { key: 'member', dir: 'asc' };
                    let newDir = 'asc';
                    if (currentSort.key === sortKey) {
                        newDir = currentSort.dir === 'asc' ? 'desc' : 'asc';
                    }
                    State.context.attendanceSortState[viewType] = { key: sortKey, dir: newDir };

                    const selectedBtn = document.querySelector('.history-date-btn.bg-blue-100');
                    if (selectedBtn) {
                        const key = selectedBtn.dataset.key;
                        if (viewType === 'daily') renderAttendanceDailyHistory(key, State.allHistoryData);
                        else if (viewType === 'weekly') renderAttendanceWeeklyHistory(key, State.allHistoryData);
                        else if (viewType === 'monthly') renderAttendanceMonthlyHistory(key, State.allHistoryData);
                    }
                }
                return;
            }

            // 기존 버튼 로직 (수정, 삭제, 추가)
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
                const isTimeBased = (record.type === '외출' || record.type === '조퇴');
                const isDateBased = (record.type === '연차' || record.type === '출장' || record.type === '결근');
                const isOuting = (record.type === '외출');

                if (DOM.editAttendanceTimeFields) {
                    DOM.editAttendanceTimeFields.classList.toggle('hidden', !isTimeBased);
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
                const isTimeBased = (firstType === '외출' || firstType === '조퇴');
                const isDateBased = (firstType === '연차' || firstType === '출장' || firstType === '결근');
                const isOuting = (firstType === '외출');
                if (DOM.addAttendanceTimeFields) DOM.addAttendanceTimeFields.classList.toggle('hidden', !isTimeBased);
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

        // 2. 입력/변경 이벤트 (필터링)
        const restoreFocus = (id, cursorIndex) => {
            const el = document.getElementById(id);
            if (el) {
                el.focus();
                if (typeof cursorIndex === 'number') {
                    el.setSelectionRange(cursorIndex, cursorIndex);
                } else {
                     // 맨 뒤로 이동
                    const len = el.value.length;
                    el.setSelectionRange(len, len);
                }
            }
        };

        DOM.attendanceHistoryViewContainer.addEventListener('input', (e) => {
            const target = e.target;
            let viewType = null;
            let filterType = null;

            if (target.id === 'att-daily-filter-member') { viewType = 'daily'; filterType = 'member'; }
            else if (target.id === 'att-weekly-filter-member') { viewType = 'weekly'; filterType = 'member'; }
            else if (target.id === 'att-monthly-filter-member') { viewType = 'monthly'; filterType = 'member'; }

            if (viewType) {
                // 상태 업데이트
                State.context.attendanceFilterState[viewType][filterType] = target.value;
                
                // 현재 커서 위치 저장
                const cursorIndex = target.selectionStart;
                const elementId = target.id;

                const selectedBtn = document.querySelector('.history-date-btn.bg-blue-100');
                if (selectedBtn) {
                    const key = selectedBtn.dataset.key;
                    if (viewType === 'daily') renderAttendanceDailyHistory(key, State.allHistoryData);
                    else if (viewType === 'weekly') renderAttendanceWeeklyHistory(key, State.allHistoryData);
                    else if (viewType === 'monthly') renderAttendanceMonthlyHistory(key, State.allHistoryData);
                    
                    // 렌더링 후 포커스 복원
                    requestAnimationFrame(() => restoreFocus(elementId, cursorIndex));
                }
            }
        });

        DOM.attendanceHistoryViewContainer.addEventListener('change', (e) => {
            const target = e.target;
            if (target.id === 'att-daily-filter-type') {
                State.context.attendanceFilterState.daily.type = target.value;
                const selectedBtn = document.querySelector('.history-date-btn.bg-blue-100');
                if (selectedBtn) {
                    renderAttendanceDailyHistory(selectedBtn.dataset.key, State.allHistoryData);
                }
            }
        });
    }

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
            
            const isTimeBased = (newType === '외출' || newType === '조퇴');
            const isOuting = (newType === '외출');
            
            const updatedRecord = { ...dayData.onLeaveMembers[index], type: newType };
            
            if (isTimeBased) {
                updatedRecord.startTime = DOM.editAttendanceStartTimeInput?.value || null;
                if (isOuting) {
                    updatedRecord.endTime = DOM.editAttendanceEndTimeInput?.value || null;
                } else {
                    updatedRecord.endTime = null; 
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
            
            const isTimeBased = (type === '외출' || type === '조퇴');
            const isOuting = (type === '외출');
            
            const newRecord = { member: memberName, type: type };
            if (isTimeBased) {
                newRecord.startTime = DOM.addAttendanceStartTimeInput?.value || null;
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
                dayData.onLeaveMembers.pop(); 
                if (isNewDay) { 
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
            const newType = e.target.value;
            const isTimeBased = (newType === '외출' || newType === '조퇴');
            const isOuting = (newType === '외출');

            if (DOM.addAttendanceTimeFields) DOM.addAttendanceTimeFields.classList.toggle('hidden', !isTimeBased);
            
            const endTimeWrapper = document.getElementById('add-attendance-end-time-wrapper');
            if (endTimeWrapper) {
                endTimeWrapper.classList.toggle('hidden', !isOuting);
            }

            if (DOM.addAttendanceDateFields) DOM.addAttendanceDateFields.classList.toggle('hidden', isTimeBased);
        });
    }
    if (DOM.editAttendanceTypeSelect) {
        DOM.editAttendanceTypeSelect.addEventListener('change', (e) => {
            const newType = e.target.value;
            const isTimeBased = (newType === '외출' || newType === '조퇴');
            const isOuting = (newType === '외출');

            if (DOM.editAttendanceTimeFields) DOM.editAttendanceTimeFields.classList.toggle('hidden', !isTimeBased);
            
            const endTimeWrapper = document.getElementById('edit-attendance-end-time-wrapper');
            if (endTimeWrapper) {
                endTimeWrapper.classList.toggle('hidden', !isOuting);
            }

            if (DOM.editAttendanceDateFields) DOM.editAttendanceDateFields.classList.toggle('hidden', isTimeBased);
        });
    }

    // ✅ [신규] 필터 변경 리스너 (이름, 업무)
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

    // ✅ [신규] 일괄 적용 버튼 리스너
    const batchApplyBtn = document.getElementById('history-batch-apply-btn');
    if (batchApplyBtn) {
        batchApplyBtn.addEventListener('click', async () => {
            const dateKey = document.getElementById('history-records-date').textContent;
            const taskFilterVal = taskFilter ? taskFilter.value : '';
            
            const newStart = document.getElementById('history-batch-start-time').value;
            const newEnd = document.getElementById('history-batch-end-time').value;

            if (!taskFilterVal) {
                showToast('업무를 선택한 상태에서만 일괄 수정이 가능합니다.', true);
                return;
            }
            if (!newStart && !newEnd) {
                showToast('수정할 시작 또는 종료 시간을 입력해주세요.', true);
                return;
            }
            if (newStart && newEnd && newStart >= newEnd) {
                showToast('시작 시간이 종료 시간보다 빨라야 합니다.', true);
                return;
            }

            if (!confirm(`선택된 업무(${taskFilterVal})의 모든 기록을 일괄 수정하시겠습니까?`)) return;

            try {
                let records = [];
                const todayKey = new Date().toISOString().slice(0, 10);

                if (dateKey === todayKey) {
                    const data = State.allHistoryData.find(d => d.id === dateKey);
                    records = data ? data.workRecords : [];
                } else {
                    const data = State.allHistoryData.find(d => d.id === dateKey);
                    records = data ? data.workRecords : [];
                }
                
                const targets = records.filter(r => r.task === taskFilterVal);
                if (targets.length === 0) {
                    showToast('수정할 대상이 없습니다.', true);
                    return;
                }

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

    // ✅ [신규] 이력 기록 관리 모달: '기록 추가' 버튼 클릭 시
    if (DOM.historyRecordAddBtn) {
        DOM.historyRecordAddBtn.addEventListener('click', () => {
            const dateKey = document.getElementById('history-records-date').textContent;
            if (!dateKey) {
                showToast('날짜 정보를 찾을 수 없습니다.', true);
                return;
            }
            
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

    // ✅ [신규] '기록 추가' 모달 내 '추가' 버튼 클릭 시
    if (DOM.confirmHistoryAddBtn) {
        DOM.confirmHistoryAddBtn.addEventListener('click', async () => {
             const dateKey = document.getElementById('history-records-date').textContent;
             const member = DOM.historyAddMemberInput.value.trim();
             const task = DOM.historyAddTaskInput.value.trim();
             const startTime = DOM.historyAddStartTimeInput.value;
             const endTime = DOM.historyAddEndTimeInput.value;

             if (!member || !task || !startTime || !endTime) {
                 showToast('모든 필드를 입력해주세요.', true);
                 return;
             }
             if (startTime >= endTime) {
                 showToast('종료 시간은 시작 시간보다 늦어야 합니다.', true);
                 return;
             }

             try {
                 const newRecord = {
                     id: `manual-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                     member,
                     task,
                     startTime,
                     endTime,
                     status: 'completed', 
                     pauses: []
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

    // ✅ [신규] 기록 관리 모달 내부 버튼 리스너 (개별 저장/삭제)
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

                if (!newTask || !newStart || !newEnd) {
                    showToast('모든 필드를 입력해주세요.', true);
                    return;
                }
                if (newStart >= newEnd) {
                    showToast('시작 시간이 종료 시간보다 빨라야 합니다.', true);
                    return;
                }

                try {
                    await updateHistoryWorkRecord(dateKey, recordId, {
                        task: newTask,
                        startTime: newStart,
                        endTime: newEnd
                    });
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
            
            contentBox.style.width = `${rect.width}px`;
            contentBox.style.height = `${rect.height}px`;

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