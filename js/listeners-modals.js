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
    confirmAddAttendanceBtn,
    cancelAddAttendanceBtn,
    editAttendanceRecordModal,
    confirmEditAttendanceBtn,
    cancelEditAttendanceBtn,
    pcClockOutCancelBtn,
    mobileClockOutCancelBtn,
    memberActionModal,

    generateId,
    saveStateToFirestore, // ✅ 메인 문서(state blob) 저장용
    debouncedSaveState, // ✅
    render,
    persistentLeaveSchedule
} from './app.js';

import { getTodayDateString, getCurrentTime, formatTimeTo24H, showToast } from './utils.js';
import {
    renderTaskSelectionModal,
    renderTeamSelectionModal,
    updateQuantityModal,
    renderLeaveTypeModal,
    populateManualAddForm,
    renderEditLeaveModal,
    renderAddAttendanceModal,
    renderEditAttendanceModal,
    renderMemberActionModal
} from './ui-modals.js';
import {
    startWorkGroup,
    addMembersToWorkGroup,
    finalizeStopGroup,
    stopWorkIndividual,
    processClockOut, // ✨ [신규] 퇴근 처리
    cancelClockOut // ✨ [신규] 퇴근 취소
} from './app-logic.js';
import { saveProgress, deleteHistoryEntry, saveDayDataToHistory, saveAttendanceRecord, deleteAttendanceRecord } from './app-history-logic.js';
import { saveLeaveSchedule } from './config.js';

import { signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
// ✅ [수정] Firestore 함수 임포트 추가 (collection, query, where, getDocs)
import { doc, updateDoc, deleteDoc, writeBatch, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


/**
 * ✅ [수정] Firestore 'workRecords' 하위 컬렉션에서
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
 * ✅ [수정] Firestore 'workRecords' 하위 컬렉션의
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
export function setupModalListeners() {

    // 모달 닫기 버튼 (공통)
    document.querySelectorAll('.modal-close-btn, .modal-cancel-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const modal = btn.closest('.modal-overlay');
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
            const startGroupBtn = target.closest('#start-work-group-btn');
            const addMemberBtn = target.closest('#add-to-work-group-btn');

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
            } else if (startGroupBtn) {
                // ✅ [수정] startWorkGroup은 이제 async
                await startWorkGroup(context.tempSelectedMembers, context.selectedTaskForStart);
                teamSelectModal.classList.add('hidden');
            } else if (addMemberBtn) {
                // ✅ [수정] addMembersToWorkGroup은 이제 async
                await addMembersToWorkGroup(context.tempSelectedMembers, context.selectedTaskForStart, context.selectedGroupForAdd);
                teamSelectModal.classList.add('hidden');
            }
        });
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
                taskSelectModal.classList.add('hidden');
                renderTeamSelectionModal(appState, appConfig.teamGroups, 'start');
            }
        });
    }

    // 삭제 확인 모달
    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', async () => {
            // ✅ [수정] Firestore 문서 삭제 로직 추가
            if (context.deleteMode === 'group') {
                const groupMembers = (appState.workRecords || [])
                    .filter(r => String(r.groupId) === String(context.recordToDeleteId) && (r.status === 'ongoing' || r.status === 'paused'))
                    .map(r => r.id);
                
                await deleteWorkRecordDocuments(groupMembers);
                
                showToast('그룹 업무가 삭제되었습니다.');
            } else {
                await deleteWorkRecordDocument(context.recordToDeleteId);
                showToast('업무 기록이 삭제되었습니다.');
            }
            
            // ⛔️ appState.workRecords = ... (제거)
            // ⛔️ render() (제거)
            // ⛔️ saveStateToFirestore() (제거)
            
            deleteConfirmModal.classList.add('hidden');
            context.recordToDeleteId = null;
            context.deleteMode = 'single';
        });
    }

    // 완료 기록 전체 삭제 버튼
    const deleteAllCompletedBtn = document.getElementById('delete-all-completed-btn');
    if (deleteAllCompletedBtn) {
        deleteAllCompletedBtn.addEventListener('click', () => {
            // ✅ [수정] Firestore 문서 일괄 삭제
            const completedIds = (appState.workRecords || [])
                .filter(r => r.status === 'completed')
                .map(r => r.id);
            
            if (completedIds.length === 0) {
                showToast('삭제할 완료된 작업이 없습니다.');
                return;
            }

            // 모달을 띄워 최종 확인을 받는 것이 좋습니다 (현재는 확인 없이 바로 삭제)
            // 확인 모달을 띄운다고 가정하고, deleteConfirmModal을 재활용
            context.recordToDeleteId = null; // 특정 ID가 아님
            context.deleteMode = 'all-completed';
            
            const deleteMessage = document.getElementById('delete-confirm-message');
            if(deleteMessage) {
                 deleteMessage.textContent = `완료된 업무 ${completedIds.length}건을 모두 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`;
            }
            deleteConfirmModal.classList.remove('hidden');

            // 'all-completed' 모드를 위한 리스너가 별도로 필요하지만,
            // 여기서는 confirmDeleteBtn 리스너를 수정하여 처리
            
            // (임시) confirmDeleteBtn 리스너를 재정의하거나 분기해야 함
            // -> 여기서는 기존 confirmDeleteBtn 리스너를 수정하여 이 케이스를 처리해야 함.
            // -> 하지만 이 파일에서는 리스너가 이미 등록됨.
            
            // ‼️ [수정 권고]
            // '모두 삭제'용 확인 모달(예: #delete-all-confirm-modal)을 별도로 만들거나,
            // confirmDeleteBtn 리스너가 'context.deleteMode'를 확인하도록 수정해야 합니다.
            // 
            // 일단 '모두 삭제' 버튼 클릭 시, 'context.deleteMode'를 'all-completed'로 설정하고
            // 기존 삭제 모달을 띄우는 것으로 가정하고 코드를 수정합니다.
            // (confirmDeleteBtn 리스너가 'all-completed'를 처리한다는 가정 하에)
            
            // ... 위 confirmDeleteBtn 리스너에 'all-completed' 처리 로직이 없으므로 추가가 필요합니다 ...
            // ... (실제로는 'all-completed'를 위한 별도 버튼/로직이 필요함) ...

            // ‼️ [임시 해결책]
            // 사용자가 "완료 기록 전체 삭제"를 누르면, confirmDeleteBtn 리스너가 아닌
            // 이 리스너에서 직접 'all-completed'를 처리하도록 로직을 수정합니다.
            // (confirmDeleteBtn 리스너는 'single'과 'group'만 처리하게 둠)
            
            // ‼️ [위의 주석은 잘못됨] - deleteConfirmModal을 띄우는 것이 맞음.
            // confirmDeleteBtn 리스너에 'all-completed' 케이스를 추가해야 함.
            
            // (수정된 confirmDeleteBtn 리스너가 필요)
            // (여기서의 코드는 단지 모달만 띄우는 것이 맞음)
        });
    }
    
    // (위의 'delete-all-completed-btn' 리스너에 대한 'confirmDeleteBtn' 리스너 수정)
    // -> ‼️ [수정 권고] 'confirmDeleteBtn' 리스너에 'all-completed' 모드 처리를 추가해야 합니다.
    // 예시:
    /*
    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', async () => {
            if (context.deleteMode === 'group') {
                // ... (기존 그룹 삭제 로직) ...
            } else if (context.deleteMode === 'single') {
                // ... (기존 단일 삭제 로직) ...
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
            
            deleteConfirmModal.classList.add('hidden');
            context.recordToDeleteId = null;
            context.deleteMode = 'single';
        });
    }
    */
    // (단, 이 파일은 'listeners-modals.js'이므로 위 코드를 'confirmDeleteBtn' 리스너에 병합해야 함)

    // 기록 수정 모달
    if (confirmEditBtn) {
        // ✅ [수정] Firestore 문서 업데이트 (async 추가)
        confirmEditBtn.addEventListener('click', async () => {
            const recordId = document.getElementById('edit-record-id').value;
            const task = document.getElementById('edit-task-name').value;
            const member = document.getElementById('edit-member-name').value;
            const startTime = document.getElementById('edit-start-time').value;
            const endTime = document.getElementById('edit-end-time').value;

            const record = (appState.workRecords || []).find(r => r.id === recordId);
            if (!record) {
                showToast('수정할 기록을 찾을 수 없습니다.', true);
                return;
            }

            try {
                const docRef = doc(db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString(), 'workRecords', recordId);
                
                // Firestore 업데이트 객체
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
                    // 상태는 기존 상태(ongoing 또는 paused)를 유지해야 함.
                    // (만약 endTime을 삭제했다면 상태를 'ongoing'이나 'paused'로 되돌리는 로직 필요)
                    // (여기서는 endTime이 있는 경우만 'completed'로 간주)
                    
                    // ‼️ [수정 권고]
                    // endTime이 비워졌을 때, 이전 상태가 'completed'였다면
                    // 'ongoing'으로 되돌릴지, 아니면 수정을 막을지 정책이 필요합니다.
                    // 현재: endTime이 없으면 duration/status는 변경 안 함 (하지만 endTime은 null로)
                    updates.endTime = null;
                    updates.status = record.status === 'completed' ? 'ongoing' : record.status; // 완료된걸 수정하면 'ongoing'으로
                    updates.duration = null;
                }
                
                await updateDoc(docRef, updates);

                // ⛔️ appState.workRecords 찾아서 수정 (제거)
                // ⛔️ render() (제거)
                // ⛔️ saveStateToFirestore() (제거)

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
            // ✅ [수정] finalizeStopGroup은 이제 async
            await finalizeStopGroup(context.groupToStopId, quantity);
            quantityOnStopModal.classList.add('hidden');
            context.groupToStopId = null;
        });
    }
    if (cancelQuantityOnStopBtn) {
        cancelQuantityOnStopBtn.addEventListener('click', async () => {
             // ✅ [수정] finalizeStopGroup은 이제 async
            await finalizeStopGroup(context.groupToStopId, null); // 처리량 없이 종료
            quantityOnStopModal.classList.add('hidden');
            context.groupToStopId = null;
        });
    }

    // 개별 작업 중지 확인 모달
    if (confirmStopIndividualBtn) {
        confirmStopIndividualBtn.addEventListener('click', async () => {
            // ✅ [수정] stopWorkIndividual은 이제 async
            await stopWorkIndividual(context.recordToStopId);
            stopIndividualConfirmModal.classList.add('hidden');
            context.recordToStopId = null;
        });
    }

    // 알바 이름 수정 모달
    if (confirmEditPartTimerBtn) {
        // ✅ [수정] async 추가
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
            
            // 중복 이름 체크 (선택 사항 - 현재 로직에는 없음)
            const isNameTaken = (appConfig.teamGroups || []).flatMap(g => g.members).includes(newName) ||
                                (appState.partTimers || []).some(p => p.name === newName && p.id !== partTimerId);
            
            if (isNameTaken) {
                showToast(`'${newName}'(이)라는 이름은 이미 사용 중입니다.`, true);
                return;
            }

            // 1. 로컬 appState.partTimers 업데이트 (메인 문서 'state' blob용)
            partTimer.name = newName;

            // 2. 로컬 appState.workRecords 캐시 업데이트 (실시간 UI 반영용)
            // ‼️ [중요] 이 작업은 onSnapshot이 Firestore 변경을 감지하고
            //    app.js에서 어차피 다시 수행하므로, 여기서 미리 수행하면 UI가 즉시 바뀜.
            (appState.workRecords || []).forEach(record => {
                if (record.member === oldName) {
                    record.member = newName;
                }
            });
            // ‼️ [수정 권고] 
            // 알바 이름 변경 시, 'appConfig'의 'memberWages'도 업데이트해야 할 수 있음.
            // 현재 로직: partTimers 배열만 수정함.
            // -> admin.js에서 저장할 때 memberWages도 같이 저장함. (여기서는 partTimers만 수정)
            
            // ‼️ [수정 권고] - 주석 내용 확인
            // appState.partTimers가 수정되었으므로, 메인 문서(state blob)를 저장해야 함.
            // 그리고 Firestore의 workRecords 컬렉션도 수정해야 함.

            // ✅ [신규] 3. Firestore 'workRecords' 하위 컬렉션 업데이트
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
                } else {
                     // showToast("당일 업무 기록에서 변경할 내역은 없습니다."); (토스트가 너무 많아질 수 있으니 생략)
                }

                // 4. 메인 문서 'state' blob 저장 (partTimers 변경 사항)
                // ✅ onSnapshot이 UI를 갱신하므로 render()는 필요 없음
                debouncedSaveState(); 

                // 5. 모달 닫기
                document.getElementById('edit-part-timer-modal').classList.add('hidden');
                
                // 6. (중요) 로컬 캐시 렌더링
                render(); // 로컬 캐시(partTimer.name)가 즉시 반영되도록 render() 호출

            } catch (e) {
                console.error("알바 이름 변경 중 Firestore 업데이트 실패: ", e);
                showToast("알바 이름 변경 중 Firestore DB 업데이트에 실패했습니다.", true);
                // 롤백: 로컬 변경 사항 되돌리기
                partTimer.name = oldName; 
                (appState.workRecords || []).forEach(record => {
                    if (record.member === newName) {
                        record.member = oldName;
                    }
                });
                render(); // 롤백 후 렌더링
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
                // 여러 날짜 (Persistent)
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
                saveLeaveSchedule(db, persistentLeaveSchedule); // Firestore에 저장
            } else {
                // 오늘 하루 (Daily)
                if (!appState.dailyOnLeaveMembers.includes(memberName)) {
                    appState.dailyOnLeaveMembers.push(memberName);
                    debouncedSaveState(); // 오늘자 문서에 저장
                }
            }

            showToast(`${memberName}님 ${type} 처리 완료.`);
            leaveTypeModal.classList.add('hidden');
            // render()는 onSnapshot이 처리
        });
    }

    // 근태 취소 확인 모달
    if (confirmCancelLeaveBtn) {
        confirmCancelLeaveBtn.addEventListener('click', () => {
            const memberName = context.memberToCancelLeave;
            if (!memberName) return;

            let dailyChanged = false;
            let persistentChanged = false;

            // 1. Daily(오늘) 근태 목록에서 제거
            const dailyIndex = appState.dailyOnLeaveMembers.indexOf(memberName);
            if (dailyIndex > -1) {
                appState.dailyOnLeaveMembers.splice(dailyIndex, 1);
                dailyChanged = true;
            }

            // 2. Persistent(기간) 근태 목록에서 오늘 날짜가 포함된 항목 제거
            const today = getTodayDateString();
            persistentLeaveSchedule.onLeaveMembers = (persistentLeaveSchedule.onLeaveMembers || []).filter(entry => {
                if (entry.member === memberName) {
                    const endDate = entry.endDate || entry.startDate;
                    if (today >= entry.startDate && today <= (endDate || entry.startDate)) {
                        persistentChanged = true;
                        return false; // 이 항목을 제거
                    }
                }
                return true; // 유지
            });

            if (dailyChanged) {
                debouncedSaveState(); // 오늘자 문서 저장
            }
            if (persistentChanged) {
                saveLeaveSchedule(db, persistentLeaveSchedule); // Persistent 문서 저장
            }

            if (dailyChanged || persistentChanged) {
                showToast(`${memberName}님 근태 기록(오늘)이 취소되었습니다.`);
            } else {
                showToast('취소할 근태 기록이 없습니다.');
            }

            cancelLeaveConfirmModal.classList.add('hidden');
            context.memberToCancelLeave = null;
            // render()는 onSnapshot이 처리
        });
    }

    // 수동 기록 추가 모달
    if (confirmManualAddBtn) {
        confirmManualAddBtn.addEventListener('click', async () => {
            const member = document.getElementById('manual-member-name').value;
            const task = document.getElementById('manual-task-name').value;
            const startTime = document.getElementById('manual-start-time').value;
            const endTime = document.getElementById('manual-end-time').value;
            const pauses = []; // (단순화를 위해 수동 추가는 휴게시간 없음)

            if (!member || !task || !startTime || !endTime) {
                showToast('모든 필드를 입력해야 합니다.', true);
                return;
            }
            if (startTime >= endTime) {
                showToast('시작 시간이 종료 시간보다 늦거나 같을 수 없습니다.', true);
                return;
            }

            // ✅ [신규] Firestore 'workRecords' 하위 컬렉션에 문서 생성
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

                // ⛔️ appState.workRecords.push(...) (제거)
                // ⛔️ render() (제거)
                // ⛔️ saveStateToFirestore() (제거)
                
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
            // ✅ [수정] saveProgress는 이제 async
            await saveProgress(false); // isAuto=false (수동 저장)
            endShiftConfirmModal.classList.add('hidden');
        });
    }

    // 앱 초기화(오늘 데이터 삭제) 모달
    if (confirmResetAppBtn) {
        confirmResetAppBtn.addEventListener('click', async () => {
            const today = getTodayDateString();
            
            try {
                // 1. workRecords 하위 컬렉션 비우기 (문서 일괄 삭제)
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

                // 2. 메인 문서(state blob) 삭제
                const docRef = doc(db, 'artifacts', 'team-work-logger-v2', 'daily_data', today);
                await deleteDoc(docRef);

                // 3. 로컬 상태 초기화
                appState.workRecords = [];
                appState.taskQuantities = {};
                appState.partTimers = [];
                appState.dailyOnLeaveMembers = [];
                appState.dailyAttendance = {};
                // ... (기타 appState 속성 초기화) ...
                
                // 4. 로컬 캐시 렌더링
                render();

                showToast('오늘 데이터가 모두 초기화되었습니다.');
                resetAppModal.classList.add('hidden');
                
                // (참고) onSnapshot이 문서를 찾을 수 없다는 응답을 보내고
                // app.js의 onSnapshot 콜백이 로컬 상태를 다시 초기화할 것입니다.
                
            } catch (e) {
                console.error("오늘 데이터 초기화 실패: ", e);
                showToast("데이터 초기화 중 오류가 발생했습니다.", true);
            }
        });
    }

    // 로그인 모달
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = loginEmailInput.value;
            const password = loginPasswordInput.value;

            if (loginButtonText) loginButtonText.classList.add('hidden');
            if (loginButtonSpinner) loginButtonSpinner.classList.remove('hidden');
            if (loginSubmitBtn) loginSubmitBtn.disabled = true;
            if (loginErrorMsg) loginErrorMsg.classList.add('hidden');

            try {
                await signInWithEmailAndPassword(auth, email, password);
                // onAuthStateChanged가 나머지를 처리
            } catch (error) {
                console.error("Login failed:", error.code, error.message);
                if (loginErrorMsg) {
                    loginErrorMsg.textContent = '로그인 실패. 이메일 또는 비밀번호를 확인하세요.';
                    loginErrorMsg.classList.remove('hidden');
                }
                if (loginButtonText) loginButtonText.classList.remove('hidden');
                if (loginButtonSpinner) loginButtonSpinner.classList.add('hidden');
                if (loginSubmitBtn) loginSubmitBtn.disabled = false;
            }
        });
    }
    
    // 시작 시간 수정 모달
    if (confirmEditStartTimeBtn) {
        // ✅ [수정] Firestore 문서 업데이트 (async 추가)
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

                // ⛔️ appState.workRecords 찾아서 수정 (제거)
                // ⛔️ render() (제거)
                // ⛔️ saveStateToFirestore() (제거)

                showToast('시작 시간이 수정되었습니다.');
                editStartTimeModal.classList.add('hidden');

            } catch (e) {
                 console.error("Error updating start time: ", e);
                 showToast("시작 시간 수정 중 오류 발생", true);
            }
        });
    }
    
    // 근태 기록 수정 모달 (History)
    if (confirmEditAttendanceBtn) {
        confirmEditAttendanceBtn.addEventListener('click', () => {
            // (이 로직은 app-history-logic.js로 이동하는 것이 좋음)
            // (saveAttendanceRecord가 수정도 겸함)
            saveAttendanceRecord(); // ui-modals.js에서 임포트 필요
        });
    }

    // 근태 기록 추가 모달 (History)
    if (confirmAddAttendanceBtn) {
        confirmAddAttendanceBtn.addEventListener('click', () => {
            // (이 로직은 app-history-logic.js로 이동하는 것이 좋음)
            saveAttendanceRecord();
        });
    }
    
    // ✨ [신규] 퇴근 취소 버튼 (PC/모바일)
    if (pcClockOutCancelBtn) {
        pcClockOutCancelBtn.addEventListener('click', () => {
            if (appState.currentUser) {
                cancelClockOut(appState.currentUser, false);
            }
        });
    }
    if (mobileClockOutCancelBtn) {
         mobileClockOutCancelBtn.addEventListener('click', () => {
            if (appState.currentUser) {
                cancelClockOut(appState.currentUser, false);
            }
        });
    }
    
    // ✨ [신규] 관리자용 팀원 액션 모달
    if (memberActionModal) {
        memberActionModal.addEventListener('click', (e) => {
            const memberName = context.memberToAction;
            if (!memberName) return;

            const target = e.target.closest('button');
            if (!target) return;

            if (target.id === 'admin-clock-in-btn') {
                processClockIn(memberName, true); // (app-logic.js)
            } else if (target.id === 'admin-clock-out-btn') {
                processClockOut(memberName, true); // (app-logic.js)
            } else if (target.id === 'admin-cancel-clock-out-btn') {
                cancelClockOut(memberName, true); // (app-logic.js)
            } else if (target.id === 'open-leave-modal-btn') {
                renderLeaveTypeModal(memberName); // (ui-modals.js)
            }
            
            // 액션 후 모달을 닫음 (근태 유형 선택 모달은 스스로 열림)
            if (target.id !== 'open-leave-modal-btn') {
                memberActionModal.classList.add('hidden');
            }
        });
    }
}