// === js/history-data-manager.js ===
// 설명: '이력' 기능과 관련된 모든 Firestore 데이터 I/O(읽기/쓰기)를 담당합니다.

import * as State from './state.js';
import { getTodayDateString, getCurrentTime, calcElapsedMinutes, showToast } from './utils.js';

// Firestore 함수 임포트
import {
    doc, setDoc, getDoc, collection, getDocs, deleteDoc, runTransaction,
    query, where, writeBatch
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
// (이름 변경: _syncTodayToHistory -> syncTodayToHistory)
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
        await syncTodayToHistory(); // ✅ 이름 변경된 함수 호출

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

        State.allHistoryData.length = 0; // 배열을 비우고
        State.allHistoryData.push(...data); // 새 데이터로 채웁니다.

        return State.allHistoryData;
    } catch (error) {
        console.error('Error fetching all history data:', error);
        showToast('전체 이력 로딩 실패', true);
        State.allHistoryData.length = 0;
        return [];
    }
}