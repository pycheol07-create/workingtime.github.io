// === js/listeners-modals-confirm.js ===
// 설명: '예/아니오' 형태의 모든 확인(Confirm) 모달 리스너를 담당합니다.

import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { showToast, getTodayDateString, getCurrentTime } from './utils.js'; // getCurrentTime 추가
import { finalizeStopGroup, stopWorkIndividual } from './app-logic.js';
import { saveDayDataToHistory } from './history-data-manager.js';
import { switchHistoryView } from './app-history-logic.js';
import { render } from './app.js'; 
import { debouncedSaveState, saveStateToFirestore } from './app-data.js'; 
import { saveLeaveSchedule } from './config.js'; 

import { 
    doc, deleteDoc, writeBatch, collection, query, where, getDocs, setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// (listeners-modals.js -> listeners-modals-confirm.js)
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

// (listeners-modals.js -> listeners-modals-confirm.js)
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

    // (listeners-modals.js -> listeners-modals-confirm.js)
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
            }
            else if (State.context.deleteMode === 'attendance') {
                const { dateKey, index } = State.context.attendanceRecordToDelete;
                const dayData = State.allHistoryData.find(d => d.id === dateKey);

                if (dayData && dayData.onLeaveMembers && dayData.onLeaveMembers[index]) {
                    const deletedRecord = dayData.onLeaveMembers.splice(index, 1)[0];
                    try {
                        const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
                        await setDoc(historyDocRef, { onLeaveMembers: dayData.onLeaveMembers }, { merge: true });

                        showToast(`${deletedRecord.member}님의 '${deletedRecord.type}' 기록이 삭제되었습니다.`);

                        const activeAttendanceTab = document.querySelector('#attendance-history-tabs button.font-semibold');
                        const view = activeAttendanceTab ? activeAttendanceTab.dataset.view : 'attendance-daily';

                        await switchHistoryView(view);
                    } catch (e) {
                         console.error('Error deleting attendance record:', e);
                         showToast('근태 기록 삭제 중 오류 발생', true);
                         dayData.onLeaveMembers.splice(index, 0, deletedRecord);
                    }
                }
                State.context.attendanceRecordToDelete = null;
            }
            // 메인 화면 근태 기록 삭제 로직
            else if (State.context.deleteMode === 'leave-record') {
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
                } else { // 'persistent'
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

    // (listeners-modals.js -> listeners-modals-confirm.js)
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
    
    // ✅ [수정] 근태 복귀(취소) 로직 수정
    if (DOM.confirmCancelLeaveBtn) {
        DOM.confirmCancelLeaveBtn.addEventListener('click', async () => {
            const memberName = State.context.memberToCancelLeave;
            if (!memberName) return;

            let dailyChanged = false;
            let persistentChanged = false;
            const now = getCurrentTime();
            let actionMessage = '취소';

            // 1. 일일 근태 ('외출', '조퇴', '지각' 등)
            const dailyEntry = State.appState.dailyOnLeaveMembers.find(entry => 
                entry.member === memberName && 
                (entry.type === '외출' || entry.type === '조퇴' || entry.type === '지각') && 
                !entry.endTime // 아직 종료되지 않은 기록
            );

            if (dailyEntry) {
                if (dailyEntry.type === '외출') {
                    // ✅ 외출은 삭제하지 않고 종료 시간을 기록 (이력 유지)
                    dailyEntry.endTime = now;
                    dailyChanged = true;
                    actionMessage = '복귀 완료';
                } else {
                    // 그 외(잘못 누른 조퇴/지각 등)는 취소 시 삭제 (또는 정책에 따라 종료시간 처리 가능)
                    // 여기서는 '복귀 처리'라는 맥락상 외출 외에는 삭제로 처리 (기존 로직 유지)
                    State.appState.dailyOnLeaveMembers = State.appState.dailyOnLeaveMembers.filter(entry => entry !== dailyEntry);
                    dailyChanged = true;
                }
            } else {
                // 2. 영구 근태 ('연차', '결근' 등) - 이건 복귀라기보다 취소 개념이 강함
                const today = getTodayDateString();
                const originalLength = State.persistentLeaveSchedule.onLeaveMembers.length;
                
                State.persistentLeaveSchedule.onLeaveMembers = (State.persistentLeaveSchedule.onLeaveMembers || []).filter(entry => {
                    if (entry.member === memberName) {
                        const endDate = entry.endDate || entry.startDate;
                        if (today >= entry.startDate && today <= (endDate || entry.startDate)) {
                            return false; // 오늘 날짜에 해당하는 기록 삭제
                        }
                    }
                    return true;
                });

                if (State.persistentLeaveSchedule.onLeaveMembers.length !== originalLength) {
                    persistentChanged = true;
                }
            }

            // DB 저장
            try {
                if (dailyChanged) {
                    await saveStateToFirestore();
                }
                if (persistentChanged) {
                    await saveLeaveSchedule(State.db, State.persistentLeaveSchedule);
                }

                if (dailyChanged || persistentChanged) {
                    showToast(`${memberName}님 ${actionMessage} 처리되었습니다.`);
                } else {
                    showToast('처리할 근태 기록을 찾지 못했습니다.', true);
                }
            } catch (e) {
                console.error("Error confirming cancel leave:", e);
                showToast("처리 중 오류가 발생했습니다.", true);
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
                    querySnapshot.forEach(doc => {
                        batch.delete(doc.ref);
                    });
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