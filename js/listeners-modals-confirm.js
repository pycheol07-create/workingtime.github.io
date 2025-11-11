// === js/listeners-modals-confirm.js ===
// 설명: '예/아니오' 형태의 모든 확인(Confirm) 모달 리스너를 담당합니다.

import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { showToast, getTodayDateString } from './utils.js';
import { finalizeStopGroup, stopWorkIndividual } from './app-logic.js';
import { saveDayDataToHistory } from './history-data-manager.js';
import { switchHistoryView } from './app-history-logic.js';

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
    // (listeners-modals.js -> listeners-modals-confirm.js)
    if (DOM.cancelQuantityOnStopBtn) {
        DOM.cancelQuantityOnStopBtn.addEventListener('click', async () => {
            await finalizeStopGroup(State.context.groupToStopId, null);
            DOM.quantityOnStopModal.classList.add('hidden');
            State.context.groupToStopId = null;
        });
    }

    // (listeners-modals.js -> listeners-modals-confirm.js)
    if (DOM.confirmStopIndividualBtn) {
        DOM.confirmStopIndividualBtn.addEventListener('click', async () => {
            await stopWorkIndividual(State.context.recordToStopId);
            DOM.stopIndividualConfirmModal.classList.add('hidden');
            State.context.recordToStopId = null;
        });
    }

    // (listeners-modals.js -> listeners-modals-confirm.js)
    if (DOM.confirmStopGroupBtn) {
        DOM.confirmStopGroupBtn.addEventListener('click', async () => {
            if (State.context.groupToStopId) {
                await finalizeStopGroup(State.context.groupToStopId, null);
                if (DOM.stopGroupConfirmModal) DOM.stopGroupConfirmModal.classList.add('hidden');
                State.context.groupToStopId = null;
            }
        });
    }

    // (listeners-modals.js -> listeners-modals-confirm.js)
    if (DOM.cancelStopGroupBtn) {
        DOM.cancelStopGroupBtn.addEventListener('click', () => {
            if (DOM.stopGroupConfirmModal) DOM.stopGroupConfirmModal.classList.add('hidden');
            State.context.groupToStopId = null;
        });
    }
    
    // (listeners-modals.js -> listeners-modals-confirm.js)
    if (DOM.confirmCancelLeaveBtn) {
        DOM.confirmCancelLeaveBtn.addEventListener('click', () => {
            // (이 로직은 Firestore를 직접 쓰지 않고 State만 변경하므로 그대로 둠)
            const memberName = State.context.memberToCancelLeave;
            if (!memberName) return;

            let dailyChanged = false;
            let persistentChanged = false;

            const originalLength = State.appState.dailyOnLeaveMembers.length;
            State.appState.dailyOnLeaveMembers = State.appState.dailyOnLeaveMembers.filter(entry => entry.member !== memberName);
            if (State.appState.dailyOnLeaveMembers.length !== originalLength) {
                dailyChanged = true;
            }

            const today = getTodayDateString();
            State.persistentLeaveSchedule.onLeaveMembers = (State.persistentLeaveSchedule.onLeaveMembers || []).filter(entry => {
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
                // debouncedSaveState()는 app.js에 있지만,
                // 이 함수는 app-logic.js의 saveLeaveSchedule과 함께 호출되어야 함
                // 여기서는 State.js의 debouncedSaveState를 호출해야 함.
                // -> app.js에서 debouncedSaveState를 가져와야 함.
                // --> 아, app.js의 debouncedSaveState는 app-logic.js를 통해 못가져옴.
                // ---> listeners-modals.js에 debouncedSaveState import가 있었음!
                // ----> 이 파일(confirm.js)에도 import app.js가 필요함.
                
                // [임시 조치] app.js의 debouncedSaveState를 직접 호출해야 함.
                // 상단에 import { debouncedSaveState } from './app.js'; 추가.
                // (app.js import가 listeners-modals.js에 이미 있었음)
                
                // [정정] 아, saveLeaveSchedule이 config.js에 있네.
                // 그럼 app.js의 debouncedSaveState와 config.js의 saveLeaveSchedule을 둘다 import해야함.
                
                // [최종]
                // 1. 상단에 import { debouncedSaveState } from './app.js'; 추가
                // 2. 상단에 import { saveLeaveSchedule } from './config.js'; 추가
                
                // [다시 최종]
                // listeners-modals.js는 이미 app.js와 config.js를 import 하고 있었음.
                // 따라서 이 파일(confirm.js)도 동일하게 import 해야 함.
                // 상단에 app.js와 config.js import 추가
                
                // [정말 최종]
                // `listeners-modals.js` 파일에 `debouncedSaveState`와 `saveLeaveSchedule`이 이미 임포트되어 있었음.
                // 따라서 `listeners-modals-confirm.js`도 동일하게 임포트해야 함.
                
                // -> 아님. `confirmCancelLeaveBtn` 리스너만 해당 임포트가 필요함.
                // -> `listeners-modals-confirm.js` 상단에 추가:
                import { debouncedSaveState } from './app.js';
                import { saveLeaveSchedule } from './config.js';
                
                debouncedSaveState();
            }
            if (persistentChanged) {
                saveLeaveSchedule(State.db, State.persistentLeaveSchedule);
            }

            if (dailyChanged || persistentChanged) {
                showToast(`${memberName}님 근태 기록(오늘)이 취소되었습니다.`);
            } else {
                showToast('취소할 근태 기록이 없습니다.');
            }

            DOM.cancelLeaveConfirmModal.classList.add('hidden');
            State.context.memberToCancelLeave = null;
        });
    }

    // (listeners-modals.js -> listeners-modals-confirm.js)
    if (DOM.confirmEndShiftBtn) {
        DOM.confirmEndShiftBtn.addEventListener('click', async () => {
            await saveDayDataToHistory(false);
            DOM.endShiftConfirmModal.classList.add('hidden');
        });
    }

    // (listeners-modals.js -> listeners-modals-confirm.js)
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

                // render()는 app.js에 있음.
                // 상단에 import { render } from './app.js'; 추가
                import { render } from './app.js';
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