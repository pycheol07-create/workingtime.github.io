// === js/history-data-manager.js ===
import * as State from './state.js';
import { getTodayDateString, getCurrentTime, calcElapsedMinutes, showToast } from './utils.js';
import {
    doc, setDoc, getDoc, collection, getDocs, deleteDoc,
    query, where, writeBatch, updateDoc, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// --- Helper Functions ---
export const getWorkRecordsCollectionRef = () => {
    const today = getTodayDateString();
    return collection(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', today, 'workRecords');
};

export const getDailyDocRef = () => {
    return doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString());
};

// [핵심 수정] 라이브 데이터와 이력 데이터를 똑똑하게 병합하여 화면에 표시
export const syncTodayToHistory = async () => {
    const todayKey = getTodayDateString();
    const now = getCurrentTime();

    try {
        // 1. 현재 라이브 데이터 가져오기
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const recordsSnapshot = await getDocs(workRecordsColRef);
        const liveWorkRecords = recordsSnapshot.docs.map(doc => {
            const data = doc.data();
            // 진행 중인 업무는 현재 시간까지로 계산하여 보여줌
            if (data.status === 'ongoing' || data.status === 'paused') {
                data.duration = calcElapsedMinutes(data.startTime, now, data.pauses);
                data.endTime = now;
            }
            return data;
        });

        const dailyDocSnap = await getDoc(getDailyDocRef());
        const dailyData = dailyDocSnap.exists() ? dailyDocSnap.data() : {};

        // 2. 서버에 저장된 이력 데이터 가져오기
        const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', todayKey);
        const historyDocSnap = await getDoc(historyDocRef);
        const historyData = historyDocSnap.exists() ? historyDocSnap.data() : {};

        // 3. 표시할 데이터 결정 (우선순위 로직)
        // 기본적으로는 라이브 데이터를 사용하지만,
        // 라이브 데이터가 텅 비어있는데(마감 직후) 서버에는 데이터가 있다면 서버 데이터를 보여줌
        let finalWorkRecords = liveWorkRecords;
        let finalDailyData = dailyData;

        const isLiveEmpty = liveWorkRecords.length === 0;
        const hasHistoryData = historyData.workRecords && historyData.workRecords.length > 0;

        if (isLiveEmpty && hasHistoryData) {
            // 마감 후 상황: 라이브는 비었으나 이력은 존재함 -> 이력 데이터 채택
            finalWorkRecords = historyData.workRecords;
            finalDailyData = historyData; // taskQuantities 등도 이력에서 가져옴
        }

        const mergedInspectionList = (finalDailyData.inspectionList && finalDailyData.inspectionList.length > 0) 
                                     ? finalDailyData.inspectionList 
                                     : (historyData.inspectionList || []);

        const liveTodayData = {
            id: todayKey,
            workRecords: finalWorkRecords,
            taskQuantities: finalDailyData.taskQuantities || {},
            confirmedZeroTasks: finalDailyData.confirmedZeroTasks || [],
            onLeaveMembers: finalDailyData.onLeaveMembers || [],
            partTimers: finalDailyData.partTimers || [],
            dailyAttendance: finalDailyData.dailyAttendance || {},
            management: finalDailyData.management || {},
            inspectionList: mergedInspectionList 
        };

        // 4. State 업데이트 (화면 갱신용)
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

                if (data.duration > 1200) { 
                    data.status = 'completed';
                    console.warn(`[Auto-Fix] 20시간 초과 업무 강제 종료: ${data.task} (${data.member})`);
                }
            }
            return data;
        }).filter(record => {
            if (record.status !== 'completed') return true;
            return Math.round(record.duration || 0) > 0;
        });

        // [중요] 라이브 데이터가 비어있을 때(마감 직후), 기존의 알찬 이력을 덮어쓰지 않도록 방지
        if (liveWorkRecords.length === 0) {
            const historySnap = await getDoc(historyDocRef);
            if (historySnap.exists()) {
                const existingHistory = historySnap.data();
                if (existingHistory.workRecords && existingHistory.workRecords.length > 0) {
                    console.log("Safe-guard: Valid history exists. Skipping overwrite with empty records.");
                    if (!isAutoSave) showToast("이미 다른 관리자가 마감했습니다. (중복 저장 방지)");
                    return; 
                }
            }
        }

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
            inspectionList: dailyData.inspectionList || [], 
            savedAt: now
        };

        await setDoc(historyDocRef, historyData, { merge: true });
        
        // 저장 후 화면 동기화
        await syncTodayToHistory(); 

        if (isAutoSave) {
            console.log(`Auto-save completed at ${now}`);
        } else {
            showToast('최신 상태가 이력에 안전하게 저장되었습니다.');
        }

    } catch (e) {
        console.error('Error in saveProgress: ', e);
        if (!isAutoSave) {
             showToast(`이력 저장 중 오류가 발생했습니다: ${e.message}`, true);
        }
    }
}

export async function saveDayDataToHistory(shouldReset) {
    const workRecordsColRef = getWorkRecordsCollectionRef();
    const globalEndTime = getCurrentTime();

    try {
        const dailyDocSnap = await getDoc(getDailyDocRef());
        const dailyData = dailyDocSnap.exists() ? dailyDocSnap.data() : {};
        const freshAttendanceMap = dailyData.dailyAttendance || {};

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
                let recordEndTime = globalEndTime;

                if (record.status === 'paused') {
                    const lastPause = (pauses && pauses.length > 0) ? pauses[pauses.length - 1] : null;
                    if (lastPause && !lastPause.end) {
                        recordEndTime = lastPause.start;
                        lastPause.end = recordEndTime;
                    }
                } else if (record.status === 'ongoing') {
                     const memberName = record.member;
                     const attendance = freshAttendanceMap[memberName];

                     if (attendance && attendance.status === 'returned' && attendance.outTime) {
                         if (attendance.outTime > record.startTime) {
                             recordEndTime = attendance.outTime;
                         }
                     }
                }

                if (record.status === 'ongoing' || record.status === 'paused') {
                    duration = calcElapsedMinutes(record.startTime, recordEndTime, pauses);
                    
                    record.status = 'completed';
                    record.endTime = recordEndTime;
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
                        endTime: recordEndTime,
                        duration: duration,
                        pauses: pauses
                    });
                }
            });
            
            await batch.commit();
            
            if (completedCount > 0) console.log(`${completedCount}개 업무 종료`);
            if (removedCount > 0) showToast(`${removedCount}건 정리됨`);
        }
    } catch (e) {
         console.error("Finalizing error: ", e);
         showToast("마감 중 오류 (이력 저장은 시도함)", true);
    }

    await new Promise(resolve => setTimeout(resolve, 500));
    await saveProgress(false); // 1. 먼저 이력에 안전하게 저장

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
             console.error("Clear daily data error: ", e);
        }
        
        State.appState.workRecords = []; 
        showToast('오늘의 업무 기록을 초기화했습니다.');

        // [중요] 초기화 직후 화면 복구
        // syncTodayToHistory가 호출되더라도 데이터가 보이도록 함
        await syncTodayToHistory();
    }
}

export async function fetchAllHistoryData() {
    const historyCollectionRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'history');
    try {
        const querySnapshot = await getDocs(historyCollectionRef);
        const dataMap = new Map();
        querySnapshot.forEach((doc) => {
            const docData = doc.data();
            if (docData) {
                 dataMap.set(doc.id, { id: doc.id, ...docData });
            }
        });

        const today = getTodayDateString();
        let minDate = today;
        
        if (dataMap.size > 0) {
            const keys = Array.from(dataMap.keys());
            keys.sort();
            minDate = keys[0];
        }

        const fullHistory = [];
        const current = new Date(minDate);
        const end = new Date(today);

        while (current <= end) {
            const dateStr = current.toISOString().slice(0, 10);
            if (dataMap.has(dateStr)) {
                fullHistory.push(dataMap.get(dateStr));
            } else {
                fullHistory.push({
                    id: dateStr,
                    workRecords: [],
                    taskQuantities: {},
                    onLeaveMembers: [],
                    partTimers: [],
                    management: { revenue: 0, orderCount: 0, inventoryQty: 0, inventoryAmt: 0 },
                    inspectionList: []
                });
            }
            current.setDate(current.getDate() + 1);
        }

        fullHistory.sort((a, b) => b.id.localeCompare(a.id));
        State.allHistoryData.length = 0; 
        State.allHistoryData.push(...fullHistory); 
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
        showToast('0분 기록 저장 안됨', true);
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
        dayData = { id: dateKey, workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [] };
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
        // 라이브에 없으면 이력에서 찾도록 처리 가능하나, 일단 단순화
        if (!localRecord) {
             // 만약 라이브가 비었는데 오늘 날짜 수정을 시도한다면, 그것은 이미 '이력' 데이터일 수 있음
             // 하지만 여기서는 일관성을 위해 일단 예외처리
             // (마감 후에는 Daily Doc이 비어있으므로 updateDoc이 실패하거나 의미 없을 수 있음)
             // 마감 후 데이터 수정은 아래 'else' 블록(이력 수정)으로 넘어가는 것이 맞음.
             // 하지만 dateKey === todayKey 이므로 이 블록에 들어옴.
             
             // [수정] 마감 후 오늘 데이터 수정을 위해 이력 직접 수정 시도
             try {
                const dayIndex = State.allHistoryData.findIndex(d => d.id === dateKey);
                if (dayIndex > -1) {
                    const dayData = State.allHistoryData[dayIndex];
                    const recIdx = dayData.workRecords.findIndex(r => r.id === recordId);
                    if (recIdx > -1) {
                         // 이력에 존재함 -> 이력 수정 로직으로 분기
                         return await updateHistoryDirectly(dateKey, recordId, updateData);
                    }
                }
             } catch(e) {}
             throw new Error("기록을 찾을 수 없습니다.");
        }

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
            showToast('0분 기록 삭제됨');
            return;
        }
        
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', todayKey, 'workRecords', recordId);
        await updateDoc(docRef, updateData);
        await syncTodayToHistory(); 
        return;
    }

    await updateHistoryDirectly(dateKey, recordId, updateData);
}

// 내부 함수: 이력 직접 수정
async function updateHistoryDirectly(dateKey, recordId, updateData) {
    const dayIndex = State.allHistoryData.findIndex(d => d.id === dateKey);
    if (dayIndex === -1) throw new Error("이력 없음");

    const dayData = State.allHistoryData[dayIndex];
    const recordIndex = dayData.workRecords.findIndex(r => r.id === recordId);
    if (recordIndex === -1) throw new Error("기록 없음");

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
        showToast('0분 기록 삭제됨');
        return;
    }

    dayData.workRecords[recordIndex] = updatedRecord;
    const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
    await setDoc(historyDocRef, { workRecords: dayData.workRecords }, { merge: true });
}


export async function deleteHistoryWorkRecord(dateKey, recordId) {
    const todayKey = getTodayDateString();

    if (dateKey === todayKey) {
        // 먼저 라이브 데이터 확인
        const dailyRecordRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', todayKey, 'workRecords', recordId);
        const dailySnap = await getDoc(dailyRecordRef);
        
        if (dailySnap.exists()) {
            await deleteDoc(dailyRecordRef);
            await syncTodayToHistory();
            return;
        }
        // 라이브에 없으면 마감된 데이터일 수 있으므로 아래 로직 진행
    }

    const dayIndex = State.allHistoryData.findIndex(d => d.id === dateKey);
    if (dayIndex === -1) throw new Error("이력 없음");

    const dayData = State.allHistoryData[dayIndex];
    const newRecords = dayData.workRecords.filter(r => r.id !== recordId);

    if (dayData.workRecords.length === newRecords.length) {
        // throw new Error("삭제할 기록을 찾을 수 없습니다."); // 조용히 무시
        return;
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