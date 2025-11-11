// === js/listeners-modals-form.js ===
// 설명: '폼 입력' 또는 '선택'이 필요한 모달 리스너를 담당합니다.

import * as DOM from './dom-elements.js';
import * as State from './state.js';

// ✅ [수정] app.js 대신 app-data.js에서 데이터 함수 임포트
import {
    generateId,
    debouncedSaveState,
    updateDailyData
} from './app-data.js';
// ⛔️ [삭제] app.js 임포트

import { getTodayDateString, getCurrentTime, showToast, calcElapsedMinutes } from './utils.js';
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

// ✅ (listeners-main.js에서 누락되었던 헬퍼 변수)
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

    // (listeners-modals.js -> listeners-modals-form.js)
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

    // (listeners-modals.js -> listeners-modals-form.js)
    if (DOM.cancelQuantityBtn) {
        DOM.cancelQuantityBtn.addEventListener('click', () => {
            if (State.context.quantityModalContext && typeof State.context.quantityModalContext.onCancel === 'function') {
                State.context.quantityModalContext.onCancel();
            }
            if (DOM.quantityModal) DOM.quantityModal.classList.add('hidden');
        });
    }

    // (listeners-modals.js -> listeners-modals-form.js)
    if (DOM.cancelTeamSelectBtn) {
        DOM.cancelTeamSelectBtn.addEventListener('click', () => {
            if (DOM.teamSelectModal) DOM.teamSelectModal.classList.add('hidden');
        });
    }

    // (listeners-modals.js -> listeners-modals-form.js)
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

    // ✅ (listeners-main.js에서 누락되었던 핵심 리스너)
    if (DOM.teamSelectModal) {
        DOM.teamSelectModal.addEventListener('click', async (e) => {
            const target = e.target; // <--- This is the element that was clicked

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

            // 4. 알바 삭제 버튼 클릭 핸들러 (🗑️ 아이콘)
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

                    debouncedSaveState(); // ✅ [수정] app-data.js에서 임포트됨
                    renderTeamSelectionModalContent(State.context.selectedTaskForStart, State.appState, State.appConfig.teamGroups);
                    showToast(`${partTimer.name}님이 삭제되었습니다.`);
                }
                return; 
            }

            // 5. 알바 추가 버튼 핸들러 (+ 추가)
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
                    id: generateId(), // ✅ [수정] app-data.js에서 임포트됨
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
                
                debouncedSaveState(); // ✅ [수정] app-data.js에서 임포트됨

                // 4. 모달 컨텐츠 리렌더링
                renderTeamSelectionModalContent(State.context.selectedTaskForStart, State.appState, State.appConfig.teamGroups);
                showToast(`'${newName}'이(가) 추가되고 출근 처리되었습니다.`);
                return; 
            }

            // 6. 확인 버튼 (업무 시작/추가)
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


    // (listeners-modals.js -> listeners-modals-form.js)
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

    // (listeners-modals.js -> listeners-modals-form.js)
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
                    id: generateId(), // ✅ [수정] app-data.js에서 임포트됨
                    name: newName,
                    wage: State.appConfig.defaultPartTimerWage || 10000
                };
                if (!State.appState.partTimers) State.appState.partTimers = [];
                State.appState.partTimers.push(newPartTimer);
                
                debouncedSaveState(); // ✅ [수정] app-data.js에서 임포트됨
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
                    debouncedSaveState(); // ✅ [수정] app-data.js에서 임포트됨
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

    // (listeners-modals.js -> listeners-modals-form.js)
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
                const newEntry = {
                    id: `leave-${Date.now()}`,
                    member: memberName,
                    type,
                    startDate,
                    endDate
                };
                State.persistentLeaveSchedule.onLeaveMembers.push(newEntry);
                saveLeaveSchedule(State.db, State.persistentLeaveSchedule);
            } else {
                const newDailyEntry = {
                    member: memberName,
                    type: type,
                    startTime: (type === '외출' || type === '조퇴') ? getCurrentTime() : null,
                    endTime: null
                };
                State.appState.dailyOnLeaveMembers.push(newDailyEntry);
                debouncedSaveState(); // ✅ [수정] app-data.js에서 임포트됨
            }

            showToast(`${memberName}님 ${type} 처리 완료.`);
            DOM.leaveTypeModal.classList.add('hidden');
        });
    }

    // (listeners-modals.js -> listeners-modals-form.js)
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
                const recordId = generateId(); // ✅ [수정] app-data.js에서 임포트됨
                const duration = calcElapsedMinutes(startTime, endTime, pauses);

                const newRecordData = {
                    id: recordId,
                    member,
                    task,
                    startTime,
                    endTime,
                    duration,
                    status: 'completed',
                    groupId: `manual-${generateId()}`, // ✅ [수정] app-data.js에서 임포트됨
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

    // (listeners-modals.js -> listeners-modals-form.js)
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
}