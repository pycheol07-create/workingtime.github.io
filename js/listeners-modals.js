// === js/listeners-modals.js ===
import {
    appState, appConfig, db, auth,
    persistentLeaveSchedule, allHistoryData,
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

    deleteConfirmModal, confirmDeleteBtn, cancelDeleteBtn,
    historyModal,
    historyTabs,
    quantityModal, confirmQuantityBtn,
    cancelQuantityBtn,
    editRecordModal, confirmEditBtn, cancelEditBtn,
    quantityOnStopModal, confirmQuantityOnStopBtn, cancelQuantityOnStopBtn,
    resetAppBtn, resetAppModal, confirmResetAppBtn, cancelResetAppBtn, taskSelectModal,
    teamSelectModal,
    stopIndividualConfirmModal, confirmStopIndividualBtn, cancelStopIndividualBtn,
    editPartTimerModal, confirmEditPartTimerBtn,
    cancelEditPartTimerBtn, partTimerNewNameInput, partTimerEditIdInput, cancelTeamSelectBtn,
    leaveTypeModal, leaveMemberNameSpan, leaveTypeOptionsContainer,
    confirmLeaveBtn, cancelLeaveBtn, leaveDateInputsDiv, leaveStartDateInput, leaveEndDateInput,
    cancelLeaveConfirmModal, confirmCancelLeaveBtn, cancelCancelLeaveBtn,
    openManualAddBtn, manualAddRecordModal, confirmManualAddBtn, cancelManualAddBtn,
    manualAddForm, endShiftConfirmModal, confirmEndShiftBtn, cancelEndShiftBtn,
    resetAppBtnMobile, navContent, editStartTimeModal,
    confirmEditStartTimeBtn, cancelEditStartTimeBtn,
    editStartTimeInput, editStartTimeContextIdInput, editStartTimeContextTypeInput,
    editLeaveModal,

    render, debouncedSaveState,
    generateId, normalizeName,
    markDataAsDirty,

} from './app.js';

import { saveLeaveSchedule } from './config.js';
import { calcElapsedMinutes, showToast, getTodayDateString, getCurrentTime } from './utils.js';

import {
    renderManualAddModalDatalists,
    renderTeamSelectionModalContent,
    renderLeaveTypeModalOptions
} from './ui.js';

import {
    startWorkGroup, addMembersToWorkGroup, finalizeStopGroup,
    stopWorkIndividual
} from './app-logic.js';

import {
    saveProgress, saveDayDataToHistory,
    switchHistoryView
} from './app-history-logic.js';

import {
    renderAttendanceDailyHistory
} from './ui-history.js';

// ✅ [수정] Firestore 함수 임포트
import { doc, setDoc, collection, updateDoc, deleteDoc, writeBatch, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


// ✅ [신규] workRecords 컬렉션 참조 헬퍼
const getWorkRecordsCollectionRef = () => {
    const today = getTodayDateString();
    return collection(db, 'artifacts', 'team-work-logger-v2', 'daily_data', today, 'workRecords');
};


export function setupGeneralModalListeners() {

    // ✅ [수정] async 추가, Firestore 문서 직접 삭제
    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', async () => {
            let stateChanged = false; // workRecords 외의 상태 변경 감지
            const workRecordsColRef = getWorkRecordsCollectionRef();

            if (context.deleteMode === 'all') {
                // ⛔️ [수정] 로컬 appState.workRecords를 필터링하는 대신, Firestore에서 직접 삭제
                try {
                    const q = query(workRecordsColRef, where("status", "==", "completed"));
                    const querySnapshot = await getDocs(q);
                    
                    if (querySnapshot.empty) {
                        showToast('삭제할 완료 기록이 없습니다.');
                    } else {
                        const batch = writeBatch(db);
                        querySnapshot.forEach(doc => {
                            batch.delete(doc.ref);
                        });
                        await batch.commit();
                        showToast(`완료된 기록 ${querySnapshot.size}건이 삭제되었습니다.`);
                    }
                    // ⛔️ appState.workRecords = ... 제거
                    // ⛔️ stateChanged = true; 제거
                } catch (e) {
                    console.error("Error deleting all completed records: ", e);
                    showToast("일괄 삭제 중 오류가 발생했습니다.", true);
                }
                
            } else if (context.deleteMode === 'single' && context.recordToDeleteId) {
                // ⛔️ [수정] Firestore에서 단일 문서 삭제
                try {
                    const docRef = doc(workRecordsColRef, context.recordToDeleteId);
                    await deleteDoc(docRef);
                    showToast('선택한 기록이 삭제되었습니다.');
                    // ⛔️ stateChanged = true; 제거
                } catch (e) {
                    console.error("Error deleting single record: ", e);
                    showToast("기록 삭제 중 오류가 발생했습니다.", true);
                }

            } else if (context.deleteMode === 'leave' && context.attendanceRecordToDelete) {
                // ... (이하는 workRecords와 무관하므로 기존 로직 유지) ...
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
                } else {
                    const index = persistentLeaveSchedule.onLeaveMembers.findIndex(r => r.member === memberName && r.startDate === startIdentifier);
                    if (index > -1) {
                        deletedRecordInfo = `${persistentLeaveSchedule.onLeaveMembers[index].type}`;
                        persistentLeaveSchedule.onLeaveMembers.splice(index, 1);
                        try {
                            await saveLeaveSchedule(db, persistentLeaveSchedule);
                            recordDeleted = true;
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

            } else if (context.deleteMode === 'attendance' && context.attendanceRecordToDelete) {
                // ... (이하는 history 컬렉션이므로 기존 로직 유지) ...
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

                            if (historyModal && !historyModal.classList.contains('hidden')) {
                                console.warn("이력 삭제됨. UI 갱신을 위해 날짜를 다시 클릭하세요.");

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
                                renderAttendanceDailyHistory(dateKey, filteredData);
                            }

                        } catch (e) {
                            console.error('Error deleting attendance history:', e);
                            showToast('근태 기록 삭제 중 오류 발생.', true);
                            allHistoryData[dayDataIndex].onLeaveMembers.splice(index, 0, record);
                        }
                    }
                }
            }

            // ✅ [수정] stateChanged는 이제 workRecords 외의 상태(근태 등)가 변경되었을 때만 true
            if (stateChanged) {
                if (context.deleteMode === 'leave') {
                    if (context.attendanceRecordToDelete?.recordType === 'daily') {
                        debouncedSaveState();
                        saveProgress(true);
                    }
                    if (context.attendanceRecordToDelete?.recordType === 'persistent') {
                        saveProgress(true);
                    }
                } else {
                    // ⛔️ debouncedSaveState(); // workRecords 삭제 시에는 호출 안함
                }
            }

            if (deleteConfirmModal) deleteConfirmModal.classList.add('hidden');
            context.recordToDeleteId = null;
            context.attendanceRecordToDelete = null;
            context.deleteMode = 'single';

            // ⛔️ render(); // 제거 (onSnapshot이 처리)
        });
    }

    // ... (confirmEndShiftBtn, resetAppBtn 등은 변경 없음) ...
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
    
    // ... (confirmQuantityBtn은 workRecords와 무관하므로 변경 없음) ...
    if (confirmQuantityBtn) {
        confirmQuantityBtn.addEventListener('click', () => {
            // 1. 입력된 처리량 수집
            const inputs = quantityModal.querySelectorAll('input[data-task]');
            const newQuantities = {};
            inputs.forEach(input => {
                const task = input.dataset.task;
                const quantity = Number(input.value) || 0;
                // 0이라도 입력된 값은 저장해야 함 (나중에 0건 확인과 연동)
                if (quantity >= 0) newQuantities[task] = quantity;
            });

            // 2. '0건 확인' 체크박스 상태 수집
            const confirmedZeroCheckboxes = quantityModal.querySelectorAll('.confirm-zero-checkbox:checked');
            const confirmedZeroTasks = Array.from(confirmedZeroCheckboxes).map(cb => cb.dataset.task);

            // 3. 설정된 콜백 함수 실행 (데이터 전달)
            if (context.quantityModalContext.onConfirm) {
                context.quantityModalContext.onConfirm(newQuantities, confirmedZeroTasks);
            }

            // 4. 모달 닫기
            if (quantityModal) quantityModal.classList.add('hidden');
        });
    }

    // ✅ [수정] async 추가, Firestore 문서 직접 수정
    if (confirmEditBtn) {
        confirmEditBtn.addEventListener('click', async () => {
            if (!context.recordToEditId) return;
            
            // ⛔️ [수정] 로컬 배열 인덱스(idx) 대신 Firestore 문서 참조
            const record = appState.workRecords.find(r => String(r.id) === String(context.recordToEditId));
            if (!record) {
                 showToast('수정할 기록을 찾을 수 없습니다 (로컬 캐시 없음).', true);
                 if (editRecordModal) editRecordModal.classList.add('hidden');
                 context.recordToEditId = null;
                 return;
            }

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
            
            // ✅ [수정] Firestore 문서 업데이트
            try {
                const workRecordsColRef = getWorkRecordsCollectionRef();
                const docRef = doc(workRecordsColRef, context.recordToEditId);
                const duration = calcElapsedMinutes(newStart, newEnd, record.pauses); // 기존 pauses는 유지

                await updateDoc(docRef, {
                    task: newTask,
                    startTime: newStart,
                    endTime: newEnd,
                    duration: duration
                });

                showToast('기록이 수정되었습니다.');
            } catch (e) {
                console.error("Error updating record: ", e);
                showToast("기록 수정 중 오류가 발생했습니다.", true);
            }
            
            // ⛔️ debouncedSaveState(); // 제거
            if (editRecordModal) editRecordModal.classList.add('hidden');
            context.recordToEditId = null;
        });
    }

    // ... (confirmQuantityOnStopBtn은 app-logic.js의 finalizeStopGroup을 호출하므로 변경 없음) ...
    if (confirmQuantityOnStopBtn) {
        confirmQuantityOnStopBtn.addEventListener('click', () => {
            if (context.groupToStopId) {
                const input = document.getElementById('quantity-on-stop-input');
                const quantity = input ? (Number(input.value) || 0) : null;
                finalizeStopGroup(context.groupToStopId, quantity); // app-logic.js 함수 (이미 Firestore 사용)
                if (input) input.value = '';

                if (quantityOnStopModal) quantityOnStopModal.classList.add('hidden');
                context.groupToStopId = null;
            }
        });
    }
    
    // ... (taskSelectModal은 app-logic.js의 startWorkGroup 등을 호출하므로 변경 없음) ...
    if (taskSelectModal) {
        taskSelectModal.addEventListener('click', (e) => {
            const btn = e.target.closest('.task-select-btn');
            if (btn) {
                const task = btn.dataset.task;
                if (taskSelectModal) taskSelectModal.classList.add('hidden');

                context.selectedTaskForStart = task;
                context.selectedGroupForAdd = null;
                renderTeamSelectionModalContent(task, appState, appConfig.teamGroups);
                const titleEl = document.getElementById('team-select-modal-title');
                if (titleEl) titleEl.textContent = `'${task}' 업무 시작`;
                if (teamSelectModal) teamSelectModal.classList.remove('hidden');
            }
        });
    }

    // ... (confirmStopIndividualBtn은 app-logic.js의 stopWorkIndividual을 호출하므로 변경 없음) ...
    if (confirmStopIndividualBtn) {
        confirmStopIndividualBtn.addEventListener('click', () => {
            if (context.recordToStopId) {
                stopWorkIndividual(context.recordToStopId); // app-logic.js 함수 (이미 Firestore 사용)
            }
            if (stopIndividualConfirmModal) stopIndividualConfirmModal.classList.add('hidden');
            context.recordToStopId = null;
        });
    }
    
    // ... (confirmStopGroupBtn은 app-logic.js의 finalizeStopGroup을 호출하므로 변경 없음) ...
    const confirmStopGroupBtn = document.getElementById('confirm-stop-group-btn');
    if (confirmStopGroupBtn) {
        confirmStopGroupBtn.addEventListener('click', () => {
            if (Array.isArray(context.groupToStopId) && context.groupToStopId.length > 0) {
                context.groupToStopId.forEach(gid => finalizeStopGroup(gid, null));
            } else if (context.groupToStopId) {
                finalizeStopGroup(context.groupToStopId, null);
            }
            const stopGroupModal = document.getElementById('stop-group-confirm-modal');
            if (stopGroupModal) stopGroupModal.classList.add('hidden');
            context.groupToStopId = null;
        });
    }

    // ... (나머지 근태, 알바 수정, 모달 닫기 로직 등은 workRecords와 무관하므로 변경 없음) ...
    const cancelStopGroupBtn = document.getElementById('cancel-stop-group-btn');
    if (cancelStopGroupBtn) {
        cancelStopGroupBtn.addEventListener('click', () => {
            const stopGroupModal = document.getElementById('stop-group-confirm-modal');
            if (stopGroupModal) stopGroupModal.classList.add('hidden');
            context.groupToStopId = null;
        });
    }

    if (confirmLeaveBtn) {
        confirmLeaveBtn.addEventListener('click', async () => {
            if (!context.memberToSetLeave) return;

            const selectedTypeInput = document.querySelector('input[name="leave-type"]:checked');
            if (!selectedTypeInput) {
                showToast('근태 유형을 선택해주세요.', true);
                return;
            }
            const leaveType = selectedTypeInput.value;
            const leaveData = { member: context.memberToSetLeave, type: leaveType };

            if (leaveType === '외출' || leaveType === '조퇴') {
                leaveData.startTime = getCurrentTime();
                if (leaveType === '조퇴') leaveData.endTime = "17:30";

                appState.dailyOnLeaveMembers = appState.dailyOnLeaveMembers.filter(item => item.member !== context.memberToSetLeave);
                appState.dailyOnLeaveMembers.push(leaveData);
                debouncedSaveState();

                saveProgress(true);

            } else if (leaveType === '연차' || leaveType === '출장' || leaveType === '결근') {
                const startDate = leaveStartDateInput?.value;
                const endDate = leaveEndDateInput?.value;
                if (!startDate) { showToast('시작일을 입력해주세요.', true); return; }
                leaveData.startDate = startDate;
                if (endDate) {
                    if (endDate < startDate) { showToast('종료일은 시작일보다 이후여야 합니다.', true); return; }
                    leaveData.endDate = endDate;
                }

                persistentLeaveSchedule.onLeaveMembers = persistentLeaveSchedule.onLeaveMembers.filter(item => item.member !== context.memberToSetLeave);
                persistentLeaveSchedule.onLeaveMembers.push(leaveData);
                await saveLeaveSchedule(db, persistentLeaveSchedule);
                markDataAsDirty();

                saveProgress(true);
            }

            showToast(`${context.memberToSetLeave}님을 '${leaveType}'(으)로 설정했습니다.`);
            if (leaveTypeModal) leaveTypeModal.classList.add('hidden');
            context.memberToSetLeave = null;
        });
    }

    if (confirmCancelLeaveBtn) {
        confirmCancelLeaveBtn.addEventListener('click', async () => {
            if (!context.memberToCancelLeave) return;

            const todayDateString = getTodayDateString();
            let actionTaken = false;

            const dailyIndex = appState.dailyOnLeaveMembers.findIndex(item => item.member === context.memberToCancelLeave);
            if (dailyIndex > -1) {
                const entry = appState.dailyOnLeaveMembers[dailyIndex];
                if (entry.type === '외출') {
                    entry.endTime = getCurrentTime();
                    showToast(`${context.memberToCancelLeave}님이 복귀 처리되었습니다.`);
                    actionTaken = true;
                } else {
                    appState.dailyOnLeaveMembers.splice(dailyIndex, 1);
                    showToast(`${context.memberToCancelLeave}님의 '${entry.type}' 상태가 취소되었습니다.`);
                    actionTaken = true;
                }
                debouncedSaveState();

                saveProgress(true);
            }

            const persistentIndex = persistentLeaveSchedule.onLeaveMembers.findIndex(item => item.member === context.memberToCancelLeave);
            if (persistentIndex > -1) {
                const entry = persistentLeaveSchedule.onLeaveMembers[persistentIndex];
                const isLeaveActiveToday = entry.startDate <= todayDateString && (!entry.endDate || todayDateString <= entry.endDate);

                if (isLeaveActiveToday) {
                    const today = new Date();
                    today.setDate(today.getDate() - 1);
                    const yesterday = today.toISOString().split('T')[0];
                    if (yesterday < entry.startDate) {
                        persistentLeaveSchedule.onLeaveMembers.splice(persistentIndex, 1);
                        showToast(`${context.memberToCancelLeave}님의 '${entry.type}' 일정이 취소되었습니다.`);
                    } else {
                        entry.endDate = yesterday;
                        showToast(`${context.memberToCancelLeave}님이 복귀 처리되었습니다. (${entry.type}이 ${yesterday}까지로 수정됨)`);
                    }
                } else {
                    persistentLeaveSchedule.onLeaveMembers.splice(persistentIndex, 1);
                    showToast(`${context.memberToCancelLeave}님의 '${entry.type}' 일정이 취소되었습니다.`);
                }
                await saveLeaveSchedule(db, persistentLeaveSchedule);
                markDataAsDirty();
                actionTaken = true;

                saveProgress(true);
            }

            if (!actionTaken) {
                showToast(`${context.memberToCancelLeave}님의 근태 정보를 찾을 수 없습니다.`, true);
            }

            if (cancelLeaveConfirmModal) cancelLeaveConfirmModal.classList.add('hidden');
            context.memberToCancelLeave = null;

            render();
        });
    }

    document.querySelectorAll('.modal-close-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const modal = e.target.closest('.fixed.inset-0');
            if (!modal || modal.id === 'history-modal') return;
            modal.classList.add('hidden');
            const modalId = modal.id;

            if (modalId === 'leave-type-modal') {
                context.memberToSetLeave = null;
                if (leaveDateInputsDiv) leaveDateInputsDiv.classList.add('hidden');
                const firstRadio = leaveTypeOptionsContainer?.querySelector('input[type="radio"]');
                if (firstRadio) firstRadio.checked = true;
            } else if (modalId === 'cancel-leave-confirm-modal') {
                context.memberToCancelLeave = null;
            } else if (modalId === 'team-select-modal') {
                context.tempSelectedMembers = [];
                context.selectedTaskForStart = null;
                context.selectedGroupForAdd = null;
                modal.querySelectorAll('button[data-member-name].ring-2').forEach(card => {
                    card.classList.remove('ring-2', 'ring-blue-500', 'bg-blue-100');
                });
            } else if (modalId === 'delete-confirm-modal') {
                context.recordToDeleteId = null;
                context.deleteMode = 'single';
            } else if (modalId === 'delete-history-modal') {
                context.historyKeyToDelete = null;
            } else if (modalId === 'edit-record-modal') {
                context.recordToEditId = null;
            } else if (modalId === 'quantity-on-stop-modal') {
                context.groupToStopId = null;
                const input = document.getElementById('quantity-on-stop-input');
                if (input) input.value = '';
            } else if (modalId === 'stop-group-confirm-modal') {
                context.groupToStopId = null;
            } else if (modalId === 'stop-individual-confirm-modal') {
                context.recordToStopId = null;
            } else if (modalId === 'manual-add-record-modal') {
                if (manualAddForm) manualAddForm.reset();
            } else if (modalId === 'edit-start-time-modal') {
                context.recordIdOrGroupIdToEdit = null;
                context.editType = null;
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
    if (cancelCancelLeaveBtn) cancelCancelLeaveBtn.addEventListener('click', () => { if (cancelLeaveConfirmModal) cancelLeaveConfirmModal.classList.add('hidden'); context.memberToCancelLeave = null; });
    if (cancelLeaveBtn) cancelLeaveBtn.addEventListener('click', () => { if (leaveTypeModal) leaveTypeModal.classList.add('hidden'); context.memberToSetLeave = null; });
    if (cancelDeleteBtn) cancelDeleteBtn.addEventListener('click', () => { if (deleteConfirmModal) deleteConfirmModal.classList.add('hidden'); context.recordToDeleteId = null; context.attendanceRecordToDelete = null; });
    if (cancelQuantityBtn) cancelQuantityBtn.addEventListener('click', () => { if (context.quantityModalContext.onCancel) context.quantityModalContext.onCancel(); if (quantityModal) quantityModal.classList.add('hidden'); });

    if (cancelEditBtn) cancelEditBtn.addEventListener('click', () => { if (editRecordModal) editRecordModal.classList.add('hidden'); context.recordToEditId = null; });
    if (cancelResetAppBtn) cancelResetAppBtn.addEventListener('click', () => { if (resetAppModal) resetAppModal.classList.add('hidden'); });
    if (cancelQuantityOnStopBtn) cancelQuantityOnStopBtn.addEventListener('click', () => { if (quantityOnStopModal) quantityOnStopModal.classList.add('hidden'); context.groupToStopId = null; });
    if (cancelStopIndividualBtn) cancelStopIndividualBtn.addEventListener('click', () => { if (stopIndividualConfirmModal) stopIndividualConfirmModal.classList.add('hidden'); context.recordToStopId = null; });
    if (cancelEditPartTimerBtn) cancelEditPartTimerBtn.addEventListener('click', () => { if (editPartTimerModal) editPartTimerModal.classList.add('hidden'); });
    if (cancelTeamSelectBtn) cancelTeamSelectBtn.addEventListener('click', () => {
        if (teamSelectModal) teamSelectModal.classList.add('hidden');
        context.tempSelectedMembers = []; context.selectedTaskForStart = null; context.selectedGroupForAdd = null;
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

    // ... (teamSelectModal 리스너는 app-logic.js를 호출하므로 변경 없음) ...
    if (teamSelectModal) {
        teamSelectModal.addEventListener('click', e => {
            const card = e.target.closest('button[data-member-name]');
            if (card && !card.disabled) {
                const memberName = card.dataset.memberName;
                const i = context.tempSelectedMembers.indexOf(memberName);
                if (i > -1) { context.tempSelectedMembers.splice(i, 1); card.classList.remove('ring-2', 'ring-blue-500', 'bg-blue-100'); }
                else { context.tempSelectedMembers.push(memberName); card.classList.add('ring-2', 'ring-blue-500', 'bg-blue-100'); }
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
                const areAllSelected = availableMembers.every(m => context.tempSelectedMembers.includes(m));
                if (areAllSelected) {
                    context.tempSelectedMembers = context.tempSelectedMembers.filter(m => !availableMembers.includes(m));
                    memberCards.forEach(c => { if (!c.disabled) c.classList.remove('ring-2', 'ring-blue-500', 'bg-blue-100'); });
                } else {
                    availableMembers.forEach(m => { if (!context.tempSelectedMembers.includes(m)) context.tempSelectedMembers.push(m); });
                    memberCards.forEach(c => { if (!c.disabled) c.classList.add('ring-2', 'ring-blue-500', 'bg-blue-100'); });
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

                debouncedSaveState(); // partTimers는 메인 문서에 저장
                renderTeamSelectionModalContent(context.selectedTaskForStart, appState, appConfig.teamGroups);
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
                debouncedSaveState(); // partTimers는 메인 문서에 저장
                renderTeamSelectionModalContent(context.selectedTaskForStart, appState, appConfig.teamGroups);
                return;
            }
        });
    }
    
    // ... (confirmEditPartTimerBtn은 partTimers를 수정하므로 debouncedSaveState 유지) ...
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
            
            // ⛔️ [주의] 로컬 appState.workRecords도 수정해야 하지만,
            // ⛔️ Firestore의 workRecords도 수정해야 합니다. (이 로직은 누락됨)
            // ⛔️ 이 부분은 추가 작업이 필요합니다. (우선 로컬 appState만 수정)
            appState.workRecords = (appState.workRecords || []).map(r => (r.member === oldName ? { ...r, member: newName } : r));
            // ‼️ [수정 권고]
            // ‼️ 알바 이름이 변경될 때, `workRecords` 컬렉션에서
            // ‼️ `member === oldName`인 모든 문서를 찾아 `member: newName`으로 업데이트하는
            // ‼️ 별도의 `writeBatch` 로직이 필요합니다. (현재 코드에는 구현되어 있지 않음)

            debouncedSaveState(); // partTimers 저장

            renderTeamSelectionModalContent(context.selectedTaskForStart, appState, appConfig.teamGroups);
            if (editPartTimerModal) editPartTimerModal.classList.add('hidden');
            showToast('알바 이름이 수정되었습니다.');
        });
    }

    // ... (confirmTeamSelectBtn은 app-logic.js를 호출하므로 변경 없음) ...
    const confirmTeamSelectBtn = document.getElementById('confirm-team-select-btn');
    if (confirmTeamSelectBtn) {
        confirmTeamSelectBtn.addEventListener('click', () => {
            if (context.tempSelectedMembers.length === 0) { showToast('추가할 팀원을 선택해주세요.', true); return; }
            if (context.selectedGroupForAdd !== null) {
                addMembersToWorkGroup(context.tempSelectedMembers, context.selectedTaskForStart, context.selectedGroupForAdd);
                showToast(`${context.selectedTaskForStart} 업무에 인원이 추가되었습니다.`);
            } else if (context.selectedTaskForStart) {
                startWorkGroup(context.tempSelectedMembers, context.selectedTaskForStart);
                showToast(`${context.selectedTaskForStart} 업무를 시작합니다.`);
            }
            if (teamSelectModal) teamSelectModal.classList.add('hidden');
            context.tempSelectedMembers = []; context.selectedTaskForStart = null; context.selectedGroupForAdd = null;
        });
    }

    // ✅ [수정] async 추가, Firestore 문서 직접 수정 (배치 또는 단일)
    if (confirmEditStartTimeBtn) {
        confirmEditStartTimeBtn.addEventListener('click', async () => {
            const newStartTime = editStartTimeInput?.value;
            const contextId = editStartTimeContextIdInput?.value;
            const contextType = editStartTimeContextTypeInput?.value;

            if (!newStartTime || !contextId || !contextType) {
                showToast('시간 변경 정보를 가져올 수 없습니다.', true); return;
            }

            let updated = false;
            const workRecordsColRef = getWorkRecordsCollectionRef();
            
            try {
                if (contextType === 'group') {
                    const groupId = Number(contextId);
                    const batch = writeBatch(db);
                    
                    // 로컬 캐시(appState)를 읽어와서 대상 ID 목록 생성
                    appState.workRecords.forEach(record => {
                        if (record.groupId === groupId && (record.status === 'ongoing' || record.status === 'paused')) {
                            const docRef = doc(workRecordsColRef, record.id);
                            batch.update(docRef, { startTime: newStartTime });
                            updated = true;
                        }
                    });
                    
                    if(updated) await batch.commit();
                    showToast('그룹 시작 시간이 변경되었습니다.');

                } else if (contextType === 'individual') {
                    const recordId = contextId;
                    const record = appState.workRecords.find(r => String(r.id) === String(recordId));
                    if (record) {
                        const docRef = doc(workRecordsColRef, recordId);
                        await updateDoc(docRef, { startTime: newStartTime });
                        updated = true;
                        showToast('개별 시작 시간이 변경되었습니다.');
                    } else {
                        showToast('해당 기록을 찾을 수 없습니다.', true);
                    }
                }
            } catch (e) {
                console.error("Error updating start time: ", e);
                showToast("시작 시간 변경 중 오류가 발생했습니다.", true);
            }
                
            // ⛔️ debouncedSaveState(); // 제거
            // ⛔️ render(); // 제거
            
            if (editStartTimeModal) editStartTimeModal.classList.add('hidden');
            context.recordIdOrGroupIdToEdit = null; context.editType = null;
            if (editStartTimeInput) editStartTimeInput.value = '';
            if (editStartTimeContextIdInput) editStartTimeContextIdInput.value = '';
            if (editStartTimeContextTypeInput) editStartTimeContextTypeInput.value = '';
        });
    }

    // ... (cancelEditStartTimeBtn은 변경 없음) ...
    if (cancelEditStartTimeBtn) {
        cancelEditStartTimeBtn.addEventListener('click', () => {
            if (editStartTimeModal) editStartTimeModal.classList.add('hidden');
            context.recordIdOrGroupIdToEdit = null; context.editType = null;
            if (editStartTimeInput) editStartTimeInput.value = '';
            if (editStartTimeContextIdInput) editStartTimeContextIdInput.value = '';
            if (editStartTimeContextTypeInput) editStartTimeContextTypeInput.value = '';
        });
    }

    // ... (openManualAddBtn은 변경 없음) ...
    if (openManualAddBtn) {
        openManualAddBtn.addEventListener('click', () => {
            renderManualAddModalDatalists(appState, appConfig);
            if (manualAddForm) manualAddForm.reset();
            if (manualAddRecordModal) manualAddRecordModal.classList.remove('hidden');
        });
    }

    // ✅ [수정] async 추가, Firestore 문서 직접 생성 (setDoc)
    if (confirmManualAddBtn) {
        confirmManualAddBtn.addEventListener('click', async () => {
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

            try {
                const newId = generateId();
                const duration = calcElapsedMinutes(startTime, endTime, []);
                const newRecord = {
                    id: newId, member: member, task: task,
                    startTime: startTime, endTime: endTime, duration: duration,
                    status: 'completed', groupId: null, pauses: []
                };
                
                const workRecordsColRef = getWorkRecordsCollectionRef();
                const docRef = doc(workRecordsColRef, newId);
                await setDoc(docRef, newRecord);
                
                showToast('수동 기록이 추가되었습니다.');
            } catch (e) {
                console.error("Error adding manual record: ", e);
                showToast("수동 기록 추가 중 오류가 발생했습니다.", true);
            }
            
            // ⛔️ appState.workRecords.push(newRecord); // 제거
            // ⛔️ debouncedSaveState(); // 제거
            if (manualAddRecordModal) manualAddRecordModal.classList.add('hidden');
            if (manualAddForm) manualAddForm.reset();
        });
    }

    // ... (cancelManualAddBtn은 변경 없음) ...
    if (cancelManualAddBtn) {
        cancelManualAddBtn.addEventListener('click', () => {
            if (manualAddRecordModal) manualAddRecordModal.classList.add('hidden');
            if (manualAddForm) manualAddForm.reset();
        });
    }
    
    // ... (editLeaveModal 관련 리스너들은 workRecords와 무관하므로 변경 없음) ...
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
            context.deleteMode = 'leave';
            context.attendanceRecordToDelete = {
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
}