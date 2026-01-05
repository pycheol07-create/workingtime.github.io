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

        const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', todayKey);
        const historyDocSnap = await getDoc(historyDocRef);
        const historyData = historyDocSnap.exists() ? historyDocSnap.data() : {};

        let finalWorkRecords = liveWorkRecords;
        let finalDailyData = dailyData;

        const isLiveEmpty = liveWorkRecords.length === 0;
        const hasHistoryData = historyData.workRecords && historyData.workRecords.length > 0;

        if (isLiveEmpty && hasHistoryData) {
            finalWorkRecords = historyData.workRecords;
            finalDailyData = historyData;
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

// ▼▼▼ [수정된 함수] 퇴근 시간은 '마감 실행 시간'으로 통일 ▼▼▼
export async function saveDayDataToHistory(shouldReset) {
    const workRecordsColRef = getWorkRecordsCollectionRef();
    const globalEndTime = getCurrentTime(); // 마감 실행 시간 (예: 19:00)

    try {
        // 1. 최신 데이터 가져오기
        const dailyDocRef = getDailyDocRef();
        const dailyDocSnap = await getDoc(dailyDocRef);
        const dailyData = dailyDocSnap.exists() ? dailyDocSnap.data() : {};
        const dailyAttendance = dailyData.dailyAttendance || {};

        const querySnapshot = await getDocs(workRecordsColRef);
        
        // --- 2. [수정됨] 퇴근 안 한 인원 자동 퇴근 처리 ---
        let attendanceUpdated = false;
        
        Object.keys(dailyAttendance).forEach(member => {
            // 아직 '근무 중(working)'인 사람만 찾음
            if (dailyAttendance[member].status === 'working') {
                
                // [변경] 업무 종료 시간과 상관없이, 퇴근 처리는 무조건 '마감 실행 시간'으로 설정
                let autoOutTime = globalEndTime; 

                // 혹시 모를 오류 방지 (출근 시간보다 퇴근 시간이 빠르면 안 됨)
                if (dailyAttendance[member].inTime && autoOutTime < dailyAttendance[member].inTime) {
                    autoOutTime = globalEndTime;
                }

                // 퇴근 처리 업데이트
                dailyAttendance[member].status = 'returned';
                dailyAttendance[member].outTime = autoOutTime;
                attendanceUpdated = true;
                console.log(`[Auto-Clock-out] ${member}: ${autoOutTime} 퇴근 처리 (업무 마감 실행)`);
            }
        });

        // 변경된 근태 정보를 DB에 먼저 저장
        if (attendanceUpdated) {
            await updateDoc(dailyDocRef, { dailyAttendance: dailyAttendance });
            showToast("미퇴근 인원을 현재 시간으로 퇴근 처리했습니다.");
        }
        
        // --- 3. 업무 기록 종료 처리 ---
        if (!querySnapshot.empty) {
            const batch = writeBatch(State.db);
            let removedCount = 0;
            let completedCount = 0;

            querySnapshot.forEach(docSnap => {
                const record = docSnap.data();
                let duration = record.duration || 0;
                let pauses = record.pauses || [];
                let needsUpdate = false;
                
                // 기본 종료 시간은 '마감 시간' (진행 중이던 업무용)
                let recordEndTime = globalEndTime;

                // 해당 직원의 퇴근 기록이 있다면 확인
                const attendance = dailyAttendance[record.member];
                if (attendance && attendance.status === 'returned' && attendance.outTime) {
                    // 퇴근 시간이 업무 시작 시간보다 뒤라면, 그 시간을 사용
                    // (진행 중인 업무를 퇴근 시간에 맞춰 잘라줌)
                    if (attendance.outTime > record.startTime) {
                        recordEndTime = attendance.outTime;
                    }
                }

                // [중요] '진행 중'이거나 '일시정지'인 업무만 강제 종료함
                // 이미 완료된(completed) 업무는 건드리지 않음 -> 17:30 종료 기록 유지됨
                if (record.status === 'ongoing' || record.status === 'paused') {
                    if (record.status === 'paused') {
                        const lastPause = pauses.length > 0 ? pauses[pauses.length - 1] : null;
                        if (lastPause && lastPause.end === null) {
                            lastPause.end = recordEndTime;
                        }
                    }
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
            
            if (completedCount > 0) console.log(`${completedCount}개 진행 중 업무 강제 종료`);
            if (removedCount > 0) showToast(`${removedCount}건 정리됨`);
        }
    } catch (e) {
         console.error("Finalizing error: ", e);
         showToast("마감 중 오류 (이력 저장은 시도함)", true);
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
        await syncTodayToHistory();
    }
}

// ... (나머지 fetchAllHistoryData 등 기존 함수 유지) ...
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
        if (!localRecord) {
             try {
                const dayIndex = State.allHistoryData.findIndex(d => d.id === dateKey);
                if (dayIndex > -1) {
                    const dayData = State.allHistoryData[dayIndex];
                    const recIdx = dayData.workRecords.findIndex(r => r.id === recordId);
                    if (recIdx > -1) {
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
            showToast('수정 후 소요 시간이 0분이 되어 기록이 삭제되었습니다.');
            return;
        }
        
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', todayKey, 'workRecords', recordId);
        await updateDoc(docRef, updateData);
        await syncTodayToHistory(); 
        return;
    }

    await updateHistoryDirectly(dateKey, recordId, updateData);
}

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
        const dailyRecordRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', todayKey, 'workRecords', recordId);
        const dailySnap = await getDoc(dailyRecordRef);
        
        if (dailySnap.exists()) {
            await deleteDoc(dailyRecordRef);
            await syncTodayToHistory();
            return;
        }
    }

    const dayIndex = State.allHistoryData.findIndex(d => d.id === dateKey);
    if (dayIndex === -1) throw new Error("해당 날짜의 이력을 찾을 수 없습니다.");

    const dayData = State.allHistoryData[dayIndex];
    const newRecords = dayData.workRecords.filter(r => r.id !== recordId);

    if (dayData.workRecords.length === newRecords.length) {
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