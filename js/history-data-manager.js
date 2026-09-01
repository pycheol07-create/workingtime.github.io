// === js/history-data-manager.js ===
import * as State from './state.js';
import { getTodayDateString, getCurrentTime, calcElapsedMinutes, showToast } from './utils.js';
import {
    doc, setDoc, getDoc, collection, getDocs, deleteDoc,
    query, where, writeBatch, updateDoc, increment, documentId
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let isHistoryCached = false;
let cachedUnverifiedDates = null;
let lastUnverifiedCheckTime = 0;

let historyFetchPromise = null;
let unverifiedFetchPromise = null;

// 이력 캐시 TTL. 과거 이력은 변하지 않으므로 길게 캐싱(읽기 요금 절감).
// 오늘 데이터는 실시간 동기화(syncTodayToHistory)로 별도 갱신되므로 영향 없음.
const HISTORY_CACHE_TTL_MS = 30 * 60 * 1000; // 30분

// ✨ 데이터가 변경되었을 때 로컬 캐시를 초기화하는 헬퍼 함수 (읽기 요금 방어용)
// localStorage 사용: 탭 간 공유 + 새로고침/재시작 후에도 유지되어 중복 읽기 최소화.
export const clearLocalCache = () => {
    localStorage.removeItem('historyDataCache');
    localStorage.removeItem('historyDataCacheTime');
    localStorage.removeItem('unverifiedDataCache');
    localStorage.removeItem('unverifiedDataCacheTime');
};

// ============================================================
// 📅 예정 물량(plannedData) — 미래 날짜별 계획 처리량 (실적 history와 분리)
// ============================================================
import { reloadAfterSave } from './view-state.js';

const PLANNED_CACHE_KEY = 'plannedDataCache';
const PLANNED_CACHE_TIME_KEY = 'plannedDataCacheTime';
const PLANNED_CACHE_TTL_MS = 10 * 60 * 1000; // 10분

const plannedColRef = () => collection(State.db, 'artifacts', 'team-work-logger-v2', 'plannedData');

// 미래 N일(오늘 제외) 날짜 문자열 배열 (로컬 시간대 기준)
export function getUpcomingPlannedDateStrings(n = 7) {
    const base = new Date(getTodayDateString() + 'T00:00:00');
    const out = [];
    for (let i = 1; i <= n; i++) {
        const d = new Date(base); d.setDate(d.getDate() + i);
        const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
        out.push(local.toISOString().slice(0, 10));
    }
    return out;
}

// 예정 물량 로드 (오늘 이후). 10분 캐시로 읽기요금 방어.
export async function fetchPlannedData(forceRefresh = false) {
    if (!State.auth || !State.auth.currentUser) return State.plannedData;
    const today = getTodayDateString();

    if (!forceRefresh) {
        try {
            const cached = localStorage.getItem(PLANNED_CACHE_KEY);
            const t = localStorage.getItem(PLANNED_CACHE_TIME_KEY);
            if (cached && t && (Date.now() - parseInt(t) < PLANNED_CACHE_TTL_MS)) {
                State.setPlannedData(JSON.parse(cached).filter(d => d.id >= today));
                return State.plannedData;
            }
        } catch (_) {}
    }

    try {
        const q = query(plannedColRef(), where(documentId(), '>=', today));
        const snap = await getDocs(q);
        const arr = [];
        snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
        arr.sort((a, b) => a.id.localeCompare(b.id));
        State.setPlannedData(arr);
        try {
            localStorage.setItem(PLANNED_CACHE_KEY, JSON.stringify(arr));
            localStorage.setItem(PLANNED_CACHE_TIME_KEY, Date.now().toString());
        } catch (_) {}
        return State.plannedData;
    } catch (e) {
        console.error('fetchPlannedData failed:', e);
        return State.plannedData;
    }
}

// 특정 날짜의 예정 물량 맵 (없으면 {})
export function getPlannedQuantitiesForDate(dateStr) {
    const rec = (State.plannedData || []).find(d => d.id === dateStr);
    return (rec && rec.plannedQuantities) ? rec.plannedQuantities : {};
}

// 예정 물량 저장 (문서 전체 교체 — 0으로 지운 항목이 남지 않도록 merge 안 함)
export async function savePlannedQuantities(dateStr, plannedQuantities) {
    if (!State.auth || !State.auth.currentUser) { showToast('로그인이 필요합니다.', true); return false; }
    if (!dateStr) return false;

    const clean = {};
    Object.entries(plannedQuantities || {}).forEach(([k, v]) => {
        const n = Number(v) || 0;
        if (n > 0) clean[k] = n;
    });

    try {
        await setDoc(doc(plannedColRef(), dateStr), {
            plannedQuantities: clean,
            updatedAt: getCurrentTime(),
            updatedBy: State.appState?.currentUser || 'unknown'
        });

        const idx = (State.plannedData || []).findIndex(d => d.id === dateStr);
        if (idx > -1) State.plannedData[idx] = { id: dateStr, plannedQuantities: clean };
        else { State.plannedData.push({ id: dateStr, plannedQuantities: clean }); State.plannedData.sort((a, b) => a.id.localeCompare(b.id)); }

        try {
            localStorage.setItem(PLANNED_CACHE_KEY, JSON.stringify(State.plannedData));
            localStorage.setItem(PLANNED_CACHE_TIME_KEY, Date.now().toString());
        } catch (_) {}

        showToast(`${dateStr} 예정 물량이 저장되었습니다.`);
        reloadAfterSave();   // 데이터관리 창에서만 새로고침(메인 화면은 건너뜀)
        return true;
    } catch (e) {
        console.error('savePlannedQuantities failed:', e);
        showToast('예정 물량 저장 실패: ' + (e.message || e), true);
        return false;
    }
}

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
        const liveWorkRecords = (State.appState.workRecords || []).map(record => {
            const data = { ...record };
            if (data.status === 'ongoing' || data.status === 'paused') {
                data.duration = calcElapsedMinutes(data.startTime, now, data.pauses);
                data.endTime = now;
            }
            return data;
        });

        const idx = State.allHistoryData.findIndex(d => d.id === todayKey);
        const existingHistory = idx > -1 ? State.allHistoryData[idx] : null;

        const isLiveEmpty = liveWorkRecords.length === 0;
        const isLiveQtyEmpty = !State.appState.taskQuantities || Object.keys(State.appState.taskQuantities).length === 0;
        const hasHistoryData = existingHistory && existingHistory.workRecords && existingHistory.workRecords.length > 0;

        let finalWorkRecords = liveWorkRecords;
        let finalQuantities = State.appState.taskQuantities || {};

        if (isLiveEmpty && isLiveQtyEmpty && hasHistoryData) {
            finalWorkRecords = existingHistory.workRecords;
            finalQuantities = existingHistory.taskQuantities || {};
        }

        const liveTodayData = {
            id: todayKey,
            workRecords: finalWorkRecords,
            taskQuantities: finalQuantities,
            // 라이브가 비어 있을 때 이력의 확인 표시를 지우지 않는다.
            confirmedZeroTasks: (State.appState.confirmedZeroTasks?.length
                ? State.appState.confirmedZeroTasks : (existingHistory?.confirmedZeroTasks || [])),
            onLeaveMembers: State.appState.dailyOnLeaveMembers || (existingHistory?.onLeaveMembers || []),
            partTimers: State.appState.partTimers || (existingHistory?.partTimers || []),
            dailyAttendance: State.appState.dailyAttendance || (existingHistory?.dailyAttendance || {}),
            // ⚠️ 통째로 고르면(||) 라이브 쪽이 환율만 든 부분 객체일 때 저장된 매출·재고가 사라진다.
            //    반드시 합쳐야 한다(라이브 값이 우선).
            management: { ...(existingHistory?.management || {}), ...(State.appState.management || {}) },
            inspectionList: State.appState.inspectionList || (existingHistory?.inspectionList || []),
            isQuantityVerified: State.appState.isQuantityVerified || (existingHistory?.isQuantityVerified || false)
        };

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

// isFinalize=true 이면 "마감/자동마감" 확정 저장으로 간주하고,
// 기록 수가 줄었을 때 저장을 건너뛰는 방어 로직을 우회한다.
// (0분 기록 삭제·중복 정리로 건수가 줄어드는 것이 정상인데, 그 때문에 최종 근무시간이
//  history에 반영되지 않고 유실되던 문제가 있었다.)
export async function saveProgress(isAutoSave = false, isQuantityVerified = false, { isFinalize = false, overrideRecords = null } = {}) {
    const dateStr = getTodayDateString();
    const now = getCurrentTime();

    if (!isAutoSave) {
        showToast('서버의 최신 상태를 이력에 저장합니다...');
    }

    const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateStr);

    try {
        const dailyData = {
            taskQuantities: State.appState.taskQuantities || {},
            confirmedZeroTasks: State.appState.confirmedZeroTasks || [],
            onLeaveMembers: State.appState.dailyOnLeaveMembers || [],
            partTimers: State.appState.partTimers || [],
            dailyAttendance: State.appState.dailyAttendance || {},
            // 라이브 management 가 일부 필드만 들고 있을 수 있으므로 이미 저장된 값 위에 얹는다.
            management: {
                ...((State.allHistoryData.find(d => d.id === dateStr) || {}).management || {}),
                ...(State.appState.management || {})
            },
            inspectionList: State.appState.inspectionList || [],
            isQuantityVerified: State.appState.isQuantityVerified || false
        };

        // overrideRecords가 주어지면(마감 시 Firestore에서 직접 읽은 확정 기록) 그것을 신뢰한다.
        // 라이브 미러(State.appState.workRecords)는 onSnapshot 반영 지연으로 비어 있을 수 있다.
        const sourceRecords = Array.isArray(overrideRecords) ? overrideRecords : (State.appState.workRecords || []);
        const liveWorkRecords = sourceRecords.map(record => {
            const data = { ...record };
            if (data.status === 'ongoing' || data.status === 'paused') {
                data.duration = calcElapsedMinutes(data.startTime, now, data.pauses);
                data.endTime = now;
                if (data.duration > 1200) data.status = 'completed';
            }
            return data;
        }).filter(record => {
            if (record.status !== 'completed') return true;
            return Math.round(record.duration || 0) > 0;
        });

        const existingHistory = State.allHistoryData.find(d => d.id === dateStr) || {};
        const existingRecordsCount = (existingHistory.workRecords || []).length;
        
        // 마감 확정(isFinalize)이 아니고, 살아있는 기록이 아예 0건인데 이력엔 있는 경우에만 방어.
        // (라이브 상태가 아직 동기화되지 않은 탭이 이력을 지우는 것을 막는 것이 원래 목적)
        if (!isFinalize && existingRecordsCount > 0 && liveWorkRecords.length === 0) {
            if (!isAutoSave) showToast("이미 데이터가 안전하게 마감/저장되었습니다.");
            return;
        }

        if (liveWorkRecords.length === 0 &&
            Object.keys(dailyData.taskQuantities).length === 0 &&
            (!dailyData.inspectionList || dailyData.inspectionList.length === 0)) {
             return;
        }

        const mergedAttendance = { ...dailyData.dailyAttendance, ...State.appState.dailyAttendance };

        const historyData = {
            id: dateStr,
            workRecords: liveWorkRecords,
            taskQuantities: dailyData.taskQuantities,
            confirmedZeroTasks: dailyData.confirmedZeroTasks,
            onLeaveMembers: dailyData.onLeaveMembers,
            partTimers: dailyData.partTimers,
            dailyAttendance: mergedAttendance, 
            management: dailyData.management,
            inspectionList: dailyData.inspectionList,
            isQuantityVerified: isQuantityVerified || State.appState.isQuantityVerified || false,
            savedAt: now
        };

        await setDoc(historyDocRef, historyData, { merge: true });
        
        if (isQuantityVerified) {
            await setDoc(getDailyDocRef(), { isQuantityVerified: true }, { merge: true });
        }

        // 메모리 이력도 방금 저장한 값으로 즉시 맞춘다.
        // (overrideRecords로 저장한 경우 라이브 미러가 아직 비어 있을 수 있어,
        //  syncTodayToHistory만 호출하면 화면이 옛 값을 계속 보여준다)
        const memIdx = State.allHistoryData.findIndex(d => d.id === dateStr);
        if (memIdx > -1) State.allHistoryData[memIdx] = { ...State.allHistoryData[memIdx], ...historyData };
        else {
            State.allHistoryData.push({ ...historyData });
            State.allHistoryData.sort((a, b) => b.id.localeCompare(a.id));
        }

        if (!overrideRecords) await syncTodayToHistory();
        clearLocalCache(); // ✨ 데이터 변경 시 캐시 지우기

        if (!isAutoSave) {
            showToast('최신 상태가 이력에 안전하게 저장되었습니다.');
        }

    } catch (e) {
        console.error('Error in saveProgress: ', e);
        if (!isAutoSave) showToast(`저장 중 오류가 발생했습니다: ${e.message}`, true);
    }
}

export async function saveDayDataToHistory(shouldReset) {
    const workRecordsColRef = getWorkRecordsCollectionRef();
    const globalEndTime = getCurrentTime();
    const finalizedRecords = []; // 마감 확정된 기록(이력 저장의 신뢰 원본)

    try {
        const dailyDocRef = getDailyDocRef();
        const dailyDocSnap = await getDoc(dailyDocRef);
        const dailyData = dailyDocSnap.exists() ? dailyDocSnap.data() : {};
        
        const dailyAttendance = { ...dailyData.dailyAttendance, ...State.appState.dailyAttendance };
        const querySnapshot = await getDocs(workRecordsColRef);
        
        let attendanceUpdated = false;
        Object.keys(dailyAttendance).forEach(member => {
            if (dailyAttendance[member].status === 'active') {
                let autoOutTime = globalEndTime; 
                if (dailyAttendance[member].inTime && autoOutTime < dailyAttendance[member].inTime) {
                    autoOutTime = globalEndTime;
                }
                dailyAttendance[member].status = 'returned'; 
                dailyAttendance[member].outTime = autoOutTime;
                attendanceUpdated = true;
            }
        });

        if (attendanceUpdated) {
            await updateDoc(dailyDocRef, { dailyAttendance: dailyAttendance });
            State.appState.dailyAttendance = dailyAttendance;
        }
        
        if (!querySnapshot.empty) {
            const batch = writeBatch(State.db);
            let removedCount = 0;

            querySnapshot.forEach(docSnap => {
                const record = { id: docSnap.id, ...docSnap.data() };
                let duration = record.duration || 0;
                let pauses = record.pauses || [];
                let needsUpdate = false;
                
                let recordEndTime = globalEndTime;
                const attendance = dailyAttendance[record.member];
                
                if (attendance && attendance.status === 'returned' && attendance.outTime) {
                    if (attendance.outTime > record.startTime) {
                        recordEndTime = (attendance.outTime <= globalEndTime) ? attendance.outTime : globalEndTime;
                    } else {
                        recordEndTime = globalEndTime;
                    }
                }

                if (record.startTime > recordEndTime) recordEndTime = record.startTime;

                if (record.status === 'ongoing' || record.status === 'paused') {
                    if (record.status === 'paused') {
                        const lastPause = pauses.length > 0 ? pauses[pauses.length - 1] : null;
                        if (lastPause && lastPause.end === null) lastPause.end = recordEndTime;
                    }
                    duration = calcElapsedMinutes(record.startTime, recordEndTime, pauses);
                    
                    needsUpdate = true;
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
                    finalizedRecords.push({ ...record, status: 'completed', endTime: recordEndTime, duration, pauses });
                } else {
                    // 이미 완료된 기록도 이력에 그대로 포함시켜야 한다.
                    finalizedRecords.push({ ...record, duration, pauses });
                }
            });
            await batch.commit();
        }
    } catch (e) {
         console.error("Finalizing error: ", e);
    }

    // 🛡️ 라이브 미러(onSnapshot) 반영을 기다리지 않고, 방금 Firestore에서 읽어 확정한 기록을
    //    그대로 이력에 저장한다. (기존 500ms 대기 방식은 반영이 늦으면 근무시간이 통째로 누락됐다)
    await saveProgress(false, false, {
        isFinalize: true,
        overrideRecords: finalizedRecords.length > 0 ? finalizedRecords : null
    });

    if (shouldReset) {
         try {
            const qAll = query(workRecordsColRef);
            const snapshotAll = await getDocs(qAll);
            if (!snapshotAll.empty) {
                const deleteBatch = writeBatch(State.db);
                snapshotAll.forEach(doc => deleteBatch.delete(doc.ref));
                await deleteBatch.commit();
            }
            await setDoc(getDailyDocRef(), { taskQuantities: {}, confirmedZeroTasks: [], isQuantityVerified: false }, { merge: true });
        } catch (e) {
             console.error("Error clearing daily data: ", e);
        }
        
        State.appState.workRecords = []; 
        clearLocalCache();
        showToast('오늘의 업무 기록을 초기화했습니다.');
    }
}

// 🛟 복구: 특정 날짜의 daily_data(원본)를 history로 옮긴다.
// 마감/진행상황 저장을 안 해서 history에 안 넘어간 날을 되살리는 일회성 도구.
// - daily_data/{date}/workRecords 서브컬렉션 + daily_data/{date} 문서 필드를 읽어
//   history/{date} 문서를 만든다.
// - 아직 종료 안 된(ongoing/paused) 기록은 앱의 17:30 자동마감 규칙과 동일하게 마감 처리.
// - history에 이미 기록이 있으면 확인(confirm) 후에만 덮어씀(force=true면 확인 생략).
// 반환: { date, records, quantities, hadExisting } 또는 null/취소.
// 🔍 미리보기(읽기 전용): 쓰기 없이 daily_data / history 상태만 확인.
export async function peekDailyData(dateKey) {
    if (!State.auth || !State.auth.currentUser) { showToast('로그인이 필요합니다.', true); return null; }
    if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) { showToast('날짜 형식 오류 (예: 2026-07-27)', true); return null; }
    const base = ['artifacts', 'team-work-logger-v2'];
    try {
        const [dailySnap, wrSnap, histSnap] = await Promise.all([
            getDoc(doc(State.db, ...base, 'daily_data', dateKey)),
            getDocs(collection(State.db, ...base, 'daily_data', dateKey, 'workRecords')),
            getDoc(doc(State.db, ...base, 'history', dateKey)),
        ]);
        const dailyData = dailySnap.exists() ? dailySnap.data() : {};
        const dailyRecords = wrSnap.size;
        const dailyQuantities = dailyData.taskQuantities ? Object.keys(dailyData.taskQuantities).length : 0;
        const hist = histSnap.exists() ? histSnap.data() : null;
        const historyRecords = hist && hist.workRecords ? hist.workRecords.length : 0;
        const result = {
            date: dateKey,
            dailyData: { records: dailyRecords, quantities: dailyQuantities, exists: dailySnap.exists() },
            history: { exists: histSnap.exists(), records: historyRecords },
        };
        console.log(`[peek ${dateKey}] daily_data: 업무 ${dailyRecords}건 / 물량 ${dailyQuantities}종  →  history: ${histSnap.exists() ? `있음(${historyRecords}건)` : '없음'}`, result);
        showToast(`${dateKey} — 원본 업무 ${dailyRecords}건, 이력 ${histSnap.exists() ? historyRecords + '건' : '없음'}`);
        return result;
    } catch (e) {
        console.error('peekDailyData error:', e);
        showToast(`조회 오류: ${e.message}`, true);
        return null;
    }
}

export async function recoverDailyDataToHistory(dateKey, { force = false, silent = false } = {}) {
    if (!State.auth || !State.auth.currentUser) { if (!silent) showToast('복구하려면 로그인이 필요합니다.', true); return null; }
    if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) { if (!silent) showToast('복구할 날짜 형식이 올바르지 않습니다. (예: 2026-07-27)', true); return null; }

    const base = ['artifacts', 'team-work-logger-v2'];
    const dailyDocRef = doc(State.db, ...base, 'daily_data', dateKey);
    const workRecordsColRef = collection(State.db, ...base, 'daily_data', dateKey, 'workRecords');
    const historyDocRef = doc(State.db, ...base, 'history', dateKey);

    try {
        const [dailySnap, wrSnap, histSnap] = await Promise.all([
            getDoc(dailyDocRef),
            getDocs(workRecordsColRef),
            getDoc(historyDocRef),
        ]);

        const dailyData = dailySnap.exists() ? dailySnap.data() : {};
        const rawRecords = [];
        wrSnap.forEach(d => rawRecords.push({ id: d.id, ...d.data() }));

        const hasQuantities = dailyData.taskQuantities && Object.keys(dailyData.taskQuantities).length > 0;
        if (rawRecords.length === 0 && !hasQuantities) {
            if (!silent) showToast(`${dateKey}: daily_data에 복구할 원본이 없습니다.`, true);
            return { date: dateKey, records: 0, quantities: 0, hadExisting: histSnap.exists() };
        }

        // 이미 history에 데이터가 있으면 실수로 덮어쓰지 않도록 확인
        const existing = histSnap.exists() ? histSnap.data() : null;
        const existingCount = (existing && existing.workRecords) ? existing.workRecords.length : 0;
        if (existingCount > 0 && !force) {
            const ok = confirm(`${dateKey} 이력에 이미 업무 ${existingCount}건이 있습니다.\n원본(daily_data) ${rawRecords.length}건으로 덮어쓸까요?`);
            if (!ok) { if (!silent) showToast('복구를 취소했습니다.'); return { date: dateKey, canceled: true }; }
        }

        // ongoing/paused 기록 마감 처리 (앱의 17:30 자동마감과 동일한 종료시각 사용)
        const AUTO_END = '17:30';
        const workRecords = rawRecords.map(r => {
            const data = { ...r };
            if (data.status === 'ongoing' || data.status === 'paused') {
                const pauses = Array.isArray(data.pauses) ? [...data.pauses] : [];
                if (data.status === 'paused' && pauses.length > 0) {
                    const lp = pauses[pauses.length - 1];
                    if (lp && lp.end === null) lp.end = AUTO_END;
                }
                data.endTime = AUTO_END;
                data.duration = Math.max(0, calcElapsedMinutes(data.startTime, AUTO_END, pauses));
                data.status = 'completed';
                data.pauses = pauses;
            }
            return data;
        }).filter(r => r.status !== 'completed' || Math.round(r.duration || 0) > 0);

        // 🛡️ 이미 history에 있는 값은 절대 후퇴시키지 않는다.
        //    (마감 시 daily_data의 물량/검증여부가 초기화되므로, 원본이 비면 기존 이력을 유지)
        const keep = (fromDaily, fromHist, isEmpty) =>
            (!isEmpty(fromDaily) ? fromDaily : (fromHist !== undefined && fromHist !== null ? fromHist : fromDaily));
        const emptyObj = (v) => !v || Object.keys(v).length === 0;
        const emptyArr = (v) => !Array.isArray(v) || v.length === 0;

        const historyData = {
            id: dateKey,
            workRecords,
            taskQuantities: keep(dailyData.taskQuantities || {}, existing && existing.taskQuantities, emptyObj),
            confirmedZeroTasks: keep(dailyData.confirmedZeroTasks || [], existing && existing.confirmedZeroTasks, emptyArr),
            onLeaveMembers: keep(dailyData.onLeaveMembers || [], existing && existing.onLeaveMembers, emptyArr),
            partTimers: keep(dailyData.partTimers || [], existing && existing.partTimers, emptyArr),
            dailyAttendance: keep(dailyData.dailyAttendance || {}, existing && existing.dailyAttendance, emptyObj),
            management: keep(dailyData.management || {}, existing && existing.management, emptyObj),
            inspectionList: keep(dailyData.inspectionList || [], existing && existing.inspectionList, emptyArr),
            isQuantityVerified: !!(dailyData.isQuantityVerified || (existing && existing.isQuantityVerified)),
            savedAt: getCurrentTime(),
            recoveredAt: new Date().toISOString(),
        };

        await setDoc(historyDocRef, historyData, { merge: true });

        // 메모리 캐시도 갱신 (재조회 없이 화면 반영)
        const idx = State.allHistoryData.findIndex(d => d.id === dateKey);
        if (idx > -1) State.allHistoryData[idx] = { ...State.allHistoryData[idx], ...historyData };
        else {
            State.allHistoryData.push(historyData);
            State.allHistoryData.sort((a, b) => b.id.localeCompare(a.id));
        }
        clearLocalCache();

        if (!silent) showToast(`✅ ${dateKey} 복구 완료 — 업무 ${workRecords.length}건, 물량 ${Object.keys(historyData.taskQuantities).length}종`);
        return { date: dateKey, records: workRecords.length, quantities: Object.keys(historyData.taskQuantities).length, hadExisting: existingCount > 0 };

    } catch (e) {
        console.error('recoverDailyDataToHistory error:', e);
        if (!silent) showToast(`복구 중 오류: ${e.message}`, true);
        return null;
    }
}

// 🩺 시작 시 자가복구: 최근 며칠 중 history가 비었지만 daily_data엔 원본이 있는 날을 자동으로 복구.
// - 이미 메모리에 로드된 allHistoryData만 보고 후보(빈 날)를 고르므로 후보 선별엔 추가 읽기 없음.
// - '빈 날'에 대해서만 daily_data를 1회 확인하고, 확인한 날짜는 localStorage에 기록해 재읽기를 막음(읽기요금 방어).
// - 주말/오늘은 제외. 정상적으로 마감된 날엔 후보가 없어 추가 비용 0.
// ⚠️ 판정 로직을 고칠 때마다 키의 버전을 올린다.
//    (이전 로직이 "확인 완료"로 잘못 표시해 둔 날짜를 다시 검사하게 하기 위함)
const SELF_HEAL_CHECKED_KEY = 'selfHealCheckedDates_v2';

export async function selfHealRecentHistory({ days = 7 } = {}) {
    if (!State.auth || !State.auth.currentUser) return { healed: [] };
    const today = getTodayDateString();

    let checked = [];
    try { checked = JSON.parse(localStorage.getItem(SELF_HEAL_CHECKED_KEY) || '[]'); } catch (_) {}
    const checkedSet = new Set(checked);

    // 후보 선별: 최근 days일(오늘·주말 제외) 중 history가 비어있고 아직 확인 안 한 날
    const candidates = [];
    const base = new Date(today);
    for (let i = 1; i <= days; i++) {
        const d = new Date(base);
        d.setDate(d.getDate() - i);
        const dow = d.getDay();
        if (dow === 0 || dow === 6) continue; // 주말 제외
        const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
        const key = local.toISOString().slice(0, 10);
        if (key >= today || checkedSet.has(key)) continue;
        const h = State.allHistoryData.find(x => x.id === key);
        // 🩺 판정 기준은 오직 '업무기록(workRecords)이 비었는가'.
        //    예전에는 물량(taskQuantities)이 있으면 후보에서 제외했는데,
        //    그 때문에 "물량은 저장됐지만 근무기록만 유실된 날"이 영영 복구되지 않았다.
        //    (17:30 자동마감이 history에 쓰지 않던 버그와 겹쳐 실제 유실 발생)
        const histEmpty = !h || !Array.isArray(h.workRecords) || h.workRecords.length === 0;
        if (histEmpty) candidates.push(key);
    }

    if (candidates.length === 0) return { healed: [] };

    const healed = [];
    for (const key of candidates) {
        try {
            const res = await recoverDailyDataToHistory(key, { force: true, silent: true });
            if (res && res.records > 0) healed.push({ date: key, records: res.records });
        } catch (e) {
            console.warn('selfHeal 실패:', key, e);
        }
        checkedSet.add(key); // 결과와 무관하게 확인 완료로 표시(재읽기 방지)
    }

    // 확인 기록 저장 (최근 60개만 유지)
    try { localStorage.setItem(SELF_HEAL_CHECKED_KEY, JSON.stringify([...checkedSet].slice(-60))); } catch (_) {}

    if (healed.length > 0) {
        const total = healed.reduce((s, x) => s + x.records, 0);
        console.log('[selfHeal] 자동 복구된 날:', healed);
        showToast(`🩺 마감 누락 ${healed.length}일 자동 복구됨 (업무 ${total}건)`);
    }
    return { healed };
}

// 🩺 앱 시작 시 가벼운 자가복구: '어제' 하루만 확인한다.
// 데이터 관리 창을 열지 않아도 동작해야 하므로 별도로 둔다.
// 비용: 하루 최대 1회, history 1건 읽기(+누락일 때만 daily_data 조회/쓰기).
export async function healYesterdayOnStartup() {
    if (!State.auth || !State.auth.currentUser) return null;

    const today = getTodayDateString();
    const d = new Date(today + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) return null; // 주말 제외
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const guard = 'startupHealChecked_' + key;
    if (localStorage.getItem(guard)) return null;

    try {
        const histSnap = await getDoc(doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', key));
        const hist = histSnap.exists() ? histSnap.data() : null;
        const hasRecords = hist && Array.isArray(hist.workRecords) && hist.workRecords.length > 0;

        localStorage.setItem(guard, '1');
        if (hasRecords) return null;

        const res = await recoverDailyDataToHistory(key, { force: true, silent: true });
        if (res && res.records > 0) {
            clearLocalCache();
            showToast(`🩺 어제(${key}) 마감 누락 업무 ${res.records}건을 자동 복구했습니다.`);
            return res;
        }
    } catch (e) {
        console.warn('시작 시 어제 자가복구 실패:', e);
        try { localStorage.removeItem(guard); } catch (_) {}
    }
    return null;
}

export async function fetchAllHistoryData(forceRefresh = false) {
    if (!forceRefresh && isHistoryCached && State.allHistoryData.length > 0) {
        return State.allHistoryData;
    }

    // ✨ 로컬 스토리지 확인 (새로고침·새 탭 시 DB 읽기 요금 방어). 과거 이력은 변하지 않으므로 길게 캐싱.
    if (!forceRefresh) {
        const cached = localStorage.getItem('historyDataCache');
        const cacheTime = localStorage.getItem('historyDataCacheTime');
        const now = Date.now();
        if (cached && cacheTime && (now - parseInt(cacheTime) < HISTORY_CACHE_TTL_MS)) {
            try {
                State.allHistoryData.length = 0;
                State.allHistoryData.push(...JSON.parse(cached));
                isHistoryCached = true;
                // 🛡️ 오늘 행은 캐시 값이 오래됐을 수 있으므로 실시간 메모리 상태로 덮어써 항상 최신 유지
                try { syncTodayToHistory(); } catch (e) {}
                return State.allHistoryData;
            } catch(e) {}
        }
    }

    if (historyFetchPromise && !forceRefresh) {
        return historyFetchPromise; 
    }

    historyFetchPromise = (async () => {
        const historyCollectionRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'history');
        try {
            const d = new Date();
            // 이력 조회 범위: 최근 12개월. (세션 캐시 5분이 있어 같은 세션 내 재호출은 추가 read 없음)
            d.setMonth(d.getMonth() - 12);
            const oneYearAgoStr = d.toISOString().split('T')[0];

            const q = query(historyCollectionRef, where(documentId(), ">=", oneYearAgoStr));
            const querySnapshot = await getDocs(q);
            
            const dataMap = new Map();
            querySnapshot.forEach((doc) => {
                const docData = doc.data();
                if (docData) dataMap.set(doc.id, { id: doc.id, ...docData });
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
                        id: dateStr, workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [],
                        management: { revenue: 0, orderCount: 0, inventoryQty: 0, inventoryAmt: 0 }, inspectionList: []
                    });
                }
                current.setDate(current.getDate() + 1);
            }

            fullHistory.sort((a, b) => b.id.localeCompare(a.id));
            State.allHistoryData.length = 0; 
            State.allHistoryData.push(...fullHistory); 
            
            isHistoryCached = true; 
            
            // ✨ 성공적으로 가져왔다면 로컬 스토리지에 캐싱 (용량 초과 시 안전하게 스킵)
            try {
                localStorage.setItem('historyDataCache', JSON.stringify(State.allHistoryData));
                localStorage.setItem('historyDataCacheTime', Date.now().toString());
            } catch (e) {
                console.warn('[history cache] localStorage 저장 실패(용량 초과 가능) — 캐시 없이 진행:', e);
                try { localStorage.removeItem('historyDataCache'); localStorage.removeItem('historyDataCacheTime'); } catch (_) {}
            }

            return State.allHistoryData;
        } catch (error) {
            console.error('Error fetching all history data:', error);
            State.allHistoryData.length = 0;
            return [];
        } finally {
            historyFetchPromise = null;
        }
    })();

    return historyFetchPromise;
}

export async function addHistoryWorkRecord(dateKey, newRecordData) {
    const todayKey = getTodayDateString();

    if (newRecordData.startTime && newRecordData.endTime && !newRecordData.duration) {
        newRecordData.duration = calcElapsedMinutes(newRecordData.startTime, newRecordData.endTime, newRecordData.pauses || []);
    }
    
    if (newRecordData.status === 'completed' && Math.round(newRecordData.duration || 0) <= 0) return;

    if (dateKey === todayKey) {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', todayKey, 'workRecords', newRecordData.id);
        await setDoc(docRef, newRecordData);
        await syncTodayToHistory();
        clearLocalCache();
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
    clearLocalCache();
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
                    if (recIdx > -1) return await updateHistoryDirectly(dateKey, recordId, updateData);
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
            if (end) newDuration = calcElapsedMinutes(start, end, pauses);
            updateData.duration = newDuration;
        }

        if (newStatus === 'completed' && newDuration !== null && Math.round(newDuration) <= 0) {
            await deleteHistoryWorkRecord(dateKey, recordId);
            return;
        }
        
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', todayKey, 'workRecords', recordId);
        await updateDoc(docRef, updateData);
        await syncTodayToHistory(); 
        clearLocalCache();
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

    if (updateData.startTime || updateData.endTime || originalRecord.pauses) {
        const start = updateData.startTime || originalRecord.startTime;
        const end = updateData.endTime || originalRecord.endTime;
        const pauses = updateData.pauses || originalRecord.pauses || [];
        updatedRecord.duration = calcElapsedMinutes(start, end, pauses);
    }

    if (updatedRecord.status === 'completed' && Math.round(updatedRecord.duration || 0) <= 0) {
        await deleteHistoryWorkRecord(dateKey, recordId);
        return;
    }

    dayData.workRecords[recordIndex] = updatedRecord;
    const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
    await setDoc(historyDocRef, { workRecords: dayData.workRecords }, { merge: true });
    clearLocalCache();
}

export async function deleteHistoryWorkRecord(dateKey, recordId) {
    const todayKey = getTodayDateString();

    if (dateKey === todayKey) {
        const dailyRecordRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', todayKey, 'workRecords', recordId);
        const dailySnap = await getDoc(dailyRecordRef);
        
        if (dailySnap.exists()) {
            await deleteDoc(dailyRecordRef);
            await syncTodayToHistory();
            clearLocalCache();
            return;
        }
    }

    const dayIndex = State.allHistoryData.findIndex(d => d.id === dateKey);
    if (dayIndex === -1) throw new Error("해당 날짜의 이력을 찾을 수 없습니다.");

    const dayData = State.allHistoryData[dayIndex];
    const newRecords = dayData.workRecords.filter(r => r.id !== recordId);

    if (dayData.workRecords.length === newRecords.length) return;

    dayData.workRecords = newRecords; 
    const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
    await setDoc(historyDocRef, { workRecords: newRecords }, { merge: true });
    clearLocalCache();
}

export async function saveManagementData(dateKey, managementData) {
    const todayKey = getTodayDateString();

    const dayIndex = State.allHistoryData.findIndex(d => d.id === dateKey);
    if (dayIndex > -1) {
        // Firestore 는 merge 로 깊게 합치므로 메모리도 같게 맞춘다.
        // (통째로 바꾸면 이번에 안 보낸 항목이 화면에서만 사라져 다음 저장 때 0으로 덮인다)
        State.allHistoryData[dayIndex].management = {
            ...(State.allHistoryData[dayIndex].management || {}),
            ...managementData
        };
    } else {
        State.allHistoryData.push({
            id: dateKey, workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [], management: managementData
        });
        State.allHistoryData.sort((a, b) => b.id.localeCompare(a.id));
    }

    const updates = { management: managementData };

    try {
        if (dateKey === todayKey) await setDoc(getDailyDocRef(), updates, { merge: true });
        const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
        await setDoc(historyDocRef, updates, { merge: true });
        clearLocalCache();
    } catch (e) {
        console.error("Error saving management data:", e);
        throw e; 
    }
}

// 💱 과거 환율 소급 입력(백필).
// history 문서가 있는 날짜 중 환율이 비어있는 날을 날짜별 조회가 되는 무료 API(frankfurter)로 채운다.
// - 오늘은 자동입력(autoFetchDailyFx)이 처리하므로 제외.
// - 주말/휴일은 API가 직전 영업일 환율을 반환.
// 반환: { ok, fail, skipped }
export async function backfillFxRates(fromDate = '2026-06-01') {
    if (!State.auth || !State.auth.currentUser) { showToast('로그인이 필요합니다.', true); return { ok: 0, fail: 0 }; }
    const todayKey = getTodayDateString();

    const targets = (State.allHistoryData || [])
        .filter(d => d.id && d.id >= fromDate && d.id < todayKey)
        .filter(d => !(d.management && Number(d.management.usdRate) > 0))
        .map(d => d.id)
        .sort();

    if (targets.length === 0) { showToast('채울 과거 환율이 없습니다. (이미 모두 입력됨)'); return { ok: 0, fail: 0 }; }
    if (!confirm(`${fromDate}부터 환율이 비어있는 ${targets.length}일을 과거 환율로 채웁니다.\n진행할까요?`)) return { ok: 0, fail: 0, canceled: true };

    let ok = 0, fail = 0;
    for (const date of targets) {
        try {
            const res = await fetch(`https://api.frankfurter.dev/v1/${date}?base=USD&symbols=KRW,CNY`, { cache: 'no-store' });
            const j = await res.json();
            const krw = j && j.rates && j.rates.KRW;
            const cny = j && j.rates && j.rates.CNY;
            if (!krw) { fail++; continue; }

            const usdRate = Math.round(krw * 100) / 100;                 // 1 USD = ? 원 (소수점 2자리)
            const cnyRate = cny ? Math.round((krw / cny) * 100) / 100 : 0; // 1 CNY = ? 원 (소수점 2자리)
            const fxAt = Date.now();
            const payload = { management: { usdRate, cnyRate, fxAt, fxBackfilled: true } };

            const histRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', date);
            await setDoc(histRef, payload, { merge: true }); // 딥머지: 기존 매출/재고 보존

            const di = State.allHistoryData.findIndex(d => d.id === date);
            if (di > -1) State.allHistoryData[di].management = { ...(State.allHistoryData[di].management || {}), usdRate, cnyRate, fxAt };
            ok++;
        } catch (e) {
            fail++;
            console.warn('환율 백필 실패:', date, e);
        }
        await new Promise(r => setTimeout(r, 150)); // API 과다호출 방지
    }

    clearLocalCache(); // 캐시 무효화 → 다음 조회 시 서버 최신값 반영
    showToast(`과거 환율 채우기 완료: 성공 ${ok}일 / 실패 ${fail}일`);
    return { ok, fail };
}

export async function checkUnverifiedRecords(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && cachedUnverifiedDates && (now - lastUnverifiedCheckTime < 3600000)) {
        return cachedUnverifiedDates;
    }

    // ✨ 브라우저 세션 스토리지 캐시 확인
    if (!forceRefresh) {
        const cached = localStorage.getItem('unverifiedDataCache');
        const cacheTime = localStorage.getItem('unverifiedDataCacheTime');
        if (cached && cacheTime && (now - parseInt(cacheTime) < HISTORY_CACHE_TTL_MS)) {
            try {
                cachedUnverifiedDates = JSON.parse(cached);
                lastUnverifiedCheckTime = now;
                return cachedUnverifiedDates;
            } catch(e) {}
        }
    }

    if (unverifiedFetchPromise && !forceRefresh) {
        return unverifiedFetchPromise;
    }

    unverifiedFetchPromise = (async () => {
        const historyCol = collection(State.db, 'artifacts', 'team-work-logger-v2', 'history');
        
        try {
            const d = new Date();
            // 🚨 기존 14일 -> 7일로 축소하여 읽기 요금 반토막
            d.setDate(d.getDate() - 7); 
            const sevenDaysAgoStr = d.toISOString().split('T')[0];

            const q = query(historyCol, where(documentId(), ">=", sevenDaysAgoStr)); 
            const snapshot = await getDocs(q);
            
            const unverifiedDates = [];
            const today = getTodayDateString();

            snapshot.forEach(doc => {
                const data = doc.data();
                if (doc.id !== today) {
                    const hasQuantities = data.taskQuantities && Object.keys(data.taskQuantities).length > 0;
                    if (hasQuantities && !data.isQuantityVerified) unverifiedDates.push(doc.id);
                }
            });

            unverifiedDates.sort();
            cachedUnverifiedDates = unverifiedDates;
            lastUnverifiedCheckTime = Date.now();
            
            try {
                localStorage.setItem('unverifiedDataCache', JSON.stringify(unverifiedDates));
                localStorage.setItem('unverifiedDataCacheTime', Date.now().toString());
            } catch (e) { /* 용량 초과 시 캐시 스킵 */ }

            return unverifiedDates; 
        } catch (e) {
            console.error("Failed to check unverified records:", e);
            return [];
        } finally {
            unverifiedFetchPromise = null;
        }
    })();

    return unverifiedFetchPromise;
}