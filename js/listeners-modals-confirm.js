// === js/listeners-modals-confirm.js ===
// 설명: '예/아니오' 형태의 모든 확인(Confirm) 모달 리스너를 담당합니다.

import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { showToast, getTodayDateString, getCurrentTime, calculateDateDifference } from './utils.js'; 
import { finalizeStopGroup, stopWorkIndividual } from './app-logic.js';
import { saveDayDataToHistory } from './history-data-manager.js';
import { switchHistoryView } from './app-history-logic.js';
import { render } from './app.js'; 
import { debouncedSaveState, saveStateToFirestore } from './app-data.js'; 
import { saveLeaveSchedule } from './config.js'; 

import { 
    doc, deleteDoc, writeBatch, collection, query, where, getDocs, setDoc, getDoc, updateDoc
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
            }
            else if (State.context.deleteMode === 'attendance') {
                // ✅ [수정] 근태 기록 삭제 로직 개선 (오늘/과거, Daily/Persistent 구분 처리)
                const { dateKey, index } = State.context.attendanceRecordToDelete;
                const todayKey = getTodayDateString();
                
                // 1. 로컬 데이터에서 삭제 대상 찾기
                const dayData = State.allHistoryData.find(d => d.id === dateKey);
                if (dayData && dayData.onLeaveMembers && dayData.onLeaveMembers[index]) {
                    const recordToDelete = dayData.onLeaveMembers[index];
                    const isPersistentType = ['연차', '출장', '결근'].includes(recordToDelete.type);
                    
                    // 2. Persistent(영구) 저장소(leaveSchedule) 확인 및 삭제 시도
                    // (화면에 보이는 연차가 persistent 데이터에서 온 것인지 확인)
                    let deletedFromPersistent = false;
                    if (isPersistentType) {
                        const pIndex = State.persistentLeaveSchedule.onLeaveMembers.findIndex(p => 
                            p.member === recordToDelete.member && 
                            p.startDate === recordToDelete.startDate && 
                            p.type === recordToDelete.type
                        );
                        
                        if (pIndex > -1) {
                            State.persistentLeaveSchedule.onLeaveMembers.splice(pIndex, 1);
                            try {
                                await saveLeaveSchedule(State.db, State.persistentLeaveSchedule);
                                deletedFromPersistent = true;
                            } catch (e) {
                                console.error("Error deleting from persistent schedule:", e);
                            }
                        }
                    }

                    // 3. Daily/History 저장소 삭제 (Persistent에서 삭제 안 된 경우만)
                    if (!deletedFromPersistent) {
                        try {
                            let docRef;
                            if (dateKey === todayKey) {
                                // 오늘 날짜는 daily_data 컬렉션
                                docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', todayKey);
                            } else {
                                // 과거 날짜는 history 컬렉션
                                docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
                            }

                            // 최신 데이터 가져와서 필터링 후 업데이트
                            const docSnap = await getDoc(docRef);
                            if (docSnap.exists()) {
                                const currentLeaves = docSnap.data().onLeaveMembers || [];
                                // ID가 있으면 ID로, 없으면 모든 필드 비교로 삭제 대상 찾기
                                const newLeaves = currentLeaves.filter(l => {
                                    if (recordToDelete.id && l.id) return l.id !== recordToDelete.id;
                                    // ID가 없는 레거시 데이터 비교
                                    return !(l.member === recordToDelete.member && 
                                             l.type === recordToDelete.type && 
                                             l.startTime === recordToDelete.startTime &&
                                             l.startDate === recordToDelete.startDate);
                                });
                                
                                await updateDoc(docRef, { onLeaveMembers: newLeaves });
                            }
                        } catch (e) {
                             console.error('Error deleting attendance record from DB:', e);
                             showToast('근태 기록 삭제 중 오류 발생', true);
                        }
                    }
                    
                    showToast(`${recordToDelete.member}님의 '${recordToDelete.type}' 기록이 삭제되었습니다.`);

                    // 4. UI 갱신
                    const activeAttendanceTab = document.querySelector('#attendance-history-tabs button.font-semibold');
                    const view = activeAttendanceTab ? activeAttendanceTab.dataset.view : 'attendance-daily';
                    await switchHistoryView(view);
                } else {
                    showToast('삭제할 기록을 찾을 수 없습니다.', true);
                }
                
                State.context.attendanceRecordToDelete = null;
            }
            // 메인 화면 근태 삭제
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
                !entry.endTime
            );

            if (dailyEntry) {
                if (dailyEntry.type === '외출') {
                    // ✅ 외출은 삭제하지 않고 종료 시간을 기록 (이력 유지)
                    dailyEntry.endTime = now;
                    dailyChanged = true;
                    actionMessage = '복귀 완료';
                } else {
                    State.appState.dailyOnLeaveMembers = State.appState.dailyOnLeaveMembers.filter(entry => entry !== dailyEntry);
                    dailyChanged = true;
                }
            } else {
                // 2. 영구 근태 ('연차', '결근' 등) 취소
                const today = getTodayDateString();
                const originalLength = State.persistentLeaveSchedule.onLeaveMembers.length;
                
                State.persistentLeaveSchedule.onLeaveMembers = (State.persistentLeaveSchedule.onLeaveMembers || []).filter(entry => {
                    if (entry.member === memberName) {
                        const endDate = entry.endDate || entry.startDate;
                        // 오늘 날짜에 걸치는 연차 삭제
                        if (today >= entry.startDate && today <= (endDate || entry.startDate)) {
                            return false;
                        }
                    }
                    return true;
                });

                if (State.persistentLeaveSchedule.onLeaveMembers.length !== originalLength) {
                    persistentChanged = true;
                }
            }

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