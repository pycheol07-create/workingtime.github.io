// === app-events.js (파일 분리 수정 1안, 이벤트 리스너 담당) ===

// 1. App/Firebase 핵심 기능 임포트
import {
    db, auth,
    appState, persistentLeaveSchedule, appConfig,
    recordCounter,
    elapsedTimeTimer, autoSaveTimer,
    recordIdOrGroupIdToEdit,
    editType,
    isDataDirty,
    selectedTaskForStart,
    selectedGroupForAdd,
    recordToDeleteId,
    recordToStopId,
    historyKeyToDelete,
    allHistoryData,
    recordToEditId,
    deleteMode,
    groupToStopId,
    quantityModalContext,
    tempSelectedMembers,
    memberToSetLeave,
    memberToCancelLeave,
    activeMainHistoryTab,
    attendanceRecordToDelete,
    LEAVE_TYPES,
    // 핵심 함수
    generateId,
    updateElapsedTimes,
    render,
    markDataAsDirty,
    autoSaveProgress,
    saveStateToFirestore,
    debouncedSaveState,
    startWorkGroup,
    addMembersToWorkGroup,
    stopWorkGroup,
    finalizeStopGroup,
    stopWorkIndividual,
    pauseWorkGroup,
    resumeWorkGroup,
    pauseWorkIndividual,
    resumeWorkIndividual,
    saveProgress,
    saveDayDataToHistory,
    startAppAfterLogin,
    makeDraggable,
    // DOM 요소
    connectionStatusEl, statusDotEl, teamStatusBoard, workLogBody,
    teamSelectModal, deleteConfirmModal, confirmDeleteBtn, cancelDeleteBtn,
    historyModal, openHistoryBtn, closeHistoryBtn, historyDateList,
    historyViewContainer, historyTabs, historyMainTabs, workHistoryPanel,
    attendanceHistoryPanel, attendanceHistoryTabs, attendanceHistoryViewContainer,
    trendAnalysisPanel, historyAttendanceDailyView, historyAttendanceWeeklyView,
    historyAttendanceMonthlyView, quantityModal, confirmQuantityBtn, cancelQuantityBtn,
    deleteHistoryModal, confirmHistoryDeleteBtn, cancelHistoryDeleteBtn,
    deleteAllCompletedBtn, editRecordModal, confirmEditBtn, cancelEditBtn,
    saveProgressBtn, quantityOnStopModal, confirmQuantityOnStopBtn,
    cancelQuantityOnStopBtn, endShiftBtn, resetAppBtn, resetAppModal,
    confirmResetAppBtn, cancelResetAppBtn, taskSelectModal,
    stopIndividualConfirmModal, confirmStopIndividualBtn, cancelStopIndividualBtn,
    stopIndividualConfirmMessage, editPartTimerModal, confirmEditPartTimerBtn,
    cancelEditPartTimerBtn, partTimerNewNameInput, partTimerEditIdInput,
    cancelTeamSelectBtn, leaveTypeModal, leaveModalTitle, leaveMemberNameSpan,
    leaveTypeOptionsContainer, confirmLeaveBtn, cancelLeaveBtn, leaveDateInputsDiv,
    leaveStartDateInput, leaveEndDateInput, cancelLeaveConfirmModal,
    confirmCancelLeaveBtn, cancelCancelLeaveBtn, cancelLeaveConfirmMessage,
    toggleCompletedLog, toggleAnalysis, toggleSummary, openManualAddBtn,
    manualAddRecordModal, confirmManualAddBtn, cancelManualAddBtn, manualAddForm,
    endShiftConfirmModal, endShiftConfirmTitle, endShiftConfirmMessage,
    confirmEndShiftBtn, cancelEndShiftBtn, loginModal, loginForm, loginEmailInput,
    loginPasswordInput, loginSubmitBtn, loginErrorMsg, loginButtonText,
    loginButtonSpinner, userGreeting, logoutBtn, menuToggleBtn, menuDropdown,
    openQuantityModalTodayBtn, openQuantityModalTodayBtnMobile, adminLinkBtnMobile,
    resetAppBtnMobile, logoutBtnMobile, hamburgerBtn, navContent,
    editStartTimeModal, editStartTimeModalTitle, editStartTimeModalMessage,
    editStartTimeInput, editStartTimeContextIdInput, editStartTimeContextTypeInput,
    confirmEditStartTimeBtn, cancelEditStartTimeBtn,
    addAttendanceRecordModal, addAttendanceForm, confirmAddAttendanceBtn,
    cancelAddAttendanceBtn, addAttendanceMemberNameInput, addAttendanceMemberDatalist,
    addAttendanceTypeSelect, addAttendanceStartTimeInput, addAttendanceEndTimeInput,
    addAttendanceStartDateInput, addAttendanceEndDateInput, addAttendanceDateKeyInput,
    addAttendanceTimeFields, addAttendanceDateFields,
    editAttendanceRecordModal, confirmEditAttendanceBtn, cancelEditAttendanceBtn,
    editAttendanceMemberName, editAttendanceTypeSelect, editAttendanceStartTimeInput,
    editAttendanceEndTimeInput, editAttendanceStartDateInput, editAttendanceEndDateInput,
    editAttendanceDateKeyInput, editAttendanceRecordIndexInput,
    editAttendanceTimeFields, editAttendanceDateFields,
    editLeaveModal, typeSelect, timeFields, dateFields, confirmBtn, deleteBtn,
    cancelBtn, originalNameInput, originalStartInput, originalTypeInput
} from './app.js'; // ❗️ app.js에서 모든 것을 임포트

// 2. Firebase 기능 임포트
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, setDoc, onSnapshot, collection, getDocs, deleteDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


// 3. 유틸리티 함수 임포트
import { showToast, getTodayDateString, displayCurrentDate, getCurrentTime, formatDuration, formatTimeTo24H, getWeekOfYear, isWeekday, calcElapsedMinutes, normalizeName, debounce } from './utils.js';

// 4. UI 렌더링 함수 임포트
import {
    getAllDashboardDefinitions,
    renderRealtimeStatus,
    renderCompletedWorkLog,
    updateSummary,
    renderTaskAnalysis,
    renderPersonalAnalysis,
    renderTaskSelectionModal,
    renderTeamSelectionModalContent,
    renderQuantityModalInputs,
    renderLeaveTypeModalOptions,
    renderDashboardLayout,
    renderManualAddModalDatalists,
    renderTrendAnalysisCharts,
    trendCharts
} from './ui.js';

// 5. 이력 관리 함수 임포트
import {
    fetchAllHistoryData,
    loadAndRenderHistoryList,
    renderHistoryDateListByMode,
    renderHistoryDetail,
    switchHistoryView,
    renderAttendanceAddModalDatalists,
    fillEditAttendanceModal,
    openAddAttendanceModal,
    saveAttendanceEdit,
    saveAttendanceAdd
} from './app-history.js';

// 6. 설정/저장 함수 임포트
import { initializeFirebase, loadAppConfig, loadLeaveSchedule, saveLeaveSchedule } from './config.js';

// ❗️ [수정] export function setupDynamicEventListeners() { ... } 래퍼를 제거하고
// ❗️ 모든 이벤트 리스너를 파일의 최상위 레벨에 둡니다.

if (teamStatusBoard) {
    teamStatusBoard.addEventListener('click', (e) => {
        // 1. 모바일 토글 버튼들
        const toggleMobileBtn = e.target.closest('#toggle-all-tasks-mobile');
        if (toggleMobileBtn) {
            e.stopPropagation();
            const grid = document.getElementById('preset-task-grid');
            if (!grid) return;
            const isExpanded = grid.classList.contains('mobile-expanded');
            if (isExpanded) {
                grid.classList.remove('mobile-expanded');
                grid.querySelectorAll('.mobile-task-hidden').forEach(el => el.classList.add('hidden'));
                toggleMobileBtn.textContent = '전체보기';
            } else {
                grid.classList.add('mobile-expanded');
                grid.querySelectorAll('.mobile-task-hidden').forEach(el => el.classList.remove('hidden'));
                toggleMobileBtn.textContent = '간략히';
            }
            return;
        }
        const toggleMemberBtn = e.target.closest('#toggle-all-members-mobile');
        if (toggleMemberBtn) {
            e.stopPropagation();
            const container = document.getElementById('all-members-container');
            if (!container) return;
            const isExpanded = container.classList.contains('mobile-expanded');
            if (isExpanded) {
                container.classList.remove('mobile-expanded');
                container.querySelectorAll('.mobile-member-hidden').forEach(el => el.classList.add('hidden'));
                toggleMemberBtn.textContent = '전체보기';
            } else {
                container.classList.add('mobile-expanded');
                container.querySelectorAll('.mobile-member-hidden').forEach(el => el.classList.remove('hidden'));
                toggleMemberBtn.textContent = '간략히';
            }
            return;
        }

        // 2. 카드 내부의 액션 버튼들
        const stopGroupButton = e.target.closest('.stop-work-group-btn');
        if (stopGroupButton) {
            groupToStopId = Number(stopGroupButton.dataset.groupId);
            if (document.getElementById('stop-group-confirm-modal')) {
                document.getElementById('stop-group-confirm-modal').classList.remove('hidden');
            }
            return;
        }
        const pauseGroupButton = e.target.closest('.pause-work-group-btn');
        if (pauseGroupButton) {
            pauseWorkGroup(Number(pauseGroupButton.dataset.groupId));
            return;
        }
        const resumeGroupButton = e.target.closest('.resume-work-group-btn');
        if (resumeGroupButton) {
            resumeWorkGroup(Number(resumeGroupButton.dataset.groupId));
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
            recordToStopId = individualStopBtn.dataset.recordId;
            const record = (appState.workRecords || []).find(r => r.id === recordToStopId);
            if (stopIndividualConfirmMessage && record) {
                stopIndividualConfirmMessage.textContent = `${record.member}님의 '${record.task}' 업무를 종료하시겠습니까?`;
            }
            if (stopIndividualConfirmModal) stopIndividualConfirmModal.classList.remove('hidden');
            return;
        }
        const addMemberButton = e.target.closest('.add-member-btn[data-action="add-member"]');
        if (addMemberButton) {
            selectedTaskForStart = addMemberButton.dataset.task;
            selectedGroupForAdd = Number(addMemberButton.dataset.groupId);
            renderTeamSelectionModalContent(selectedTaskForStart, appState, appConfig.teamGroups);
            const titleEl = document.getElementById('team-select-modal-title');
            if (titleEl) titleEl.textContent = `'${selectedTaskForStart}' 인원 추가`;
            if (teamSelectModal) teamSelectModal.classList.remove('hidden');
            return;
        }

        // 3. 그룹 시작 시간 수정 영역
        const groupTimeDisplay = e.target.closest('.group-time-display[data-action="edit-group-start-time"]');
        if (groupTimeDisplay) {
            const groupId = Number(groupTimeDisplay.dataset.groupId);
            const currentStartTime = groupTimeDisplay.dataset.currentStartTime;
            if (!groupId || !currentStartTime) return;

            recordIdOrGroupIdToEdit = groupId;
            editType = 'group';

            if (editStartTimeModalTitle) editStartTimeModalTitle.textContent = '그룹 시작 시간 변경';
            if (editStartTimeModalMessage) editStartTimeModalMessage.textContent = '이 그룹의 모든 팀원의 시작 시간이 변경됩니다.';
            if (editStartTimeInput) editStartTimeInput.value = currentStartTime;
            if (editStartTimeContextIdInput) editStartTimeContextIdInput.value = groupId;
            if (editStartTimeContextTypeInput) editStartTimeContextTypeInput.value = 'group';

            if (editStartTimeModal) editStartTimeModal.classList.remove('hidden');
            return;
        }

        // 4. 개별 시작 시간 수정 (시계 아이콘 버튼)
        const individualEditTimeBtn = e.target.closest('button[data-action="edit-individual-start-time"]');
        if (individualEditTimeBtn) {
            const recordId = individualEditTimeBtn.dataset.recordId;
            const currentStartTime = individualEditTimeBtn.dataset.currentStartTime;
            const record = (appState.workRecords || []).find(r => String(r.id) === String(recordId));
            if (!record) return;

            recordIdOrGroupIdToEdit = recordId;
            editType = 'individual';

            if (editStartTimeModalTitle) editStartTimeModalTitle.textContent = '개별 시작 시간 변경';
            if (editStartTimeModalMessage) editStartTimeModalMessage.textContent = `${record.member}님의 시작 시간을 변경합니다.`;
            if (editStartTimeInput) editStartTimeInput.value = currentStartTime;
            if (editStartTimeContextIdInput) editStartTimeContextIdInput.value = recordId;
            if (editStartTimeContextTypeInput) editStartTimeContextTypeInput.value = 'individual';

            if (editStartTimeModal) editStartTimeModal.classList.remove('hidden');
            return;
        }

        // 5. 통합 근태 수정 카드 클릭
        const editLeaveCard = e.target.closest('[data-action="edit-leave-record"]');
        if (editLeaveCard) {
            const memberName = editLeaveCard.dataset.memberName;
            const currentType = editLeaveCard.dataset.leaveType;
            const currentStartTime = editLeaveCard.dataset.startTime;
            const currentStartDate = editLeaveCard.dataset.startDate;
            const currentEndTime = editLeaveCard.dataset.endTime;
            const currentEndDate = editLeaveCard.dataset.endDate;

            const role = appState.currentUserRole || 'user';
            const selfName = appState.currentUser || null;
            if (role !== 'admin' && memberName !== selfName) {
                showToast('본인의 근태 기록만 수정할 수 있습니다.', true);
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
            LEAVE_TYPES.forEach(type => {
                const option = document.createElement('option');
                option.value = type;
                option.textContent = type;
                if (type === currentType) {
                    option.selected = true;
                }
                typeSelect.appendChild(option);
            });

            const isTimeBased = (currentType === '외출' || currentType === '조퇴');
            const isDateBased = !isTimeBased;

            timeFields.classList.toggle('hidden', !isTimeBased);
            dateFields.classList.toggle('hidden', isDateBased);

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

        // 6. 근태 설정 카드 (data-action="member-toggle-leave")
        const memberCard = e.target.closest('[data-action="member-toggle-leave"]');
        if (memberCard) {
            const memberName = memberCard.dataset.memberName;
            const role = appState.currentUserRole || 'user';
            const selfName = appState.currentUser || null;

            if (role !== 'admin' && memberName !== selfName) {
                showToast('본인의 근태 현황만 설정할 수 있습니다.', true); return;
            }
            const isWorking = (appState.workRecords || []).some(r => r.member === memberName && (r.status === 'ongoing' || r.status === 'paused'));
            if (isWorking) {
                return showToast(`${memberName}님은 현재 업무 중이므로 근태 상태를 변경할 수 없습니다.`, true);
            }

            memberToSetLeave = memberName;
            if (leaveMemberNameSpan) leaveMemberNameSpan.textContent = memberName;
            renderLeaveTypeModalOptions(LEAVE_TYPES);
            if (leaveStartDateInput) leaveStartDateInput.value = getTodayDateString();
            if (leaveEndDateInput) leaveEndDateInput.value = '';
            const firstRadio = leaveTypeOptionsContainer?.querySelector('input[type="radio"]');
            if (firstRadio) {
                const initialType = firstRadio.value;
                if (leaveDateInputsDiv) leaveDateInputsDiv.classList.toggle('hidden', !(initialType === '연차' || initialType === '출장' || initialType === '결근'));
            } else if (leaveDateInputsDiv) { leaveDateInputsDiv.classList.add('hidden'); }
            if (leaveTypeModal) leaveTypeModal.classList.remove('hidden');

            return;
        }

        // 7. 업무 카드 전체 클릭 (시작 또는 기타 업무)
        const card = e.target.closest('div[data-action]');
        if (card) {
            const action = card.dataset.action;
            if (action === 'start-task' || action === 'other') {
                if (e.target.closest('a, input, select, .members-list')) {
                    return;
                }

                const task = card.dataset.task;
                if (action === 'start-task') {
                    selectedTaskForStart = task;
                    selectedGroupForAdd = null;
                    renderTeamSelectionModalContent(task, appState, appConfig.teamGroups);
                    const titleEl = document.getElementById('team-select-modal-title');
                    if (titleEl) titleEl.textContent = `'${task}' 업무 시작`;
                    if (teamSelectModal) teamSelectModal.classList.remove('hidden');
                    return;
                } else if (action === 'other') {
                    if (taskSelectModal) taskSelectModal.classList.remove('hidden');
                    return;
                }
            }
        }
    }); // teamStatusBoard 리스너 끝
} // if (teamStatusBoard) 끝

if (workLogBody) {
    workLogBody.addEventListener('click', (e) => {
        const deleteBtn = e.target.closest('button[data-action="delete"]');
        if (deleteBtn) {
            recordToDeleteId = deleteBtn.dataset.recordId;
            deleteMode = 'single';
            const msgEl = document.getElementById('delete-confirm-message');
            if (msgEl) msgEl.textContent = '이 업무 기록을 삭제하시겠습니까?';
            if (deleteConfirmModal) deleteConfirmModal.classList.remove('hidden');
            return;
        }
        const editBtn = e.target.closest('button[data-action="edit"]');
        if (editBtn) {
            recordToEditId = editBtn.dataset.recordId;
            const record = (appState.workRecords || []).find(r => String(r.id) === String(recordToEditId));
            if (record) {
                document.getElementById('edit-member-name').value = record.member;
                document.getElementById('edit-start-time').value = record.startTime || '';
                document.getElementById('edit-end-time').value = record.endTime || '';

                const taskSelect = document.getElementById('edit-task-type');
                taskSelect.innerHTML = '';
                const allTasks = [].concat(...Object.values(appConfig.taskGroups || {}));
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

if (deleteAllCompletedBtn) {
    deleteAllCompletedBtn.addEventListener('click', () => {
        deleteMode = 'all';
        const msgEl = document.getElementById('delete-confirm-message');
        if (msgEl) msgEl.textContent = '오늘 완료된 모든 업무 기록을 삭제하시겠습니까?';
        if (deleteConfirmModal) deleteConfirmModal.classList.remove('hidden');
    });
}

if (confirmDeleteBtn) {
    confirmDeleteBtn.addEventListener('click', async () => {
        let stateChanged = false;

        if (deleteMode === 'all') {
            const originalLength = appState.workRecords.length;
            appState.workRecords = (appState.workRecords || []).filter(r => r.status !== 'completed');
            if (appState.workRecords.length < originalLength) {
                stateChanged = true;
                showToast('완료된 모든 기록이 삭제되었습니다.');
            } else {
                showToast('삭제할 완료 기록이 없습니다.');
            }

        } else if (deleteMode === 'single' && recordToDeleteId) {
            const originalLength = appState.workRecords.length;
            appState.workRecords = (appState.workRecords || []).filter(r => String(r.id) !== String(recordToDeleteId));
            if (appState.workRecords.length < originalLength) {
                stateChanged = true;
                showToast('선택한 기록이 삭제되었습니다.');
            } else {
                showToast('삭제할 기록을 찾지 못했습니다.', true);
            }

        } else if (deleteMode === 'leave' && attendanceRecordToDelete) {
            const { memberName, startIdentifier, recordType } = attendanceRecordToDelete;
            let recordDeleted = false;
            let deletedRecordInfo = '';

            if (recordType === 'daily') {
                const index = appState.dailyOnLeaveMembers.findIndex(r => r.member === memberName && r.startTime === startIdentifier);
                if (index > -1) {
                    deletedRecordInfo = `${appState.dailyOnLeaveMembers[index].type}`;
                    appState.dailyOnLeaveMembers.splice(index, 1);
                    stateChanged = true;
                    recordDeleted = true;
                }
            } else { // recordType === 'persistent'
                const index = persistentLeaveSchedule.onLeaveMembers.findIndex(r => r.member === memberName && r.startDate === startIdentifier);
                if (index > -1) {
                    deletedRecordInfo = `${persistentLeaveSchedule.onLeaveMembers[index].type}`;
                    persistentLeaveSchedule.onLeaveMembers.splice(index, 1);
                    try {
                        await saveLeaveSchedule(db, persistentLeaveSchedule); // config.js
                        recordDeleted = true;
                    } catch (e) {
                        console.error('Error deleting persistent leave record:', e);
                        showToast('근태 기록 삭제 중 Firestore 저장 오류 발생.', true);
                    }
                }
            }

            if (recordDeleted) {
                showToast(`${memberName}님의 '${deletedRecordInfo}' 기록이 삭제되었습니다.`);
            } else {
                showToast('삭제할 근태 기록을 찾지 못했습니다.', true);
            }
        } else if (deleteMode === 'attendance' && attendanceRecordToDelete) { // 이력(history) 삭제
            const { dateKey, index } = attendanceRecordToDelete;
            const dayDataIndex = allHistoryData.findIndex(d => d.id === dateKey);
            if (dayDataIndex === -1) {
                showToast('이력 데이터를 찾지 못했습니다.', true);
            } else {
                const dayData = allHistoryData[dayDataIndex];
                if (dayData.onLeaveMembers && dayData.onLeaveMembers[index]) {
                    const removed = dayData.onLeaveMembers.splice(index, 1)[0];
                    const historyDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
                    try {
                        await setDoc(historyDocRef, dayData);
                        showToast(`${removed.member}님의 '${removed.type}' 이력 기록이 삭제되었습니다.`);
                        renderAttendanceDailyHistory(dateKey, allHistoryData); // ui.js
                    } catch (e) {
                        showToast('이력 기록 삭제 중 오류 발생.', true);
                        dayData.onLeaveMembers.splice(index, 0, removed);
                    }
                }
            }
        }

        if (stateChanged && deleteMode !== 'leave') {
            debouncedSaveState();
        }
        if (deleteMode === 'leave' && attendanceRecordToDelete?.recordType === 'daily' && stateChanged) {
            debouncedSaveState();
        }

        if (deleteConfirmModal) deleteConfirmModal.classList.add('hidden');
        recordToDeleteId = null;
        attendanceRecordToDelete = null;
        deleteMode = 'single';

        render();
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
            const contentBox = document.getElementById('history-modal-content-box');
            const overlay = document.getElementById('history-modal');

            if (contentBox && overlay && contentBox.dataset.hasBeenUncentered === 'true') {
                overlay.classList.add('flex', 'items-center', 'justify-center');
                contentBox.style.position = '';
                contentBox.style.top = '';
                contentBox.style.left = '';
                contentBox.dataset.hasBeenUncentered = 'false';
            }

            try {
                await loadAndRenderHistoryList(); // app-history.js
            } catch (loadError) {
                console.error("이력 데이터 로딩 중 오류:", loadError);
                showToast("이력 데이터를 불러오는 중 오류가 발생했습니다.", true);
            }
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
            saveDayDataToHistory(false);
            showToast('업무 마감 처리 완료. 오늘의 기록을 이력에 저장하고 초기화했습니다.');
        }
    });
}

if (confirmEndShiftBtn) {
    confirmEndShiftBtn.addEventListener('click', () => {
        saveDayDataToHistory(false);
        showToast('업무 마감 처리 완료. 오늘의 기록을 이력에 저장하고 초기화했습니다.');
        if (endShiftConfirmModal) endShiftConfirmModal.classList.add('hidden');
    });
}

if (cancelEndShiftBtn) {
    cancelEndShiftBtn.addEventListener('click', () => {
        if (endShiftConfirmModal) endShiftConfirmModal.classList.add('hidden');
    });
}

if (saveProgressBtn) {
    saveProgressBtn.addEventListener('click', () => saveProgress(false));
}

if (closeHistoryBtn) {
    closeHistoryBtn.addEventListener('click', () => {
        if (historyModal) {
            historyModal.classList.add('hidden');
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

            const activeSubTabBtn = (activeMainHistoryTab === 'work')
                ? historyTabs?.querySelector('button.font-semibold')
                : attendanceHistoryTabs?.querySelector('button.font-semibold');
            const activeView = activeSubTabBtn ? activeSubTabBtn.dataset.view : (activeMainHistoryTab === 'work' ? 'daily' : 'attendance-daily');

            if (activeView === 'daily') {
                const currentIndex = allHistoryData.findIndex(d => d.id === dateKey);
                const previousDayData = (currentIndex > -1 && currentIndex + 1 < allHistoryData.length)
                    ? allHistoryData[currentIndex + 1]
                    : null;
                renderHistoryDetail(dateKey, previousDayData); // app-history.js
            } else if (activeView === 'attendance-daily') {
                renderAttendanceDailyHistory(dateKey, allHistoryData); // ui.js
            } else if (activeView === 'weekly' || activeView === 'monthly' || activeView === 'attendance-weekly' || activeView === 'attendance-monthly') {
                const targetKey = dateKey;
                if (activeView === 'weekly' || activeView === 'monthly') {
                    const summaryCard = document.getElementById(`summary-card-${targetKey}`);
                    if (summaryCard) {
                        summaryCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        summaryCard.classList.add('ring-2', 'ring-blue-400', 'transition-all', 'duration-300');
                        setTimeout(() => {
                            summaryCard.classList.remove('ring-2', 'ring-blue-400');
                        }, 2000);
                    }
                }
            }
        }
    });
}

if (historyTabs) {
    historyTabs.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-view]');
        if (btn) {
            switchHistoryView(btn.dataset.view); // app-history.js
        }
    });
}

if (confirmHistoryDeleteBtn) {
    confirmHistoryDeleteBtn.addEventListener('click', async () => {
        if (historyKeyToDelete) {
            const historyDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'history', historyKeyToDelete);
            try {
                await deleteDoc(historyDocRef);
                showToast(`${historyKeyToDelete} 이력이 삭제되었습니다.`);
                await loadAndRenderHistoryList(); // app-history.js
            } catch (e) {
                console.error('Error deleting history:', e);
                showToast('이력 삭제 중 오류 발생.', true);
            }
        }
        if (deleteHistoryModal) deleteHistoryModal.classList.add('hidden');
        historyKeyToDelete = null;
    });
}

if (historyMainTabs) {
    historyMainTabs.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-main-tab]');
        if (btn) {
            const tabName = btn.dataset.mainTab;
            activeMainHistoryTab = tabName;

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
                if (dateListContainer) dateListContainer.style.display = 'block';

                const activeSubTabBtn = historyTabs?.querySelector('button.font-semibold');
                const view = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'daily';
                switchHistoryView(view); // app-history.js
            } else if (tabName === 'attendance') {
                if (workHistoryPanel) workHistoryPanel.classList.add('hidden');
                if (attendanceHistoryPanel) attendanceHistoryPanel.classList.remove('hidden');
                if (trendAnalysisPanel) trendAnalysisPanel.classList.add('hidden');
                if (dateListContainer) dateListContainer.style.display = 'block';

                const activeSubTabBtn = attendanceHistoryTabs?.querySelector('button.font-semibold');
                const view = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'attendance-daily';
                switchHistoryView(view); // app-history.js
            } else if (tabName === 'trends') {
                if (workHistoryPanel) workHistoryPanel.classList.add('hidden');
                if (attendanceHistoryPanel) attendanceHistoryPanel.classList.add('hidden');
                if (trendAnalysisPanel) trendAnalysisPanel.classList.remove('hidden');
                if (dateListContainer) dateListContainer.style.display = 'none';

                renderTrendAnalysisCharts(allHistoryData, appConfig, trendCharts); // ui.js
            }
        }
    });
}

if (attendanceHistoryTabs) {
    attendanceHistoryTabs.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-view]');
        if (btn) {
            switchHistoryView(btn.dataset.view); // app-history.js
        }
    });
}

if (resetAppBtn) {
    resetAppBtn.addEventListener('click', () => {
        if (resetAppModal) resetAppModal.classList.remove('hidden');
    });
}

if (confirmResetAppBtn) {
    confirmResetAppBtn.addEventListener('click', async () => {
        await saveDayDataToHistory(true);
        if (resetAppModal) resetAppModal.classList.add('hidden');
    });
}

if (resetAppBtnMobile) {
    resetAppBtnMobile.addEventListener('click', () => {
        if (resetAppModal) resetAppModal.classList.remove('hidden');
        if (navContent) navContent.classList.add('hidden');
    });
}

if (confirmQuantityBtn) {
    confirmQuantityBtn.addEventListener('click', () => {
        const inputs = quantityModal.querySelectorAll('input[data-task]');
        const newQuantities = {};
        inputs.forEach(input => {
            const task = input.dataset.task;
            const quantity = Number(input.value) || 0;
            if (quantity > 0) newQuantities[task] = quantity;
        });
        if (quantityModalContext.onConfirm) {
            quantityModalContext.onConfirm(newQuantities);
        }
        if (quantityModal) quantityModal.classList.add('hidden');
    });
}

if (confirmEditBtn) {
    confirmEditBtn.addEventListener('click', () => {
        if (!recordToEditId) return;
        const idx = appState.workRecords.findIndex(r => String(r.id) === String(recordToEditId));
        if (idx === -1) {
            showToast('수정할 기록을 찾을 수 없습니다.', true);
            if (editRecordModal) editRecordModal.classList.add('hidden');
            recordToEditId = null;
            return;
        }

        const record = appState.workRecords[idx];
        const newTask = document.getElementById('edit-task-type').value;
        const newStart = document.getElementById('edit-start-time').value;
        const newEnd = document.getElementById('edit-end-time').value;

        if (!newStart || !newEnd || !newTask) {
            showToast('모든 필드를 올바르게 입력해주세요.', true);
            return;
        }

        if (newEnd < newStart) {
            showToast('종료 시간은 시작 시간보다 이후여야 합니다.', true);
            return;
        }

        record.task = newTask;
        record.startTime = newStart;
        record.endTime = newEnd;
        record.duration = calcElapsedMinutes(newStart, newEnd, record.pauses); // utils.js

        debouncedSaveState();
        showToast('기록이 수정되었습니다.');
        if (editRecordModal) editRecordModal.classList.add('hidden');
        recordToEditId = null;
    });
}

if (confirmQuantityOnStopBtn) {
    confirmQuantityOnStopBtn.addEventListener('click', () => {
        if (groupToStopId) {
            const input = document.getElementById('quantity-on-stop-input');
            const quantity = input ? (Number(input.value) || 0) : null;
            finalizeStopGroup(groupToStopId, quantity);
            if (input) input.value = '';
        }
    });
}

if (taskSelectModal) {
    taskSelectModal.addEventListener('click', (e) => {
        const btn = e.target.closest('.task-select-btn');
        if (btn) {
            const task = btn.dataset.task;
            if (taskSelectModal) taskSelectModal.classList.add('hidden');

            selectedTaskForStart = task;
            selectedGroupForAdd = null;
            renderTeamSelectionModalContent(task, appState, appConfig.teamGroups); // ui.js
            const titleEl = document.getElementById('team-select-modal-title');
            if (titleEl) titleEl.textContent = `'${task}' 업무 시작`;
            if (teamSelectModal) teamSelectModal.classList.remove('hidden');
        }
    });
}

if (confirmStopIndividualBtn) {
    confirmStopIndividualBtn.addEventListener('click', () => {
        if (recordToStopId) {
            stopWorkIndividual(recordToStopId);
        }
        if (stopIndividualConfirmModal) stopIndividualConfirmModal.classList.add('hidden');
        recordToStopId = null;
    });
}

const confirmStopGroupBtn = document.getElementById('confirm-stop-group-btn');
if (confirmStopGroupBtn) {
    confirmStopGroupBtn.addEventListener('click', () => {
        if (Array.isArray(groupToStopId) && groupToStopId.length > 0) {
            groupToStopId.forEach(gid => stopWorkGroup(gid));
        } else if (groupToStopId) {
            stopWorkGroup(groupToStopId);
        }
        const stopGroupModal = document.getElementById('stop-group-confirm-modal');
        if (stopGroupModal) stopGroupModal.classList.add('hidden');
        groupToStopId = null;
    });
}

const cancelStopGroupBtn = document.getElementById('cancel-stop-group-btn');
if (cancelStopGroupBtn) {
    cancelStopGroupBtn.addEventListener('click', () => {
        const stopGroupModal = document.getElementById('stop-group-confirm-modal');
        if (stopGroupModal) stopGroupModal.classList.add('hidden');
        groupToStopId = null;
    });
}

if (confirmLeaveBtn) confirmLeaveBtn.addEventListener('click', async () => {
    if (!memberToSetLeave) return;

    const selectedTypeInput = document.querySelector('input[name="leave-type"]:checked');
    if (!selectedTypeInput) {
        showToast('근태 유형을 선택해주세요.', true);
        return;
    }
    const leaveType = selectedTypeInput.value;
    const leaveData = { member: memberToSetLeave, type: leaveType };

    if (leaveType === '외출' || leaveType === '조퇴') {
        leaveData.startTime = getCurrentTime(); // utils.js
        if (leaveType === '조퇴') leaveData.endTime = "17:30";

        appState.dailyOnLeaveMembers = appState.dailyOnLeaveMembers.filter(item => item.member !== memberToSetLeave);
        appState.dailyOnLeaveMembers.push(leaveData);
        debouncedSaveState();
    } else if (leaveType === '연차' || leaveType === '출장' || leaveType === '결근') {
        const startDate = leaveStartDateInput?.value;
        const endDate = leaveEndDateInput?.value;
        if (!startDate) { showToast('시작일을 입력해주세요.', true); return; }
        leaveData.startDate = startDate;
        if (endDate) {
            if (endDate < startDate) { showToast('종료일은 시작일보다 이후여야 합니다.', true); return; }
            leaveData.endDate = endDate;
        }

        persistentLeaveSchedule.onLeaveMembers = persistentLeaveSchedule.onLeaveMembers.filter(item => item.member !== memberToSetLeave);
        persistentLeaveSchedule.onLeaveMembers.push(leaveData);
        await saveLeaveSchedule(db, persistentLeaveSchedule); // config.js
        markDataAsDirty();
    }

    showToast(`${memberToSetLeave}님을 '${leaveType}'(으)로 설정했습니다.`);
    if (leaveTypeModal) leaveTypeModal.classList.add('hidden');
    memberToSetLeave = null;
});

if (confirmCancelLeaveBtn) {
    confirmCancelLeaveBtn.addEventListener('click', async () => {
        if (!memberToCancelLeave) return;

        const todayDateString = getTodayDateString(); // utils.js
        let actionTaken = false;

        const dailyIndex = appState.dailyOnLeaveMembers.findIndex(item => item.member === memberToCancelLeave);
        if (dailyIndex > -1) {
            const entry = appState.dailyOnLeaveMembers[dailyIndex];
            if (entry.type === '외출') {
                entry.endTime = getCurrentTime(); // utils.js
                showToast(`${memberToCancelLeave}님이 복귀 처리되었습니다.`);
                actionTaken = true;
            } else {
                appState.dailyOnLeaveMembers.splice(dailyIndex, 1);
                showToast(`${memberToCancelLeave}님의 '${entry.type}' 상태가 취소되었습니다.`);
                actionTaken = true;
            }
            debouncedSaveState();
        }

        const persistentIndex = persistentLeaveSchedule.onLeaveMembers.findIndex(item => item.member === memberToCancelLeave);
        if (persistentIndex > -1) {
            const entry = persistentLeaveSchedule.onLeaveMembers[persistentIndex];
            const isLeaveActiveToday = entry.startDate <= todayDateString && (!entry.endDate || todayDateString <= entry.endDate);

            if (isLeaveActiveToday) {
                const today = new Date();
                today.setDate(today.getDate() - 1);
                const yesterday = today.toISOString().split('T')[0];
                if (yesterday < entry.startDate) {
                    persistentLeaveSchedule.onLeaveMembers.splice(persistentIndex, 1);
                    showToast(`${memberToCancelLeave}님의 '${entry.type}' 일정이 취소되었습니다.`);
                } else {
                    entry.endDate = yesterday;
                    showToast(`${memberToCancelLeave}님이 복귀 처리되었습니다. (${entry.type}이 ${yesterday}까지로 수정됨)`);
                }
            } else {
                persistentLeaveSchedule.onLeaveMembers.splice(persistentIndex, 1);
                showToast(`${memberToCancelLeave}님의 '${entry.type}' 일정이 취소되었습니다.`);
            }
            await saveLeaveSchedule(db, persistentLeaveSchedule); // config.js
            markDataAsDirty();
            actionTaken = true;
        }

        if (!actionTaken) {
            showToast(`${memberToCancelLeave}님의 근태 정보를 찾을 수 없습니다.`, true);
        }

        if (cancelLeaveConfirmModal) cancelLeaveConfirmModal.classList.add('hidden');
        memberToCancelLeave = null;
    });
}

document.querySelectorAll('.modal-close-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const modal = e.target.closest('.fixed.inset-0');
        if (!modal || modal.id === 'history-modal') return;

        modal.classList.add('hidden');

        const modalId = modal.id;
        if (modalId === 'leave-type-modal') {
            memberToSetLeave = null;
            if (leaveDateInputsDiv) leaveDateInputsDiv.classList.add('hidden');
            const firstRadio = leaveTypeOptionsContainer?.querySelector('input[type="radio"]');
            if (firstRadio) firstRadio.checked = true;
        } else if (modalId === 'cancel-leave-confirm-modal') {
            memberToCancelLeave = null;
        } else if (modalId === 'team-select-modal') {
            tempSelectedMembers = [];
            selectedTaskForStart = null;
            selectedGroupForAdd = null;
            modal.querySelectorAll('button[data-member-name].ring-2').forEach(card => {
                card.classList.remove('ring-2', 'ring-blue-500', 'bg-blue-100');
            });
        } else if (modalId === 'delete-confirm-modal') {
            recordToDeleteId = null;
            deleteMode = 'single';
        } else if (modalId === 'delete-history-modal') {
            historyKeyToDelete = null;
        } else if (modalId === 'edit-record-modal') {
            recordToEditId = null;
        } else if (modalId === 'quantity-on-stop-modal') {
            groupToStopId = null;
            const input = document.getElementById('quantity-on-stop-input');
            if (input) input.value = '';
        } else if (modalId === 'stop-group-confirm-modal') {
            groupToStopId = null;
        } else if (modalId === 'stop-individual-confirm-modal') {
            recordToStopId = null;
        } else if (modalId === 'edit-part-timer-modal') {
            // (알바 수정 모달 닫기 로직 - 이미 존재)
        } else if (modalId === 'manual-add-record-modal') {
            if (manualAddForm) manualAddForm.reset();
        }
        else if (modalId === 'edit-start-time-modal') {
            recordIdOrGroupIdToEdit = null;
            editType = null;
            if (editStartTimeInput) editStartTimeInput.value = '';
            if (editStartTimeContextIdInput) editStartTimeContextIdInput.value = '';
            if (editStartTimeContextTypeInput) editStartTimeContextTypeInput.value = '';
        }
        else if (modalId === 'edit-attendance-record-modal') {
            if (editAttendanceDateKeyInput) editAttendanceDateKeyInput.value = '';
            if (editAttendanceRecordIndexInput) editAttendanceRecordIndexInput.value = '';
        }
        else if (modalId === 'add-attendance-record-modal') {
            if (addAttendanceForm) addAttendanceForm.reset();
            if (addAttendanceDateKeyInput) addAttendanceDateKeyInput.value = '';
            if (addAttendanceTimeFields) addAttendanceTimeFields.classList.add('hidden');
            if (addAttendanceDateFields) addAttendanceDateFields.classList.add('hidden');
        }
        else if (modalId === 'edit-leave-record-modal') {
            document.getElementById('edit-leave-original-member-name').value = '';
            document.getElementById('edit-leave-original-start-identifier').value = '';
            document.getElementById('edit-leave-original-type').value = '';
            document.getElementById('edit-leave-time-fields').classList.add('hidden');
            document.getElementById('edit-leave-date-fields').classList.add('hidden');
        }
    });
});

if (cancelCancelLeaveBtn) cancelCancelLeaveBtn.addEventListener('click', () => { if (cancelLeaveConfirmModal) cancelLeaveConfirmModal.classList.add('hidden'); memberToCancelLeave = null; });
if (cancelLeaveBtn) cancelLeaveBtn.addEventListener('click', () => { if (leaveTypeModal) leaveTypeModal.classList.add('hidden'); memberToSetLeave = null; });
if (cancelDeleteBtn) cancelDeleteBtn.addEventListener('click', () => { if (deleteConfirmModal) deleteConfirmModal.classList.add('hidden'); recordToDeleteId = null; attendanceRecordToDelete = null; });
if (cancelQuantityBtn) cancelQuantityBtn.addEventListener('click', () => { if (quantityModalContext.onCancel) quantityModalContext.onCancel(); if (quantityModal) quantityModal.classList.add('hidden'); });
if (cancelHistoryDeleteBtn) cancelHistoryDeleteBtn.addEventListener('click', () => { if (deleteHistoryModal) deleteHistoryModal.classList.add('hidden'); historyKeyToDelete = null; });
if (cancelEditBtn) cancelEditBtn.addEventListener('click', () => { if (editRecordModal) editRecordModal.classList.add('hidden'); recordToEditId = null; });
if (cancelResetAppBtn) cancelResetAppBtn.addEventListener('click', () => { if (resetAppModal) resetAppModal.classList.add('hidden'); });
if (cancelQuantityOnStopBtn) cancelQuantityOnStopBtn.addEventListener('click', () => { if (quantityOnStopModal) quantityOnStopModal.classList.add('hidden'); groupToStopId = null; });
if (cancelStopIndividualBtn) cancelStopIndividualBtn.addEventListener('click', () => { if (stopIndividualConfirmModal) stopIndividualConfirmModal.classList.add('hidden'); recordToStopId = null; });
if (cancelEditPartTimerBtn) cancelEditPartTimerBtn.addEventListener('click', () => { if (editPartTimerModal) editPartTimerModal.classList.add('hidden'); });
if (cancelTeamSelectBtn) cancelTeamSelectBtn.addEventListener('click', () => {
    if (teamSelectModal) teamSelectModal.classList.add('hidden');
    tempSelectedMembers = []; selectedTaskForStart = null; selectedGroupForAdd = null;
    teamSelectModal.querySelectorAll('button[data-member-name].ring-2').forEach(card => {
        card.classList.remove('ring-2', 'ring-blue-500', 'bg-blue-100');
    });
});
if (cancelAddAttendanceBtn) {
    cancelAddAttendanceBtn.addEventListener('click', () => {
        if (addAttendanceRecordModal) addAttendanceRecordModal.classList.add('hidden');
        if (addAttendanceForm) addAttendanceForm.reset();
        if (addAttendanceDateKeyInput) addAttendanceDateKeyInput.value = '';
        if (addAttendanceTimeFields) addAttendanceTimeFields.classList.add('hidden');
        if (addAttendanceDateFields) addAttendanceDateFields.classList.add('hidden');
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

if (addAttendanceTypeSelect) {
    addAttendanceTypeSelect.addEventListener('change', (e) => {
        const selectedType = e.target.value;
        const isTimeBased = (selectedType === '외출' || selectedType === '조퇴');
        const isDateBased = (selectedType === '연차' || selectedType === '출장' || selectedType === '결근');

        if (addAttendanceTimeFields) addAttendanceTimeFields.classList.toggle('hidden', !isTimeBased);
        if (addAttendanceDateFields) addAttendanceDateFields.classList.toggle('hidden', !isDateBased);
    });
}

if (attendanceHistoryViewContainer) {
    // ❗️ 이 리스너는 app-events.js로 이동했습니다.
    // ❗️ app.js에 중복으로 남아있으면 안 됩니다.
    // ❗️ (위의 `appState` export 목록에 `attendanceHistoryViewContainer`가 있으므로
    // ❗️ `app-events.js`에서 올바르게 참조할 수 있습니다.)
}

if (confirmAddAttendanceBtn) {
    // ❗️ 이 리스너는 app-events.js로 이동했습니다.
}

if (confirmEditAttendanceBtn) {
    // ❗️ 이 리스너는 app-events.js로 이동했습니다.
}

if (teamSelectModal) {
    // ❗️ 이 리스너는 app-events.js로 이동했습니다.
}

if (confirmEditPartTimerBtn) {
    // ❗️ 이 리스너는 app-events.js로 이동했습니다.
}

if (confirmTeamSelectBtn) {
    // ❗️ 이 리스너는 app-events.js로 이동했습니다.
}

if (openManualAddBtn) {
    // ❗️ 이 리스너는 app-events.js로 이동했습니다.
}

if (openQuantityModalTodayBtn) {
    // ❗️ 이 리스너는 app-events.js로 이동했습니다.
}

if (openQuantityModalTodayBtnMobile) {
    // ❗️ 이 리스너는 app-events.js로 이동했습니다.
}

if (confirmManualAddBtn) {
    // ❗️ 이 리스너는 app-events.js로 이동했습니다.
}

if (cancelManualAddBtn) {
    // ❗️ 이 리스너는 app-events.js로 이동했습니다.
}

if (hamburgerBtn && navContent) {
    // ❗️ 이 리스너는 app-events.js로 이동했습니다.
}

if (menuToggleBtn) {
    // ❗️ 이 리스너는 app-events.js로 이동했습니다.
}

// ❗️ document.addEventListener('click', ...)는 app-events.js로 이동했습니다.

if (confirmEditStartTimeBtn) {
    // ❗️ 이 리스너는 app-events.js로 이동했습니다.
}

if (cancelEditStartTimeBtn) {
    // ❗️ 이 리스너는 app-events.js로 이동했습니다.
}

if (loginForm) {
    // ❗️ 이 리스너는 app-events.js로 이동했습니다.
}

if (logoutBtn) {
    // ❗️ 이 리스너는 app-events.js로 이동했습니다.
}

if (logoutBtnMobile) {
    // ❗️ 이 리스너는 app-events.js로 이동했습니다.
}

// ❗️ makeDraggable 함수 정의는 app-events.js로 이동했습니다.

if (analysisTabs) {
    // ❗️ 이 리스너는 app-events.js로 이동했습니다.
}

if (analysisMemberSelect) {
    // ❗️ 이 리스너는 app-events.js로 이동했습니다.
}

if (editLeaveModal) {
    // ❗️ 이 리스너는 app-events.js로 이동했습니다.
}

// ❗️ 1분마다 새로고침하는 코드는 삭제되었습니다 (사용자 경험 저해)
// setInterval(() => { ... }, 60000);