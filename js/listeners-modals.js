// === js/listeners-modals.js ===
import {
    appState, appConfig, db, auth,
    context,
    teamSelectModal,
    deleteConfirmModal,
    confirmDeleteBtn,
    cancelDeleteBtn,
    historyModal,
    closeHistoryBtn,
    quantityModal,
    // ✅ [추가] 처리량 모달 버튼 import
    confirmQuantityBtn,
    cancelQuantityBtn,
    deleteHistoryModal,
    confirmHistoryDeleteBtn,
    cancelHistoryDeleteBtn,
    editRecordModal,
    confirmEditBtn,
    cancelEditBtn,
    quantityOnStopModal,
    confirmQuantityOnStopBtn,
    cancelQuantityOnStopBtn,
    resetAppModal,
    confirmResetAppBtn,
    cancelResetAppBtn,
    taskSelectModal,
    stopIndividualConfirmModal,
    confirmStopIndividualBtn,
    cancelStopIndividualBtn,
    stopIndividualConfirmMessage,
    editPartTimerModal,
    confirmEditPartTimerBtn,
    cancelEditPartTimerBtn,
    partTimerNewNameInput,
    partTimerEditIdInput,
    cancelTeamSelectBtn,
    leaveTypeModal,
    confirmLeaveBtn,
    cancelLeaveBtn,
    cancelLeaveConfirmModal,
    confirmCancelLeaveBtn,
    cancelCancelLeaveBtn,
    manualAddRecordModal,
    confirmManualAddBtn,
    cancelManualAddBtn,
    manualAddForm,
    endShiftConfirmModal,
    confirmEndShiftBtn,
    cancelEndShiftBtn,
    loginModal,
    loginForm,
    loginSubmitBtn,
    loginErrorMsg,
    loginButtonText,
    loginButtonSpinner,
    editStartTimeModal,
    confirmEditStartTimeBtn,
    cancelEditStartTimeBtn,
    editLeaveModal,
    coqExplanationModal,
    addAttendanceRecordModal,
    addAttendanceForm,
    confirmAddAttendanceBtn,
    cancelAddAttendanceBtn,
    addAttendanceMemberNameInput,
    addAttendanceTypeSelect,
    addAttendanceStartTimeInput,
    addAttendanceEndTimeInput,
    addAttendanceStartDateInput,
    addAttendanceEndDateInput,
    addAttendanceDateKeyInput,
    addAttendanceTimeFields,
    addAttendanceDateFields,
    editAttendanceRecordModal,
    confirmEditAttendanceBtn,
    cancelEditAttendanceBtn,
    editAttendanceTypeSelect,
    editAttendanceStartTimeInput,
    editAttendanceEndTimeInput,
    editAttendanceStartDateInput,
    editAttendanceEndDateInput,
    editAttendanceDateKeyInput,
    editAttendanceRecordIndexInput,
    editAttendanceTimeFields,
    editAttendanceDateFields,
    pcClockOutCancelBtn,
    mobileClockOutCancelBtn,
    memberActionModal,

    generateId,
    saveStateToFirestore, 
    debouncedSaveState, 
    render,
    persistentLeaveSchedule,
    allHistoryData, 
    LEAVE_TYPES 
} from './app.js';

import { getTodayDateString, getCurrentTime, formatTimeTo24H, showToast, calcElapsedMinutes } from './utils.js';

import {
    renderTaskSelectionModal,
    renderTeamSelectionModalContent,
} from './ui-modals.js';

import {
    startWorkGroup,
    addMembersToWorkGroup,
    finalizeStopGroup,
    stopWorkIndividual,
    processClockOut, 
    cancelClockOut 
} from './app-logic.js';

import { saveProgress, saveDayDataToHistory, switchHistoryView } from './app-history-logic.js';
import { saveLeaveSchedule } from './config.js';

import { signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, updateDoc, deleteDoc, writeBatch, collection, query, where, getDocs, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { renderAttendanceDailyHistory } from './ui-history.js';


/**
 * Firestore 'workRecords' 하위 컬렉션에서
 * 특정 ID의 문서를 삭제하는 헬퍼 함수
 */
const deleteWorkRecordDocument = async (recordId) => {
    if (!recordId) return;
    try {
        const today = getTodayDateString();
        const docRef = doc(db, 'artifacts', 'team-work-logger-v2', 'daily_data', today, 'workRecords', recordId);
        await deleteDoc(docRef);
    } catch (e) {
        console.error("Error deleting work record document: ", e);
        showToast("문서 삭제 중 오류 발생.", true);
    }
};

/**
 * Firestore 'workRecords' 하위 컬렉션의
 * 여러 문서를 일괄 삭제하는 헬퍼 함수
 */
const deleteWorkRecordDocuments = async (recordIds) => {
    if (!recordIds || recordIds.length === 0) return;
    try {
        const today = getTodayDateString();
        const colRef = collection(db, 'artifacts', 'team-work-logger-v2', 'daily_data', today, 'workRecords');
        const batch = writeBatch(db);

        recordIds.forEach(recordId => {
            const docRef = doc(colRef, recordId);
            batch.delete(docRef);
        });

        await batch.commit();
    } catch (e) {
        console.error("Error batch deleting work record documents: ", e);
        showToast("여러 문서 삭제 중 오류 발생.", true);
    }
};

// 모든 모달의 이벤트 리스너를 설정
export function setupGeneralModalListeners() {

    // 모달 닫기 버튼 (공통)
    document.querySelectorAll('.modal-close-btn, .modal-cancel-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const modal = btn.closest('.modal-overlay, .fixed.inset-0'); 
            if (modal) {
                modal.classList.add('hidden');
            }
        });
    });

    // 팀 선택 모달
    if (teamSelectModal) {
        teamSelectModal.addEventListener('click', async (e) => {
            const target = e.target;
            const memberButton = target.closest('.member-select-btn');

            if (memberButton) {
                const memberName = memberButton.dataset.member;
                const isSelected = memberButton.classList.toggle('bg-blue-600');
                memberButton.classList.toggle('bg-gray-200');
                memberButton.classList.toggle('text-white');

                if (isSelected) {
                    if (!context.tempSelectedMembers.includes(memberName)) {
                        context.tempSelectedMembers.push(memberName);
                    }
                } else {
                    context.tempSelectedMembers = context.tempSelectedMembers.filter(m => m !== memberName);
                }
            } 
        });

        const confirmTeamSelectBtn = document.getElementById('confirm-team-select-btn');
        if (confirmTeamSelectBtn) {
             confirmTeamSelectBtn.addEventListener('click', async () => {
                if (context.selectedGroupForAdd) {
                    await addMembersToWorkGroup(context.tempSelectedMembers, context.selectedTaskForStart, context.selectedGroupForAdd);
                } else {
                    await startWorkGroup(context.tempSelectedMembers, context.selectedTaskForStart);
                }
                teamSelectModal.classList.add('hidden');
             });
        }
    }


    if (cancelTeamSelectBtn) {
        cancelTeamSelectBtn.addEventListener('click', () => {
            teamSelectModal.classList.add('hidden');
        });
    }

    // 작업 선택 모달
    if (taskSelectModal) {
        taskSelectModal.addEventListener('click', (e) => {
            const taskButton = e.target.closest('.task-select-btn');
            if (taskButton) {
                const taskName = taskButton.dataset.task;
                context.selectedTaskForStart = taskName;
                context.selectedGroupForAdd = null; 
                context.tempSelectedMembers = []; 
                taskSelectModal.classList.add('hidden');
                
                renderTeamSelectionModalContent(taskName, appState, appConfig.teamGroups);
                
                const titleEl = document.getElementById('team-select-modal-title');
                const confirmBtn = document.getElementById('confirm-team-select-btn');
                if (titleEl) titleEl.textContent = `'${taskName}' 업무 시작`;
                if (confirmBtn) confirmBtn.textContent = '선택 완료 및 업무 시작';
                
                if (teamSelectModal) teamSelectModal.classList.remove('hidden');
            }
        });
    }

    // 삭제 확인 모달 (공통)
    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', async () => {
            
            if (context.deleteMode === 'group') {
                const groupMembers = (appState.workRecords || [])
                    .filter(r => String(r.groupId) === String(context.recordToDeleteId) && (r.status === 'ongoing' || r.status === 'paused'))
                    .map(r => r.id);
                
                if (groupMembers.length > 0) { 
                    await deleteWorkRecordDocuments(groupMembers);
                    showToast('그룹 업무가 삭제되었습니다.');
                }
            } else if (context.deleteMode === 'single') { 
                await deleteWorkRecordDocument(context.recordToDeleteId);
                showToast('업무 기록이 삭제되었습니다.');
            } else if (context.deleteMode === 'all-completed') { 
                 const completedIds = (appState.workRecords || [])
                    .filter(r => r.status === 'completed')
                    .map(r => r.id);
                
                if (completedIds.length > 0) {
                    await deleteWorkRecordDocuments(completedIds);
                    showToast(`완료된 업무 ${completedIds.length}건이 삭제되었습니다.`);
                } else {
                    showToast('삭제할 완료된 업무가 없습니다.');
                }
            }
            else if (context.deleteMode === 'attendance') {
                const { dateKey, index } = context.attendanceRecordToDelete;
                const dayData = allHistoryData.find(d => d.id === dateKey);
                
                if (dayData && dayData.onLeaveMembers && dayData.onLeaveMembers[index]) {
                    const deletedRecord = dayData.onLeaveMembers.splice(index, 1)[0];
                    try {
                        const historyDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
                        await setDoc(historyDocRef, { onLeaveMembers: dayData.onLeaveMembers }, { merge: true }); 
                        
                        showToast(`${deletedRecord.member}님의 '${deletedRecord.type}' 기록이 삭제되었습니다.`);
                        
                        const activeAttendanceTab = document.querySelector('#attendance-history-tabs button.font-semibold');
                        const view = activeAttendanceTab ? activeAttendanceTab.dataset.view : 'attendance-daily';
                        
                        await switchHistoryView(view); 
                    } catch (e) {
                         console.error('Error deleting attendance record:', e);
                         showToast('근태 기록 삭제 중 오류 발생', true);
                         dayData.onLeaveMembers.splice(index, 0, deletedRecord); // 롤백
                    }
                }
                context.attendanceRecordToDelete = null;
            }
            
            deleteConfirmModal.classList.add('hidden');
            context.recordToDeleteId = null;
            context.deleteMode = 'single';
        });
    }

    // ✅ [추가] 처리량 입력 모달 (오늘/이력 겸용)
    if (confirmQuantityBtn) {
        confirmQuantityBtn.addEventListener('click', () => {
            const inputs = quantityModal.querySelectorAll('#modal-task-quantity-inputs input[type="number"]');
            const newQuantities = {};
            inputs.forEach(input => {
                const task = input.dataset.task;
                const value = Number(input.value) || 0;
                if (task) {
                    newQuantities[task] = value;
                }
            });

            // ✅ '0건 확인' 체크된 항목 수집
            const confirmedCheckboxes = quantityModal.querySelectorAll('.confirm-zero-checkbox:checked');
            const confirmedZeroTasks = Array.from(confirmedCheckboxes).map(cb => cb.dataset.task);

            if (context.quantityModalContext.onConfirm) {
                context.quantityModalContext.onConfirm(newQuantities, confirmedZeroTasks);
            }
            quantityModal.classList.add('hidden');
        });
    }
    if (cancelQuantityBtn) {
        cancelQuantityBtn.addEventListener('click', () => {
            if (context.quantityModalContext.onCancel) {
                context.quantityModalContext.onCancel();
            }
            quantityModal.classList.add('hidden');
        });
    }


    // 기록 수정 모달
    if (confirmEditBtn) {
        confirmEditBtn.addEventListener('click', async () => {
            const recordId = context.recordToEditId; 
            const task = document.getElementById('edit-task-type').value; 
            const member = document.getElementById('edit-member-name').value;
            const startTime = document.getElementById('edit-start-time').value;
            const endTime = document.getElementById('edit-end-time').value;

            const record = (appState.workRecords || []).find(r => r.id === recordId);
            if (!record) {
                showToast('수정할 기록을 찾을 수 없습니다.', true);
                return;
            }
            
            if (startTime && endTime && startTime >= endTime) {
                showToast('시작 시간이 종료 시간보다 늦거나 같을 수 없습니다.', true);
                return;
            }

            try {
                const docRef = doc(db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString(), 'workRecords', recordId);
                
                const updates = {
                    task,
                    member,
                    startTime
                };

                if (endTime) {
                    updates.endTime = endTime;
                    updates.status = 'completed';
                    updates.duration = calcElapsedMinutes(startTime, endTime, record.pauses || []);
                } else {
                    updates.endTime = null;
                    updates.status = record.status === 'completed' ? 'ongoing' : record.status; 
                    updates.duration = null;
                }
                
                await updateDoc(docRef, updates);

                showToast('업무 기록이 수정되었습니다.');
                editRecordModal.classList.add('hidden');
            } catch (e) {
                console.error("Error updating work record: ", e);
                showToast("기록 수정 중 오류 발생", true);
            }
        });
    }

    // 작업 중지 시 처리량 입력 모달
    if (confirmQuantityOnStopBtn) {
        confirmQuantityOnStopBtn.addEventListener('click', async () => {
            const quantity = document.getElementById('quantity-on-stop-input').value;
            await finalizeStopGroup(context.groupToStopId, quantity);
            quantityOnStopModal.classList.add('hidden');
            context.groupToStopId = null;
        });
    }
    if (cancelQuantityOnStopBtn) {
        cancelQuantityOnStopBtn.addEventListener('click', async () => {
            await finalizeStopGroup(context.groupToStopId, null); // 처리량 없이 종료
            quantityOnStopModal.classList.add('hidden');
            context.groupToStopId = null;
        });
    }

    // 개별 작업 중지 확인 모달
    if (confirmStopIndividualBtn) {
        confirmStopIndividualBtn.addEventListener('click', async () => {
            await stopWorkIndividual(context.recordToStopId);
            stopIndividualConfirmModal.classList.add('hidden');
            context.recordToStopId = null;
        });
    }

    // 알바 이름 수정 모달
    if (confirmEditPartTimerBtn) {
        confirmEditPartTimerBtn.addEventListener('click', async () => {
            const partTimerId = document.getElementById('part-timer-edit-id').value;
            const newName = document.getElementById('part-timer-new-name').value.trim();
            
            if (!partTimerId || !newName) {
                showToast('정보가 누락되었습니다.', true);
                return;
            }

            const partTimer = (appState.partTimers || []).find(p => p.id === partTimerId);
            if (!partTimer) {
                showToast('수정할 알바 정보를 찾을 수 없습니다.', true);
                return;
            }

            const oldName = partTimer.name;
            if (oldName === newName) {
                showToast('이름이 변경되지 않았습니다.');
                document.getElementById('edit-part-timer-modal').classList.add('hidden');
                return;
            }
            
            const isNameTaken = (appConfig.teamGroups || []).flatMap(g => g.members).includes(newName) ||
                                (appState.partTimers || []).some(p => p.name === newName && p.id !== partTimerId);
            
            if (isNameTaken) {
                showToast(`'${newName}'(이)라는 이름은 이미 사용 중입니다.`, true);
                return;
            }

            partTimer.name = newName;

            (appState.workRecords || []).forEach(record => {
                if (record.member === oldName) {
                    record.member = newName;
                }
            });

            try {
                const today = getTodayDateString();
                const workRecordsColRef = collection(db, 'artifacts', 'team-work-logger-v2', 'daily_data', today, 'workRecords');
                const q = query(workRecordsColRef, where("member", "==", oldName));
                
                const querySnapshot = await getDocs(q);
                
                if (!querySnapshot.empty) {
                    const batch = writeBatch(db);
                    querySnapshot.forEach(doc => {
                        batch.update(doc.ref, { member: newName });
                    });
                    await batch.commit();
                    showToast(`'${oldName}'님의 당일 업무 ${querySnapshot.size}건의 이름도 '${newName}'으로 변경했습니다.`);
                } 
                
                debouncedSaveState(); 
                document.getElementById('edit-part-timer-modal').classList.add('hidden');
                render(); 

            } catch (e) {
                console.error("알바 이름 변경 중 Firestore 업데이트 실패: ", e);
                showToast("알바 이름 변경 중 Firestore DB 업데이트에 실패했습니다.", true);
                partTimer.name = oldName; 
                (appState.workRecords || []).forEach(record => {
                    if (record.member === newName) {
                        record.member = oldName;
                    }
                });
                render(); 
            }
        });
    }

    // 근태 유형 선택 모달
    if (confirmLeaveBtn) {
        confirmLeaveBtn.addEventListener('click', () => {
            const memberName = context.memberToSetLeave;
            const selectedTypeRadio = document.querySelector('input[name="leave-type"]:checked');
            if (!memberName || !selectedTypeRadio) {
                showToast('선택이 필요합니다.', true);
                return;
            }

            const type = selectedTypeRadio.value;
            const today = getTodayDateString();
            const startDate = document.getElementById('leave-start-date-input').value || today;
            const endDate = document.getElementById('leave-end-date-input').value || startDate;

            if (type === '연차' || type === '출장' || type === '결근') {
                if (startDate > endDate) {
                    showToast('종료 날짜는 시작 날짜보다 빠를 수 없습니다.', true);
                    return;
                }
                const newEntry = {
                    id: `leave-${Date.now()}`,
                    member: memberName,
                    type,
                    startDate,
                    endDate
                };
                persistentLeaveSchedule.onLeaveMembers.push(newEntry);
                saveLeaveSchedule(db, persistentLeaveSchedule); 
            } else {
                // 오늘 하루 (Daily)
                const newDailyEntry = {
                    member: memberName,
                    type: type,
                    startTime: (type === '외출' || type === '조퇴') ? getCurrentTime() : null,
                    endTime: null
                };
                appState.dailyOnLeaveMembers.push(newDailyEntry);
                debouncedSaveState(); 
            }

            showToast(`${memberName}님 ${type} 처리 완료.`);
            leaveTypeModal.classList.add('hidden');
        });
    }

    // 근태 취소 확인 모달
    if (confirmCancelLeaveBtn) {
        confirmCancelLeaveBtn.addEventListener('click', () => {
            const memberName = context.memberToCancelLeave;
            if (!memberName) return;

            let dailyChanged = false;
            let persistentChanged = false;

            const originalLength = appState.dailyOnLeaveMembers.length;
            appState.dailyOnLeaveMembers = appState.dailyOnLeaveMembers.filter(entry => entry.member !== memberName);
            if (appState.dailyOnLeaveMembers.length !== originalLength) {
                dailyChanged = true;
            }

            const today = getTodayDateString();
            persistentLeaveSchedule.onLeaveMembers = (persistentLeaveSchedule.onLeaveMembers || []).filter(entry => {
                if (entry.member === memberName) {
                    const endDate = entry.endDate || entry.startDate;
                    if (today >= entry.startDate && today <= (endDate || entry.startDate)) {
                        persistentChanged = true;
                        return false; 
                    }
                }
                return true; 
            });

            if (dailyChanged) {
                debouncedSaveState(); 
            }
            if (persistentChanged) {
                saveLeaveSchedule(db, persistentLeaveSchedule); 
            }

            if (dailyChanged || persistentChanged) {
                showToast(`${memberName}님 근태 기록(오늘)이 취소되었습니다.`);
            } else {
                showToast('취소할 근태 기록이 없습니다.');
            }

            cancelLeaveConfirmModal.classList.add('hidden');
            context.memberToCancelLeave = null;
        });
    }

    // 수동 기록 추가 모달
    if (confirmManualAddBtn) {
        confirmManualAddBtn.addEventListener('click', async () => {
            const member = document.getElementById('manual-add-member').value; 
            const task = document.getElementById('manual-add-task').value; 
            const startTime = document.getElementById('manual-add-start-time').value; 
            const endTime = document.getElementById('manual-add-end-time').value; 
            const pauses = []; 

            if (!member || !task || !startTime || !endTime) {
                showToast('모든 필드를 입력해야 합니다.', true);
                return;
            }
            if (startTime >= endTime) {
                showToast('시작 시간이 종료 시간보다 늦거나 같을 수 없습니다.', true);
                return;
            }

            try {
                const recordId = generateId();
                const duration = calcElapsedMinutes(startTime, endTime, pauses);
                
                const newRecordData = {
                    id: recordId,
                    member,
                    task,
                    startTime,
                    endTime,
                    duration,
                    status: 'completed',
                    groupId: `manual-${generateId()}`,
                    pauses: []
                };
                
                const docRef = doc(db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString(), 'workRecords', recordId);
                await setDoc(docRef, newRecordData); 

                showToast('수동 기록이 추가되었습니다.');
                manualAddRecordModal.classList.add('hidden');
                manualAddForm.reset();

            } catch (e) {
                console.error("Error adding manual work record: ", e);
                showToast("수동 기록 추가 중 오류 발생", true);
            }
        });
    }

    // 마감 및 저장 확인 모달
    if (confirmEndShiftBtn) {
        confirmEndShiftBtn.addEventListener('click', async () => {
            await saveDayDataToHistory(false); // 👈 마감 (초기화 없음)
            endShiftConfirmModal.classList.add('hidden');
        });
    }

    // 앱 초기화(오늘 데이터 삭제) 모달
    if (confirmResetAppBtn) {
        confirmResetAppBtn.addEventListener('click', async () => {
            const today = getTodayDateString();
            
            try {
                const workRecordsColRef = collection(db, 'artifacts', 'team-work-logger-v2', 'daily_data', today, 'workRecords');
                const q = query(workRecordsColRef);
                const querySnapshot = await getDocs(q);
                
                if (!querySnapshot.empty) {
                    const batch = writeBatch(db);
                    querySnapshot.forEach(doc => {
                        batch.delete(doc.ref);
                    });
                    await batch.commit();
                }

                const docRef = doc(db, 'artifacts', 'team-work-logger-v2', 'daily_data', today);
                await setDoc(docRef, { state: '{}' }); // 👈 삭제 대신 초기화

                appState.workRecords = [];
                appState.taskQuantities = {};
                appState.partTimers = [];
                appState.dailyOnLeaveMembers = [];
                appState.dailyAttendance = {};
                
                render();

                showToast('오늘 데이터가 모두 초기화되었습니다.');
                resetAppModal.classList.add('hidden');
                
            } catch (e) {
                console.error("오늘 데이터 초기화 실패: ", e);
                showToast("데이터 초기화 중 오류가 발생했습니다.", true);
            }
        });
    }
    
    // 시작 시간 수정 모달
    if (confirmEditStartTimeBtn) {
        confirmEditStartTimeBtn.addEventListener('click', async () => {
            const contextId = document.getElementById('edit-start-time-context-id').value;
            const contextType = document.getElementById('edit-start-time-context-type').value;
            const newStartTime = document.getElementById('edit-start-time-input').value;

            if (!contextId || !contextType || !newStartTime) {
                showToast('정보가 누락되었습니다.', true);
                return;
            }
            
            try {
                const today = getTodayDateString();
                const workRecordsColRef = collection(db, 'artifacts', 'team-work-logger-v2', 'daily_data', today, 'workRecords');

                if (contextType === 'individual') {
                    const docRef = doc(workRecordsColRef, contextId);
                    await updateDoc(docRef, { startTime: newStartTime });
                    
                } else if (contextType === 'group') {
                    const q = query(workRecordsColRef, where("groupId", "==", contextId), where("status", "in", ["ongoing", "paused"]));
                    const querySnapshot = await getDocs(q);
                    
                    if (!querySnapshot.empty) {
                        const batch = writeBatch(db);
                        querySnapshot.forEach(doc => {
                            batch.update(doc.ref, { startTime: newStartTime });
                        });
                        await batch.commit();
                    }
                }

                showToast('시작 시간이 수정되었습니다.');
                editStartTimeModal.classList.add('hidden');

            } catch (e) {
                 console.error("Error updating start time: ", e);
                 showToast("시작 시간 수정 중 오류가 발생", true);
            }
        });
    }
    
    // 이력 보기(History)의 근태 수정 모달
    if (confirmEditAttendanceBtn) {
        confirmEditAttendanceBtn.addEventListener('click', async () => {
            const dateKey = editAttendanceDateKeyInput?.value;
            const indexStr = editAttendanceRecordIndexInput?.value;

            if (!dateKey || indexStr === '') {
                showToast('수정할 기록 정보를 찾을 수 없습니다.', true); return;
            }
            const index = parseInt(indexStr, 10);

            const dayDataIndex = allHistoryData.findIndex(d => d.id === dateKey);
            if (dayDataIndex === -1) {
                showToast('해당 날짜의 이력 데이터를 찾을 수 없습니다.', true); return;
            }
            const dayData = allHistoryData[dayDataIndex];
            if (!dayData.onLeaveMembers || !dayData.onLeaveMembers[index]) {
                showToast('수정할 근태 기록을 찾을 수 없습니다.', true); return;
            }

            const newType = editAttendanceTypeSelect?.value;
            const isTimeBased = (newType === '외출' || newType === '조퇴');

            const updatedRecord = { ...dayData.onLeaveMembers[index], type: newType };

            if (isTimeBased) {
                updatedRecord.startTime = editAttendanceStartTimeInput?.value || null;
                updatedRecord.endTime = editAttendanceEndTimeInput?.value || null;
                delete updatedRecord.startDate;
                delete updatedRecord.endDate;
            } else {
                updatedRecord.startDate = editAttendanceStartDateInput?.value || null;
                updatedRecord.endDate = editAttendanceEndDateInput?.value || null;
                delete updatedRecord.startTime;
                delete updatedRecord.endTime;
            }

            if (isTimeBased && !updatedRecord.startTime) {
                showToast('시작 시간을 입력해주세요.', true); return;
            }
            if (!isTimeBased && !updatedRecord.startDate) {
                showToast('시작일을 입력해주세요.', true); return;
            }

            dayData.onLeaveMembers[index] = updatedRecord;

            try {
                const historyDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
                await setDoc(historyDocRef, { onLeaveMembers: dayData.onLeaveMembers }, { merge: true });

                showToast('근태 기록이 수정되었습니다.');
                if (editAttendanceRecordModal) editAttendanceRecordModal.classList.add('hidden');

                renderAttendanceDailyHistory(dateKey, allHistoryData);

            } catch (e) {
                console.error('Error updating attendance history:', e);
                showToast('근태 기록 저장 중 오류가 발생했습니다.', true);
            }
        });
    }

    // 이력 보기(History)의 근태 추가 모달
    if (confirmAddAttendanceBtn) {
        confirmAddAttendanceBtn.addEventListener('click', async () => {
            const dateKey = addAttendanceDateKeyInput?.value;
            if (!dateKey) {
                showToast('날짜 정보를 찾을 수 없습니다.', true); return;
            }

            const memberName = addAttendanceMemberNameInput?.value.trim();
            const type = addAttendanceTypeSelect?.value;
            if (!memberName || !type) {
                showToast('이름과 유형을 모두 입력해주세요.', true); return;
            }

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
                await setDoc(historyDocRef, { onLeaveMembers: dayData.onLeaveMembers }, { merge: true });

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

    // 이력 보기(History) 근태 모달의 '유형' 변경 시 UI 토글
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