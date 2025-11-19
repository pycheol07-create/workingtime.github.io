// === js/listeners-modals-form.js ===
// 설명: '폼 입력' 또는 '선택'이 필요한 모달 리스너를 담당합니다.

import * as DOM from './dom-elements.js';
import * as State from './state.js';

import {
    generateId,
    debouncedSaveState,
    updateDailyData,
    saveStateToFirestore 
} from './app-data.js';

import { getTodayDateString, getCurrentTime, showToast, calcElapsedMinutes, calculateDateDifference } from './utils.js';
import {
    renderTeamSelectionModalContent
} from './ui-modals.js';
import {
    startWorkGroup,
    addMembersToWorkGroup
} from './app-logic.js';
import { saveLeaveSchedule } from './config.js';
import {
    doc, updateDoc, collection, query, where, getDocs, writeBatch, setDoc 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 헬퍼 변수
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


export function setupFormModalListeners() {

    if (DOM.confirmQuantityBtn) {
        DOM.confirmQuantityBtn.addEventListener('click', async () => {
            const newQuantities = {};
            const confirmedZeroTasks = [];

            document.querySelectorAll('#modal-task-quantity-inputs input[type="number"]').forEach(input => {
                const taskName = input.dataset.task;
                if (taskName) {
                    newQuantities[taskName] = Number(input.value) || 0;
                }
            });

            document.querySelectorAll('#modal-task-quantity-inputs .confirm-zero-checkbox').forEach(checkbox => {
                if (checkbox.checked) {
                    confirmedZeroTasks.push(checkbox.dataset.task);
                }
            });

            if (State.context.quantityModalContext && typeof State.context.quantityModalContext.onConfirm === 'function') {
                await State.context.quantityModalContext.onConfirm(newQuantities, confirmedZeroTasks);
            }

            if (DOM.quantityModal) DOM.quantityModal.classList.add('hidden');
        });
    }

    if (DOM.cancelQuantityBtn) {
        DOM.cancelQuantityBtn.addEventListener('click', () => {
            if (State.context.quantityModalContext && typeof State.context.quantityModalContext.onCancel === 'function') {
                State.context.quantityModalContext.onCancel();
            }
            if (DOM.quantityModal) DOM.quantityModal.classList.add('hidden');
        });
    }

    if (DOM.cancelTeamSelectBtn) {
        DOM.cancelTeamSelectBtn.addEventListener('click', () => {
            if (DOM.teamSelectModal) DOM.teamSelectModal.classList.add('hidden');
        });
    }

    if (DOM.taskSelectModal) {
        DOM.taskSelectModal.addEventListener('click', (e) => {
            const taskButton = e.target.closest('.task-select-btn');
            if (taskButton) {
                const taskName = taskButton.dataset.task;
                State.context.selectedTaskForStart = taskName;
                State.context.selectedGroupForAdd = null;
                State.context.tempSelectedMembers = [];
                DOM.taskSelectModal.classList.add('hidden');

                renderTeamSelectionModalContent(taskName, State.appState, State.appConfig.teamGroups);

                const titleEl = document.getElementById('team-select-modal-title');
                const confirmBtn = document.getElementById('confirm-team-select-btn');
                if (titleEl) titleEl.textContent = `'${taskName}' 업무 시작`;
                if (confirmBtn) confirmBtn.textContent = '선택 완료 및 업무 시작';

                if (DOM.teamSelectModal) DOM.teamSelectModal.classList.remove('hidden');
            }
        });
    }

    if (DOM.teamSelectModal) {
        DOM.teamSelectModal.addEventListener('click', async (e) => {
            const target = e.target; 

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

            const deletePartTimerBtn = target.closest('.delete-part-timer-btn');
            if (deletePartTimerBtn) {
                const partTimerId = deletePartTimerBtn.dataset.partTimerId;
                const partTimer = (State.appState.partTimers || []).find(p => p.id === partTimerId);

                if (partTimer) {
                    State.appState.partTimers = State.appState.partTimers.filter(p => p.id !== partTimerId);
                    
                    if (State.appState.dailyAttendance && State.appState.dailyAttendance[partTimer.name]) {
                        delete State.appState.dailyAttendance[partTimer.name];
                    }

                    debouncedSaveState();
                    renderTeamSelectionModalContent(State.context.selectedTaskForStart, State.appState, State.appConfig.teamGroups);
                    showToast(`${partTimer.name}님이 삭제되었습니다.`);
                }
                return; 
            }

             if (target.closest('#add-part-timer-modal-btn')) {
                if (!State.appState.partTimers) State.appState.partTimers = [];

                const existingNames = new Set(State.appState.partTimers.map(p => p.name));
                let nextNum = 1;
                while (existingNames.has(`알바${nextNum}`)) {
                    nextNum++;
                }
                const newName = `알바${nextNum}`;

                const newPartTimer = {
                    id: generateId(),
                    name: newName,
                    wage: State.appConfig.defaultPartTimerWage || 10000
                };

                if (!State.appState.dailyAttendance) State.appState.dailyAttendance = {};
                State.appState.dailyAttendance[newName] = {
                    inTime: getCurrentTime(),
                    outTime: null,
                    status: 'active'
                };
                State.appState.partTimers.push(newPartTimer);
                
                debouncedSaveState(); 

                renderTeamSelectionModalContent(State.context.selectedTaskForStart, State.appState, State.appConfig.teamGroups);
                showToast(`'${newName}'이(가) 추가되고 출근 처리되었습니다.`);
                return; 
            }

            const confirmTeamSelectBtn = target.closest('#confirm-team-select-btn');
            if (confirmTeamSelectBtn) {
                 if (State.context.tempSelectedMembers.length === 0) {
                    showToast('최소 1명 이상의 팀원을 선택해주세요.', true);
                    return;
                }

                const btn = confirmTeamSelectBtn;
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
             }
        });
    }

    if (DOM.confirmEditBtn) {
        DOM.confirmEditBtn.addEventListener('click', async () => {
            const recordId = State.context.recordToEditId;
            const task = document.getElementById('edit-task-type').value;
            const member = document.getElementById('edit-member-name').value;
            const startTime = document.getElementById('edit-start-time').value;
            const endTime = document.getElementById('edit-end-time').value;

            const record = (State.appState.workRecords || []).find(r => r.id === recordId);
            if (!record) {
                showToast('수정할 기록을 찾을 수 없습니다.', true);
                return;
            }

            if (startTime && endTime && startTime >= endTime) {
                showToast('시작 시간이 종료 시간보다 늦거나 같을 수 없습니다.', true);
                return;
            }

            try {
                const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString(), 'workRecords', recordId);

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
                DOM.editRecordModal.classList.add('hidden');
            } catch (e) {
                console.error("Error updating work record: ", e);
                showToast("기록 수정 중 오류 발생", true);
            }
        });
    }

    if (DOM.confirmEditPartTimerBtn) {
        DOM.confirmEditPartTimerBtn.addEventListener('click', async () => {
            const partTimerId = document.getElementById('part-timer-edit-id').value;
            const newName = document.getElementById('part-timer-new-name').value.trim();

            if (!newName) {
                showToast('이름을 입력해주세요.', true); return;
            }

            const isNameTaken = (State.appConfig.teamGroups || []).flatMap(g => g.members).includes(newName) ||
                                (State.appState.partTimers || []).some(p => p.name === newName && p.id !== partTimerId);

            if (isNameTaken) {
                showToast(`'${newName}'(이)라는 이름은 이미 사용 중입니다.`, true); return;
            }

            if (!partTimerId) {
                const newPartTimer = {
                    id: generateId(),
                    name: newName,
                    wage: State.appConfig.defaultPartTimerWage || 10000
                };
                if (!State.appState.partTimers) State.appState.partTimers = [];
                State.appState.partTimers.push(newPartTimer);
                
                debouncedSaveState();
                renderTeamSelectionModalContent(State.context.selectedTaskForStart, State.appState, State.appConfig.teamGroups);
                showToast(`알바 '${newName}'님이 추가되었습니다.`);
            } else {
                const partTimer = (State.appState.partTimers || []).find(p => p.id === partTimerId);
                if (!partTimer) {
                    showToast('수정할 알바 정보를 찾을 수 없습니다.', true); return;
                }
                const oldName = partTimer.name;
                if (oldName === newName) {
                     document.getElementById('edit-part-timer-modal').classList.add('hidden'); return;
                }

                partTimer.name = newName;

                (State.appState.workRecords || []).forEach(record => {
                    if (record.member === oldName) record.member = newName;
                });

                try {
                    const today = getTodayDateString();
                    const workRecordsColRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', today, 'workRecords');
                    const q = query(workRecordsColRef, where("member", "==", oldName));
                    const querySnapshot = await getDocs(q);
                    if (!querySnapshot.empty) {
                        const batch = writeBatch(State.db);
                        querySnapshot.forEach(doc => batch.update(doc.ref, { member: newName }));
                        await batch.commit();
                    }
                    debouncedSaveState(); 
                    showToast(`'${oldName}'님을 '${newName}'(으)로 수정했습니다.`);
                } catch (e) {
                    console.error("알바 이름 변경 중 DB 오류: ", e);
                    showToast("이름 변경 중 DB 저장에 실패했습니다.", true);
                    partTimer.name = oldName;
                }
            }
            document.getElementById('edit-part-timer-modal').classList.add('hidden');
            renderTeamSelectionModalContent(State.context.selectedTaskForStart, State.appState, State.appConfig.teamGroups);
        });
    }

    // ✅ [수정] 근태 저장 리스너 (연차 등 Persistent 기록의 메모리 동기화 추가)
    if (DOM.confirmLeaveBtn) {
        DOM.confirmLeaveBtn.addEventListener('click', () => {
            const memberName = State.context.memberToSetLeave;
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

                // 사용 일수 계산
                const diffDays = calculateDateDifference(startDate, endDate);

                const newEntry = {
                    id: `leave-${Date.now()}`,
                    member: memberName,
                    type,
                    startDate,
                    endDate
                };
                // 1. Persistent 저장소(설정값)에 저장
                State.persistentLeaveSchedule.onLeaveMembers.push(newEntry);
                saveLeaveSchedule(State.db, State.persistentLeaveSchedule);
                
                // 2. ✅ [신규] 로컬 이력 데이터(allHistoryData)에도 즉시 반영 (화면 갱신용)
                // 기간 내의 모든 날짜에 대해 이력 데이터가 존재하면 추가
                const startDt = new Date(startDate);
                const endDt = new Date(endDate);
                
                for(let dt = new Date(startDt); dt <= endDt; dt.setDate(dt.getDate() + 1)) {
                    const dateKey = dt.toISOString().slice(0, 10);
                    // 해당 날짜의 데이터 찾기 (없으면 생성)
                    let dayData = State.allHistoryData.find(d => d.id === dateKey);
                    if (!dayData) {
                        dayData = { id: dateKey, onLeaveMembers: [], workRecords: [], taskQuantities: {} };
                        State.allHistoryData.push(dayData);
                        // 날짜순 정렬 유지
                        State.allHistoryData.sort((a, b) => b.id.localeCompare(a.id));
                    }
                    
                    if (!dayData.onLeaveMembers) dayData.onLeaveMembers = [];
                    // 중복 체크 후 추가
                    const exists = dayData.onLeaveMembers.some(l => l.member === memberName && l.type === type);
                    if (!exists) {
                        dayData.onLeaveMembers.push({ ...newEntry });
                    }
                }

                // 3. 오늘 날짜에 해당하면 실시간 근태 배열에도 업데이트 (메인화면 반영용)
                if (today >= startDate && today <= endDate) {
                    State.appState.dateBasedOnLeaveMembers = State.persistentLeaveSchedule.onLeaveMembers.filter(entry => {
                        const ed = entry.endDate || entry.startDate;
                        return today >= entry.startDate && today <= ed;
                    });
                }

                if (type === '연차') {
                     showToast(`${memberName}님 ${diffDays}일 연차 처리 완료. (현황 탭에서 잔여일 확인 가능)`);
                } else {
                     showToast(`${memberName}님 ${type} 처리 완료.`);
                }
            } else {
                // '지각', '외출', '조퇴' 등 Daily 근태
                const newDailyEntry = {
                    member: memberName,
                    type: type,
                    startTime: (type === '외출' || type === '조퇴' || type === '지각') ? getCurrentTime() : null,
                    endTime: null
                };
                State.appState.dailyOnLeaveMembers.push(newDailyEntry);
                debouncedSaveState();
                showToast(`${memberName}님 ${type} 처리 완료.`);
            }

            DOM.leaveTypeModal.classList.add('hidden');
        });
    }

    if (DOM.confirmManualAddBtn) {
        DOM.confirmManualAddBtn.addEventListener('click', async () => {
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

                const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString(), 'workRecords', recordId);
                await setDoc(docRef, newRecordData);

                showToast('수동 기록이 추가되었습니다.');
                DOM.manualAddRecordModal.classList.add('hidden');
                DOM.manualAddForm.reset();

            } catch (e) {
                console.error("Error adding manual work record: ", e);
                showToast("수동 기록 추가 중 오류 발생", true);
            }
        });
    }

    if (DOM.confirmEditStartTimeBtn) {
        DOM.confirmEditStartTimeBtn.addEventListener('click', async () => {
            const contextId = document.getElementById('edit-start-time-context-id').value;
            const contextType = document.getElementById('edit-start-time-context-type').value;
            const newStartTime = document.getElementById('edit-start-time-input').value;

            if (!contextId || !contextType || !newStartTime) {
                showToast('정보가 누락되었습니다.', true);
                return;
            }

            try {
                const today = getTodayDateString();
                const workRecordsColRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', today, 'workRecords');

                if (contextType === 'individual') {
                    const docRef = doc(workRecordsColRef, contextId);
                    await updateDoc(docRef, { startTime: newStartTime });

                } else if (contextType === 'group') {
                    const q = query(workRecordsColRef, where("groupId", "==", contextId), where("status", "in", ["ongoing", "paused"]));
                    const querySnapshot = await getDocs(q);

                    if (!querySnapshot.empty) {
                        const batch = writeBatch(State.db);
                        querySnapshot.forEach(doc => {
                            batch.update(doc.ref, { startTime: newStartTime });
                        });
                        await batch.commit();
                    }
                }

                showToast('시작 시간이 수정되었습니다.');
                DOM.editStartTimeModal.classList.add('hidden');

            } catch (e) {
                 console.error("Error updating start time: ", e);
                 showToast("시작 시간 수정 중 오류가 발생했습니다.", true);
            }
        });
    }
    
    const editLeaveModal = document.getElementById('edit-leave-record-modal');

    if (editLeaveModal) {
        
        const cancelEditLeaveBtn = document.getElementById('cancel-edit-leave-record-btn');
        if (cancelEditLeaveBtn) {
            cancelEditLeaveBtn.addEventListener('click', () => {
                editLeaveModal.classList.add('hidden');
            });
        }

        const deleteLeaveBtn = document.getElementById('delete-leave-record-btn');
        if (deleteLeaveBtn) {
            deleteLeaveBtn.addEventListener('click', () => {
                const memberName = document.getElementById('edit-leave-original-member-name').value;
                const type = document.getElementById('edit-leave-type').value; 
                
                State.context.deleteMode = 'leave-record';
                State.context.attendanceRecordToDelete = { 
                    memberName: memberName,
                    startIdentifier: document.getElementById('edit-leave-original-start-identifier').value,
                    type: document.getElementById('edit-leave-original-type').value,
                    displayType: type
                };

                const msgEl = document.getElementById('delete-confirm-message');
                if (msgEl) msgEl.textContent = `${memberName}님의 '${type}' 기록을 삭제하시겠습니까?`;
                
                editLeaveModal.classList.add('hidden');
                if (DOM.deleteConfirmModal) DOM.deleteConfirmModal.classList.remove('hidden');
            });
        }

        const confirmEditLeaveBtn = document.getElementById('confirm-edit-leave-record-btn');
        if (confirmEditLeaveBtn) {
            confirmEditLeaveBtn.addEventListener('click', async () => {
                const memberName = document.getElementById('edit-leave-original-member-name').value;
                const originalStart = document.getElementById('edit-leave-original-start-identifier').value;
                const originalType = document.getElementById('edit-leave-original-type').value;

                const newType = document.getElementById('edit-leave-type').value;
                const newStartTime = document.getElementById('edit-leave-start-time').value;
                const newEndTime = document.getElementById('edit-leave-end-time').value;
                const newStartDate = document.getElementById('edit-leave-start-date').value;
                const newEndDate = document.getElementById('edit-leave-end-date').value;

                const isNewTimeBased = (newType === '외출' || newType === '조퇴' || newType === '지각');

                let dailyChanged = false;
                let persistentChanged = false;
                let foundAndRemoved = false;

                if (originalType === 'daily') {
                    const index = State.appState.dailyOnLeaveMembers.findIndex(
                        r => r.member === memberName && (r.startTime || '') === originalStart
                    );
                    if (index > -1) {
                        State.appState.dailyOnLeaveMembers.splice(index, 1);
                        dailyChanged = true;
                        foundAndRemoved = true;
                    }
                } else { 
                    const index = State.persistentLeaveSchedule.onLeaveMembers.findIndex(
                        r => r.member === memberName && (r.startDate || '') === originalStart
                    );
                    if (index > -1) {
                        State.persistentLeaveSchedule.onLeaveMembers.splice(index, 1);
                        persistentChanged = true;
                        foundAndRemoved = true;
                    }
                }

                if (!foundAndRemoved) {
                    showToast('수정할 원본 기록을 찾지 못했습니다.', true);
                    return;
                }

                if (isNewTimeBased) {
                    if (!newStartTime) {
                        showToast('시간 기반 근태는 시작 시간이 필수입니다.', true);
                        return;
                    }
                    State.appState.dailyOnLeaveMembers.push({
                        member: memberName,
                        type: newType,
                        startTime: newStartTime,
                        endTime: (newType === '외출') ? newEndTime : null 
                    });
                    dailyChanged = true;
                } else { 
                    if (!newStartDate) {
                        showToast('날짜 기반 근태는 시작일이 필수입니다.', true);
                        return;
                    }
                    State.persistentLeaveSchedule.onLeaveMembers.push({
                        id: `leave-${Date.now()}`,
                        member: memberName,
                        type: newType,
                        startDate: newStartDate,
                        endDate: newEndDate || newStartDate
                    });
                    persistentChanged = true;
                }

                try {
                    if (dailyChanged) {
                        await saveStateToFirestore();
                    }
                    if (persistentChanged) {
                        await saveLeaveSchedule(State.db, State.persistentLeaveSchedule);
                    }
                    showToast('근태 기록이 수정되었습니다.');
                    editLeaveModal.classList.add('hidden');
                } catch (e) {
                    console.error("Error saving updated leave record:", e);
                    showToast('기록 저장 중 오류가 발생했습니다.', true);
                }
            });
        }

        const editLeaveTypeSelect = document.getElementById('edit-leave-type');
        if (editLeaveTypeSelect) {
            editLeaveTypeSelect.addEventListener('change', (e) => {
                const newType = e.target.value;
                const isTimeBased = (newType === '외출' || newType === '조퇴' || newType === '지각');
                const isOuting = (newType === '외출');
                
                document.getElementById('edit-leave-time-fields').classList.toggle('hidden', !isTimeBased);
                document.getElementById('edit-leave-date-fields').classList.toggle('hidden', isTimeBased);
                
                const endTimeWrapper = document.getElementById('edit-leave-end-time-wrapper');
                if (endTimeWrapper) {
                    endTimeWrapper.classList.toggle('hidden', !isOuting);
                }
            });
        }
    }
}