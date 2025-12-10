// === js/history-data-manager.js ===
// 설명: '이력' 기능과 관련된 모든 Firestore 데이터 I/O(읽기/쓰기)를 담당합니다.

import * as State from './state.js';
import { getTodayDateString, getCurrentTime, calcElapsedMinutes, showToast } from './utils.js';

// Firestore 함수 임포트
import {
    doc, setDoc, getDoc, collection, getDocs, deleteDoc, runTransaction,
    query, where, writeBatch, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


// (app-history-logic.js -> history-data-manager.js)
// workRecords 컬렉션 참조 헬퍼
export const getWorkRecordsCollectionRef = () => {
    const today = getTodayDateString();
    return collection(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', today, 'workRecords');
};

// (app-history-logic.js -> history-data-manager.js)
// 메인 데일리 문서 참조 헬퍼
export const getDailyDocRef = () => {
    return doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString());
};

// (app-history-logic.js -> history-data-manager.js)
// Firestore에서 직접 데이터를 읽어와 로컬 이력 리스트와 동기화
export const syncTodayToHistory = async () => {
    const todayKey = getTodayDateString();
    const now = getCurrentTime();

    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const recordsSnapshot = await getDocs(workRecordsColRef);
        const liveWorkRecords = recordsSnapshot.docs.map(doc => {
            const data = doc.data();
            if (data.status === 'ongoing' || data.status === 'paused') {
                data.duration = calcElapsedMinutes(data.startTime, now, data.pauses);
                data.endTime = now;
            }
            return data;
        });

        const dailyDocSnap = await getDoc(getDailyDocRef());
        const dailyData = dailyDocSnap.exists() ? dailyDocSnap.data() : {};

        // History 문서도 확인하여 inspectionList 보존
        const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', todayKey);
        const historyDocSnap = await getDoc(historyDocRef);
        const historyData = historyDocSnap.exists() ? historyDocSnap.data() : {};

        const mergedInspectionList = (dailyData.inspectionList && dailyData.inspectionList.length > 0) 
                                     ? dailyData.inspectionList 
                                     : (historyData.inspectionList || []);

        const liveTodayData = {
            id: todayKey,
            workRecords: liveWorkRecords,
            taskQuantities: dailyData.taskQuantities || {},
            confirmedZeroTasks: dailyData.confirmedZeroTasks || [],
            onLeaveMembers: dailyData.onLeaveMembers || [],
            partTimers: dailyData.partTimers || [],
            dailyAttendance: dailyData.dailyAttendance || {},
            management: dailyData.management || {},
            inspectionList: mergedInspectionList,
            // ✅ [신규] 특이사항 메모 동기화 (Daily 우선)
            dailyNote: dailyData.dailyNote || historyData.dailyNote || '' 
        };

        const idx = State.allHistoryData.findIndex(d => d.id === todayKey);
        if (idx > -1) {
            State.allHistoryData[idx] = liveTodayData;
        } else {
            State.allHistoryData.unshift(liveTodayData);
            State.allHistoryData.sort((a, b) => b.id.localeCompare(a.id));
        }

    } catch (e) {
        console.error("Error syncing today to history cache: ", e);
    }
};

// (app-history-logic.js -> history-data-manager.js)
// 이력 저장 (서버 권위 방식)
export async function saveProgress(isAutoSave = false) {
    const dateStr = getTodayDateString();
    const now = getCurrentTime();

    if (!isAutoSave) {
        showToast('서버의 최신 상태를 이력에 저장합니다...');
    }

    const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateStr);

    try {
        const dailyDocSnap = await getDoc(getDailyDocRef());
        const dailyData = dailyDocSnap.exists() ? dailyDocSnap.data() : {};

        const workRecordsColRef = getWorkRecordsCollectionRef();
        const recordsSnapshot = await getDocs(workRecordsColRef);
        
        const liveWorkRecords = recordsSnapshot.docs.map(doc => {
            const data = doc.data();
            if (data.status === 'ongoing' || data.status === 'paused') {
                data.duration = calcElapsedMinutes(data.startTime, now, data.pauses);
                data.endTime = now;
            }
            return data;
        }).filter(record => {
            if (record.status !== 'completed') return true;
            return Math.round(record.duration || 0) > 0;
        });

        if (liveWorkRecords.length === 0 && 
            Object.keys(dailyData.taskQuantities || {}).length === 0 && 
            (!dailyData.inspectionList || dailyData.inspectionList.length === 0) &&
            !dailyData.dailyNote) { // ✅ 메모도 체크
             return;
        }

        const historyData = {
            id: dateStr,
            workRecords: liveWorkRecords,
            taskQuantities: dailyData.taskQuantities || {},
            confirmedZeroTasks: dailyData.confirmedZeroTasks || [],
            onLeaveMembers: dailyData.onLeaveMembers || [],
            partTimers: dailyData.partTimers || [],
            dailyAttendance: dailyData.dailyAttendance || {},
            management: dailyData.management || {},
            inspectionList: dailyData.inspectionList || [],
            // ✅ [신규] 특이사항 저장
            dailyNote: dailyData.dailyNote || '',
            savedAt: now
        };

        await setDoc(historyDocRef, historyData, { merge: true });
        await syncTodayToHistory(); 

        if (isAutoSave) {
            console.log(`Auto-save (server-authoritative) completed at ${now}`);
        } else {
            showToast('최신 상태가 이력에 안전하게 저장되었습니다.');
        }

    } catch (e) {
        console.error('Error in saveProgress (server-authoritative): ', e);
        if (!isAutoSave) {
             showToast(`이력 저장 중 오류가 발생했습니다: ${e.message}`, true);
        }
    }
}

// (app-history-logic.js -> history-data-manager.js)
// 업무 마감 (전체 강제 종료 및 정리)
export async function saveDayDataToHistory(shouldReset) {
    const workRecordsColRef = getWorkRecordsCollectionRef();
    const endTime = getCurrentTime();

    try {
        const querySnapshot = await getDocs(workRecordsColRef);

        if (!querySnapshot.empty) {
            const batch = writeBatch(State.db);
            let removedCount = 0;
            let completedCount = 0;

            querySnapshot.forEach(docSnap => {
                const record = docSnap.data();
                let duration = record.duration || 0;
                let pauses = record.pauses || [];
                let needsUpdate = false;

                if (record.status === 'ongoing' || record.status === 'paused') {
                    if (record.status === 'paused') {
                        const lastPause = pauses.length > 0 ? pauses[pauses.length - 1] : null;
                        if (lastPause && lastPause.end === null) {
                            lastPause.end = endTime;
                        }
                    }
                    duration = calcElapsedMinutes(record.startTime, endTime, pauses);
                    record.status = 'completed';
                    record.endTime = endTime;
                    record.duration = duration;
                    record.pauses = pauses;
                    needsUpdate = true;
                    completedCount++;
                }

                if (Math.round(duration) <= 0) {
                    batch.delete(docSnap.ref);
                    removedCount++;
                } else if (needsUpdate) {
                    batch.update(docSnap.ref, {
                        status: 'completed',
                        endTime: endTime,
                        duration: duration,
                        pauses: pauses
                    });
                }
            });
            
            await batch.commit();
            
            if (completedCount > 0) {
                console.log(`${completedCount}개의 진행 중인 업무를 강제 종료했습니다.`);
            }
            if (removedCount > 0) {
                showToast(`소요 시간이 0분인 기록 ${removedCount}건을 정리(삭제)했습니다.`);
            }
        }
    } catch (e) {
         console.error("Error finalizing tasks during shift end: ", e);
         showToast("업무 마감 중 오류 발생 (이력 저장은 시도합니다)", true);
    }

    await new Promise(resolve => setTimeout(resolve, 500));
    await saveProgress(false);

    if (shouldReset) {
         try {
            const qAll = query(workRecordsColRef);
            const snapshotAll = await getDocs(qAll);
            if (!snapshotAll.empty) {
                const deleteBatch = writeBatch(State.db);
                snapshotAll.forEach(doc => deleteBatch.delete(doc.ref));
                await deleteBatch.commit();
            }
             await setDoc(getDailyDocRef(), { state: '{}' });
        } catch (e) {
             console.error("Error clearing daily data: ", e);
        }
        
        State.appState.workRecords = []; 
        showToast('오늘의 업무 기록을 초기화했습니다.');
    }
}

// (app-history-logic.js -> history-data-manager.js)
// 전체 이력 데이터 불러오기
export async function fetchAllHistoryData() {
    const historyCollectionRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'history');
    try {
        const querySnapshot = await getDocs(historyCollectionRef);
        const data = [];
        querySnapshot.forEach((doc) => {
            const docData = doc.data();
            if (docData) {
                 data.push({ id: doc.id, ...docData });
            }
        });
        data.sort((a, b) => b.id.localeCompare(a.id));

        State.allHistoryData.length = 0; 
        State.allHistoryData.push(...data); 

        return State.allHistoryData;
    } catch (error) {
        console.error('Error fetching all history data:', error);
        showToast('전체 이력 로딩 실패', true);
        State.allHistoryData.length = 0;
        return [];
    }
}

export async function addHistoryWorkRecord(dateKey, newRecordData) {
    const todayKey = getTodayDateString();

    if (newRecordData.startTime && newRecordData.endTime && !newRecordData.duration) {
        newRecordData.duration = calcElapsedMinutes(newRecordData.startTime, newRecordData.endTime, newRecordData.pauses || []);
    }
    
    if (newRecordData.status === 'completed' && Math.round(newRecordData.duration || 0) <= 0) {
        showToast('소요 시간이 0분이어 기록이 저장되지 않았습니다.', true);
        return;
    }

    if (dateKey === todayKey) {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', todayKey, 'workRecords', newRecordData.id);
        await setDoc(docRef, newRecordData);
        await syncTodayToHistory();
        return;
    }

    const dayIndex = State.allHistoryData.findIndex(d => d.id === dateKey);
    
    let dayData = dayIndex > -1 ? State.allHistoryData[dayIndex] : null;
    
    if (!dayData) {
        dayData = {
            id: dateKey,
            workRecords: [],
            taskQuantities: {},
            onLeaveMembers: [],
            partTimers: []
        };
        State.allHistoryData.push(dayData);
        State.allHistoryData.sort((a, b) => b.id.localeCompare(a.id));
    }

    if (!dayData.workRecords) dayData.workRecords = [];

    dayData.workRecords.push(newRecordData);

    const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
    await setDoc(historyDocRef, { workRecords: dayData.workRecords }, { merge: true });
}

export async function updateHistoryWorkRecord(dateKey, recordId, updateData) {
    const todayKey = getTodayDateString();

    if (dateKey === todayKey) {
        const localRecord = (State.appState.workRecords || []).find(r => r.id === recordId);
        if (!localRecord) throw new Error("기록을 찾을 수 없습니다.");

        let newDuration = localRecord.duration;
        let newStatus = updateData.status || localRecord.status;

        if (updateData.startTime || updateData.endTime || updateData.pauses) {
            const start = updateData.startTime || localRecord.startTime;
            const end = updateData.endTime || localRecord.endTime;
            const pauses = updateData.pauses || localRecord.pauses || [];
            
            if (end) {
                newDuration = calcElapsedMinutes(start, end, pauses);
                updateData.duration = newDuration;
            }
        }

        if (newStatus === 'completed' && newDuration !== null && Math.round(newDuration) <= 0) {
            await deleteHistoryWorkRecord(dateKey, recordId);
            showToast('수정 후 소요 시간이 0분이 되어 기록이 삭제되었습니다.');
            return;
        }
        
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', todayKey, 'workRecords', recordId);
        await updateDoc(docRef, updateData);
        await syncTodayToHistory(); 
        return;
    }

    const dayIndex = State.allHistoryData.findIndex(d => d.id === dateKey);
    if (dayIndex === -1) throw new Error("해당 날짜의 이력을 찾을 수 없습니다.");

    const dayData = State.allHistoryData[dayIndex];
    const recordIndex = dayData.workRecords.findIndex(r => r.id === recordId);
    if (recordIndex === -1) throw new Error("수정할 기록을 찾을 수 없습니다.");

    const originalRecord = dayData.workRecords[recordIndex];
    const updatedRecord = { ...originalRecord, ...updateData };

    if (updateData.startTime || updateData.endTime || updateData.pauses) {
        const start = updateData.startTime || originalRecord.startTime;
        const end = updateData.endTime || originalRecord.endTime;
        const pauses = updateData.pauses || originalRecord.pauses || [];
        updatedRecord.duration = calcElapsedMinutes(start, end, pauses);
    }

    if (updatedRecord.status === 'completed' && Math.round(updatedRecord.duration || 0) <= 0) {
        await deleteHistoryWorkRecord(dateKey, recordId);
        showToast('수정 후 소요 시간이 0분이 되어 기록이 삭제되었습니다.');
        return;
    }

    dayData.workRecords[recordIndex] = updatedRecord;

    const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
    await setDoc(historyDocRef, { workRecords: dayData.workRecords }, { merge: true });
}

export async function deleteHistoryWorkRecord(dateKey, recordId) {
    const todayKey = getTodayDateString();

    if (dateKey === todayKey) {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', todayKey, 'workRecords', recordId);
        await deleteDoc(docRef);
        await syncTodayToHistory();
        return;
    }

    const dayIndex = State.allHistoryData.findIndex(d => d.id === dateKey);
    if (dayIndex === -1) throw new Error("해당 날짜의 이력을 찾을 수 없습니다.");

    const dayData = State.allHistoryData[dayIndex];
    const newRecords = dayData.workRecords.filter(r => r.id !== recordId);

    if (dayData.workRecords.length === newRecords.length) {
        throw new Error("삭제할 기록을 찾을 수 없습니다.");
    }

    dayData.workRecords = newRecords; 

    const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
    await setDoc(historyDocRef, { workRecords: newRecords }, { merge: true });
}

export async function saveManagementData(dateKey, managementData) {
    const todayKey = getTodayDateString();

    const dayIndex = State.allHistoryData.findIndex(d => d.id === dateKey);
    if (dayIndex > -1) {
        State.allHistoryData[dayIndex].management = managementData;
    } else {
        State.allHistoryData.push({
            id: dateKey,
            workRecords: [],
            taskQuantities: {},
            onLeaveMembers: [],
            partTimers: [],
            management: managementData
        });
        State.allHistoryData.sort((a, b) => b.id.localeCompare(a.id));
    }

    const updates = { management: managementData };

    try {
        if (dateKey === todayKey) {
            const dailyDocRef = getDailyDocRef();
            await setDoc(dailyDocRef, updates, { merge: true });
        }

        const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
        await setDoc(historyDocRef, updates, { merge: true });

    } catch (e) {
        console.error("Error saving management data:", e);
        throw e; 
    }
}

// ✅ [신규] 일별 특이사항(메모) 저장 함수
export async function saveDailyNote(dateKey, note) {
    const todayKey = getTodayDateString();
    const updates = { dailyNote: note };

    try {
        // 1. History 저장 (영구 보관)
        const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
        await setDoc(historyDocRef, updates, { merge: true });

        // 2. 오늘 날짜라면 Daily Data에도 동기화
        if (dateKey === todayKey) {
            const dailyDocRef = getDailyDocRef();
            await setDoc(dailyDocRef, updates, { merge: true });
        }

        // 3. 로컬 상태 업데이트
        const dayData = State.allHistoryData.find(d => d.id === dateKey);
        if (dayData) {
            dayData.dailyNote = note;
        }

        return true;
    } catch (e) {
        console.error("Error saving daily note:", e);
        throw e;
    }
}