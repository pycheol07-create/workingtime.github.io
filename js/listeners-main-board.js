// === js/listeners-main-board.js ===
// 설명: 메인 화면의 '실시간 현황판'(업무 카드, 팀원 현황) 관련 리스너를 담당합니다.

import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { render } from './app.js';
import { showToast, formatTimeTo24H } from './utils.js';
import { renderTeamSelectionModalContent, renderLeaveTypeModalOptions } from './ui.js';
import {
    stopWorkIndividual, pauseWorkGroup, resumeWorkGroup,
    pauseWorkIndividual, resumeWorkIndividual,
    processClockIn, processClockOut, cancelClockOut,
    startWorkGroup,
    addMembersToWorkGroup,
} from './app-logic.js';

// (listeners-main.js -> listeners-main-board.js)
// 근태 설정 모달 열기 헬퍼 함수
const openLeaveModal = (memberName) => {
    if (DOM.leaveMemberNameSpan) DOM.leaveMemberNameSpan.textContent = memberName;
    State.context.memberToSetLeave = memberName;
    renderLeaveTypeModalOptions(State.LEAVE_TYPES);
    if (DOM.leaveTypeModal) DOM.leaveTypeModal.classList.remove('hidden');
};

// (listeners-main.js -> listeners-main-board.js)
// 관리자 액션 모달 열기 헬퍼 함수
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


export function setupMainBoardListeners() {

    // (listeners-main.js -> listeners-main-board.js)
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
    
    // (listeners-main.js -> listeners-main-board.js)
    // 관리자 액션 모달 내부 버튼 리스너
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
}