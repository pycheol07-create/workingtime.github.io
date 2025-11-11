// === js/listeners-main.js ===
import {
    appState, appConfig, db, auth,
    persistentLeaveSchedule,
    context,
    LEAVE_TYPES,

    teamStatusBoard, workLogBody,
    deleteConfirmModal,
    endShiftBtn, endShiftConfirmTitle, endShiftConfirmMessage, endShiftConfirmModal,
    saveProgressBtn,
    editRecordModal,
    taskSelectModal,
    stopIndividualConfirmModal, stopIndividualConfirmMessage,
    teamSelectModal,
    editStartTimeModal, editStartTimeModalTitle, editStartTimeModalMessage,
    editStartTimeInput, editStartTimeContextIdInput, editStartTimeContextTypeInput,
    leaveTypeModal, leaveMemberNameSpan,
    cancelLeaveConfirmModal, cancelLeaveConfirmMessage,
    toggleCompletedLog, toggleAnalysis, toggleSummary,
    menuToggleBtn, menuDropdown,
    openQuantityModalTodayBtn, openQuantityModalTodayBtnMobile,
    hamburgerBtn, navContent,
    analysisMemberSelect,
    openManualAddBtn, manualAddRecordModal,

    stopGroupConfirmModal,

    render,
    // ⛔️ [삭제] 더 이상 존재하지 않는 함수 import 제거
    // debouncedSaveState,
    generateId,

    loginModal, loginForm, loginEmailInput, loginPasswordInput, loginSubmitBtn,
    loginErrorMsg, loginButtonText, loginButtonSpinner, logoutBtn, logoutBtnMobile,

    pcClockOutCancelBtn, mobileClockOutCancelBtn,
    memberActionModal, actionMemberName, actionMemberStatusBadge, actionMemberTimeInfo,
    adminClockInBtn, adminClockOutBtn, adminCancelClockOutBtn, openLeaveModalBtn,

    updateDailyData

} from './app.js';

import { showToast, getCurrentTime, formatTimeTo24H } from './utils.js';

import {
    renderTeamSelectionModalContent,
    renderLeaveTypeModalOptions,
    renderPersonalAnalysis,
    renderQuantityModalInputs,
    renderManualAddModalDatalists
} from './ui.js';

import {
    pauseWorkGroup, resumeWorkGroup,
    pauseWorkIndividual, resumeWorkIndividual,
    processClockIn, processClockOut, cancelClockOut,
    startWorkGroup,
    addMembersToWorkGroup,
} from './app-logic.js';

import {
    saveProgress,
    checkMissingQuantities
} from './app-history-logic.js';

import { signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// 근태 설정 모달 열기 헬퍼 함수
const openLeaveModal = (memberName) => {
    if (leaveMemberNameSpan) leaveMemberNameSpan.textContent = memberName;
    context.memberToSetLeave = memberName;
    renderLeaveTypeModalOptions(LEAVE_TYPES);
    if (leaveTypeModal) leaveTypeModal.classList.remove('hidden');
};

// 관리자 액션 모달 열기 헬퍼 함수
const openAdminMemberActionModal = (memberName) => {
    context.memberToAction = memberName;
    if (actionMemberName) actionMemberName.textContent = memberName;

    const ongoingRecord = (appState.workRecords || []).find(r => r.member === memberName && r.status === 'ongoing');
    const pausedRecord = (appState.workRecords || []).find(r => r.member === memberName && r.status === 'paused');
    const attendance = appState.dailyAttendance?.[memberName];
    const status = attendance?.status || 'none';

    // 상태 배지 & 시간 정보 업데이트
    if (actionMemberStatusBadge && actionMemberTimeInfo) {
         if (ongoingRecord) {
            actionMemberStatusBadge.textContent = `업무 중 (${ongoingRecord.task})`;
            actionMemberStatusBadge.className = 'inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-red-100 text-red-800';
            actionMemberTimeInfo.textContent = `출근: ${formatTimeTo24H(attendance?.inTime)} | 업무시작: ${formatTimeTo24H(ongoingRecord.startTime)}`;
        } else if (pausedRecord) {
            actionMemberStatusBadge.textContent = '휴식 중';
            actionMemberStatusBadge.className = 'inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-yellow-100 text-yellow-800';
            actionMemberTimeInfo.textContent = `출근: ${formatTimeTo24H(attendance?.inTime)}`;
        } else if (status === 'active') {
            actionMemberStatusBadge.textContent = '대기 중';
            actionMemberStatusBadge.className = 'inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-green-100 text-green-800';
            actionMemberTimeInfo.textContent = `출근: ${formatTimeTo24H(attendance.inTime)}`;
        } else if (status === 'returned') {
            actionMemberStatusBadge.textContent = '퇴근 완료';
            actionMemberStatusBadge.className = 'inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-gray-100 text-gray-600';
            actionMemberTimeInfo.textContent = `출근: ${formatTimeTo24H(attendance.inTime)} / 퇴근: ${formatTimeTo24H(attendance.outTime)}`;
        } else {
            actionMemberStatusBadge.textContent = '출근 전';
            actionMemberStatusBadge.className = 'inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-gray-100 text-gray-400';
            actionMemberTimeInfo.textContent = '';
        }
    }

    // 버튼 표시 여부 제어
    if (adminClockInBtn) adminClockInBtn.classList.toggle('hidden', status === 'active' || status === 'returned');
    if (adminClockOutBtn) adminClockOutBtn.classList.toggle('hidden', status !== 'active');
    if (adminCancelClockOutBtn) adminCancelClockOutBtn.classList.toggle('hidden', status !== 'returned');

    if (memberActionModal) memberActionModal.classList.remove('hidden');
};

export function setupMainScreenListeners() {

    // 선택/미선택 상태 클래스 정의
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
            const currentUser = appState.currentUser;
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
            const currentUser = appState.currentUser;
            if (!currentUser) return;
            if (e.target.checked) {
                processClockIn(currentUser);
            } else {
                 const success = processClockOut(currentUser);
                if (!success) e.target.checked = true;
            }
        });
    }

    if (pcClockOutCancelBtn) {
        pcClockOutCancelBtn.addEventListener('click', () => {
            const currentUser = appState.currentUser;
            if (currentUser) cancelClockOut(currentUser);
        });
    }

    if (mobileClockOutCancelBtn) {
        mobileClockOutCancelBtn.addEventListener('click', () => {
            const currentUser = appState.currentUser;
            if (currentUser) cancelClockOut(currentUser);
        });
    }

    if (teamStatusBoard) {
        teamStatusBoard.addEventListener('click', (e) => {

            const toggleMobileBtn = e.target.closest('#toggle-all-tasks-mobile');
            if (toggleMobileBtn) {
                e.stopPropagation();
                context.isMobileTaskViewExpanded = !context.isMobileTaskViewExpanded;
                render();
                return;
            }

            const toggleMemberBtn = e.target.closest('#toggle-all-members-mobile');
            if (toggleMemberBtn) {
                e.stopPropagation();
                context.isMobileMemberViewExpanded = !context.isMobileMemberViewExpanded;
                render();
                return;
            }

            const stopGroupButton = e.target.closest('.stop-work-group-btn');
            if (stopGroupButton) {
                context.groupToStopId = stopGroupButton.dataset.groupId;
                if (stopGroupConfirmModal) {
                    stopGroupConfirmModal.classList.remove('hidden');
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
                context.recordToStopId = individualStopBtn.dataset.recordId;
                const record = (appState.workRecords || []).find(r => String(r.id) === String(context.recordToStopId));
                if (stopIndividualConfirmMessage && record) {
                    stopIndividualConfirmMessage.textContent = `${record.member}님의 '${record.task}' 업무를 종료하시겠습니까?`;
                }
                if (stopIndividualConfirmModal) stopIndividualConfirmModal.classList.remove('hidden');
                return;
            }

            const groupTimeDisplay = e.target.closest('.group-time-display[data-action="edit-group-start-time"]');
            if (groupTimeDisplay) {
                const groupId = groupTimeDisplay.dataset.groupId;
                const currentStartTime = groupTimeDisplay.dataset.currentStartTime;
                if (!groupId || !currentStartTime) return;

                context.recordIdOrGroupIdToEdit = groupId;
                context.editType = 'group';

                if (editStartTimeModalTitle) editStartTimeModalTitle.textContent = '그룹 시작 시간 변경';
                if (editStartTimeModalMessage) editStartTimeModalMessage.textContent = '이 그룹의 모든 팀원의 시작 시간이 변경됩니다.';
                if (editStartTimeInput) editStartTimeInput.value = currentStartTime;
                if (editStartTimeContextIdInput) editStartTimeContextIdInput.value = groupId;
                if (editStartTimeContextTypeInput) editStartTimeContextTypeInput.value = 'group';

                if (editStartTimeModal) editStartTimeModal.classList.remove('hidden');
                return;
            }

            const individualEditTimeBtn = e.target.closest('button[data-action="edit-individual-start-time"]');
            if (individualEditTimeBtn) {
                const recordId = individualEditTimeBtn.dataset.recordId;
                const currentStartTime = individualEditTimeBtn.dataset.currentStartTime;
                const record = (appState.workRecords || []).find(r => String(r.id) === String(recordId));
                if (!record) return;

                context.recordIdOrGroupIdToEdit = recordId;
                context.editType = 'individual';

                if (editStartTimeModalTitle) editStartTimeModalTitle.textContent = '개별 시작 시간 변경';
                if (editStartTimeModalMessage) editStartTimeModalMessage.textContent = `${record.member}님의 시작 시간을 변경합니다.`;
                if (editStartTimeInput) editStartTimeInput.value = currentStartTime;
                if (editStartTimeContextIdInput) editStartTimeContextIdInput.value = recordId;
                if (editStartTimeContextTypeInput) editStartTimeContextTypeInput.value = 'individual';

                if (editStartTimeModal) editStartTimeModal.classList.remove('hidden');
                return;
            }

            const editLeaveCard = e.target.closest('[data-action="edit-leave-record"]');
            if (editLeaveCard) {
                const memberName = editLeaveCard.dataset.memberName;
                const currentType = editLeaveCard.dataset.leaveType;

                const role = appState.currentUserRole || 'user';
                const selfName = appState.currentUser || null;
                if (role !== 'admin' && memberName !== selfName) {
                    showToast('본인의 근태 기록만 수정할 수 있습니다.', true);
                    return;
                }

                if (currentType === '외출') {
                    context.memberToCancelLeave = memberName;
                    if (cancelLeaveConfirmMessage) {
                        cancelLeaveConfirmMessage.textContent = `${memberName}님을 '${currentType}' 상태에서 복귀(취소) 처리하시겠습니까?`;
                    }
                    if (cancelLeaveConfirmModal) {
                        cancelLeaveConfirmModal.classList.remove('hidden');
                    }
                    return;
                }
                showToast('연차/출장 등의 수정은 이력 보기 메뉴를 이용해주세요.', false);
                return;
            }

            const memberCard = e.target.closest('[data-action="member-toggle-leave"]');
            if (memberCard) {
                const memberName = memberCard.dataset.memberName;
                const role = appState.currentUserRole || 'user';
                const selfName = appState.currentUser || null;

                if (role !== 'admin' && memberName !== selfName) {
                    showToast('본인의 근태 현황만 설정할 수 있습니다.', true); return;
                }

                if (role === 'admin' && memberName !== selfName) {
                     openAdminMemberActionModal(memberName);
                     return;
                }

                const isWorking = (appState.workRecords || []).some(r => r.member === memberName && (r.status === 'ongoing' || r.status === 'paused'));
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
                    context.selectedTaskForStart = task;
                    context.selectedGroupForAdd = null;
                    context.tempSelectedMembers = [];
                    renderTeamSelectionModalContent(task, appState, appConfig.teamGroups);
                    const titleEl = document.getElementById('team-select-modal-title');
                    if (titleEl) titleEl.textContent = `'${task}' 업무 시작`;
                    if (teamSelectModal) teamSelectModal.classList.remove('hidden');
                    return;

                } else if (action === 'other') {
                    if (taskSelectModal) taskSelectModal.classList.remove('hidden');
                    return;

                } else if (groupId && task) {
                    context.selectedTaskForStart = task;
                    context.selectedGroupForAdd = groupId;
                    context.tempSelectedMembers = [];
                    renderTeamSelectionModalContent(task, appState, appConfig.teamGroups);
                    const titleEl = document.getElementById('team-select-modal-title');
                    if (titleEl) titleEl.textContent = `'${task}' 인원 추가`;
                    if (teamSelectModal) teamSelectModal.classList.remove('hidden');
                    return;
                }
            }

        });
    }

    if (workLogBody) {
        workLogBody.addEventListener('click', (e) => {
            const deleteBtn = e.target.closest('button[data-action="delete"]');
            if (deleteBtn) {
                context.recordToDeleteId = deleteBtn.dataset.recordId;
                context.deleteMode = 'single';
                const msgEl = document.getElementById('delete-confirm-message');
                if (msgEl) msgEl.textContent = '이 업무 기록을 삭제하시겠습니까?';
                if (deleteConfirmModal) deleteConfirmModal.classList.remove('hidden');
                return;
            }
            const editBtn = e.target.closest('button[data-action="edit"]');
            if (editBtn) {
                context.recordToEditId = editBtn.dataset.recordId;
                const record = (appState.workRecords || []).find(r => String(r.id) === String(context.recordToEditId));
                if (record) {
                    document.getElementById('edit-member-name').value = record.member;
                    document.getElementById('edit-start-time').value = record.startTime || '';
                    document.getElementById('edit-end-time').value = record.endTime || '';

                    const taskSelect = document.getElementById('edit-task-type');
                    taskSelect.innerHTML = '';

                    const allTasks = (appConfig.taskGroups || []).flatMap(group => group.tasks);

                    allTasks.forEach(task => {
                        const option = document.createElement('option');
                        option.value = task;
                        option.textContent = task;
                        if (task === record.task) option.selected = true;
                        taskSelect.appendChild(option);
                    });

                    if (editRecordModal) editRecordModal.classList.remove('hidden');
                }
                return;
            }
        });
    }

    if (endShiftBtn) {
        endShiftBtn.addEventListener('click', () => {
            const ongoingRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused');

            if (ongoingRecords.length > 0) {
                const ongoingTaskNames = new Set(ongoingRecords.map(r => r.task));
                const ongoingTaskCount = ongoingTaskNames.size;
                if (endShiftConfirmTitle) endShiftConfirmTitle.textContent = `진행 중인 업무 ${ongoingTaskCount}종`;
                if (endShiftConfirmMessage) endShiftConfirmMessage.textContent = `총 ${ongoingRecords.length}명이 참여 중인 ${ongoingTaskCount}종의 업무가 있습니다. 모두 종료하고 마감하시겠습니까?`;
                if (endShiftConfirmModal) endShiftConfirmModal.classList.remove('hidden');
            } else {
                saveDayDataToHistory(true);
            }
        });
    }

    if (saveProgressBtn) {
        saveProgressBtn.addEventListener('click', () => saveProgress(false));
    }

    if (openManualAddBtn) {
        openManualAddBtn.addEventListener('click', () => {
            document.getElementById('manual-add-start-time').value = getCurrentTime();
            document.getElementById('manual-add-end-time').value = '';
            renderManualAddModalDatalists(appState, appConfig);
            if (manualAddRecordModal) manualAddRecordModal.classList.remove('hidden');
        });
    }

    [toggleCompletedLog, toggleAnalysis, toggleSummary].forEach(toggle => {
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

    if (hamburgerBtn && navContent) {
        hamburgerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            navContent.classList.toggle('hidden');
        });
        navContent.addEventListener('click', (e) => {
            if (window.innerWidth < 768 && e.target.closest('a, button')) {
                navContent.classList.add('hidden');
            }
        });
    }

    if (menuToggleBtn) {
        menuToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (menuDropdown) menuDropdown.classList.toggle('hidden');
        });
    }

    document.addEventListener('click', (e) => {
        if (navContent && hamburgerBtn) {
            const isClickInsideNav = navContent.contains(e.target);
            const isClickOnHamburger = hamburgerBtn.contains(e.target);
            if (!navContent.classList.contains('hidden') && !isClickInsideNav && !isClickOnHamburger) {
                navContent.classList.add('hidden');
            }
        }
        if (menuDropdown && menuToggleBtn) {
            const isClickInsideMenu = menuDropdown.contains(e.target);
            const isClickOnMenuBtn = menuToggleBtn.contains(e.target);
            if (!menuDropdown.classList.contains('hidden') && !isClickInsideMenu && !isClickOnMenuBtn) {
                menuDropdown.classList.add('hidden');
            }
        }
    });

    if (openQuantityModalTodayBtn) {
        openQuantityModalTodayBtn.addEventListener('click', () => {
            if (!auth || !auth.currentUser) {
                showToast('로그인이 필요합니다.', true);
                if (loginModal) loginModal.classList.remove('hidden');
                return;
            }

            const quantityModal = document.getElementById('quantity-modal');

            const todayData = {
                workRecords: appState.workRecords || [],
                taskQuantities: appState.taskQuantities || {},
                confirmedZeroTasks: appState.confirmedZeroTasks || []
            };
            const missingTasksList = checkMissingQuantities(todayData);

            renderQuantityModalInputs(appState.taskQuantities || {}, appConfig.quantityTaskTypes || [], missingTasksList, appState.confirmedZeroTasks || []);

            const title = document.getElementById('quantity-modal-title');
            if (title) title.textContent = '오늘의 처리량 입력';

            context.quantityModalContext.mode = 'today';
            context.quantityModalContext.dateKey = null;

            context.quantityModalContext.onConfirm = async (newQuantities, confirmedZeroTasks) => {
                appState.taskQuantities = newQuantities;
                appState.confirmedZeroTasks = confirmedZeroTasks;
                
                await updateDailyData({
                    taskQuantities: newQuantities,
                    confirmedZeroTasks: confirmedZeroTasks
                });

                showToast('오늘의 처리량이 저장되었습니다.');
            };

            context.quantityModalContext.onCancel = () => {};

            const quantityModalEl = document.getElementById('quantity-modal');
            if (quantityModalEl) quantityModalEl.classList.remove('hidden');
            if (menuDropdown) menuDropdown.classList.add('hidden');
        });
    }

    if (openQuantityModalTodayBtnMobile) {
        openQuantityModalTodayBtnMobile.addEventListener('click', () => {
            if (!auth || !auth.currentUser) {
                showToast('로그인이 필요합니다.', true);
                if (loginModal) loginModal.classList.remove('hidden');
                return;
            }

            const quantityModal = document.getElementById('quantity-modal');

            const todayData = {
                workRecords: appState.workRecords || [],
                taskQuantities: appState.taskQuantities || {},
                confirmedZeroTasks: appState.confirmedZeroTasks || []
            };
            const missingTasksList = checkMissingQuantities(todayData);

            renderQuantityModalInputs(appState.taskQuantities || {}, appConfig.quantityTaskTypes || [], missingTasksList, appState.confirmedZeroTasks || []);

            const title = document.getElementById('quantity-modal-title');
            if (title) title.textContent = '오늘의 처리량 입력';

            context.quantityModalContext.mode = 'today';
            context.quantityModalContext.dateKey = null;

            context.quantityModalContext.onConfirm = async (newQuantities, confirmedZeroTasks) => {
                appState.taskQuantities = newQuantities;
                appState.confirmedZeroTasks = confirmedZeroTasks;

                await updateDailyData({
                    taskQuantities: newQuantities,
                    confirmedZeroTasks: confirmedZeroTasks
                });
                
                showToast('오늘의 처리량이 저장되었습니다.');
            };

            context.quantityModalContext.onCancel = () => {};

            const quantityModalEl = document.getElementById('quantity-modal');
            if (quantityModalEl) quantityModalEl.classList.remove('hidden');
            if (navContent) navContent.classList.add('hidden');
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

    if (analysisMemberSelect) {
        analysisMemberSelect.addEventListener('change', (e) => {
            const selectedMember = e.target.value;
            renderPersonalAnalysis(selectedMember, appState);
        });
    }

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (loginSubmitBtn) loginSubmitBtn.disabled = true;
            if (loginButtonText) loginButtonText.classList.add('hidden');
            if (loginButtonSpinner) loginButtonSpinner.classList.remove('hidden');
            if (loginErrorMsg) loginErrorMsg.classList.add('hidden');

            const email = loginEmailInput.value;
            const password = loginPasswordInput.value;

            try {
                await signInWithEmailAndPassword(auth, email, password);
                if (loginPasswordInput) loginPasswordInput.value = '';
            } catch (error) {
                console.error('Login error:', error.code, error.message);
                if (loginErrorMsg) {
                    if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found') {
                        loginErrorMsg.textContent = '이메일 또는 비밀번호가 잘못되었습니다.';
                    } else {
                        loginErrorMsg.textContent = `로그인 오류: ${error.code}`;
                    }
                    loginErrorMsg.classList.remove('hidden');
                }
            } finally {
                if (loginSubmitBtn) loginSubmitBtn.disabled = false;
                if (loginButtonText) loginButtonText.classList.remove('hidden');
                if (loginButtonSpinner) loginButtonSpinner.classList.add('hidden');
            }
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                await signOut(auth);
            } catch (error) {
                console.error('Logout error:', error);
                showToast('로그아웃 중 오류가 발생했습니다.', true);
            }
        });
    }

    if (logoutBtnMobile) {
        logoutBtnMobile.addEventListener('click', async () => {
            try {
                await signOut(auth);
            } catch (error) {
                console.error('Logout error:', error);
                showToast('로그아웃 중 오류가 발생했습니다.', true);
            }
        });
    }

    if (adminClockInBtn) {
        adminClockInBtn.addEventListener('click', () => {
            if (context.memberToAction) {
                processClockIn(context.memberToAction, true);
                if (memberActionModal) memberActionModal.classList.add('hidden');
            }
        });
    }
    if (adminClockOutBtn) {
        adminClockOutBtn.addEventListener('click', () => {
             if (context.memberToAction) {
                processClockOut(context.memberToAction, true);
                if (memberActionModal) memberActionModal.classList.add('hidden');
            }
        });
    }
    if (adminCancelClockOutBtn) {
        adminCancelClockOutBtn.addEventListener('click', () => {
             if (context.memberToAction) {
                cancelClockOut(context.memberToAction, true);
                if (memberActionModal) memberActionModal.classList.add('hidden');
            }
        });
    }
    if (openLeaveModalBtn) {
        openLeaveModalBtn.addEventListener('click', () => {
            if (context.memberToAction) {
                if (memberActionModal) memberActionModal.classList.add('hidden');
                setTimeout(() => openLeaveModal(context.memberToAction), 100);
            }
        });
    }

    if (teamSelectModal) {
        teamSelectModal.addEventListener('click', async (e) => {
            const target = e.target;
            const memberButton = target.closest('.member-select-btn');
            if (memberButton && !memberButton.disabled) {
                const memberName = memberButton.dataset.memberName;
                const isCurrentlySelected = memberButton.classList.contains('bg-blue-600');

                if (!isCurrentlySelected) {
                    selectMemberBtn(memberButton);
                    if (!context.tempSelectedMembers.includes(memberName)) {
                        context.tempSelectedMembers.push(memberName);
                    }
                } else {
                    deselectMemberBtn(memberButton);
                    context.tempSelectedMembers = context.tempSelectedMembers.filter(m => m !== memberName);
                }
            }

            const selectAllBtn = target.closest('.group-select-all-btn');
            if (selectAllBtn) {
                const groupName = selectAllBtn.dataset.groupName;
                const memberListDiv = teamSelectModal.querySelector(`.space-y-2[data-group-name="${groupName}"]`);
                if (memberListDiv) {
                    const availableButtons = Array.from(memberListDiv.querySelectorAll('.member-select-btn:not(:disabled)'));
                    const allSelected = availableButtons.length > 0 && availableButtons.every(btn => btn.classList.contains('bg-blue-600'));

                    availableButtons.forEach(btn => {
                        const memberName = btn.dataset.memberName;
                        if (allSelected) {
                            deselectMemberBtn(btn);
                            context.tempSelectedMembers = context.tempSelectedMembers.filter(m => m !== memberName);
                        } else {
                             if (!btn.classList.contains('bg-blue-600')) {
                                selectMemberBtn(btn);
                                if (!context.tempSelectedMembers.includes(memberName)) {
                                    context.tempSelectedMembers.push(memberName);
                                }
                            }
                        }
                    });
                }
            }
        });

        const confirmTeamSelectBtn = document.getElementById('confirm-team-select-btn');
        if (confirmTeamSelectBtn) {
             confirmTeamSelectBtn.addEventListener('click', async (e) => {
                if (context.tempSelectedMembers.length === 0) {
                    showToast('최소 1명 이상의 팀원을 선택해주세요.', true);
                    return;
                }

                const btn = e.currentTarget;
                btn.disabled = true;
                btn.textContent = '처리 중...';

                try {
                    if (context.selectedGroupForAdd) {
                        await addMembersToWorkGroup(context.tempSelectedMembers, context.selectedTaskForStart, context.selectedGroupForAdd);
                    } else {
                        await startWorkGroup(context.tempSelectedMembers, context.selectedTaskForStart);
                    }
                    teamSelectModal.classList.add('hidden');
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