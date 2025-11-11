// === js/listeners-main.js ===

// ✅ [신규] DOM 요소와 상태 변수를 분리된 파일에서 가져옵니다.
import * as DOM from './dom-elements.js';
import * as State from './state.js';

// ✅ [수정] app.js에서는 유틸리티 함수 및 로직 함수만 가져옵니다.
import {
    // appState, appConfig, db, auth, ... (State로 이동)
    // persistentLeaveSchedule, allHistoryData, context, LEAVE_TYPES, (State로 이동)
    // teamStatusBoard, workLogBody, ... (DOM으로 이동)

    render, debouncedSaveState,
    generateId,
    markDataAsDirty,

    // ✅ [신규] updateDailyData 임포트
    updateDailyData

} from './app.js';

import { calcElapsedMinutes, showToast, getTodayDateString, getCurrentTime, formatTimeTo24H } from './utils.js';

import {
    getAllDashboardDefinitions,
    renderTeamSelectionModalContent,
    renderLeaveTypeModalOptions,
    renderPersonalAnalysis,
    renderQuantityModalInputs,
    renderManualAddModalDatalists
} from './ui.js';

import {
    stopWorkIndividual, pauseWorkGroup, resumeWorkGroup,
    pauseWorkIndividual, resumeWorkIndividual,
    processClockIn, processClockOut, cancelClockOut,
    startWorkGroup,
    addMembersToWorkGroup,
} from './app-logic.js';

import {
    saveProgress, saveDayDataToHistory,
    checkMissingQuantities
} from './app-history-logic.js';

import { signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, runTransaction, updateDoc, collection, query, where, getDocs, writeBatch, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ✅ [신규] 근태 설정 모달 열기 헬퍼 함수
const openLeaveModal = (memberName) => {
    if (DOM.leaveMemberNameSpan) DOM.leaveMemberNameSpan.textContent = memberName;
    State.context.memberToSetLeave = memberName;
    renderLeaveTypeModalOptions(State.LEAVE_TYPES);
    if (DOM.leaveTypeModal) DOM.leaveTypeModal.classList.remove('hidden');
};

// ✅ [신규] 관리자 액션 모달 열기 헬퍼 함수
const openAdminMemberActionModal = (memberName) => {
    State.context.memberToAction = memberName;
    if (DOM.actionMemberName) DOM.actionMemberName.textContent = memberName;

    const ongoingRecord = (State.appState.workRecords || []).find(r => r.member === memberName && r.status === 'ongoing');
    const pausedRecord = (State.appState.workRecords || []).find(r => r.member === memberName && r.status === 'paused');
    const attendance = State.appState.dailyAttendance?.[memberName];
    const status = attendance?.status || 'none';

    // 상태 배지 & 시간 정보 업데이트
    if (DOM.actionMemberStatusBadge && DOM.actionMemberTimeInfo) {
         if (ongoingRecord) {
            DOM.actionMemberStatusBadge.textContent = `업무 중 (${ongoingRecord.task})`;
            DOM.actionMemberStatusBadge.className = 'inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-red-100 text-red-800';
            DOM.actionMemberTimeInfo.textContent = `출근: ${formatTimeTo24H(attendance?.inTime)} | 업무시작: ${formatTimeTo24H(ongoingRecord.startTime)}`;
        } else if (pausedRecord) {
            DOM.actionMemberStatusBadge.textContent = '휴식 중';
            DOM.actionMemberStatusBadge.className = 'inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-yellow-100 text-yellow-800';
            DOM.actionMemberTimeInfo.textContent = `출근: ${formatTimeTo24H(attendance?.inTime)}`;
        } else if (status === 'active') {
            DOM.actionMemberStatusBadge.textContent = '대기 중';
            DOM.actionMemberStatusBadge.className = 'inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-green-100 text-green-800';
            DOM.actionMemberTimeInfo.textContent = `출근: ${formatTimeTo24H(attendance.inTime)}`;
        } else if (status === 'returned') {
            DOM.actionMemberStatusBadge.textContent = '퇴근 완료';
            DOM.actionMemberStatusBadge.className = 'inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-gray-100 text-gray-600';
            DOM.actionMemberTimeInfo.textContent = `출근: ${formatTimeTo24H(attendance.inTime)} / 퇴근: ${formatTimeTo24H(attendance.outTime)}`;
        } else {
            DOM.actionMemberStatusBadge.textContent = '출근 전';
            DOM.actionMemberStatusBadge.className = 'inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-gray-100 text-gray-400';
            DOM.actionMemberTimeInfo.textContent = '';
        }
    }

    // 버튼 표시 여부 제어
    if (DOM.adminClockInBtn) DOM.adminClockInBtn.classList.toggle('hidden', status === 'active' || status === 'returned');
    if (DOM.adminClockOutBtn) DOM.adminClockOutBtn.classList.toggle('hidden', status !== 'active');
    if (DOM.adminCancelClockOutBtn) DOM.adminCancelClockOutBtn.classList.toggle('hidden', status !== 'returned');

    if (DOM.memberActionModal) DOM.memberActionModal.classList.remove('hidden');
};

export function setupMainScreenListeners() {

    // 🔥 [핵심] 선택/미선택 상태 클래스 정의
    const SELECTED_CLASSES = ['bg-blue-600', 'border-blue-600', 'text-white', 'hover:bg-blue-700'];
    const UNSELECTED_CLASSES = ['bg-white', 'border-gray-300', 'text-gray-900', 'hover:bg-blue-50', 'hover:border-blue-300'];

    // 헬퍼: 버튼을 선택 상태로 만듦
    const selectMemberBtn = (btn) => {
        btn.classList.remove(...UNSELECTED_CLASSES);
        btn.classList.add(...SELECTED_CLASSES);
    };
    // 헬퍼: 버튼을 선택 해제 상태로 만듦
    const deselectMemberBtn = (btn) => {
        btn.classList.remove(...SELECTED_CLASSES);
        btn.classList.add(...UNSELECTED_CLASSES);
    };


    const pcAttendanceCheckbox = document.getElementById('pc-attendance-checkbox');
    if (pcAttendanceCheckbox) {
        pcAttendanceCheckbox.addEventListener('change', (e) => {
            const currentUser = State.appState.currentUser;
            if (!currentUser) return;
            if (e.target.checked) {
                processClockIn(currentUser);
            } else {
                const success = processClockOut(currentUser);
                if (!success) e.target.checked = true;
            }
        });
    }

    const mobileAttendanceCheckbox = document.getElementById('mobile-attendance-checkbox');
    if (mobileAttendanceCheckbox) {
        mobileAttendanceCheckbox.addEventListener('change', (e) => {
            const currentUser = State.appState.currentUser;
            if (!currentUser) return;
            if (e.target.checked) {
                processClockIn(currentUser);
            } else {
                 const success = processClockOut(currentUser);
                if (!success) e.target.checked = true;
            }
        });
    }

    if (DOM.pcClockOutCancelBtn) {
        DOM.pcClockOutCancelBtn.addEventListener('click', () => {
            const currentUser = State.appState.currentUser;
            if (currentUser) cancelClockOut(currentUser);
        });
    }

    if (DOM.mobileClockOutCancelBtn) {
        DOM.mobileClockOutCancelBtn.addEventListener('click', () => {
            const currentUser = State.appState.currentUser;
            if (currentUser) cancelClockOut(currentUser);
        });
    }

    if (DOM.teamStatusBoard) {
        DOM.teamStatusBoard.addEventListener('click', (e) => {

            const toggleMobileBtn = e.target.closest('#toggle-all-tasks-mobile');
            if (toggleMobileBtn) {
                e.stopPropagation();
                State.context.isMobileTaskViewExpanded = !State.context.isMobileTaskViewExpanded;
                render();
                return;
            }

            const toggleMemberBtn = e.target.closest('#toggle-all-members-mobile');
            if (toggleMemberBtn) {
                e.stopPropagation();
                State.context.isMobileMemberViewExpanded = !State.context.isMobileMemberViewExpanded;
                render();
                return;
            }

            const stopGroupButton = e.target.closest('.stop-work-group-btn');
            if (stopGroupButton) {
                State.context.groupToStopId = stopGroupButton.dataset.groupId;
                if (DOM.stopGroupConfirmModal) {
                    DOM.stopGroupConfirmModal.classList.remove('hidden');
                }
                return;
            }
            const pauseGroupButton = e.target.closest('.pause-work-group-btn');
            if (pauseGroupButton) {
                pauseWorkGroup(pauseGroupButton.dataset.groupId);
                return;
            }
            const resumeGroupButton = e.target.closest('.resume-work-group-btn');
            if (resumeGroupButton) {
                resumeWorkGroup(resumeGroupButton.dataset.groupId);
                return;
            }
            const individualPauseBtn = e.target.closest('[data-action="pause-individual"]');
            if (individualPauseBtn) {
                pauseWorkIndividual(individualPauseBtn.dataset.recordId);
                return;
            }
            const individualResumeBtn = e.target.closest('[data-action="resume-individual"]');
            if (individualResumeBtn) {
                resumeWorkIndividual(individualResumeBtn.dataset.recordId);
                return;
            }
            const individualStopBtn = e.target.closest('button[data-action="stop-individual"]');
            if (individualStopBtn) {
                State.context.recordToStopId = individualStopBtn.dataset.recordId;
                const record = (State.appState.workRecords || []).find(r => String(r.id) === String(State.context.recordToStopId));
                if (DOM.stopIndividualConfirmMessage && record) {
                    DOM.stopIndividualConfirmMessage.textContent = `${record.member}님의 '${record.task}' 업무를 종료하시겠습니까?`;
                }
                if (DOM.stopIndividualConfirmModal) DOM.stopIndividualConfirmModal.classList.remove('hidden');
                return;
            }

            const groupTimeDisplay = e.target.closest('.group-time-display[data-action="edit-group-start-time"]');
            if (groupTimeDisplay) {
                const groupId = groupTimeDisplay.dataset.groupId;
                const currentStartTime = groupTimeDisplay.dataset.currentStartTime;
                if (!groupId || !currentStartTime) return;

                State.context.recordIdOrGroupIdToEdit = groupId;
                State.context.editType = 'group';

                if (DOM.editStartTimeModalTitle) DOM.editStartTimeModalTitle.textContent = '그룹 시작 시간 변경';
                if (DOM.editStartTimeModalMessage) DOM.editStartTimeModalMessage.textContent = '이 그룹의 모든 팀원의 시작 시간이 변경됩니다.';
                if (DOM.editStartTimeInput) DOM.editStartTimeInput.value = currentStartTime;
                if (DOM.editStartTimeContextIdInput) DOM.editStartTimeContextIdInput.value = groupId;
                if (DOM.editStartTimeContextTypeInput) DOM.editStartTimeContextTypeInput.value = 'group';

                if (DOM.editStartTimeModal) DOM.editStartTimeModal.classList.remove('hidden');
                return;
            }

            const individualEditTimeBtn = e.target.closest('button[data-action="edit-individual-start-time"]');
            if (individualEditTimeBtn) {
                const recordId = individualEditTimeBtn.dataset.recordId;
                const currentStartTime = individualEditTimeBtn.dataset.currentStartTime;
                const record = (State.appState.workRecords || []).find(r => String(r.id) === String(recordId));
                if (!record) return;

                State.context.recordIdOrGroupIdToEdit = recordId;
                State.context.editType = 'individual';

                if (DOM.editStartTimeModalTitle) DOM.editStartTimeModalTitle.textContent = '개별 시작 시간 변경';
                if (DOM.editStartTimeModalMessage) DOM.editStartTimeModalMessage.textContent = `${record.member}님의 시작 시간을 변경합니다.`;
                if (DOM.editStartTimeInput) DOM.editStartTimeInput.value = currentStartTime;
                if (DOM.editStartTimeContextIdInput) DOM.editStartTimeContextIdInput.value = recordId;
                if (DOM.editStartTimeContextTypeInput) DOM.editStartTimeContextTypeInput.value = 'individual';

                if (DOM.editStartTimeModal) DOM.editStartTimeModal.classList.remove('hidden');
                return;
            }

            const editLeaveCard = e.target.closest('[data-action="edit-leave-record"]');
            if (editLeaveCard) {
                const memberName = editLeaveCard.dataset.memberName;
                const currentType = editLeaveCard.dataset.leaveType;
                const currentStartTime = editLeaveCard.dataset.startTime;
                const currentStartDate = editLeaveCard.dataset.startDate;
                const currentEndTime = editLeaveCard.dataset.endTime;
                const currentEndDate = editLeaveCard.dataset.endDate;

                const role = State.appState.currentUserRole || 'user';
                const selfName = State.appState.currentUser || null;
                if (role !== 'admin' && memberName !== selfName) {
                    showToast('본인의 근태 기록만 수정할 수 있습니다.', true);
                    return;
                }

                if (currentType === '외출') {
                    State.context.memberToCancelLeave = memberName;
                    if (DOM.cancelLeaveConfirmMessage) {
                        DOM.cancelLeaveConfirmMessage.textContent = `${memberName}님을 '${currentType}' 상태에서 복귀(취소) 처리하시겠습니까?`;
                    }
                    if (DOM.cancelLeaveConfirmModal) {
                        DOM.cancelLeaveConfirmModal.classList.remove('hidden');
                    }
                    return;
                }

                const modal = document.getElementById('edit-leave-record-modal');
                const titleEl = document.getElementById('edit-leave-modal-title');
                const nameEl = document.getElementById('edit-leave-member-name');
                const typeSelect = document.getElementById('edit-leave-type');
                const timeFields = document.getElementById('edit-leave-time-fields');
                const dateFields = document.getElementById('edit-leave-date-fields');
                const startTimeInput = document.getElementById('edit-leave-start-time');
                const endTimeInput = document.getElementById('edit-leave-end-time');
                const startDateInput = document.getElementById('edit-leave-start-date');
                const endDateInput = document.getElementById('edit-leave-end-date');
                const originalNameInput = document.getElementById('edit-leave-original-member-name');
                const originalStartInput = document.getElementById('edit-leave-original-start-identifier');
                const originalTypeInput = document.getElementById('edit-leave-original-type');

                if (!modal || !typeSelect) return;

                titleEl.textContent = `${memberName}님 근태 수정`;
                nameEl.textContent = memberName;

                typeSelect.innerHTML = '';
                State.LEAVE_TYPES.forEach(type => {
                    const option = document.createElement('option');
                    option.value = type;
                    option.textContent = type;
                    if (type === currentType) {
                        option.selected = true;
                    }
                    typeSelect.appendChild(option);
                });

                const isTimeBased = (currentType === '외출' || currentType === '조퇴');

                timeFields.classList.toggle('hidden', !isTimeBased);
                dateFields.classList.toggle('hidden', isTimeBased);

                if (isTimeBased) {
                    startTimeInput.value = currentStartTime || '';
                    endTimeInput.value = currentEndTime || '';
                } else {
                    startDateInput.value = currentStartDate || '';
                    endDateInput.value = currentEndDate || '';
                }

                originalNameInput.value = memberName;
                originalStartInput.value = isTimeBased ? currentStartTime : currentStartDate;
                originalTypeInput.value = isTimeBased ? 'daily' : 'persistent';

                modal.classList.remove('hidden');
                return;
            }

            const memberCard = e.target.closest('[data-action="member-toggle-leave"]');
            if (memberCard) {
                const memberName = memberCard.dataset.memberName;
                const role = State.appState.currentUserRole || 'user';
                const selfName = State.appState.currentUser || null;

                if (role !== 'admin' && memberName !== selfName) {
                    showToast('본인의 근태 현황만 설정할 수 있습니다.', true); return;
                }

                // ✅ 관리자일 경우 관리자 전용 모달 열기
                if (role === 'admin' && memberName !== selfName) {
                     openAdminMemberActionModal(memberName);
                     return;
                }

                const isWorking = (State.appState.workRecords || []).some(r => r.member === memberName && (r.status === 'ongoing' || r.status === 'paused'));
                if (isWorking) {
                    return showToast(`${memberName}님은 현재 업무 중이므로 근태 상태를 변경할 수 없습니다.`, true);
                }

                openLeaveModal(memberName);
                return;
            }

            if (e.target.closest('.members-list, .card-actions, .group-time-display')) {
                e.stopPropagation();
                return;
            }

            const card = e.target.closest('div[data-group-id], div[data-action]');

            if (card) {
                const action = card.dataset.action;
                const groupId = card.dataset.groupId;
                const task = card.dataset.task;

                if (action === 'start-task') {
                    State.context.selectedTaskForStart = task;
                    State.context.selectedGroupForAdd = null;
                    State.context.tempSelectedMembers = [];
                    renderTeamSelectionModalContent(task, State.appState, State.appConfig.teamGroups);
                    const titleEl = document.getElementById('team-select-modal-title');
                    if (titleEl) titleEl.textContent = `'${task}' 업무 시작`;
                    if (DOM.teamSelectModal) DOM.teamSelectModal.classList.remove('hidden');
                    return;

                } else if (action === 'other') {
                    if (DOM.taskSelectModal) DOM.taskSelectModal.classList.remove('hidden');
                    return;

                } else if (groupId && task) {
                    State.context.selectedTaskForStart = task;
                    State.context.selectedGroupForAdd = groupId;
                    State.context.tempSelectedMembers = [];
                    renderTeamSelectionModalContent(task, State.appState, State.appConfig.teamGroups);
                    const titleEl = document.getElementById('team-select-modal-title');
                    if (titleEl) titleEl.textContent = `'${task}' 인원 추가`;
                    if (DOM.teamSelectModal) DOM.teamSelectModal.classList.remove('hidden');
                    return;
                }
            }

        });
    }

    if (DOM.workLogBody) {
        DOM.workLogBody.addEventListener('click', (e) => {
            const deleteBtn = e.target.closest('button[data-action="delete"]');
            if (deleteBtn) {
                State.context.recordToDeleteId = deleteBtn.dataset.recordId;
                State.context.deleteMode = 'single';
                const msgEl = document.getElementById('delete-confirm-message');
                if (msgEl) msgEl.textContent = '이 업무 기록을 삭제하시겠습니까?';
                if (DOM.deleteConfirmModal) DOM.deleteConfirmModal.classList.remove('hidden');
                return;
            }
            const editBtn = e.target.closest('button[data-action="edit"]');
            if (editBtn) {
                State.context.recordToEditId = editBtn.dataset.recordId;
                const record = (State.appState.workRecords || []).find(r => String(r.id) === String(State.context.recordToEditId));
                if (record) {
                    document.getElementById('edit-member-name').value = record.member;
                    document.getElementById('edit-start-time').value = record.startTime || '';
                    document.getElementById('edit-end-time').value = record.endTime || '';

                    const taskSelect = document.getElementById('edit-task-type');
                    taskSelect.innerHTML = '';

                    const allTasks = (State.appConfig.taskGroups || []).flatMap(group => group.tasks);

                    allTasks.forEach(task => {
                        const option = document.createElement('option');
                        option.value = task;
                        option.textContent = task;
                        if (task === record.task) option.selected = true;
                        taskSelect.appendChild(option);
                    });

                    if (DOM.editRecordModal) DOM.editRecordModal.classList.remove('hidden');
                }
                return;
            }
        });
    }

    if (DOM.endShiftBtn) {
        DOM.endShiftBtn.addEventListener('click', () => {
            const ongoingRecords = (State.appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused');

            if (ongoingRecords.length > 0) {
                const ongoingTaskNames = new Set(ongoingRecords.map(r => r.task));
                const ongoingTaskCount = ongoingTaskNames.size;
                if (DOM.endShiftConfirmTitle) DOM.endShiftConfirmTitle.textContent = `진행 중인 업무 ${ongoingTaskCount}종`;
                if (DOM.endShiftConfirmMessage) DOM.endShiftConfirmMessage.textContent = `총 ${ongoingRecords.length}명이 참여 중인 ${ongoingTaskCount}종의 업무가 있습니다. 모두 종료하고 마감하시겠습니까?`;
                if (DOM.endShiftConfirmModal) DOM.endShiftConfirmModal.classList.remove('hidden');
            } else {
                saveDayDataToHistory(true);
            }
        });
    }

    if (DOM.saveProgressBtn) {
        DOM.saveProgressBtn.addEventListener('click', () => saveProgress(false));
    }

    if (DOM.openManualAddBtn) {
        DOM.openManualAddBtn.addEventListener('click', () => {
            document.getElementById('manual-add-start-time').value = getCurrentTime();
            document.getElementById('manual-add-end-time').value = '';
            renderManualAddModalDatalists(State.appState, State.appConfig);
            if (DOM.manualAddRecordModal) DOM.manualAddRecordModal.classList.remove('hidden');
        });
    }

    [DOM.toggleCompletedLog, DOM.toggleAnalysis, DOM.toggleSummary].forEach(toggle => {
        if (!toggle) return;
        toggle.addEventListener('click', () => {
            if (window.innerWidth >= 768) return;
            const content = toggle.nextElementSibling;
            const arrow = toggle.querySelector('svg');
            if (!content) return;
            content.classList.toggle('hidden');
            if (arrow) arrow.classList.toggle('rotate-180');
        });
    });

    if (DOM.hamburgerBtn && DOM.navContent) {
        DOM.hamburgerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            DOM.navContent.classList.toggle('hidden');
        });
        DOM.navContent.addEventListener('click', (e) => {
            if (window.innerWidth < 768 && e.target.closest('a, button')) {
                DOM.navContent.classList.add('hidden');
            }
        });
    }

    if (DOM.menuToggleBtn) {
        DOM.menuToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (DOM.menuDropdown) DOM.menuDropdown.classList.toggle('hidden');
        });
    }

    document.addEventListener('click', (e) => {
        if (DOM.navContent && DOM.hamburgerBtn) {
            const isClickInsideNav = DOM.navContent.contains(e.target);
            const isClickOnHamburger = DOM.hamburgerBtn.contains(e.target);
            if (!DOM.navContent.classList.contains('hidden') && !isClickInsideNav && !isClickOnHamburger) {
                DOM.navContent.classList.add('hidden');
            }
        }
        if (DOM.menuDropdown && DOM.menuToggleBtn) {
            const isClickInsideMenu = DOM.menuDropdown.contains(e.target);
            const isClickOnMenuBtn = DOM.menuToggleBtn.contains(e.target);
            if (!DOM.menuDropdown.classList.contains('hidden') && !isClickInsideMenu && !isClickOnMenuBtn) {
                DOM.menuDropdown.classList.add('hidden');
            }
        }
    });

    if (DOM.openQuantityModalTodayBtn) {
        DOM.openQuantityModalTodayBtn.addEventListener('click', () => {
            if (!State.auth || !State.auth.currentUser) {
                showToast('로그인이 필요합니다.', true);
                if (DOM.loginModal) DOM.loginModal.classList.remove('hidden');
                return;
            }

            const quantityModal = document.getElementById('quantity-modal');

            const todayData = {
                workRecords: State.appState.workRecords || [],
                taskQuantities: State.appState.taskQuantities || {},
                confirmedZeroTasks: State.appState.confirmedZeroTasks || []
            };
            const missingTasksList = checkMissingQuantities(todayData);

            renderQuantityModalInputs(State.appState.taskQuantities || {}, State.appConfig.quantityTaskTypes || [], missingTasksList, State.appState.confirmedZeroTasks || []);

            const title = document.getElementById('quantity-modal-title');
            if (title) title.textContent = '오늘의 처리량 입력';

            State.context.quantityModalContext.mode = 'today';
            State.context.quantityModalContext.dateKey = null;

            State.context.quantityModalContext.onConfirm = async (newQuantities, confirmedZeroTasks) => {
                // 로컬 상태 즉시 업데이트 (UX 반응성)
                State.appState.taskQuantities = newQuantities;
                State.appState.confirmedZeroTasks = confirmedZeroTasks;
                
                // ✅ [핵심 수정] 서버 원자적 업데이트 (updateDailyData 사용)
                await updateDailyData({
                    taskQuantities: newQuantities,
                    confirmedZeroTasks: confirmedZeroTasks
                });

                showToast('오늘의 처리량이 저장되었습니다.');
                // ⛔️ render(); // onSnapshot이 처리하므로 제거
            };

            State.context.quantityModalContext.onCancel = () => {};

            const quantityModalEl = document.getElementById('quantity-modal');
            if (quantityModalEl) quantityModalEl.classList.remove('hidden');
            if (DOM.menuDropdown) DOM.menuDropdown.classList.add('hidden');
        });
    }

    if (DOM.openQuantityModalTodayBtnMobile) {
        DOM.openQuantityModalTodayBtnMobile.addEventListener('click', () => {
            if (!State.auth || !State.auth.currentUser) {
                showToast('로그인이 필요합니다.', true);
                if (DOM.loginModal) DOM.loginModal.classList.remove('hidden');
                return;
            }

            const quantityModal = document.getElementById('quantity-modal');

            const todayData = {
                workRecords: State.appState.workRecords || [],
                taskQuantities: State.appState.taskQuantities || {},
                confirmedZeroTasks: State.appState.confirmedZeroTasks || []
            };
            const missingTasksList = checkMissingQuantities(todayData);

            renderQuantityModalInputs(State.appState.taskQuantities || {}, State.appConfig.quantityTaskTypes || [], missingTasksList, State.appState.confirmedZeroTasks || []);

            const title = document.getElementById('quantity-modal-title');
            if (title) title.textContent = '오늘의 처리량 입력';

            State.context.quantityModalContext.mode = 'today';
            State.context.quantityModalContext.dateKey = null;

            State.context.quantityModalContext.onConfirm = async (newQuantities, confirmedZeroTasks) => {
                State.appState.taskQuantities = newQuantities;
                State.appState.confirmedZeroTasks = confirmedZeroTasks;

                // ✅ [핵심 수정] 모바일도 동일하게 updateDailyData 적용
                await updateDailyData({
                    taskQuantities: newQuantities,
                    confirmedZeroTasks: confirmedZeroTasks
                });
                
                showToast('오늘의 처리량이 저장되었습니다.');
            };

            State.context.quantityModalContext.onCancel = () => {};

            const quantityModalEl = document.getElementById('quantity-modal');
            if (quantityModalEl) quantityModalEl.classList.remove('hidden');
            if (DOM.navContent) DOM.navContent.classList.add('hidden');
        });
    }

    const analysisTabs = document.getElementById('analysis-tabs');
    if (analysisTabs) {
        analysisTabs.addEventListener('click', (e) => {
            const button = e.target.closest('.analysis-tab-btn');
            if (!button) return;
            const panelId = button.dataset.tabPanel;
            if (!panelId) return;

            analysisTabs.querySelectorAll('.analysis-tab-btn').forEach(btn => {
                btn.classList.remove('text-blue-600', 'border-blue-600');
                btn.classList.add('text-gray-500', 'border-transparent', 'hover:text-gray-700', 'hover:border-gray-300');
            });
            button.classList.add('text-blue-600', 'border-blue-600');
            button.classList.remove('text-gray-500', 'border-transparent', 'hover:text-gray-700', 'hover:border-gray-300');

            document.querySelectorAll('.analysis-tab-panel').forEach(panel => {
                panel.classList.add('hidden');
            });
            const panelToShow = document.getElementById(panelId);
            if (panelToShow) {
                panelToShow.classList.remove('hidden');
            }
        });
    }

    if (DOM.analysisMemberSelect) {
        DOM.analysisMemberSelect.addEventListener('change', (e) => {
            const selectedMember = e.target.value;
            renderPersonalAnalysis(selectedMember, State.appState);
        });
    }

    if (DOM.loginForm) {
        DOM.loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (DOM.loginSubmitBtn) DOM.loginSubmitBtn.disabled = true;
            if (DOM.loginButtonText) DOM.loginButtonText.classList.add('hidden');
            if (DOM.loginButtonSpinner) DOM.loginButtonSpinner.classList.remove('hidden');
            if (DOM.loginErrorMsg) DOM.loginErrorMsg.classList.add('hidden');

            const email = DOM.loginEmailInput.value;
            const password = DOM.loginPasswordInput.value;

            try {
                await signInWithEmailAndPassword(State.auth, email, password);
                if (DOM.loginPasswordInput) DOM.loginPasswordInput.value = '';
            } catch (error) {
                console.error('Login error:', error.code, error.message);
                if (DOM.loginErrorMsg) {
                    if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found') {
                        DOM.loginErrorMsg.textContent = '이메일 또는 비밀번호가 잘못되었습니다.';
                    } else {
                        DOM.loginErrorMsg.textContent = `로그인 오류: ${error.code}`;
                    }
                    DOM.loginErrorMsg.classList.remove('hidden');
                }
            } finally {
                if (DOM.loginSubmitBtn) DOM.loginSubmitBtn.disabled = false;
                if (DOM.loginButtonText) DOM.loginButtonText.classList.remove('hidden');
                if (DOM.loginButtonSpinner) DOM.loginButtonSpinner.classList.add('hidden');
            }
        });
    }

    if (DOM.logoutBtn) {
        DOM.logoutBtn.addEventListener('click', async () => {
            try {
                await signOut(State.auth);
            } catch (error) {
                console.error('Logout error:', error);
                showToast('로그아웃 중 오류가 발생했습니다.', true);
            }
        });
    }

    if (DOM.logoutBtnMobile) {
        DOM.logoutBtnMobile.addEventListener('click', async () => {
            try {
                await signOut(State.auth);
            } catch (error) {
                console.error('Logout error:', error);
                showToast('로그아웃 중 오류가 발생했습니다.', true);
            }
        });
    }

    if (DOM.adminClockInBtn) {
        DOM.adminClockInBtn.addEventListener('click', () => {
            if (State.context.memberToAction) {
                processClockIn(State.context.memberToAction, true);
                if (DOM.memberActionModal) DOM.memberActionModal.classList.add('hidden');
            }
        });
    }
    if (DOM.adminClockOutBtn) {
        DOM.adminClockOutBtn.addEventListener('click', () => {
             if (State.context.memberToAction) {
                processClockOut(State.context.memberToAction, true);
                if (DOM.memberActionModal) DOM.memberActionModal.classList.add('hidden');
            }
        });
    }
    if (DOM.adminCancelClockOutBtn) {
        DOM.adminCancelClockOutBtn.addEventListener('click', () => {
             if (State.context.memberToAction) {
                cancelClockOut(State.context.memberToAction, true);
                if (DOM.memberActionModal) DOM.memberActionModal.classList.add('hidden');
            }
        });
    }
    if (DOM.openLeaveModalBtn) {
        DOM.openLeaveModalBtn.addEventListener('click', () => {
            if (State.context.memberToAction) {
                if (DOM.memberActionModal) DOM.memberActionModal.classList.add('hidden');
                setTimeout(() => openLeaveModal(State.context.memberToAction), 100);
            }
        });
    }

    // ✅ 팀 선택 모달 리스너
    if (DOM.teamSelectModal) {
        DOM.teamSelectModal.addEventListener('click', async (e) => {
            const target = e.target;

            // 1. 개별 멤버 버튼 클릭
            const memberButton = target.closest('.member-select-btn');
            if (memberButton && !memberButton.disabled) {
                const memberName = memberButton.dataset.memberName;
                const isCurrentlySelected = memberButton.classList.contains('bg-blue-600');

                if (!isCurrentlySelected) {
                    selectMemberBtn(memberButton);
                    if (!State.context.tempSelectedMembers.includes(memberName)) {
                        State.context.tempSelectedMembers.push(memberName);
                    }
                } else {
                    deselectMemberBtn(memberButton);
                    State.context.tempSelectedMembers = State.context.tempSelectedMembers.filter(m => m !== memberName);
                }
            }

            // 2. 전체 선택/해제 버튼 클릭
            const selectAllBtn = target.closest('.group-select-all-btn');
            if (selectAllBtn) {
                const groupName = selectAllBtn.dataset.groupName;
                const memberListDiv = DOM.teamSelectModal.querySelector(`.space-y-2[data-group-name="${groupName}"]`);
                if (memberListDiv) {
                    const availableButtons = Array.from(memberListDiv.querySelectorAll('.member-select-btn:not(:disabled)'));
                    const allSelected = availableButtons.length > 0 && availableButtons.every(btn => btn.classList.contains('bg-blue-600'));

                    availableButtons.forEach(btn => {
                        const memberName = btn.dataset.memberName;
                        if (allSelected) {
                            deselectMemberBtn(btn);
                            State.context.tempSelectedMembers = State.context.tempSelectedMembers.filter(m => m !== memberName);
                        } else {
                             if (!btn.classList.contains('bg-blue-600')) {
                                selectMemberBtn(btn);
                                if (!State.context.tempSelectedMembers.includes(memberName)) {
                                    State.context.tempSelectedMembers.push(memberName);
                                }
                            }
                        }
                    });
                }
            }

            // 3. 알바 수정 버튼 클릭 핸들러 (✏️ 아이콘)
            const editPartTimerBtn = target.closest('.edit-part-timer-btn');
            if (editPartTimerBtn) {
                const partTimerId = editPartTimerBtn.dataset.partTimerId;
                const partTimer = (State.appState.partTimers || []).find(p => p.id === partTimerId);
                if (partTimer) {
                    document.querySelector('#edit-part-timer-modal h2').textContent = '알바 이름 수정';
                    document.getElementById('part-timer-edit-id').value = partTimer.id;
                    document.getElementById('part-timer-new-name').value = partTimer.name;
                    document.getElementById('edit-part-timer-modal').classList.remove('hidden');
                    setTimeout(() => document.getElementById('part-timer-new-name').focus(), 50);
                }
                return;
            }

            // ✨ [수정] 알바 삭제 버튼 클릭 핸들러 (🗑️ 아이콘) - 즉시 삭제
            const deletePartTimerBtn = target.closest('.delete-part-timer-btn');
            if (deletePartTimerBtn) {
                const partTimerId = deletePartTimerBtn.dataset.partTimerId;
                const partTimer = (State.appState.partTimers || []).find(p => p.id === partTimerId);

                if (partTimer) {
                    // 1. 로컬 상태에서 알바 제거
                    State.appState.partTimers = State.appState.partTimers.filter(p => p.id !== partTimerId);
                    
                    // 2. 금일 출근 기록이 있다면 함께 제거 (정리)
                    if (State.appState.dailyAttendance && State.appState.dailyAttendance[partTimer.name]) {
                        delete State.appState.dailyAttendance[partTimer.name];
                    }

                    debouncedSaveState();
                    renderTeamSelectionModalContent(State.context.selectedTaskForStart, State.appState, State.appConfig.teamGroups);
                    showToast(`${partTimer.name}님이 삭제되었습니다.`);
                }
                return;
            }

            // ✨ [수정] 알바 추가 버튼 핸들러: 즉시 자동 추가 및 출근 처리
             if (target.closest('#add-part-timer-modal-btn')) {
                if (!State.appState.partTimers) State.appState.partTimers = [];

                // 1. 중복되지 않는 '알바N' 이름 찾기
                const existingNames = new Set(State.appState.partTimers.map(p => p.name));
                let nextNum = 1;
                while (existingNames.has(`알바${nextNum}`)) {
                    nextNum++;
                }
                const newName = `알바${nextNum}`;

                // 2. 새 알바 객체 생성
                const newPartTimer = {
                    id: generateId(),
                    name: newName,
                    wage: State.appConfig.defaultPartTimerWage || 10000
                };

                // 3. 상태 추가 (알바 정보 + 즉시 출근 처리)
                if (!State.appState.dailyAttendance) State.appState.dailyAttendance = {};
                State.appState.dailyAttendance[newName] = {
                    inTime: getCurrentTime(),
                    outTime: null,
                    status: 'active'
                };
                State.appState.partTimers.push(newPartTimer);
                
                debouncedSaveState();

                // 4. 모달 컨텐츠 리렌더링
                renderTeamSelectionModalContent(State.context.selectedTaskForStart, State.appState, State.appConfig.teamGroups);
                showToast(`'${newName}'이(가) 추가되고 출근 처리되었습니다.`);
                return;
            }
        });

        // 확인 버튼 (업무 시작) - ✨ 중복 클릭 방지 로직 추가
        const confirmTeamSelectBtn = document.getElementById('confirm-team-select-btn');
        if (confirmTeamSelectBtn) {
             confirmTeamSelectBtn.addEventListener('click', async (e) => {
                if (State.context.tempSelectedMembers.length === 0) {
                    showToast('최소 1명 이상의 팀원을 선택해주세요.', true);
                    return;
                }

                const btn = e.currentTarget;
                btn.disabled = true;
                btn.textContent = '처리 중...';

                try {
                    if (State.context.selectedGroupForAdd) {
                        await addMembersToWorkGroup(State.context.tempSelectedMembers, State.context.selectedTaskForStart, State.context.selectedGroupForAdd);
                    } else {
                        await startWorkGroup(State.context.tempSelectedMembers, State.context.selectedTaskForStart);
                    }
                    DOM.teamSelectModal.classList.add('hidden');
                } catch (error) {
                    console.error("업무 시작 중 오류:", error);
                    showToast("오류가 발생했습니다. 다시 시도해주세요.", true);
                } finally {
                    btn.disabled = false;
                    btn.textContent = '선택 완료 및 업무 시작';
                }
             });
        }
    }
}