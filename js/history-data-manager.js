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

        // ✅ [수정] History 문서도 확인하여 inspectionList 보존 (완료되어 Daily에서 삭제된 경우 대비)
        const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', todayKey);
        const historyDocSnap = await getDoc(historyDocRef);
        const historyData = historyDocSnap.exists() ? historyDocSnap.data() : {};

        // Daily에 리스트가 있으면 Daily(최신) 우선, 없으면 History(보관됨) 사용
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
            // ✅ [신규] 검수 리스트 추가
            inspectionList: mergedInspectionList 
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
        
        // ✅ [수정] 저장 시점에도 0분 이하인 완료된 기록은 제외하고 저장 (필터링)
        const liveWorkRecords = recordsSnapshot.docs.map(doc => {
            const data = doc.data();
            if (data.status === 'ongoing' || data.status === 'paused') {
                data.duration = calcElapsedMinutes(data.startTime, now, data.pauses);
                data.endTime = now;
            }
            return data;
        }).filter(record => {
            // 진행 중인 업무는 0분이어도 저장 (아직 안 끝났으니까)
            if (record.status !== 'completed') return true;
            // 완료된 업무는 0분 초과인 것만 저장
            return Math.round(record.duration || 0) > 0;
        });

        // 데이터가 아예 없으면 저장 건너뛰기 (단, 검수리스트가 있으면 저장해야 함)
        if (liveWorkRecords.length === 0 && 
            Object.keys(dailyData.taskQuantities || {}).length === 0 && 
            (!dailyData.inspectionList || dailyData.inspectionList.length === 0)) {
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
            // ✅ [신규] 검수 리스트도 이력에 저장
            inspectionList: dailyData.inspectionList || [], 
            savedAt: now
        };

        // merge: true로 저장하여 기존 데이터(예: 완료되어 daily에선 삭제됐지만 history엔 있는 리스트) 보호
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
// 업무 마감 (전체 강제 종료 및 정리) - ✅ 0분 이하 기록 완전 박멸
export async function saveDayDataToHistory(shouldReset) {
    const workRecordsColRef = getWorkRecordsCollectionRef();
    const endTime = getCurrentTime();

    try {
        // ✅ [수정] 상태와 상관없이 '모든' 기록을 가져와서 검사
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

                // 1. 진행 중이거나 일시정지 상태라면 종료 처리
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

                // 2. (완료된 것도 포함하여) 소요 시간이 0분 이하라면 삭제
                if (Math.round(duration) <= 0) {
                    batch.delete(docSnap.ref);
                    removedCount++;
                } else if (needsUpdate) {
                    // 삭제 대상이 아니고 업데이트가 필요하면 업데이트
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


// 이력(또는 오늘)에 새 업무 기록 추가 - ✅ 완료된 기록에 한해서만 0분 체크
export async function addHistoryWorkRecord(dateKey, newRecordData) {
    const todayKey = getTodayDateString();

    // duration 자동 계산 (필요시)
    if (newRecordData.startTime && newRecordData.endTime && !newRecordData.duration) {
        newRecordData.duration = calcElapsedMinutes(newRecordData.startTime, newRecordData.endTime, newRecordData.pauses || []);
    }
    
    // ✅ [수정] 상태가 'completed'일 때만 0분 이하 저장을 막음
    if (newRecordData.status === 'completed' && Math.round(newRecordData.duration || 0) <= 0) {
        showToast('소요 시간이 0분이어 기록이 저장되지 않았습니다.', true);
        return;
    }

    // 1. 오늘 날짜인 경우 -> daily_data 컬렉션에 추가
    if (dateKey === todayKey) {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', todayKey, 'workRecords', newRecordData.id);
        await setDoc(docRef, newRecordData);
        await syncTodayToHistory();
        return;
    }

    // 2. 과거 날짜인 경우 -> history 문서의 배열에 추가
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

    // Firestore 업데이트
    const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
    await setDoc(historyDocRef, { workRecords: dayData.workRecords }, { merge: true });
}


// 이력(또는 오늘)의 특정 업무 기록 수정 - ✅ 완료된 기록에 한해서만 0분 체크
export async function updateHistoryWorkRecord(dateKey, recordId, updateData) {
    const todayKey = getTodayDateString();

    // 1. 오늘 날짜인 경우
    if (dateKey === todayKey) {
        // 기존 기록 조회 (duration 재계산을 위해 필요)
        const localRecord = (State.appState.workRecords || []).find(r => r.id === recordId);
        if (!localRecord) throw new Error("기록을 찾을 수 없습니다.");

        let newDuration = localRecord.duration;
        let newStatus = updateData.status || localRecord.status;

        // 시작/종료/휴식 변경 시 duration 재계산
        if (updateData.startTime || updateData.endTime || updateData.pauses) {
            const start = updateData.startTime || localRecord.startTime;
            const end = updateData.endTime || localRecord.endTime;
            const pauses = updateData.pauses || localRecord.pauses || [];
            
            if (end) {
                newDuration = calcElapsedMinutes(start, end, pauses);
                updateData.duration = newDuration;
            }
        }

        // ✅ [수정] '완료(completed)' 상태인 경우에만 0분 이하 삭제
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

    // 2. 과거 날짜인 경우
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

    // ✅ [수정] '완료(completed)' 상태인 경우에만 0분 이하 삭제
    // (과거 데이터는 보통 다 completed이지만, 혹시 모르니 체크)
    if (updatedRecord.status === 'completed' && Math.round(updatedRecord.duration || 0) <= 0) {
        await deleteHistoryWorkRecord(dateKey, recordId);
        showToast('수정 후 소요 시간이 0분이 되어 기록이 삭제되었습니다.');
        return;
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

// ✅ [신규] 경영 지표 저장 함수
export async function saveManagementData(dateKey, managementData) {
    const todayKey = getTodayDateString();

    // 1. 로컬 상태 업데이트
    const dayIndex = State.allHistoryData.findIndex(d => d.id === dateKey);
    if (dayIndex > -1) {
        State.allHistoryData[dayIndex].management = managementData;
    } else {
        // 날짜 데이터가 아예 없는 경우 생성 (드문 케이스)
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

    // 2. Firestore 업데이트
    const updates = { management: managementData };

    try {
        // 오늘 날짜라면 daily_data에도 저장 (실시간 동기화 유지)
        if (dateKey === todayKey) {
            const dailyDocRef = getDailyDocRef();
            await setDoc(dailyDocRef, updates, { merge: true });
        }

        // history 컬렉션에 저장 (영구 보관)
        const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
        await setDoc(historyDocRef, updates, { merge: true });

    } catch (e) {
        console.error("Error saving management data:", e);
        throw e; 
    }
}