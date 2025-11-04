// === app-listeners.js (모든 DOM 이벤트 리스너 및 관련 로직) ===

// app.js (메인)에서 가져올 핵심 상태 및 DOM 요소들
import {
    appState, appConfig, db, auth, 
    persistentLeaveSchedule, allHistoryData,
    context, 
    LEAVE_TYPES,

    // DOM 요소 (전부)
    addAttendanceRecordModal, addAttendanceForm, confirmAddAttendanceBtn, cancelAddAttendanceBtn,
    addAttendanceMemberNameInput, addAttendanceMemberDatalist, addAttendanceTypeSelect,
    addAttendanceStartTimeInput, addAttendanceEndTimeInput, addAttendanceStartDateInput,
    addAttendanceEndDateInput, addAttendanceDateKeyInput, addAttendanceTimeFields,
    addAttendanceDateFields, editAttendanceRecordModal, confirmEditAttendanceBtn,
    cancelEditAttendanceBtn, editAttendanceMemberName, editAttendanceTypeSelect,
    editAttendanceStartTimeInput, editAttendanceEndTimeInput, editAttendanceStartDateInput,
    editAttendanceEndDateInput, editAttendanceDateKeyInput, editAttendanceRecordIndexInput,
    editAttendanceTimeFields, editAttendanceDateFields, teamStatusBoard, workLogBody,
    teamSelectModal, deleteConfirmModal, confirmDeleteBtn, cancelDeleteBtn, historyModal,
    historyModalContentBox,
    openHistoryBtn, closeHistoryBtn, historyDateList, historyViewContainer, historyTabs,
    historyMainTabs, workHistoryPanel, attendanceHistoryPanel, attendanceHistoryTabs,
    attendanceHistoryViewContainer, trendAnalysisPanel, quantityModal, confirmQuantityBtn,
    cancelQuantityBtn, deleteHistoryModal, confirmHistoryDeleteBtn, cancelHistoryDeleteBtn,
    deleteAllCompletedBtn, editRecordModal, confirmEditBtn, cancelEditBtn, saveProgressBtn,
    quantityOnStopModal, confirmQuantityOnStopBtn, cancelQuantityOnStopBtn, endShiftBtn,
    resetAppBtn, resetAppModal, confirmResetAppBtn, cancelResetAppBtn, taskSelectModal,
    stopIndividualConfirmModal, confirmStopIndividualBtn, cancelStopIndividualBtn,
    stopIndividualConfirmMessage, editPartTimerModal, confirmEditPartTimerBtn,
    cancelEditPartTimerBtn, partTimerNewNameInput, partTimerEditIdInput, cancelTeamSelectBtn,
    leaveTypeModal, leaveModalTitle, leaveMemberNameSpan, leaveTypeOptionsContainer,
    confirmLeaveBtn, cancelLeaveBtn, leaveDateInputsDiv, leaveStartDateInput, leaveEndDateInput,
    cancelLeaveConfirmModal, confirmCancelLeaveBtn, cancelCancelLeaveBtn,
    cancelLeaveConfirmMessage, toggleCompletedLog, toggleAnalysis, toggleSummary,
    openManualAddBtn, manualAddRecordModal, confirmManualAddBtn, cancelManualAddBtn,
    manualAddForm, endShiftConfirmModal, endShiftConfirmTitle, endShiftConfirmMessage,
    confirmEndShiftBtn, cancelEndShiftBtn, menuToggleBtn, menuDropdown,
    openQuantityModalTodayBtn, openQuantityModalTodayBtnMobile, adminLinkBtnMobile,
    resetAppBtnMobile, logoutBtnMobile, hamburgerBtn, navContent, editStartTimeModal,
    editStartTimeModalTitle, editStartTimeModalMessage, editStartTimeInput,
    editStartTimeContextIdInput, editStartTimeContextTypeInput, confirmEditStartTimeBtn,
    cancelEditStartTimeBtn,
    analysisMemberSelect,

    // ✅ [추가] 이 DOM 요소를 import 목록에 추가합니다.
    editLeaveModal,

    // app.js (메인)의 헬퍼/로직 함수
    render, debouncedSaveState, saveStateToFirestore, 
    generateId, normalizeName, 
    markDataAsDirty,
    
    // (로그인/로그아웃 DOM 요소)
    loginModal, 
    loginForm,
    loginEmailInput,
    loginPasswordInput,
    loginSubmitBtn,
    loginErrorMsg,
    loginButtonText,
    loginButtonSpinner,
    userGreeting,
    logoutBtn
    
} from './app.js';

// config.js에서 가져올 함수
import { saveLeaveSchedule } from './config.js';

// utils.js에서 필요한 모든 헬퍼 함수 가져오기
import { calcElapsedMinutes, showToast, getTodayDateString, getCurrentTime } from './utils.js';

// ui.js (통합)에서 가져올 렌더링 함수
import {
    getAllDashboardDefinitions,
    renderManualAddModalDatalists,
    renderQuantityModalInputs,
    renderTeamSelectionModalContent,
    renderLeaveTypeModalOptions,
    renderPersonalAnalysis,
    renderTrendAnalysisCharts,
    trendCharts // ✅ [수정] trendCharts는 ui.js에서 가져옴
} from './ui.js';

// app-logic.js (업무 로직)
import {
    startWorkGroup, addMembersToWorkGroup, finalizeStopGroup,
    stopWorkIndividual, pauseWorkGroup, resumeWorkGroup,
    pauseWorkIndividual, resumeWorkIndividual
} from './app-logic.js';

// app-history-logic.js (이력 로직)
import {
    saveProgress, saveDayDataToHistory,
    loadAndRenderHistoryList,
    openHistoryQuantityModal,
    renderHistoryDetail,
    requestHistoryDeletion,
    downloadHistoryAsExcel,
    downloadAttendanceHistoryAsExcel,
    switchHistoryView,
    renderHistoryDateListByMode
} from './app-history-logic.js';

// (ui-history에서 직접 가져와야 함 - app-history-logic가 ui를 import하므로 순환참조 방지)
import {
  renderAttendanceDailyHistory,
  renderAttendanceWeeklyHistory,
  renderAttendanceMonthlyHistory,
  renderWeeklyHistory,
  renderMonthlyHistory
} from './ui-history.js';


// Firebase (Firestore & Auth)
import { doc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";


/**
 * 앱의 모든 DOM 이벤트 리스너를 초기화합니다.
 * 이 함수는 app.js의 main() 함수 끝에서 한 번 호출됩니다.
 */
export function initializeAppListeners() {

    // --- 1. 메인 화면 (teamStatusBoard) 리스너 ---
    if (teamStatusBoard) {
      teamStatusBoard.addEventListener('click', (e) => {
        
        // 1. 모바일 토글 버튼들
        const toggleMobileBtn = e.target.closest('#toggle-all-tasks-mobile');
        if (toggleMobileBtn) {
            e.stopPropagation(); 
            
            // 👈 [수정] DOM을 직접 조작하는 대신 context 상태를 변경하고 render() 호출
            context.isMobileTaskViewExpanded = !context.isMobileTaskViewExpanded;
            render(); // render()가 'ui-main.js'의 renderRealtimeStatus를 올바른 상태로 호출
            
            return;
        }
        
        const toggleMemberBtn = e.target.closest('#toggle-all-members-mobile');
        if (toggleMemberBtn) {
            e.stopPropagation();

            // 👈 [수정] DOM을 직접 조작하는 대신 context 상태를 변경하고 render() 호출
            context.isMobileMemberViewExpanded = !context.isMobileMemberViewExpanded;
            render(); // render()가 'ui-main.js'의 renderRealtimeStatus를 올바른 상태로 호출
            
            return;
        }

        // 2. 카드 내부의 액션 버튼들
        const stopGroupButton = e.target.closest('.stop-work-group-btn');
        if (stopGroupButton) {
            context.groupToStopId = Number(stopGroupButton.dataset.groupId); // ✅ context.
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
            context.recordToStopId = individualStopBtn.dataset.recordId; // ✅ context.
            const record = (appState.workRecords || []).find(r => r.id === context.recordToStopId);
            if (stopIndividualConfirmMessage && record) {
                 stopIndividualConfirmMessage.textContent = `${record.member}님의 '${record.task}' 업무를 종료하시겠습니까?`;
            }
            if (stopIndividualConfirmModal) stopIndividualConfirmModal.classList.remove('hidden');
            return;
        }
        
        /*
        const addMemberButton = e.target.closest('.add-member-btn[data-action="add-member"]');
        if (addMemberButton) {
            context.selectedTaskForStart = addMemberButton.dataset.task; // ✅ context.
            context.selectedGroupForAdd = Number(addMemberButton.dataset.groupId); // ✅ context.
            renderTeamSelectionModalContent(context.selectedTaskForStart, appState, appConfig.teamGroups);
            const titleEl = document.getElementById('team-select-modal-title');
            if (titleEl) titleEl.textContent = `'${context.selectedTaskForStart}' 인원 추가`;
            if (teamSelectModal) teamSelectModal.classList.remove('hidden');
            return;
        }
        */

        // 3. 그룹 시작 시간 수정 영역
        const groupTimeDisplay = e.target.closest('.group-time-display[data-action="edit-group-start-time"]');
        if (groupTimeDisplay) {
            const groupId = Number(groupTimeDisplay.dataset.groupId);
            const currentStartTime = groupTimeDisplay.dataset.currentStartTime;
            if (!groupId || !currentStartTime) return;

            context.recordIdOrGroupIdToEdit = groupId; // ✅ context.
            context.editType = 'group'; // ✅ context.

            if(editStartTimeModalTitle) editStartTimeModalTitle.textContent = '그룹 시작 시간 변경';
            if(editStartTimeModalMessage) editStartTimeModalMessage.textContent = '이 그룹의 모든 팀원의 시작 시간이 변경됩니다.';
            if(editStartTimeInput) editStartTimeInput.value = currentStartTime;
            if(editStartTimeContextIdInput) editStartTimeContextIdInput.value = groupId;
            if(editStartTimeContextTypeInput) editStartTimeContextTypeInput.value = 'group';
            
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

            context.recordIdOrGroupIdToEdit = recordId; // ✅ context.
            context.editType = 'individual'; // ✅ context.

            if(editStartTimeModalTitle) editStartTimeModalTitle.textContent = '개별 시작 시간 변경';
            if(editStartTimeModalMessage) editStartTimeModalMessage.textContent = `${record.member}님의 시작 시간을 변경합니다.`;
            if(editStartTimeInput) editStartTimeInput.value = currentStartTime;
            if(editStartTimeContextIdInput) editStartTimeContextIdInput.value = recordId;
            if(editStartTimeContextTypeInput) editStartTimeContextTypeInput.value = 'individual';

            if (editStartTimeModal) editStartTimeModal.classList.remove('hidden');
            return;
        }
        
        // 6. 통합 근태 수정 카드 클릭 (data-action="edit-leave-record")
        const editLeaveCard = e.target.closest('[data-action="edit-leave-record"]');
        if (editLeaveCard) {
            const memberName = editLeaveCard.dataset.memberName;
            const currentType = editLeaveCard.dataset.leaveType;
            const currentStartTime = editLeaveCard.dataset.startTime; // 외출/조퇴용
            const currentStartDate = editLeaveCard.dataset.startDate; // 연차/결근/출장용
            const currentEndTime = editLeaveCard.dataset.endTime;
            const currentEndDate = editLeaveCard.dataset.endDate;

            const role = appState.currentUserRole || 'user';
            const selfName = appState.currentUser || null;
            if (role !== 'admin' && memberName !== selfName) {
                showToast('본인의 근태 기록만 수정할 수 있습니다.', true);
                return;
            }
            
            // '외출' 또는 '조퇴'인 경우, '복귀' 확인 모달을 바로 띄웁니다.
            if (currentType === '외출' || currentType === '조퇴') {
                context.memberToCancelLeave = memberName;
                if (cancelLeaveConfirmMessage) {
                    cancelLeaveConfirmMessage.textContent = `${memberName}님을 '${currentType}' 상태에서 복귀(취소) 처리하시겠습니까?`;
                }
                if (cancelLeaveConfirmModal) {
                    cancelLeaveConfirmModal.classList.remove('hidden');
                }
                return; // 👈 중요: 수정 모달을 열지 않고 여기서 종료
            }


            // (이하 기존 로직)
            // '연차', '출장', '결근'인 경우에만 전체 수정 모달이 열립니다.
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

        // 7. 근태 설정 카드 (data-action="member-toggle-leave")
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
            
            context.memberToSetLeave = memberName; // ✅ context.
            if(leaveMemberNameSpan) leaveMemberNameSpan.textContent = memberName;
            renderLeaveTypeModalOptions(LEAVE_TYPES);
            if(leaveStartDateInput) leaveStartDateInput.value = getTodayDateString();
            if(leaveEndDateInput) leaveEndDateInput.value = '';
            const firstRadio = leaveTypeOptionsContainer?.querySelector('input[type="radio"]');
            if (firstRadio) {
                const initialType = firstRadio.value;
                if (leaveDateInputsDiv) leaveDateInputsDiv.classList.toggle('hidden', !(initialType === '연차' || initialType === '출장' || initialType === '결근'));
            } else if (leaveDateInputsDiv) { leaveDateInputsDiv.classList.add('hidden'); }
            if(leaveTypeModal) leaveTypeModal.classList.remove('hidden');
            
            return;
        }

        // 8. 업무 카드 전체 클릭 (시작, 기타, 또는 인원 추가)
        
        // 8a. 카드 내부의 상호작용 요소 클릭 시, 카드 전체 클릭(8b)으로 
        //     이벤트가 전파되는 것을 막습니다. (가장 중요)
        if (e.target.closest('.members-list, .card-actions, .group-time-display')) {
            // (members-list: 멤버 목록)
            // (card-actions: 하단 버튼 영역)
            // (group-time-display: 상단 시간 표시 영역)
            e.stopPropagation(); // 👈 이 클릭은 카드 전체 클릭으로 간주하지 않음
            return;
        }

        // 8b. 카드 자체(빈 공간) 클릭 처리
        // 'start-task' 카드는 data-action을, '진행 중' 카드는 data-group-id를 가집니다.
        const card = e.target.closest('div[data-group-id], div[data-action]');
        
        if (card) { 
            const action = card.dataset.action;
            const groupId = card.dataset.groupId;
            const task = card.dataset.task;

            if (action === 'start-task') {
                // (기존) 시작 전 카드 클릭
                context.selectedTaskForStart = task; 
                context.selectedGroupForAdd = null; 
                renderTeamSelectionModalContent(task, appState, appConfig.teamGroups);
                const titleEl = document.getElementById('team-select-modal-title');
                if (titleEl) titleEl.textContent = `'${task}' 업무 시작`;
                if (teamSelectModal) teamSelectModal.classList.remove('hidden');
                return;

            } else if (action === 'other') {
                // (기존) 기타 업무 카드 클릭
                if (taskSelectModal) taskSelectModal.classList.remove('hidden');
                return;
            
            } else if (groupId && task) {
                // (신규) 진행 중인 카드 (data-group-id가 있는 카드)의 
                // 빈 공간 클릭 시 -> '인원 추가' 로직 실행
                
                context.selectedTaskForStart = task;
                context.selectedGroupForAdd = Number(groupId); 
                renderTeamSelectionModalContent(task, appState, appConfig.teamGroups);
                const titleEl = document.getElementById('team-select-modal-title');
                if (titleEl) titleEl.textContent = `'${task}' 인원 추가`;
                if (teamSelectModal) teamSelectModal.classList.remove('hidden');
                return;
            }
        }
        
      }); 
    } 

    // --- 2. 완료 기록 (workLogBody) 리스너 ---
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

    // --- 3. 버튼 리스너 (일괄 삭제, 저장, 마감 등) ---
    if (deleteAllCompletedBtn) {
      deleteAllCompletedBtn.addEventListener('click', () => {
        context.deleteMode = 'all'; // ✅ context.
        const msgEl = document.getElementById('delete-confirm-message');
        if (msgEl) msgEl.textContent = '오늘 완료된 모든 업무 기록을 삭제하시겠습니까?';
        if (deleteConfirmModal) deleteConfirmModal.classList.remove('hidden');
      });
    }

    if (confirmDeleteBtn) {
      confirmDeleteBtn.addEventListener('click', async () => {
        let stateChanged = false; 

        if (context.deleteMode === 'all') { // ✅ context.
          const originalLength = appState.workRecords.length;
          appState.workRecords = (appState.workRecords || []).filter(r => r.status !== 'completed');
          if (appState.workRecords.length < originalLength) {
              stateChanged = true;
              showToast('완료된 모든 기록이 삭제되었습니다.');
          } else {
              showToast('삭제할 완료 기록이 없습니다.');
          }
          
        } else if (context.deleteMode === 'single' && context.recordToDeleteId) { // ✅ context.
          const originalLength = appState.workRecords.length;
          appState.workRecords = (appState.workRecords || []).filter(r => String(r.id) !== String(context.recordToDeleteId));
          if (appState.workRecords.length < originalLength) {
              stateChanged = true;
              showToast('선택한 기록이 삭제되었습니다.');
          } else {
               showToast('삭제할 기록을 찾지 못했습니다.', true);
          }

        } else if (context.deleteMode === 'leave' && context.attendanceRecordToDelete) { // ✅ context.
            const { memberName, startIdentifier, recordType } = context.attendanceRecordToDelete;
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
                        await saveLeaveSchedule(db, persistentLeaveSchedule); 
                        recordDeleted = true;
                        
                        // 'persistent' (연차 등) 삭제 시에도 상태 변경을 알리고
                        // markDataAsDirty()를 호출해야 합니다.
                        stateChanged = true;
                        markDataAsDirty();

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
        
        } else if (context.deleteMode === 'attendance' && context.attendanceRecordToDelete) { // ✅ context.
            // (이력) 근태 기록 삭제
            const { dateKey, index } = context.attendanceRecordToDelete;
            const dayDataIndex = allHistoryData.findIndex(d => d.id === dateKey);
            if (dayDataIndex === -1) {
                 showToast('원본 이력 데이터를 찾을 수 없습니다.', true);
            } else {
                const record = allHistoryData[dayDataIndex].onLeaveMembers[index];
                if (!record) {
                     showToast('삭제할 근태 기록을 찾지 못했습니다.', true);
                } else {
                    allHistoryData[dayDataIndex].onLeaveMembers.splice(index, 1);
                    const historyDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
                    try {
                        await setDoc(historyDocRef, allHistoryData[dayDataIndex]);
                        showToast(`${record.member}님의 '${record.type}' 기록이 삭제되었습니다.`);
                        renderAttendanceDailyHistory(dateKey, allHistoryData);
                    } catch (e) {
                        console.error('Error deleting attendance history:', e);
                        showToast('근태 기록 삭제 중 오류 발생.', true);
                        allHistoryData[dayDataIndex].onLeaveMembers.splice(index, 0, record);
                    }
                }
            }
        }
        
        // stateChanged가 true일 때, 삭제 모드에 따라 올바르게 저장/반영되도록 수정
        if (stateChanged) {
            if (context.deleteMode === 'leave') {
                // '일일 근태' (조퇴, 외출) 삭제 시
                if (context.attendanceRecordToDelete?.recordType === 'daily') {
                    debouncedSaveState();
                    saveProgress(true); // 이력(history)에도 즉시 저장
                }
                // '영구 근태' (연차 등) 삭제 시
                if (context.attendanceRecordToDelete?.recordType === 'persistent') {
                    saveProgress(true);
                }
            } else {
                // 'all' 또는 'single' (업무 기록) 삭제 시
                debouncedSaveState();
            }
        }

        if (deleteConfirmModal) deleteConfirmModal.classList.add('hidden');
        context.recordToDeleteId = null; // ✅ context.
        context.attendanceRecordToDelete = null; // ✅ context.
        context.deleteMode = 'single'; // ✅ context.
        
        // 상태 변경(stateChanged)이 있었다면, 화면을 새로고침합니다.
        if (stateChanged) {
            render();
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

    // --- 4. 이력(History) 모달 리스너 ---
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
          
          const activeSubTabBtn = (context.activeMainHistoryTab === 'work') // ✅ context.
            ? historyTabs?.querySelector('button.font-semibold')
            : attendanceHistoryTabs?.querySelector('button.font-semibold');
          const activeView = activeSubTabBtn ? activeSubTabBtn.dataset.view : (context.activeMainHistoryTab === 'work' ? 'daily' : 'attendance-daily'); // ✅ context.
          
          if (context.activeMainHistoryTab === 'work') {
              if (activeView === 'daily') {
                  const currentIndex = allHistoryData.findIndex(d => d.id === dateKey);
                  const previousDayData = (currentIndex > -1 && currentIndex + 1 < allHistoryData.length) 
                                        ? allHistoryData[currentIndex + 1] 
                                        : null;
                  renderHistoryDetail(dateKey, previousDayData);
              } else if (activeView === 'weekly') {
                  renderWeeklyHistory(dateKey, allHistoryData, appConfig);
              } else if (activeView === 'monthly') {
                  renderMonthlyHistory(dateKey, allHistoryData, appConfig);
              }
          } else { // attendance tab
              if (activeView === 'attendance-daily') {
                  renderAttendanceDailyHistory(dateKey, allHistoryData);
              } else if (activeView === 'attendance-weekly') {
                  renderAttendanceWeeklyHistory(dateKey, allHistoryData);
              } else if (activeView === 'attendance-monthly') {
                  renderAttendanceMonthlyHistory(dateKey, allHistoryData);
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
        if (context.historyKeyToDelete) { // ✅ context.
          const historyDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'history', context.historyKeyToDelete); // ✅ context.
          try {
            await deleteDoc(historyDocRef);
            showToast(`${context.historyKeyToDelete} 이력이 삭제되었습니다.`); // ✅ context.
            await loadAndRenderHistoryList();
          } catch (e) {
            console.error('Error deleting history:', e);
            showToast('이력 삭제 중 오류 발생.', true);
          }
        }
        if (deleteHistoryModal) deleteHistoryModal.classList.add('hidden');
        context.historyKeyToDelete = null; // ✅ context.
      });
    }

    if (historyMainTabs) {
      historyMainTabs.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-main-tab]');
        if (btn) {
          const tabName = btn.dataset.mainTab;
          context.activeMainHistoryTab = tabName; // ✅ context.

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
            switchHistoryView(view);
          
          } else if (tabName === 'attendance') { 
            if (workHistoryPanel) workHistoryPanel.classList.add('hidden');
            if (attendanceHistoryPanel) attendanceHistoryPanel.classList.remove('hidden');
            if (trendAnalysisPanel) trendAnalysisPanel.classList.add('hidden'); 
            if (dateListContainer) dateListContainer.style.display = 'block'; 

            const activeSubTabBtn = attendanceHistoryTabs?.querySelector('button.font-semibold');
            const view = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'attendance-daily';
            switchHistoryView(view);
          
          } else if (tabName === 'trends') { 
            if (workHistoryPanel) workHistoryPanel.classList.add('hidden');
            if (attendanceHistoryPanel) attendanceHistoryPanel.classList.add('hidden');
            if (trendAnalysisPanel) trendAnalysisPanel.classList.remove('hidden');
            if (dateListContainer) dateListContainer.style.display = 'none'; 
            
            renderTrendAnalysisCharts(allHistoryData, appConfig, trendCharts);
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

    // --- 5. 기타 모달 및 버튼 리스너 ---
    
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
        if (context.quantityModalContext.onConfirm) { // ✅ context.
          context.quantityModalContext.onConfirm(newQuantities); // ✅ context.
        }
        if (quantityModal) quantityModal.classList.add('hidden');
      });
    }

    if (confirmEditBtn) {
      confirmEditBtn.addEventListener('click', () => {
        if (!context.recordToEditId) return; // ✅ context.
        const idx = appState.workRecords.findIndex(r => String(r.id) === String(context.recordToEditId)); // ✅ context.
        if (idx === -1) {
          showToast('수정할 기록을 찾을 수 없습니다.', true);
          if (editRecordModal) editRecordModal.classList.add('hidden');
          context.recordToEditId = null; // ✅ context.
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
        record.duration = calcElapsedMinutes(newStart, newEnd, record.pauses);

        debouncedSaveState(); 
        showToast('기록이 수정되었습니다.');
        if (editRecordModal) editRecordModal.classList.add('hidden');
        context.recordToEditId = null; // ✅ context.
      });
    }

    if (confirmQuantityOnStopBtn) {
      confirmQuantityOnStopBtn.addEventListener('click', () => {
        if (context.groupToStopId) { // ✅ context.
          const input = document.getElementById('quantity-on-stop-input');
          const quantity = input ? (Number(input.value) || 0) : null;
          finalizeStopGroup(context.groupToStopId, quantity); // ✅ context.
          if(input) input.value = '';
          
          if (quantityOnStopModal) quantityOnStopModal.classList.add('hidden');
          context.groupToStopId = null; // ✅ context.
        }
      });
    }

    if (taskSelectModal) {
      taskSelectModal.addEventListener('click', (e) => {
        const btn = e.target.closest('.task-select-btn');
        if (btn) {
          const task = btn.dataset.task;
          if (taskSelectModal) taskSelectModal.classList.add('hidden');

          context.selectedTaskForStart = task; // ✅ context.
          context.selectedGroupForAdd = null; // ✅ context.
          renderTeamSelectionModalContent(task, appState, appConfig.teamGroups);
          const titleEl = document.getElementById('team-select-modal-title');
          if (titleEl) titleEl.textContent = `'${task}' 업무 시작`;
          if (teamSelectModal) teamSelectModal.classList.remove('hidden');
        }
      });
    }

    if (confirmStopIndividualBtn) {
      confirmStopIndividualBtn.addEventListener('click', () => {
        if (context.recordToStopId) { // ✅ context.
          stopWorkIndividual(context.recordToStopId); // ✅ context.
        }
        if (stopIndividualConfirmModal) stopIndividualConfirmModal.classList.add('hidden');
        context.recordToStopId = null; // ✅ context.
      });
    }

    const confirmStopGroupBtn = document.getElementById('confirm-stop-group-btn');
    if (confirmStopGroupBtn) {
      confirmStopGroupBtn.addEventListener('click', () => {
        if (Array.isArray(context.groupToStopId) && context.groupToStopId.length > 0) { // ✅ context.
          context.groupToStopId.forEach(gid => finalizeStopGroup(gid, null)); // ✅ context.
        } else if (context.groupToStopId) { // ✅ context.
          finalizeStopGroup(context.groupToStopId, null); // ✅ context.
        }
        const stopGroupModal = document.getElementById('stop-group-confirm-modal');
        if (stopGroupModal) stopGroupModal.classList.add('hidden');
        context.groupToStopId = null; // ✅ context.
      });
    }

    const cancelStopGroupBtn = document.getElementById('cancel-stop-group-btn');
    if (cancelStopGroupBtn) {
      cancelStopGroupBtn.addEventListener('click', () => {
        const stopGroupModal = document.getElementById('stop-group-confirm-modal');
        if (stopGroupModal) stopGroupModal.classList.add('hidden');
        context.groupToStopId = null; // ✅ context.
      });
    }

    // --- 6. 근태 (Leave) 관련 리스너 ---
    if (confirmLeaveBtn) {
      confirmLeaveBtn.addEventListener('click', async () => {
        if (!context.memberToSetLeave) return; // ✅ context.

        const selectedTypeInput = document.querySelector('input[name="leave-type"]:checked');
        if (!selectedTypeInput) {
            showToast('근태 유형을 선택해주세요.', true);
            return;
        }
        const leaveType = selectedTypeInput.value;
        const leaveData = { member: context.memberToSetLeave, type: leaveType }; // ✅ context.

        if (leaveType === '외출' || leaveType === '조퇴') {
            leaveData.startTime = getCurrentTime();
            if (leaveType === '조퇴') leaveData.endTime = "17:30";

            appState.dailyOnLeaveMembers = appState.dailyOnLeaveMembers.filter(item => item.member !== context.memberToSetLeave); // ✅ context.
            appState.dailyOnLeaveMembers.push(leaveData);
            debouncedSaveState(); 
            
            saveProgress(true); // 이력(history)에도 즉시 저장

        } else if (leaveType === '연차' || leaveType === '출장' || leaveType === '결근') {
            const startDate = leaveStartDateInput?.value;
            const endDate = leaveEndDateInput?.value;
            if (!startDate) { showToast('시작일을 입력해주세요.', true); return; }
            leaveData.startDate = startDate;
            if (endDate) {
                if (endDate < startDate) { showToast('종료일은 시작일보다 이후여야 합니다.', true); return; }
                leaveData.endDate = endDate;
            }

            persistentLeaveSchedule.onLeaveMembers = persistentLeaveSchedule.onLeaveMembers.filter(item => item.member !== context.memberToSetLeave); // ✅ context.
            persistentLeaveSchedule.onLeaveMembers.push(leaveData);
            await saveLeaveSchedule(db, persistentLeaveSchedule); 
            markDataAsDirty();

            saveProgress(true); // 이력(history)에도 즉시 저장
        }

        showToast(`${context.memberToSetLeave}님을 '${leaveType}'(으)로 설정했습니다.`); // ✅ context.
        if(leaveTypeModal) leaveTypeModal.classList.add('hidden');
        context.memberToSetLeave = null; // ✅ context.
    });
    }

    if (confirmCancelLeaveBtn) {
        confirmCancelLeaveBtn.addEventListener('click', async () => {
            if (!context.memberToCancelLeave) return; // ✅ context.

            const todayDateString = getTodayDateString();
            let actionTaken = false;

            const dailyIndex = appState.dailyOnLeaveMembers.findIndex(item => item.member === context.memberToCancelLeave); // ✅ context.
            if (dailyIndex > -1) {
                const entry = appState.dailyOnLeaveMembers[dailyIndex];
                if (entry.type === '외출') {
                    entry.endTime = getCurrentTime(); 
                    showToast(`${context.memberToCancelLeave}님이 복귀 처리되었습니다.`); // ✅ context.
                    actionTaken = true;
                } else {
                    appState.dailyOnLeaveMembers.splice(dailyIndex, 1);
                    showToast(`${context.memberToCancelLeave}님의 '${entry.type}' 상태가 취소되었습니다.`); // ✅ context.
                    actionTaken = true;
                }
                debouncedSaveState(); 
                
                saveProgress(true); // 이력(history)에도 즉시 저장
            }

            const persistentIndex = persistentLeaveSchedule.onLeaveMembers.findIndex(item => item.member === context.memberToCancelLeave); // ✅ context.
            if (persistentIndex > -1) {
                const entry = persistentLeaveSchedule.onLeaveMembers[persistentIndex];
                const isLeaveActiveToday = entry.startDate <= todayDateString && (!entry.endDate || todayDateString <= entry.endDate);

                if (isLeaveActiveToday) {
                    const today = new Date();
                    today.setDate(today.getDate() - 1);
                    const yesterday = today.toISOString().split('T')[0];
                    if (yesterday < entry.startDate) {
                        persistentLeaveSchedule.onLeaveMembers.splice(persistentIndex, 1);
                        showToast(`${context.memberToCancelLeave}님의 '${entry.type}' 일정이 취소되었습니다.`); // ✅ context.
                    } else {
                        entry.endDate = yesterday;
                        showToast(`${context.memberToCancelLeave}님이 복귀 처리되었습니다. (${entry.type}이 ${yesterday}까지로 수정됨)`); // ✅ context.
                    }
                } else {
                    persistentLeaveSchedule.onLeaveMembers.splice(persistentIndex, 1);
                    showToast(`${context.memberToCancelLeave}님의 '${entry.type}' 일정이 취소되었습니다.`); // ✅ context.
                }
                await saveLeaveSchedule(db, persistentLeaveSchedule); 
                markDataAsDirty();
                actionTaken = true;
                
                saveProgress(true); // 이력(history)에도 즉시 저장
            }

            if (!actionTaken) {
                 showToast(`${context.memberToCancelLeave}님의 근태 정보를 찾을 수 없습니다.`, true); // ✅ context.
            }

            if(cancelLeaveConfirmModal) cancelLeaveConfirmModal.classList.add('hidden');
            context.memberToCancelLeave = null; // ✅ context.
            
            // 상태 변경 후 화면을 즉시 새로고침합니다.
            render();
        });
    }

    // --- 7. 모달 공통 닫기 및 개별 닫기 리스너 ---
    document.querySelectorAll('.modal-close-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
          const modal = e.target.closest('.fixed.inset-0');
          if (!modal || modal.id === 'history-modal') return;
          modal.classList.add('hidden');
          const modalId = modal.id;
          
          if (modalId === 'leave-type-modal') {
              context.memberToSetLeave = null; // ✅ context.
              if(leaveDateInputsDiv) leaveDateInputsDiv.classList.add('hidden');
              const firstRadio = leaveTypeOptionsContainer?.querySelector('input[type="radio"]');
              if (firstRadio) firstRadio.checked = true;
          } else if (modalId === 'cancel-leave-confirm-modal') {
              context.memberToCancelLeave = null; // ✅ context.
          } else if (modalId === 'team-select-modal') {
              context.tempSelectedMembers = []; // ✅ context.
              context.selectedTaskForStart = null; // ✅ context.
              context.selectedGroupForAdd = null; // ✅ context.
              modal.querySelectorAll('button[data-member-name].ring-2').forEach(card => {
                  card.classList.remove('ring-2','ring-blue-500','bg-blue-100');
              });
          } else if (modalId === 'delete-confirm-modal') {
              context.recordToDeleteId = null; // ✅ context.
              context.deleteMode = 'single'; // ✅ context.
          } else if (modalId === 'delete-history-modal') {
              context.historyKeyToDelete = null; // ✅ context.
          } else if (modalId === 'edit-record-modal') {
              context.recordToEditId = null; // ✅ context.
          } else if (modalId === 'quantity-on-stop-modal') {
              context.groupToStopId = null; // ✅ context.
              const input = document.getElementById('quantity-on-stop-input');
              if(input) input.value = '';
          } else if (modalId === 'stop-group-confirm-modal') { 
              context.groupToStopId = null; // ✅ context.
          } else if (modalId === 'stop-individual-confirm-modal') {
              context.recordToStopId = null; // ✅ context.
          } else if (modalId === 'manual-add-record-modal') { 
              if (manualAddForm) manualAddForm.reset();
          } else if (modalId === 'edit-start-time-modal') {
              context.recordIdOrGroupIdToEdit = null; // ✅ context.
              context.editType = null; // ✅ context.
              if (editStartTimeInput) editStartTimeInput.value = '';
              if (editStartTimeContextIdInput) editStartTimeContextIdInput.value = '';
              if (editStartTimeContextTypeInput) editStartTimeContextTypeInput.value = '';
          } else if (modalId === 'edit-attendance-record-modal') {
              if (editAttendanceDateKeyInput) editAttendanceDateKeyInput.value = '';
              if (editAttendanceRecordIndexInput) editAttendanceRecordIndexInput.value = '';
          } else if (modalId === 'add-attendance-record-modal') {
              if (addAttendanceForm) addAttendanceForm.reset();
              if (addAttendanceDateKeyInput) addAttendanceDateKeyInput.value = '';
              if (addAttendanceTimeFields) addAttendanceTimeFields.classList.add('hidden');
              if (addAttendanceDateFields) addAttendanceDateFields.classList.add('hidden');
          } else if (modalId === 'edit-leave-record-modal') {
              document.getElementById('edit-leave-original-member-name').value = '';
              document.getElementById('edit-leave-original-start-identifier').value = '';
              document.getElementById('edit-leave-original-type').value = '';
              document.getElementById('edit-leave-time-fields').classList.add('hidden');
              document.getElementById('edit-leave-date-fields').classList.add('hidden');
          }
      });
    });
    if (cancelCancelLeaveBtn) cancelCancelLeaveBtn.addEventListener('click', () => { if(cancelLeaveConfirmModal) cancelLeaveConfirmModal.classList.add('hidden'); context.memberToCancelLeave = null; }); // ✅ context.
    if (cancelLeaveBtn) cancelLeaveBtn.addEventListener('click', () => { if(leaveTypeModal) leaveTypeModal.classList.add('hidden'); context.memberToSetLeave = null; }); // ✅ context.
    if (cancelDeleteBtn) cancelDeleteBtn.addEventListener('click', () => { if(deleteConfirmModal) deleteConfirmModal.classList.add('hidden'); context.recordToDeleteId = null; context.attendanceRecordToDelete = null; }); // ✅ context.
    if (cancelQuantityBtn) cancelQuantityBtn.addEventListener('click', () => { if (context.quantityModalContext.onCancel) context.quantityModalContext.onCancel(); if(quantityModal) quantityModal.classList.add('hidden'); }); // ✅ context.
    if (cancelHistoryDeleteBtn) cancelHistoryDeleteBtn.addEventListener('click', () => { if(deleteHistoryModal) deleteHistoryModal.classList.add('hidden'); context.historyKeyToDelete = null; }); // ✅ context.
    if (cancelEditBtn) cancelEditBtn.addEventListener('click', () => { if(editRecordModal) editRecordModal.classList.add('hidden'); context.recordToEditId = null; }); // ✅ context.
    if (cancelResetAppBtn) cancelResetAppBtn.addEventListener('click', () => { if(resetAppModal) resetAppModal.classList.add('hidden'); });
    if (cancelQuantityOnStopBtn) cancelQuantityOnStopBtn.addEventListener('click', () => { if(quantityOnStopModal) quantityOnStopModal.classList.add('hidden'); context.groupToStopId = null; }); // ✅ context.
    if (cancelStopIndividualBtn) cancelStopIndividualBtn.addEventListener('click', () => { if(stopIndividualConfirmModal) stopIndividualConfirmModal.classList.add('hidden'); context.recordToStopId = null; }); // ✅ context.
    if (cancelEditPartTimerBtn) cancelEditPartTimerBtn.addEventListener('click', () => { if(editPartTimerModal) editPartTimerModal.classList.add('hidden'); });
    if (cancelTeamSelectBtn) cancelTeamSelectBtn.addEventListener('click', () => {
         if(teamSelectModal) teamSelectModal.classList.add('hidden');
         context.tempSelectedMembers = []; context.selectedTaskForStart = null; context.selectedGroupForAdd = null; // ✅ context.
         teamSelectModal.querySelectorAll('button[data-member-name].ring-2').forEach(card => {
            card.classList.remove('ring-2','ring-blue-500','bg-blue-100');
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

    // --- 8. 기타 UI 리스너 ---
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

    // (근태 이력) '일별 상세' 보기 리스너 (수정/삭제/추가)
    if (attendanceHistoryViewContainer) {
        attendanceHistoryViewContainer.addEventListener('click', (e) => {
            
            // 1. '수정' 버튼 클릭
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
                if (editAttendanceRecordModal) editAttendanceRecordModal.classList.remove('hidden');
                return; 
            }
            
            // 2. '삭제' 버튼 클릭
            const deleteBtn = e.target.closest('button[data-action="delete-attendance"]');
            if (deleteBtn) {
                const dateKey = deleteBtn.dataset.dateKey;
                const index = parseInt(deleteBtn.dataset.index, 10);
                if (!dateKey || isNaN(index)) { return; }
                const dayData = allHistoryData.find(d => d.id === dateKey);
                const record = dayData?.onLeaveMembers?.[index];
                if (!record) { showToast('삭제할 근태 기록을 찾을 수 없습니다.', true); return; }

                context.deleteMode = 'attendance'; // ✅ context.
                context.attendanceRecordToDelete = { dateKey, index }; // ✅ context.
                
                const msgEl = document.getElementById('delete-confirm-message');
                if (msgEl) msgEl.textContent = `${record.member}님의 '${record.type}' 기록을 삭제하시겠습니까?`;
                if (deleteConfirmModal) deleteConfirmModal.classList.remove('hidden');
                return; 
            }

            // 3. '수동 추가' 버튼 클릭
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

                if (addAttendanceRecordModal) addAttendanceRecordModal.classList.remove('hidden');
                return;
            }
        });
    }

    // (이력) 근태 '수동 추가' 저장
    if (confirmAddAttendanceBtn) {
        confirmAddAttendanceBtn.addEventListener('click', async () => {
            const dateKey = addAttendanceDateKeyInput.value;
            const member = addAttendanceMemberNameInput.value.trim();
            const newType = addAttendanceTypeSelect.value;

            if (!dateKey) { showToast('저장할 날짜 정보를 찾지 못했습니다.', true); return; }
            if (!member) { showToast('이름을 입력하거나 선택해주세요.', true); return; }

            const dayDataIndex = allHistoryData.findIndex(d => d.id === dateKey);
            if (dayDataIndex === -1) { showToast('원본 이력 데이터를 찾을 수 없습니다.', true); return; }
            
            const dayData = allHistoryData[dayDataIndex];
            const newRecord = { member: member, type: newType };
            const isTimeBased = (newType === '외출' || newType === '조퇴');
            const isDateBased = (newType === '연차' || newType === '출장' || newType === '결근');

            if (isTimeBased) {
                const startTime = addAttendanceStartTimeInput.value;
                const endTime = addAttendanceEndTimeInput.value;
                if (!startTime) { showToast('시간 기반 근태는 시작 시간이 필수입니다.', true); return; }
                if (endTime && endTime < startTime) { showToast('종료 시간은 시작 시간보다 이후여야 합니다.', true); return; }
                newRecord.startTime = startTime;
                newRecord.endTime = endTime || null;
            } else if (isDateBased) {
                const startDate = addAttendanceStartDateInput.value;
                const endDate = addAttendanceEndDateInput.value;
                 if (!startDate) { showToast('날짜 기반 근태는 시작일이 필수입니다.', true); return; }
                if (endDate && endDate < startDate) { showToast('종료일은 시작일보다 이후여야 합니다.', true); return; }
                newRecord.startDate = startDate;
                newRecord.endDate = endDate || null;
            }

            if (!dayData.onLeaveMembers) dayData.onLeaveMembers = [];
            dayData.onLeaveMembers.push(newRecord);

            const historyDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
            try {
                await setDoc(historyDocRef, dayData); 
                showToast('근태 기록이 성공적으로 추가되었습니다.');
                renderAttendanceDailyHistory(dateKey, allHistoryData);
                if (addAttendanceRecordModal) addAttendanceRecordModal.classList.add('hidden');
            } catch (e) {
                console.error('Error adding attendance history:', e);
                showToast('근태 기록 저장 중 오류가 발생했습니다.', true);
                dayData.onLeaveMembers.pop();
            }
        });
    }
    
    // (이력) 근태 '수정' 저장
    if (confirmEditAttendanceBtn) {
        confirmEditAttendanceBtn.addEventListener('click', async () => {
            const dateKey = editAttendanceDateKeyInput.value;
            const index = parseInt(editAttendanceRecordIndexInput.value, 10);
            const newType = editAttendanceTypeSelect.value;

            confirmEditAttendanceBtn.disabled = true; 

            if (!dateKey || isNaN(index)) {
                showToast('저장할 기록 정보를 찾는 데 실패했습니다.', true);
                confirmEditAttendanceBtn.disabled = false; 
                return;
            }
            const dayDataIndex = allHistoryData.findIndex(d => d.id === dateKey);
            if (dayDataIndex === -1) {
                 showToast('원본 이력 데이터를 찾을 수 없습니다.', true);
                 confirmEditAttendanceBtn.disabled = false; 
                 return;
            }
            
            const dayData = { ...allHistoryData[dayDataIndex] }; 
            dayData.onLeaveMembers = dayData.onLeaveMembers ? [...dayData.onLeaveMembers] : []; 
            
            const recordToUpdate = dayData.onLeaveMembers[index];
            if (!recordToUpdate) {
                 showToast('원본 근태 기록을 찾지 못했습니다.', true);
                 confirmEditAttendanceBtn.disabled = false; 
                 return;
            }

            const updatedRecord = { member: recordToUpdate.member, type: newType };
            const isTimeBased = (newType === '외출' || newType === '조퇴');
            const isDateBased = (newType === '연차' || newType === '출장' || newType === '결근');

            try { 
                if (isTimeBased) {
                    const startTime = editAttendanceStartTimeInput.value;
                    const endTime = editAttendanceEndTimeInput.value; 
                    if (!startTime) throw new Error('시간 기반 근태는 시작 시간이 필수입니다.');
                    if (endTime && endTime < startTime) throw new Error('종료 시간은 시작 시간보다 이후여야 합니다.');
                    updatedRecord.startTime = startTime;
                    updatedRecord.endTime = endTime || null; 
                } else if (isDateBased) {
                    const startDate = editAttendanceStartDateInput.value;
                    const endDate = editAttendanceEndDateInput.value; 
                     if (!startDate) throw new Error('날짜 기반 근태는 시작일이 필수입니다.');
                    if (endDate && endDate < startDate) throw new Error('종료일은 시작일보다 이후여야 합니다.');
                    updatedRecord.startDate = startDate;
                    updatedRecord.endDate = endDate || null; 
                }
            } catch (validationError) { 
                showToast(validationError.message, true);
                confirmEditAttendanceBtn.disabled = false; 
                return; 
            }

            const originalRecord = allHistoryData[dayDataIndex].onLeaveMembers[index]; 
            allHistoryData[dayDataIndex].onLeaveMembers[index] = updatedRecord; 

            const historyDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
            try {
                await setDoc(historyDocRef, allHistoryData[dayDataIndex]); 
                showToast('근태 기록이 성공적으로 수정되었습니다.'); 
                renderAttendanceDailyHistory(dateKey, allHistoryData);
                if (editAttendanceRecordModal) editAttendanceRecordModal.classList.add('hidden');
            } catch (e) {
                console.error('Error updating attendance history:', e);
                showToast('근태 기록 저장 중 오류가 발생했습니다.', true);
                allHistoryData[dayDataIndex].onLeaveMembers[index] = originalRecord; 
            } finally {
                confirmEditAttendanceBtn.disabled = false;
            }
        });
    }

    // --- 9. 팀 선택 모달 (teamSelectModal) 리스너 ---
    if (teamSelectModal) {
      teamSelectModal.addEventListener('click', e => {
        const card = e.target.closest('button[data-member-name]');
        if (card && !card.disabled) {
            const memberName = card.dataset.memberName;
            const i = context.tempSelectedMembers.indexOf(memberName); // ✅ context.
            if (i > -1) { context.tempSelectedMembers.splice(i,1); card.classList.remove('ring-2','ring-blue-500','bg-blue-100'); } // ✅ context.
            else { context.tempSelectedMembers.push(memberName); card.classList.add('ring-2','ring-blue-500','bg-blue-100'); } // ✅ context.
            return;
        }

        const selectAllBtn = e.target.closest('.group-select-all-btn');
        if (selectAllBtn) {
            const groupName = selectAllBtn.dataset.groupName;
            const memberListContainer = teamSelectModal.querySelector(`div[data-group-name="${groupName}"]`);
            if (!memberListContainer) return;
            const memberCards = Array.from(memberListContainer.querySelectorAll('button[data-member-name]'));
            const availableMembers = memberCards.filter(c => !c.disabled).map(c => c.dataset.memberName);
            if (availableMembers.length === 0) return;
            const areAllSelected = availableMembers.every(m => context.tempSelectedMembers.includes(m)); // ✅ context.
            if (areAllSelected) {
                context.tempSelectedMembers = context.tempSelectedMembers.filter(m => !availableMembers.includes(m)); // ✅ context.
                memberCards.forEach(c => { if (!c.disabled) c.classList.remove('ring-2','ring-blue-500','bg-blue-100'); });
            } else {
                availableMembers.forEach(m => { if (!context.tempSelectedMembers.includes(m)) context.tempSelectedMembers.push(m); }); // ✅ context.
                memberCards.forEach(c => { if (!c.disabled) c.classList.add('ring-2','ring-blue-500','bg-blue-100'); });
            }
            return;
        }

        const addPartTimerBtn = e.target.closest('#add-part-timer-modal-btn');
        if (addPartTimerBtn) {
            appState.partTimers = appState.partTimers || [];
            let counter = appState.partTimers.length + 1;
            const baseName = '알바 ';
            const existingNames = (appConfig.teamGroups || []).flatMap(g => g.members).concat(appState.partTimers.map(p => p.name));
            let newName = `${baseName}${counter}`;
            while (existingNames.includes(newName)) { counter++; newName = `${baseName}${counter}`; }

            const newId = Date.now();
            const newWage = appConfig.defaultPartTimerWage || 10000;
            appState.partTimers.push({ id: newId, name: newName, wage: newWage });

            debouncedSaveState(); 
            renderTeamSelectionModalContent(context.selectedTaskForStart, appState, appConfig.teamGroups); // ✅ context.
            return;
        }

        const editPartTimerBtn = e.target.closest('.edit-part-timer-btn');
        if (editPartTimerBtn) {
            const id = Number(editPartTimerBtn.dataset.partTimerId);
            const pt = (appState.partTimers || []).find(p => p.id === id);
            if (pt) {
                if (partTimerEditIdInput) partTimerEditIdInput.value = id;
                if (partTimerNewNameInput) partTimerNewNameInput.value = pt.name;
                if (editPartTimerModal) editPartTimerModal.classList.remove('hidden');
            }
            return;
        }

        const deletePartTimerBtn = e.target.closest('.delete-part-timer-btn');
        if (deletePartTimerBtn) {
            const id = Number(deletePartTimerBtn.dataset.partTimerId);
            appState.partTimers = (appState.partTimers || []).filter(p => p.id !== id);
            debouncedSaveState(); 
            renderTeamSelectionModalContent(context.selectedTaskForStart, appState, appConfig.teamGroups); // ✅ context.
            return;
        }
    });
    }

    if (confirmEditPartTimerBtn) {
      confirmEditPartTimerBtn.addEventListener('click', () => {
        const id = Number(partTimerEditIdInput?.value);
        const idx = (appState.partTimers || []).findIndex(p => p.id === id);
        if (idx === -1) { if (editPartTimerModal) editPartTimerModal.classList.add('hidden'); return; }
        const partTimer = appState.partTimers[idx];
        const newNameRaw = partTimerNewNameInput?.value || '';
        const newName = newNameRaw.trim();
        if (!newName) { showToast('알바 이름은 비워둘 수 없습니다.', true); return; }

        const nOld = normalizeName(partTimer.name);
        const nNew = normalizeName(newName);
        if (nOld === nNew) { if (editPartTimerModal) editPartTimerModal.classList.add('hidden'); return; }

        const allNamesNorm = (appConfig.teamGroups || []).flatMap(g => g.members).map(normalizeName)
            .concat((appState.partTimers || []).filter((p, i) => i !== idx).map(p => normalizeName(p.name)));
        if (allNamesNorm.includes(nNew)) { showToast('해당 이름은 이미 사용 중입니다.', true); return; }

        const oldName = partTimer.name;
        appState.partTimers[idx] = { ...partTimer, name: newName };
        appState.workRecords = (appState.workRecords || []).map(r => (r.member === oldName ? { ...r, member: newName } : r));
        
        debouncedSaveState(); 
        
        renderTeamSelectionModalContent(context.selectedTaskForStart, appState, appConfig.teamGroups); // ✅ context.
        if (editPartTimerModal) editPartTimerModal.classList.add('hidden');
        showToast('알바 이름이 수정되었습니다.');
    });
    }

    const confirmTeamSelectBtn = document.getElementById('confirm-team-select-btn');
    if (confirmTeamSelectBtn) {
      confirmTeamSelectBtn.addEventListener('click', () => {
      if (context.tempSelectedMembers.length === 0) { showToast('추가할 팀원을 선택해주세요.', true); return; } // ✅ context.
      if (context.selectedGroupForAdd !== null) { // ✅ context.
        addMembersToWorkGroup(context.tempSelectedMembers, context.selectedTaskForStart, context.selectedGroupForAdd); // ✅ context.
        showToast(`${context.selectedTaskForStart} 업무에 인원이 추가되었습니다.`); // ✅ context.
      } else if (context.selectedTaskForStart) { // ✅ context.
        startWorkGroup(context.tempSelectedMembers, context.selectedTaskForStart); // ✅ context.
        showToast(`${context.selectedTaskForStart} 업무를 시작합니다.`); // ✅ context.
      }
      if (teamSelectModal) teamSelectModal.classList.add('hidden');
      context.tempSelectedMembers = []; context.selectedTaskForStart = null; context.selectedGroupForAdd = null; // ✅ context.
    });
    }
    
    // --- 10. 메뉴 및 햄버거 리스너 ---
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

    // --- 11. 기타 모달 (시작 시간 수정, 수동 추가 등) ---
    if (confirmEditStartTimeBtn) {
        confirmEditStartTimeBtn.addEventListener('click', () => {
            const newStartTime = editStartTimeInput?.value;
            const contextId = editStartTimeContextIdInput?.value;
            const contextType = editStartTimeContextTypeInput?.value;

            if (!newStartTime || !contextId || !contextType) {
                showToast('시간 변경 정보를 가져올 수 없습니다.', true); return;
            }

            let updated = false;
            if (contextType === 'group') {
                const groupId = Number(contextId);
                appState.workRecords.forEach(record => {
                    if (record.groupId === groupId && (record.status === 'ongoing' || record.status === 'paused')) {
                        record.startTime = newStartTime;
                        updated = true;
                    }
                });
                if (updated) showToast('그룹 시작 시간이 변경되었습니다.');

            } else if (contextType === 'individual') {
                const recordId = contextId; 
                const recordIndex = appState.workRecords.findIndex(r => String(r.id) === String(recordId));
                if (recordIndex !== -1) {
                    appState.workRecords[recordIndex].startTime = newStartTime;
                    updated = true;
                    showToast('개별 시작 시간이 변경되었습니다.');
                } else {
                    showToast('해당 기록을 찾을 수 없습니다.', true);
                }
            }
            if (updated) {
                debouncedSaveState(); 
                render(); 
            }
            if (editStartTimeModal) editStartTimeModal.classList.add('hidden');
            context.recordIdOrGroupIdToEdit = null; context.editType = null; // ✅ context.
            if (editStartTimeInput) editStartTimeInput.value = '';
            if (editStartTimeContextIdInput) editStartTimeContextIdInput.value = '';
            if (editStartTimeContextTypeInput) editStartTimeContextTypeInput.value = '';
        });
    }

    if (cancelEditStartTimeBtn) {
        cancelEditStartTimeBtn.addEventListener('click', () => {
            if (editStartTimeModal) editStartTimeModal.classList.add('hidden');
            context.recordIdOrGroupIdToEdit = null; context.editType = null; // ✅ context.
            if (editStartTimeInput) editStartTimeInput.value = '';
            if (editStartTimeContextIdInput) editStartTimeContextIdInput.value = '';
            if (editStartTimeContextTypeInput) editStartTimeContextTypeInput.value = '';
        });
    }

    if (openManualAddBtn) {
        openManualAddBtn.addEventListener('click', () => {
            renderManualAddModalDatalists(appState, appConfig);
            if (manualAddForm) manualAddForm.reset(); 
            if (manualAddRecordModal) manualAddRecordModal.classList.remove('hidden');
        });
    }

    if (openQuantityModalTodayBtn) {
        openQuantityModalTodayBtn.addEventListener('click', () => {
            if (!auth || !auth.currentUser) {
                showToast('로그인이 필요합니다.', true);
                if (loginModal) loginModal.classList.remove('hidden');
                return;
            }
            renderQuantityModalInputs(appState.taskQuantities || {}, appConfig.quantityTaskTypes || []);
            const title = document.getElementById('quantity-modal-title');
            if (title) title.textContent = '오늘의 처리량 입력';

            context.quantityModalContext.mode = 'today'; // ✅ context.
            context.quantityModalContext.dateKey = null; // ✅ context.
            context.quantityModalContext.onConfirm = async (newQuantities) => { // ✅ context.
                appState.taskQuantities = newQuantities;
                debouncedSaveState(); 
                showToast('오늘의 처리량이 저장되었습니다.');
                render();

                try {
                    const allDefinitions = getAllDashboardDefinitions(appConfig); 
                    const dashboardItemIds = appConfig.dashboardItems || [];     
                    const quantityTaskTypes = appConfig.quantityTaskTypes || []; 
                    const quantitiesFromState = appState.taskQuantities || {}; 
                    const taskNameToDashboardIdMap = appConfig.quantityToDashboardMap || {};
                    
                    for (const task in quantitiesFromState) {
                        if (!quantityTaskTypes.includes(task)) continue;
                        const quantity = newQuantities[task] || 0;
                        const targetDashboardId = taskNameToDashboardIdMap[task]; 

                        if (targetDashboardId && allDefinitions[targetDashboardId] && dashboardItemIds.includes(targetDashboardId)) {
                            const valueId = allDefinitions[targetDashboardId].valueId; 
                            const element = document.getElementById(valueId);        
                            if (element) {
                                element.textContent = quantity; 
                            } 
                        } 
                    }
                } catch (syncError) {
                    console.error("Error during dashboard sync:", syncError);
                }

                const todayDateKey = getTodayDateString();
                const todayHistoryIndex = allHistoryData.findIndex(d => d.id === todayDateKey);
                if (todayHistoryIndex > -1) {
                    const todayHistoryData = allHistoryData[todayHistoryIndex];
                    const updatedHistoryData = { ...todayHistoryData, taskQuantities: newQuantities };
                    allHistoryData[todayHistoryIndex] = updatedHistoryData;
                    const historyDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'history', todayDateKey);
                    try {
                        await setDoc(historyDocRef, updatedHistoryData);
                    } catch (e) {
                        console.error('오늘 날짜 이력(history) 처리량 업데이트 실패:', e);
                        allHistoryData[todayHistoryIndex] = todayHistoryData;
                    }
                }
            };
            context.quantityModalContext.onCancel = () => {}; // ✅ context.

            const cBtn = document.getElementById('confirm-quantity-btn');
            const xBtn = document.getElementById('cancel-quantity-btn');
            if (cBtn) cBtn.textContent = '저장';
            if (xBtn) xBtn.textContent = '취소';
            if (quantityModal) quantityModal.classList.remove('hidden');
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
            renderQuantityModalInputs(appState.taskQuantities || {}, appConfig.quantityTaskTypes || []);
            const title = document.getElementById('quantity-modal-title');
            if (title) title.textContent = '오늘의 처리량 입력';
            
            context.quantityModalContext.mode = 'today'; // ✅ context.
            context.quantityModalContext.dateKey = null; // ✅ context.
            context.quantityModalContext.onConfirm = (newQuantities) => { // ✅ context.
                appState.taskQuantities = newQuantities;
                debouncedSaveState(); 
                showToast('오늘의 처리량이 저장되었습니다.');
                render(); 
            };
            context.quantityModalContext.onCancel = () => {}; // ✅ context.

            const cBtn = document.getElementById('confirm-quantity-btn');
            const xBtn = document.getElementById('cancel-quantity-btn');
            if (cBtn) cBtn.textContent = '저장';
            if (xBtn) xBtn.textContent = '취소';
            if (quantityModal) quantityModal.classList.remove('hidden');
            if (navContent) navContent.classList.add('hidden');
        });
    }

    if (confirmManualAddBtn) {
        confirmManualAddBtn.addEventListener('click', () => {
            const member = document.getElementById('manual-add-member')?.value.trim();
            const task = document.getElementById('manual-add-task')?.value.trim();
            const startTime = document.getElementById('manual-add-start-time')?.value;
            const endTime = document.getElementById('manual-add-end-time')?.value;

            if (!member || !task || !startTime || !endTime) {
                showToast('모든 필드를 올바르게 입력해주세요.', true); return;
            }
            if (endTime < startTime) {
                showToast('종료 시간은 시작 시간보다 이후여야 합니다.', true); return;
            }

            const newId = generateId(); // ✅ context.recordCounter 사용
            const duration = calcElapsedMinutes(startTime, endTime, []);
            const newRecord = {
                id: newId, member: member, task: task,
                startTime: startTime, endTime: endTime, duration: duration,
                status: 'completed', groupId: null, pauses: []
            };
            appState.workRecords.push(newRecord);
            debouncedSaveState(); 
            showToast('수동 기록이 추가되었습니다.');
            if (manualAddRecordModal) manualAddRecordModal.classList.add('hidden');
            if (manualAddForm) manualAddForm.reset();
        });
    }

    if (cancelManualAddBtn) {
        cancelManualAddBtn.addEventListener('click', () => {
            if (manualAddRecordModal) manualAddRecordModal.classList.add('hidden');
            if (manualAddForm) manualAddForm.reset();
        });
    }

    // --- 12. 분석 탭 리스너 ---
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

    // --- 13. (메인) 통합 근태 수정 모달 리스너 ---
    if (editLeaveModal) {
        const typeSelect = document.getElementById('edit-leave-type');
        const timeFields = document.getElementById('edit-leave-time-fields');
        const dateFields = document.getElementById('edit-leave-date-fields');
        const confirmBtn = document.getElementById('confirm-edit-leave-record-btn');
        const deleteBtn = document.getElementById('delete-leave-record-btn');
        const cancelBtn = document.getElementById('cancel-edit-leave-record-btn');
        const originalNameInput = document.getElementById('edit-leave-original-member-name');
        const originalStartInput = document.getElementById('edit-leave-original-start-identifier');
        const originalTypeInput = document.getElementById('edit-leave-original-type');

        typeSelect?.addEventListener('change', (e) => {
            const selectedType = e.target.value;
            const isTimeBased = (selectedType === '외출' || selectedType === '조퇴');
            timeFields?.classList.toggle('hidden', !isTimeBased);
            dateFields?.classList.toggle('hidden', isTimeBased);
        });

        confirmBtn?.addEventListener('click', async () => {
            const memberName = originalNameInput.value;
            const originalStart = originalStartInput.value;
            const originalRecordType = originalTypeInput.value; 
            const newType = typeSelect.value;

            if (!memberName || !originalStart || !originalRecordType) {
                showToast('원본 기록 정보를 찾을 수 없습니다.', true); return;
            }

            const isNewTimeBased = (newType === '외출' || newType === '조퇴');
            const isNewDateBased = !isNewTimeBased;
            const isOriginalTimeBased = (originalRecordType === 'daily');
            const isOriginalDateBased = !isOriginalTimeBased;

            let updatedRecord = { member: memberName, type: newType };
            let validationError = null;

            try {
                if (isNewTimeBased) {
                    const startTime = document.getElementById('edit-leave-start-time').value;
                    const endTime = document.getElementById('edit-leave-end-time').value; 
                    if (!startTime) throw new Error('시작 시간은 필수입니다.');
                    if (endTime && endTime < startTime) throw new Error('종료 시간은 시작 시간보다 이후여야 합니다.');
                    updatedRecord.startTime = startTime;
                    updatedRecord.endTime = endTime || null; 
                } else { 
                    const startDate = document.getElementById('edit-leave-start-date').value;
                    const endDate = document.getElementById('edit-leave-end-date').value; 
                    if (!startDate) throw new Error('시작일은 필수입니다.');
                    if (endDate && endDate < startDate) throw new Error('종료일은 시작일보다 이후여야 합니다.');
                    updatedRecord.startDate = startDate;
                    updatedRecord.endDate = endDate || null; 
                }
            } catch (e) {
                validationError = e.message;
            }

            if (validationError) {
                showToast(validationError, true); return;
            }

            let foundAndUpdated = false;
            let recordRemoved = null; 

            if (isOriginalTimeBased) {
                const index = appState.dailyOnLeaveMembers.findIndex(r => r.member === memberName && r.startTime === originalStart);
                if (index > -1) {
                    if (isNewTimeBased) { 
                        appState.dailyOnLeaveMembers[index] = updatedRecord;
                    } else { 
                        recordRemoved = appState.dailyOnLeaveMembers.splice(index, 1)[0];
                        persistentLeaveSchedule.onLeaveMembers.push(updatedRecord);
                    }
                    foundAndUpdated = true;
                }
            } 
            else { 
                const index = persistentLeaveSchedule.onLeaveMembers.findIndex(r => r.member === memberName && r.startDate === originalStart);
                if (index > -1) {
                     if (isNewDateBased) { 
                        persistentLeaveSchedule.onLeaveMembers[index] = updatedRecord;
                    } else { 
                        recordRemoved = persistentLeaveSchedule.onLeaveMembers.splice(index, 1)[0];
                        appState.dailyOnLeaveMembers.push(updatedRecord);
                    }
                    foundAndUpdated = true;
                }
            }

            if (foundAndUpdated) {
                try {
                    let savePersistentPromise = Promise.resolve();
                    if (isNewTimeBased || isOriginalTimeBased) { 
                        debouncedSaveState(); 
                    }
                    if (isNewDateBased || isOriginalDateBased) { 
                         savePersistentPromise = saveLeaveSchedule(db, persistentLeaveSchedule); 
                    }
                    await savePersistentPromise; 
                    showToast('근태 기록이 성공적으로 수정되었습니다.');
                    editLeaveModal.classList.add('hidden');
                    render(); 
                } catch (e) {
                    console.error('Error saving updated leave record:', e);
                    showToast('근태 기록 저장 중 오류가 발생했습니다.', true);
                    if (recordRemoved) {
                        if (isOriginalTimeBased) appState.dailyOnLeaveMembers.push(recordRemoved);
                        else persistentLeaveSchedule.onLeaveMembers.push(recordRemoved);
                    }
                }
            } else {
                showToast('원본 근태 기록을 찾지 못해 수정할 수 없습니다.', true);
            }
        });

        deleteBtn?.addEventListener('click', () => {
            const memberName = originalNameInput.value;
            const originalStart = originalStartInput.value;
            const originalRecordType = originalTypeInput.value; 

            if (!memberName || !originalStart || !originalRecordType) {
                showToast('삭제할 기록 정보를 찾을 수 없습니다.', true); return;
            }
            context.deleteMode = 'leave'; // ✅ context.
            context.attendanceRecordToDelete = { // ✅ context.
                memberName: memberName, 
                startIdentifier: originalStart, 
                recordType: originalRecordType 
            }; 
            
            const msgEl = document.getElementById('delete-confirm-message');
            if (msgEl) msgEl.textContent = `${memberName}님의 근태 기록을 삭제하시겠습니까?`;
            
            editLeaveModal.classList.add('hidden'); 
            document.getElementById('delete-confirm-modal')?.classList.remove('hidden'); 
        });

        cancelBtn?.addEventListener('click', () => {
            editLeaveModal.classList.add('hidden');
            originalNameInput.value = '';
            originalStartInput.value = '';
            originalTypeInput.value = '';
            timeFields.classList.add('hidden');
            dateFields.classList.add('hidden');
        });
    }


    // --- 14. 이력 모달 드래그 기능 ---
    const historyHeader = document.getElementById('history-modal-header');
    if (historyModal && historyHeader && historyModalContentBox) {
        makeDraggable(historyModal, historyHeader, historyModalContentBox);
    }

    // --- 15. 이력 모달 전체화면 버튼 리스너 ---
    const toggleFullscreenBtn = document.getElementById('toggle-history-fullscreen-btn');
    if (toggleFullscreenBtn && historyModal && historyModalContentBox) {
        toggleFullscreenBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            
            // 드래그로 인해 적용된 인라인 스타일 초기화
            historyModalContentBox.style.position = '';
            historyModalContentBox.style.top = '';
            historyModalContentBox.style.left = '';
            historyModalContentBox.style.transform = '';
            historyModalContentBox.dataset.hasBeenUncentered = 'false';

            // 오버레이(배경)의 정렬 클래스 토글
            historyModal.classList.toggle('flex');
            historyModal.classList.toggle('items-center');
            historyModal.classList.toggle('justify-center');
            
            // 콘텐츠 박스의 크기 클래스 토글
            historyModalContentBox.classList.toggle('max-w-7xl'); // (기본) 최대 너비
            historyModalContentBox.classList.toggle('h-[90vh]');  // (기본) 높이
            historyModalContentBox.classList.toggle('w-screen');  // (전체) 너비 100vw
            historyModalContentBox.classList.toggle('h-screen');  // (전체) 높이 100vh
            historyModalContentBox.classList.toggle('max-w-none');// (전체) 최대 너비 없음

            // 아이콘 변경
            const icon = toggleFullscreenBtn.querySelector('svg');
            const isFullscreen = historyModalContentBox.classList.contains('w-screen');
            if (isFullscreen) {
                // 축소 아이콘
                icon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" d="M10 4H4v6m0 0l6 6m-6-6l6-6m10 10h6v-6m0 0l-6-6m6 6l-6 6" />`;
                toggleFullscreenBtn.title = "기본 크기로";
            } else {
                // 확대 아이콘
                icon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m0 0V4m0 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5h-4m0 0v-4m0 0l-5-5" />`;
                toggleFullscreenBtn.title = "전체화면";
            }
        });
    }

    // --- 16. 로그인/로그아웃 리스너 ---
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
                // onAuthStateChanged in app.js가 성공 처리를 합니다.
                if (loginPasswordInput) loginPasswordInput.value = ''; // 비밀번호 필드 지우기
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
                // onAuthStateChanged in app.js가 UI 변경을 처리합니다.
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
                // onAuthStateChanged in app.js가 UI 변경을 처리합니다.
            } catch (error) {
                console.error('Logout error:', error);
                showToast('로그아웃 중 오류가 발생했습니다.', true);
            }
        });
    }


} // <-- initializeAppListeners() 함수 끝

/**
 * 모달 팝업을 드래그 가능하게 만듭니다.
 */
function makeDraggable(modalOverlay, header, contentBox) {
    let isDragging = false;
    let offsetX, offsetY;

    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) {
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
        
        // 화면 밖으로 드래그할 수 있도록 경계 제한 로직 주석 처리
        /*
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const boxWidth = contentBox.offsetWidth;
        const boxHeight = contentBox.offsetHeight;

        if (newLeft < 0) newLeft = 0;
        if (newTop < 0) newTop = 0;
        if (newLeft + boxWidth > viewportWidth) newLeft = viewportWidth - boxWidth;
        if (newTop + boxHeight > viewportHeight) newTop = viewportHeight - boxHeight;
        */

        contentBox.style.left = `${newLeft}px`;
        contentBox.style.top = `${newTop}px`;
    }

    function onMouseUp() {
        isDragging = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }
}