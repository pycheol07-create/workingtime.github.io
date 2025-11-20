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
                // ✅ [수정] 이력 탭에서의 근태 삭제 로직 강화
                const { dateKey, index } = State.context.attendanceRecordToDelete;
                const todayKey = getTodayDateString();
                
                // 1. 로컬 데이터에서 삭제 대상 확인
                const dayData = State.allHistoryData.find(d => d.id === dateKey);
                if (dayData && dayData.onLeaveMembers && dayData.onLeaveMembers[index]) {
                    const recordToDelete = dayData.onLeaveMembers[index];
                    const isPersistentType = ['연차', '출장', '결근'].includes(recordToDelete.type);
                    
                    // 2. 영구 저장소(leaveSchedule) 삭제 시도 (연차 등인 경우)
                    let deletedFromPersistent = false;
                    if (isPersistentType) {
                        const pIndex = State.persistentLeaveSchedule.onLeaveMembers.findIndex(p => {
                            // ID가 있으면 ID로 비교, 없으면 필드값으로 비교
                            if (recordToDelete.id && p.id) return p.id === recordToDelete.id;
                            return p.member === recordToDelete.member && 
                                   p.startDate === recordToDelete.startDate && 
                                   p.type === recordToDelete.type;
                        });
                        
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

                    // 3. 로컬 데이터 및 DB 문서(daily_data/history) 업데이트
                    // (영구 일정에서 삭제했더라도, 이미 날짜별 문서에 복사된 데이터는 별도로 지워야 함)
                    dayData.onLeaveMembers.splice(index, 1); // 로컬 즉시 반영

                    try {
                        let docRef;
                        if (dateKey === todayKey) {
                            docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', todayKey);
                        } else {
                            docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
                        }

                        // 배열 전체를 덮어쓰는 방식으로 업데이트 (확실한 동기화)
                        await updateDoc(docRef, { onLeaveMembers: dayData.onLeaveMembers });
                        
                        showToast(`${recordToDelete.member}님의 '${recordToDelete.type}' 기록이 삭제되었습니다.`);
                        
                        // 4. 화면 갱신
                        const activeAttendanceTab = document.querySelector('#attendance-history-tabs button.font-semibold');
                        const view = activeAttendanceTab ? activeAttendanceTab.dataset.view : 'attendance-daily';
                        await switchHistoryView(view);

                    } catch (e) {
                         console.error('Error updating attendance doc:', e);
                         showToast('삭제 내용을 저장하는 중 오류가 발생했습니다.', true);
                    }
                } else {
                    showToast('삭제할 기록을 찾을 수 없습니다.', true);
                }
                
                State.context.attendanceRecordToDelete = null;
            }
            // 메인 화면에서의 근태 삭제 (아이콘 클릭 등)
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
                    // 외출은 종료 시간 기록 (이력 유지)
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

    // ✅ [신규] 업무 종료 알림 - "네, 마감합니다" 버튼
    if (DOM.confirmShiftEndAlertBtn) {
        DOM.confirmShiftEndAlertBtn.addEventListener('click', async () => {
            // 1. 브라우저 종료 방지 해제
            window.onbeforeunload = null;
            
            // 2. 모달 닫기
            if (DOM.shiftEndAlertModal) DOM.shiftEndAlertModal.classList.add('hidden');

            // 3. 마감 처리 (Reset: true)
            await saveDayDataToHistory(true);
        });
    }

    // ✅ [신규] 업무 종료 알림 - "아니요, 계속 근무" 버튼
    if (DOM.cancelShiftEndAlertBtn) {
        DOM.cancelShiftEndAlertBtn.addEventListener('click', () => {
            // 1. 브라우저 종료 방지 해제 (사용자가 의도적으로 남음)
            window.onbeforeunload = null;

            // 2. 모달 닫기
            if (DOM.shiftEndAlertModal) DOM.shiftEndAlertModal.classList.add('hidden');
        });
    }
}