// === js/listeners-modals-confirm.js ===

import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { showToast, getTodayDateString, getCurrentTime } from './utils.js';
import { finalizeStopGroup, stopWorkIndividual } from './app-logic.js';
import { saveDayDataToHistory } from './history-data-manager.js';
import { switchHistoryView } from './app-history-logic.js';
import { render } from './app.js';
import { debouncedSaveState, saveStateToFirestore } from './app-data.js';
import { saveLeaveSchedule } from './config.js';

import { 
    doc, deleteDoc, writeBatch, collection, query, where, getDocs, setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const deleteWorkRecordDocument = async (recordId) => {
    if (!recordId) return;
    try {
        const today = getTodayDateString();
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', today, 'workRecords', recordId);
        await deleteDoc(docRef);
    } catch (e) {
        console.error("Error deleting work record document: ", e);
        showToast("문서 삭제 중 오류 발생.", true);
    }
};

const deleteWorkRecordDocuments = async (recordIds) => {
    if (!recordIds || recordIds.length === 0) return;
    try {
        const today = getTodayDateString();
        const colRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', today, 'workRecords');
        const batch = writeBatch(State.db);

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

export function setupConfirmationModalListeners() {

    if (DOM.confirmDeleteBtn) {
        DOM.confirmDeleteBtn.addEventListener('click', async () => {
            if (State.context.deleteMode === 'group') {
                const groupMembers = (State.appState.workRecords || [])
                    .filter(r => String(r.groupId) === String(State.context.recordToDeleteId) && (r.status === 'ongoing' || r.status === 'paused'))
                    .map(r => r.id);

                if (groupMembers.length > 0) {
                    await deleteWorkRecordDocuments(groupMembers);
                    showToast('그룹 업무가 삭제되었습니다.');
                }
            } else if (State.context.deleteMode === 'single') {
                await deleteWorkRecordDocument(State.context.recordToDeleteId);
                showToast('업무 기록이 삭제되었습니다.');
            } else if (State.context.deleteMode === 'all-completed') {
                 const completedIds = (State.appState.workRecords || [])
                    .filter(r => r.status === 'completed')
                    .map(r => r.id);

                if (completedIds.length > 0) {
                    await deleteWorkRecordDocuments(completedIds);
                    showToast(`완료된 업무 ${completedIds.length}건이 삭제되었습니다.`);
                } else {
                    showToast('삭제할 완료된 업무가 없습니다.');
                }
            } else if (State.context.deleteMode === 'attendance') {
                const { dateKey, index } = State.context.attendanceRecordToDelete;
                const dayData = State.allHistoryData.find(d => d.id === dateKey);

                if (dayData && dayData.onLeaveMembers && dayData.onLeaveMembers[index]) {
                    const deletedRecord = dayData.onLeaveMembers.splice(index, 1)[0];
                    
                    // ✅ 만약 삭제하는 기록이 '오늘' 날짜라면 메인 상태도 동기화
                    if (dateKey === getTodayDateString()) {
                        State.appState.dailyOnLeaveMembers = [...dayData.onLeaveMembers];
                    }

                    try {
                        const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
                        await setDoc(historyDocRef, { onLeaveMembers: dayData.onLeaveMembers }, { merge: true });

                        // 오늘 날짜라면 daily_data도 업데이트
                        if (dateKey === getTodayDateString()) {
                             const dailyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', dateKey);
                             await updateDoc(dailyDocRef, { onLeaveMembers: dayData.onLeaveMembers });
                        }

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
                State.context.attendanceRecordToDelete = null;
            } else if (State.context.deleteMode === 'leave-record') {
                const { memberName, startIdentifier, type, displayType } = State.context.attendanceRecordToDelete;
                let dailyChanged = false;
                let persistentChanged = false;
                
                if (type === 'daily') {
                    const index = State.appState.dailyOnLeaveMembers.findIndex(
                        r => r.member === memberName && (r.startTime || '') === startIdentifier
                    );
                    if (index > -1) {
                        State.appState.dailyOnLeaveMembers.splice(index, 1);
                        dailyChanged = true;
                    }
                } else {
                    const index = State.persistentLeaveSchedule.onLeaveMembers.findIndex(
                        r => r.member === memberName && (r.startDate || '') === startIdentifier
                    );
                    if (index > -1) {
                        State.persistentLeaveSchedule.onLeaveMembers.splice(index, 1);
                        persistentChanged = true;
                    }
                }

                if (dailyChanged || persistentChanged) {
                    try {
                        if (dailyChanged) await saveStateToFirestore();
                        if (persistentChanged) await saveLeaveSchedule(State.db, State.persistentLeaveSchedule);
                        showToast(`${memberName}님의 '${displayType}' 기록이 삭제되었습니다.`);
                    } catch (e) {
                        console.error("Error deleting leave record:", e);
                        showToast('기록 삭제 중 오류가 발생했습니다.', true);
                    }
                } else {
                    showToast('삭제할 기록을 찾지 못했습니다.', true);
                }
                State.context.attendanceRecordToDelete = null;
            }

            DOM.deleteConfirmModal.classList.add('hidden');
            State.context.recordToDeleteId = null;
            State.context.deleteMode = 'single';
        });
    }

    if (DOM.confirmQuantityOnStopBtn) {
        DOM.confirmQuantityOnStopBtn.addEventListener('click', async () => {
            const quantity = document.getElementById('quantity-on-stop-input').value;
            await finalizeStopGroup(State.context.groupToStopId, quantity);
            DOM.quantityOnStopModal.classList.add('hidden');
            State.context.groupToStopId = null;
        });
    }
    if (DOM.cancelQuantityOnStopBtn) {
        DOM.cancelQuantityOnStopBtn.addEventListener('click', async () => {
            await finalizeStopGroup(State.context.groupToStopId, null);
            DOM.quantityOnStopModal.classList.add('hidden');
            State.context.groupToStopId = null;
        });
    }

    if (DOM.confirmStopIndividualBtn) {
        DOM.confirmStopIndividualBtn.addEventListener('click', async () => {
            await stopWorkIndividual(State.context.recordToStopId);
            DOM.stopIndividualConfirmModal.classList.add('hidden');
            State.context.recordToStopId = null;
        });
    }

    if (DOM.confirmStopGroupBtn) {
        DOM.confirmStopGroupBtn.addEventListener('click', async () => {
            if (State.context.groupToStopId) {
                await finalizeStopGroup(State.context.groupToStopId, null);
                if (DOM.stopGroupConfirmModal) DOM.stopGroupConfirmModal.classList.add('hidden');
                State.context.groupToStopId = null;
            }
        });
    }

    if (DOM.cancelStopGroupBtn) {
        DOM.cancelStopGroupBtn.addEventListener('click', () => {
            if (DOM.stopGroupConfirmModal) DOM.stopGroupConfirmModal.classList.add('hidden');
            State.context.groupToStopId = null;
        });
    }
    
    // ✅ [수정] 외출 복귀 로직 (삭제 대신 종료시간 기록)
    if (DOM.confirmCancelLeaveBtn) {
        DOM.confirmCancelLeaveBtn.addEventListener('click', () => {
            const memberName = State.context.memberToCancelLeave;
            if (!memberName) return;

            let dailyChanged = false;
            let persistentChanged = false;
            let message = '';

            // 1. 오늘 근태(일일) 확인
            const todayIndex = State.appState.dailyOnLeaveMembers.findIndex(entry => 
                entry.member === memberName && !entry.endTime // 종료되지 않은 항목
            );

            if (todayIndex > -1) {
                const entry = State.appState.dailyOnLeaveMembers[todayIndex];
                
                if (entry.type === '외출') {
                    // ✅ 외출은 종료시간 기록 (기록 보존)
                    entry.endTime = getCurrentTime();
                    dailyChanged = true;
                    message = `${memberName}님 외출 복귀 처리되었습니다.`;
                } else {
                    // 조퇴 등은 취소 시 삭제 (기존 방식)
                    State.appState.dailyOnLeaveMembers.splice(todayIndex, 1);
                    dailyChanged = true;
                    message = `${memberName}님 근태 기록이 취소되었습니다.`;
                }
            }

            // 2. 영구 일정(연차 등) 확인 - 취소 시 삭제
            const today = getTodayDateString();
            State.persistentLeaveSchedule.onLeaveMembers = (State.persistentLeaveSchedule.onLeaveMembers || []).filter(entry => {
                if (entry.member === memberName) {
                    const endDate = entry.endDate || entry.startDate;
                    if (today >= entry.startDate && today <= (endDate || entry.startDate)) {
                        persistentChanged = true;
                        return false; // 삭제
                    }
                }
                return true;
            });

            if (dailyChanged) {
                debouncedSaveState();
            }
            if (persistentChanged) {
                saveLeaveSchedule(State.db, State.persistentLeaveSchedule);
                if (!message) message = `${memberName}님 연차/일정이 취소되었습니다.`;
            }

            if (dailyChanged || persistentChanged) {
                showToast(message);
            } else {
                showToast('취소할 진행 중인 근태 기록이 없습니다.');
            }

            DOM.cancelLeaveConfirmModal.classList.add('hidden');
            State.context.memberToCancelLeave = null;
        });
    }

    if (DOM.confirmEndShiftBtn) {
        DOM.confirmEndShiftBtn.addEventListener('click', async () => {
            await saveDayDataToHistory(false);
            DOM.endShiftConfirmModal.classList.add('hidden');
        });
    }

    if (DOM.confirmResetAppBtn) {
        DOM.confirmResetAppBtn.addEventListener('click', async () => {
            const today = getTodayDateString();
            try {
                const workRecordsColRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', today, 'workRecords');
                const q = query(workRecordsColRef);
                const querySnapshot = await getDocs(q);
                if (!querySnapshot.empty) {
                    const batch = writeBatch(State.db);
                    querySnapshot.forEach(doc => batch.delete(doc.ref));
                    await batch.commit();
                }
                const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', today);
                await setDoc(docRef, {});

                State.appState.workRecords = [];
                State.appState.taskQuantities = {};
                State.appState.partTimers = [];
                State.appState.dailyOnLeaveMembers = [];
                State.appState.dailyAttendance = {};

                render();
                showToast('오늘 데이터가 모두 초기화되었습니다.');
                DOM.resetAppModal.classList.add('hidden');
            } catch (e) {
                console.error("오늘 데이터 초기화 실패: ", e);
                showToast("데이터 초기화 중 오류가 발생했습니다.", true);
            }
        });
    }
}