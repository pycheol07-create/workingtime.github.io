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

// ✅ [수정] import 문을 ui-modals.js가 실제로 export하는 함수 기준으로 수정
import {
    renderTaskSelectionModal,
    renderTeamSelectionModalContent, // 👈 renderTeamSelectionModal -> renderTeamSelectionModalContent
    // ⛔️ updateQuantityModal, renderLeaveTypeModal 등 존재하지 않는 함수 제거
} from './ui-modals.js';

import {
    startWorkGroup,
    addMembersToWorkGroup,
    finalizeStopGroup,
    stopWorkIndividual,
    processClockOut, // ✨ [신규] 퇴근 처리
    cancelClockOut // ✨ [신규] 퇴근 취소
} from './app-logic.js';
// ✅ [수정] 오류를 일으킨 deleteHistoryEntry, deleteAttendanceRecord 임포트 제거
import { saveProgress, saveDayDataToHistory } from './app-history-logic.js';
// ⛔️ [수정] saveAttendanceRecord는 app-history-logic.js에 없으므로 제거
// import { saveProgress, saveDayDataToHistory, saveAttendanceRecord } from './app-history-logic.js';
import { saveLeaveSchedule } from './config.js';

import { signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
// ✅ [수정] Firestore 함수 임포트 추가 (collection, query, where, getDocs, setDoc)
import { doc, updateDoc, deleteDoc, writeBatch, collection, query, where, getDocs, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


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
export function setupGeneralModalListeners() { // 👈 함수명 수정 (setupModalListeners -> setupGeneralModalListeners)

    // 모달 닫기 버튼 (공통)
    document.querySelectorAll('.modal-close-btn, .modal-cancel-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const modal = btn.closest('.modal-overlay, .fixed.inset-0'); // 👈 모달 선택자 보강
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
            // ⛔️ [삭제] startGroupBtn, addMemberBtn (listeners-main.js로 이동했거나 app.js에 있음)
            // const startGroupBtn = target.closest('#start-work-group-btn');
            // const addMemberBtn = target.closest('#add-to-work-group-btn');

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
            // ⛔️ [삭제] startGroupBtn, addMemberBtn 로직 제거
            /*
            else if (startGroupBtn) {
                // ✅ [수정] startWorkGroup은 이제 async
                await startWorkGroup(context.tempSelectedMembers, context.selectedTaskForStart);
                teamSelectModal.classList.add('hidden');
            } else if (addMemberBtn) {
                // ✅ [수정] addMembersToWorkGroup은 이제 async
                await addMembersToWorkGroup(context.tempSelectedMembers, context.selectedTaskForStart, context.selectedGroupForAdd);
                teamSelectModal.classList.add('hidden');
            }
            */
        });

        // ✅ [추가] 확인/취소 버튼 리스너 (teamSelectModal 리스너 밖으로 이동)
        const confirmTeamSelectBtn = document.getElementById('confirm-team-select-btn');
        if (confirmTeamSelectBtn) {
             confirmTeamSelectBtn.addEventListener('click', async () => {
                if (context.selectedGroupForAdd) {
                     // 인원 추가 모드
                    await addMembersToWorkGroup(context.tempSelectedMembers, context.selectedTaskForStart, context.selectedGroupForAdd);
                } else {
                    // 새 업무 시작 모드
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
                context.selectedGroupForAdd = null; // ✅ [추가] 새 업무 시작이므로 그룹 ID 초기화
                context.tempSelectedMembers = []; // ✅ [추가] 선택 멤버 초기화
                taskSelectModal.classList.add('hidden');
                // ✅ [수정] renderTeamSelectionModal -> renderTeamSelectionModalContent
                renderTeamSelectionModalContent(taskName, appState, appConfig.teamGroups);
                
                // ✅ [추가] 모달 상태 변경 (인원 추가 -> 업무 시작)
                const titleEl = document.getElementById('team-select-modal-title');
                const confirmBtn = document.getElementById('confirm-team-select-btn');
                if (titleEl) titleEl.textContent = `'${taskName}' 업무 시작`;
                if (confirmBtn) confirmBtn.textContent = '선택 완료 및 업무 시작';
                
                if (teamSelectModal) teamSelectModal.classList.remove('hidden');
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
                
                if (groupMembers.length > 0) { // ✅ [추가] 삭제할 대상이 있을 때만
                    await deleteWorkRecordDocuments(groupMembers);
                    showToast('그룹 업무가 삭제되었습니다.');
                }
            } else if (context.deleteMode === 'single') { // ✅ 'single' 명시
                await deleteWorkRecordDocument(context.recordToDeleteId);
                showToast('업무 기록이 삭제되었습니다.');
            } else if (context.deleteMode === 'all-completed') { // ✅ 'all-completed' 처리 추가
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
            // ✅ [추가] 근태 기록 삭제 로직 (listeners-history.js에서 이동)
            else if (context.deleteMode === 'attendance') {
                const { dateKey, index } = context.attendanceRecordToDelete;
                const dayData = allHistoryData.find(d => d.id === dateKey);
                if (dayData && dayData.onLeaveMembers && dayData.onLeaveMembers[index]) {
                    const deletedRecord = dayData.onLeaveMembers.splice(index, 1)[0];
                    try {
                        const historyDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
                        await setDoc(historyDocRef, { onLeaveMembers: dayData.onLeaveMembers }, { merge: true });
                        showToast(`${deletedRecord.member}님의 '${deletedRecord.type}' 기록이 삭제되었습니다.`);
                        // 뷰 갱신
                        const activeAttendanceTab = document.querySelector('#attendance-history-tabs button.font-semibold');
                        const view = activeAttendanceTab ? activeAttendanceTab.dataset.view : 'attendance-daily';
                        switchHistoryView(view); // 👈 이 함수는 listeners-history.js에 있으므로, 이 파일도 수정 필요
                    } catch (e) {
                         console.error('Error deleting attendance record:', e);
                         showToast('근태 기록 삭제 중 오류 발생', true);
                         dayData.onLeaveMembers.splice(index, 0, deletedRecord); // 롤백
                    }
                }
                context.attendanceRecordToDelete = null;
            }
            
            // ⛔️ appState.workRecords = ... (제거)
            // ⛔️ render() (제거)
            // ⛔️ saveStateToFirestore() (제거)
            
            deleteConfirmModal.classList.add('hidden');
            context.recordToDeleteId = null;
            context.deleteMode = 'single';
        });
    }

    // ⛔️ [삭제] deleteAllCompletedBtn 리스너 (listeners-main.js로 이동)

    // 기록 수정 모달
    if (confirmEditBtn) {
        // ✅ [수정] Firestore 문서 업데이트 (async 추가)
        confirmEditBtn.addEventListener('click', async () => {
            // ⛔️ [수정] edit-record-id는 존재하지 않음. context 사용
            // const recordId = document.getElementById('edit-record-id').value;
            const recordId = context.recordToEditId; 
            const task = document.getElementById('edit-task-type').value; // 👈 ID 수정
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
                    
                    // endTime이 비워졌을 때, 이전 상태가 'completed'였다면
                    // 'ongoing'으로 되돌림
                    updates.endTime = null;
                    updates.status = record.status === 'completed' ? 'ongoing' : record.status; 
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
    
    // ⛔️ [삭제] stop-group-confirm-modal 리스너 (listeners-main.js로 이동)

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
            
            // 중복 이름 체크 
            const isNameTaken = (appConfig.teamGroups || []).flatMap(g => g.members).includes(newName) ||
                                (appState.partTimers || []).some(p => p.name === newName && p.id !== partTimerId);
            
            if (isNameTaken) {
                showToast(`'${newName}'(이)라는 이름은 이미 사용 중입니다.`, true);
                return;
            }

            // 1. 로컬 appState.partTimers 업데이트 (메인 문서 'state' blob용)
            partTimer.name = newName;

            // 2. 로컬 appState.workRecords 캐시 업데이트 (실시간 UI 반영용)
            (appState.workRecords || []).forEach(record => {
                if (record.member === oldName) {
                    record.member = newName;
                }
            });

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
                } 
                
                // 4. 메인 문서 'state' blob 저장 (partTimers 변경 사항)
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
                // ⛔️ [수정] dailyOnLeaveMembers는 이제 객체 배열임
                // if (!appState.dailyOnLeaveMembers.includes(memberName)) {
                //     appState.dailyOnLeaveMembers.push(memberName);
                // }
                const newDailyEntry = {
                    member: memberName,
                    type: type,
                    startTime: (type === '외출' || type === '조퇴') ? getCurrentTime() : null,
                    endTime: null
                };
                appState.dailyOnLeaveMembers.push(newDailyEntry);
                debouncedSaveState(); // 오늘자 문서에 저장
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
            // ⛔️ [수정] dailyOnLeaveMembers는 이제 객체 배열임
            // const dailyIndex = appState.dailyOnLeaveMembers.indexOf(memberName);
            const originalLength = appState.dailyOnLeaveMembers.length;
            appState.dailyOnLeaveMembers = appState.dailyOnLeaveMembers.filter(entry => entry.member !== memberName);
            if (appState.dailyOnLeaveMembers.length !== originalLength) {
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
            const member = document.getElementById('manual-add-member').value; // 👈 ID 수정
            const task = document.getElementById('manual-add-task').value; // 👈 ID 수정
            const startTime = document.getElementById('manual-add-start-time').value; // 👈 ID 수정
            const endTime = document.getElementById('manual-add-end-time').value; // 👈 ID 수정
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
                await setDoc(docRef, newRecordData); // ✅ setDoc 임포트 확인 (맨 위에)

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
            // ⛔️ [수정] 마감은 saveProgress(중간저장)가 아니라 saveDayDataToHistory(마감저장)이어야 함
            // await saveProgress(false); // isAuto=false (수동 저장)
            await saveDayDataToHistory(false); // 👈 false: 초기화 안 함
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
                // ⛔️ [수정] 삭제 대신 초기화된 상태로 덮어쓰기 (onSnapshot 오류 방지)
                // await deleteDoc(docRef); 
                await setDoc(docRef, { state: '{}' });

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
                
            } catch (e) {
                console.error("오늘 데이터 초기화 실패: ", e);
                showToast("데이터 초기화 중 오류가 발생했습니다.", true);
            }
        });
    }

    // ⛔️ [삭제] 로그인 모달 리스너 (listeners-main.js로 이동)
    
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
    
    // ⛔️ [삭제] 근태 기록 수정/추가 모달 (listeners-history.js로 이동)
    
    // ⛔️ [삭제] 퇴근 취소 버튼 (listeners-main.js로 이동)
    
    // ⛔️ [삭제] 관리자용 팀원 액션 모달 (listeners-main.js로 이동)
}

// ⛔️ [삭제] switchHistoryView (listeners-history.js에 있어야 함)