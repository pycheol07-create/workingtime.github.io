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

        const liveTodayData = {
            id: todayKey,
            workRecords: liveWorkRecords,
            taskQuantities: dailyData.taskQuantities || {},
            confirmedZeroTasks: dailyData.confirmedZeroTasks || [],
            onLeaveMembers: dailyData.onLeaveMembers || [],
            partTimers: dailyData.partTimers || [],
            dailyAttendance: dailyData.dailyAttendance || {}
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
        });

        if (liveWorkRecords.length === 0 && Object.keys(dailyData.taskQuantities || {}).length === 0) {
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
            savedAt: now
        };

        await setDoc(historyDocRef, historyData);
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
// 업무 마감 (전체 강제 종료 포함)
export async function saveDayDataToHistory(shouldReset) {
    const workRecordsColRef = getWorkRecordsCollectionRef();
    const endTime = getCurrentTime();

    try {
        const q = query(workRecordsColRef, where('status', 'in', ['ongoing', 'paused']));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            const batch = writeBatch(State.db);
            querySnapshot.forEach(docSnap => {
                const record = docSnap.data();
                let pauses = record.pauses || [];
                if (record.status === 'paused') {
                    const lastPause = pauses.length > 0 ? pauses[pauses.length - 1] : null;
                    if (lastPause && lastPause.end === null) {
                        lastPause.end = endTime;
                    }
                }
                const duration = calcElapsedMinutes(record.startTime, endTime, pauses);

                batch.update(docSnap.ref, {
                    status: 'completed',
                    endTime: endTime,
                    duration: duration,
                    pauses: pauses
                });
            });
            await batch.commit();
            console.log(`${querySnapshot.size}개의 진행 중인 업무를 강제 종료했습니다.`);
        }
    } catch (e) {
         console.error("Error finalizing ongoing tasks during shift end: ", e);
         showToast("업무 마감 중 진행 업무 종료 실패. (이력 저장은 계속 진행합니다)", true);
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
        
        State.appState.workRecords = []; // 로컬 상태도 초기화
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


// ✅ [신규] 이력(또는 오늘)에 새 업무 기록 추가
export async function addHistoryWorkRecord(dateKey, newRecordData) {
    const todayKey = getTodayDateString();

    // 1. 오늘 날짜인 경우 -> daily_data 컬렉션에 추가
    if (dateKey === todayKey) {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', todayKey, 'workRecords', newRecordData.id);
        
        // duration 자동 계산 (필요시)
        if (newRecordData.startTime && newRecordData.endTime && !newRecordData.duration) {
            newRecordData.duration = calcElapsedMinutes(newRecordData.startTime, newRecordData.endTime, []);
        }

        await setDoc(docRef, newRecordData);
        await syncTodayToHistory();
        return;
    }

    // 2. 과거 날짜인 경우 -> history 문서의 배열에 추가
    const dayIndex = State.allHistoryData.findIndex(d => d.id === dateKey);
    
    // 만약 해당 날짜의 이력이 아예 없다면 생성해야 함 (드문 케이스지만 처리)
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

    // duration 계산
    if (newRecordData.startTime && newRecordData.endTime && !newRecordData.duration) {
        newRecordData.duration = calcElapsedMinutes(newRecordData.startTime, newRecordData.endTime, []);
    }

    dayData.workRecords.push(newRecordData);

    // Firestore 업데이트
    const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
    await setDoc(historyDocRef, { workRecords: dayData.workRecords }, { merge: true });
}


// 이력(또는 오늘)의 특정 업무 기록 수정
export async function updateHistoryWorkRecord(dateKey, recordId, updateData) {
    const todayKey = getTodayDateString();

    // 1. 오늘 날짜인 경우 -> 실제 daily_data 컬렉션을 수정
    if (dateKey === todayKey) {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', todayKey, 'workRecords', recordId);
        
        if (updateData.startTime && updateData.endTime) {
            const localRecord = (State.appState.workRecords || []).find(r => r.id === recordId);
            if (localRecord) {
                updateData.duration = calcElapsedMinutes(updateData.startTime, updateData.endTime, localRecord.pauses || []);
            }
        }
        
        await updateDoc(docRef, updateData);
        await syncTodayToHistory(); 
        return;
    }

    // 2. 과거 날짜인 경우 -> history 문서의 배열을 수정
    const dayIndex = State.allHistoryData.findIndex(d => d.id === dateKey);
    if (dayIndex === -1) throw new Error("해당 날짜의 이력을 찾을 수 없습니다.");

    const dayData = State.allHistoryData[dayIndex];
    const recordIndex = dayData.workRecords.findIndex(r => r.id === recordId);
    if (recordIndex === -1) throw new Error("수정할 기록을 찾을 수 없습니다.");

    const originalRecord = dayData.workRecords[recordIndex];
    const updatedRecord = { ...originalRecord, ...updateData };

    if (updateData.startTime || updateData.endTime) {
        const start = updateData.startTime || originalRecord.startTime;
        const end = updateData.endTime || originalRecord.endTime;
        updatedRecord.duration = calcElapsedMinutes(start, end, originalRecord.pauses || []);
    }

    dayData.workRecords[recordIndex] = updatedRecord;

    const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
    await setDoc(historyDocRef, { workRecords: dayData.workRecords }, { merge: true });
}

// 이력(또는 오늘)의 특정 업무 기록 삭제
export async function deleteHistoryWorkRecord(dateKey, recordId) {
    const todayKey = getTodayDateString();

    // 1. 오늘 날짜인 경우 -> daily_data에서 삭제
    if (dateKey === todayKey) {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', todayKey, 'workRecords', recordId);
        await deleteDoc(docRef);
        await syncTodayToHistory();
        return;
    }

    // 2. 과거 날짜인 경우 -> history 문서 배열에서 제거
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