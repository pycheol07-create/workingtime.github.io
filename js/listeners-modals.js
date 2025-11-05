import {
    appState, appConfig, db, auth,
    persistentLeaveSchedule, allHistoryData,
    context,
    LEAVE_TYPES,

    addAttendanceRecordModal, addAttendanceForm, cancelAddAttendanceBtn,
    addAttendanceDateKeyInput, addAttendanceTimeFields,
    addAttendanceDateFields, editAttendanceRecordModal,
    editAttendanceDateKeyInput, editAttendanceRecordIndexInput,
    teamSelectModal, deleteConfirmModal, confirmDeleteBtn, cancelDeleteBtn,
    historyModal,
    historyTabs,
    quantityModal, confirmQuantityBtn,
    cancelQuantityBtn,
    editRecordModal, confirmEditBtn, cancelEditBtn,
    quantityOnStopModal, confirmQuantityOnStopBtn, cancelQuantityOnStopBtn,
    resetAppBtn, resetAppModal, confirmResetAppBtn, cancelResetAppBtn, taskSelectModal,
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

    render, debouncedSaveState, saveStateToFirestore,
    generateId, normalizeName,
    markDataAsDirty,

} from './app.js';

import { saveLeaveSchedule } from './config.js';
import { calcElapsedMinutes, showToast, getTodayDateString, getCurrentTime } from './utils.js';

import {
    getAllDashboardDefinitions,
    renderManualAddModalDatalists,
    renderTeamSelectionModalContent
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

import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export function setupGeneralModalListeners() {

    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', async () => {
            let stateChanged = false;

            if (context.deleteMode === 'all') {
                const originalLength = appState.workRecords.length;
                appState.workRecords = (appState.workRecords || []).filter(r => r.status !== 'completed');
                if (appState.workRecords.length < originalLength) {
                    stateChanged = true;
                    showToast('완료된 모든 기록이 삭제되었습니다.');
                } else {
                    showToast('삭제할 완료 기록이 없습니다.');
                }

            } else if (context.deleteMode === 'single' && context.recordToDeleteId) {
                const originalLength = appState.workRecords.length;
                appState.workRecords = (appState.workRecords || []).filter(r => String(r.id) !== String(context.recordToDeleteId));
                if (appState.workRecords.length < originalLength) {
                    stateChanged = true;
                    showToast('선택한 기록이 삭제되었습니다.');
                } else {
                    showToast('삭제할 기록을 찾지 못했습니다.', true);
                }

            } else if (context.deleteMode === 'leave' && context.attendanceRecordToDelete) {
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
                    debouncedSaveState();
                }
            }

            if (deleteConfirmModal) deleteConfirmModal.classList.add('hidden');
            context.recordToDeleteId = null;
            context.attendanceRecordToDelete = null;
            context.deleteMode = 'single';

            if (stateChanged) {
                render();
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

            if (context.quantityModalContext.onConfirm) {
                if (context.quantityModalContext.mode === 'today') {
                    const onConfirmToday = async (newQuantities) => {
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
                    onConfirmToday(newQuantities);

                } else if (context.quantityModalContext.mode === 'history') {
                    const onConfirmHistory = async (newQuantities) => {
                        const dateKey = context.quantityModalContext.dateKey;
                        if (!dateKey) return;

                        const idx = allHistoryData.findIndex(d => d.id === dateKey);
                        if (idx === -1 && dateKey !== getTodayDateString()) {
                            showToast('이력 데이터를 찾을 수 없어 수정할 수 없습니다.', true);
                            return;
                        }

                        if (idx > -1) {
                            allHistoryData[idx] = { ...allHistoryData[idx], taskQuantities: newQuantities };
                        }

                        const historyDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
                        try {
                            const dataToSave = (idx > -1)
                                ? allHistoryData[idx]
                                : { id: dateKey, taskQuantities: newQuantities, workRecords: [], onLeaveMembers: [], partTimers: [] };

                            await setDoc(historyDocRef, dataToSave);

                            showToast(`${dateKey}의 처리량이 수정되었습니다.`);

                            if (dateKey === getTodayDateString()) {
                                appState.taskQuantities = newQuantities;
                                render();
                            }

                            if (dateKey !== getTodayDateString()) {
                                if (historyModal && !historyModal.classList.contains('hidden')) {
                                    const activeSubTabBtn = historyTabs?.querySelector('button.font-semibold');
                                    const currentView = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'daily';
                                    switchHistoryView(currentView);
                                }
                            }

                        } catch (e) {
                            console.error('Error updating history quantities:', e);
                            showToast('처리량 업데이트 중 오류 발생.', true);
                        }
                    };
                    onConfirmHistory(newQuantities);
                }
            }

            if (quantityModal) quantityModal.classList.add('hidden');
        });
    }

    if (confirmEditBtn) {
        confirmEditBtn.addEventListener('click', () => {
            if (!context.recordToEditId) return;
            const idx = appState.workRecords.findIndex(r => String(r.id) === String(context.recordToEditId));
            if (idx === -1) {
                showToast('수정할 기록을 찾을 수 없습니다.', true);
                if (editRecordModal) editRecordModal.classList.add('hidden');
                context.recordToEditId = null;
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
            context.recordToEditId = null;
        });
    }

    if (confirmQuantityOnStopBtn) {
        confirmQuantityOnStopBtn.addEventListener('click', () => {
            if (context.groupToStopId) {
                const input = document.getElementById('quantity-on-stop-input');
                const quantity = input ? (Number(input.value) || 0) : null;
                finalizeStopGroup(context.groupToStopId, quantity);
                if (input) input.value = '';

                if (quantityOnStopModal) quantityOnStopModal.classList.add('hidden');
                context.groupToStopId = null;
            }
        });
    }

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

    if (confirmStopIndividualBtn) {
        confirmStopIndividualBtn.addEventListener('click', () => {
            if (context.recordToStopId) {
                stopWorkIndividual(context.recordToStopId);
            }
            if (stopIndividualConfirmModal) stopIndividualConfirmModal.classList.add('hidden');
            context.recordToStopId = null;
        });
    }

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

                debouncedSaveState();
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
                debouncedSaveState();
                renderTeamSelectionModalContent(context.selectedTaskForStart, appState, appConfig.teamGroups);
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

            renderTeamSelectionModalContent(context.selectedTaskForStart, appState, appConfig.teamGroups);
            if (editPartTimerModal) editPartTimerModal.classList.add('hidden');
            showToast('알바 이름이 수정되었습니다.');
        });
    }

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
            context.recordIdOrGroupIdToEdit = null; context.editType = null;
            if (editStartTimeInput) editStartTimeInput.value = '';
            if (editStartTimeContextIdInput) editStartTimeContextIdInput.value = '';
            if (editStartTimeContextTypeInput) editStartTimeContextTypeInput.value = '';
        });
    }

    if (cancelEditStartTimeBtn) {
        cancelEditStartTimeBtn.addEventListener('click', () => {
            if (editStartTimeModal) editStartTimeModal.classList.add('hidden');
            context.recordIdOrGroupIdToEdit = null; context.editType = null;
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

            const newId = generateId();
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