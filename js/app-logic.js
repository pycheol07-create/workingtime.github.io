// === js/app-logic.js ===
import {
    appState, db, auth,
    render,
    generateId,
    saveStateToFirestore,
    debouncedSaveState
} from './app.js';

import { calcElapsedMinutes, getCurrentTime, showToast, getTodayDateString } from './utils.js';
// ✅ [필수] runTransaction 추가 (더 확실한 동시성 제어를 위해 트랜잭션 사용 권장, 일단은 쿼리 기반으로도 충분히 개선됨)
import { doc, collection, setDoc, updateDoc, writeBatch, query, where, getDocs, getDoc, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


const getWorkRecordsCollectionRef = () => {
    const today = getTodayDateString();
    return collection(db, 'artifacts', 'team-work-logger-v2', 'daily_data', today, 'workRecords');
};

// ... (processClockIn, processClockOut, cancelClockOut, startWorkGroup, addMembersToWorkGroup 함수는 기존과 동일하게 유지) ...
// (지면 관계상 생략했습니다. 기존 코드를 그대로 두세요.)
export const processClockIn = (memberName, isAdminAction = false) => { /* 기존 코드 유지 */ 
    const now = getCurrentTime();
    if (!appState.dailyAttendance) appState.dailyAttendance = {};
    const currentStatus = appState.dailyAttendance[memberName]?.status;
    if (currentStatus === 'active') { showToast(`${memberName}님은 이미 출근(Active) 상태입니다.`, true); return false; }
    appState.dailyAttendance[memberName] = { ...appState.dailyAttendance[memberName], inTime: now, outTime: null, status: 'active' };
    saveStateToFirestore();
    showToast(`${memberName}님 ${isAdminAction ? '관리자에 의해 ' : ''}출근 처리되었습니다. (${now})`);
    return true;
};
export const processClockOut = (memberName, isAdminAction = false) => { /* 기존 코드 유지 */
     const isWorking = (appState.workRecords || []).some(r => r.member === memberName && (r.status === 'ongoing' || r.status === 'paused'));
    if (isWorking) { showToast(`${memberName}님은 현재 업무 진행 중이라 퇴근할 수 없습니다. 먼저 업무를 종료해주세요.`, true); return false; }
    const now = getCurrentTime();
    if (!appState.dailyAttendance) appState.dailyAttendance = {};
    if (!appState.dailyAttendance[memberName]) { appState.dailyAttendance[memberName] = { inTime: now }; }
    if (appState.dailyAttendance[memberName].status === 'returned') { showToast(`${memberName}님은 이미 퇴근 처리되었습니다.`, true); return false; }
    appState.dailyAttendance[memberName].outTime = now;
    appState.dailyAttendance[memberName].status = 'returned';
    saveStateToFirestore();
    showToast(`${memberName}님 ${isAdminAction ? '관리자에 의해 ' : ''}퇴근 처리되었습니다. (${now})`);
    return true;
};
export const cancelClockOut = (memberName, isAdminAction = false) => { /* 기존 코드 유지 */
    if (!appState.dailyAttendance || !appState.dailyAttendance[memberName]) { showToast(`${memberName}님의 출퇴근 기록이 없습니다.`, true); return false; }
    const record = appState.dailyAttendance[memberName];
    if (record.status !== 'returned') { showToast(`${memberName}님은 현재 퇴근 상태가 아닙니다.`, true); return false; }
    appState.dailyAttendance[memberName] = { ...record, outTime: null, status: 'active' };
    saveStateToFirestore();
    showToast(`${memberName}님의 퇴근이 ${isAdminAction ? '관리자에 의해 ' : ''}취소되었습니다. (다시 근무 상태)`);
    return true;
};
export const startWorkGroup = async (members, task) => { /* 기존 코드 유지 */
    const notClockedInMembers = members.filter(member => !appState.dailyAttendance?.[member] || appState.dailyAttendance[member].status !== 'active');
    if (notClockedInMembers.length > 0) { showToast(`아직 출근하지 않은 팀원이 있어 업무를 시작할 수 없습니다: ${notClockedInMembers.join(', ')}`, true); return; }
    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const batch = writeBatch(db);
        const groupId = generateId();
        const startTime = getCurrentTime();
        members.forEach(member => {
            const recordId = generateId();
            const newRecordRef = doc(workRecordsColRef, recordId);
            const newRecordData = { id: recordId, member, task, startTime, endTime: null, duration: null, status: 'ongoing', groupId, pauses: [] };
            batch.set(newRecordRef, newRecordData);
        });
        await batch.commit();
    } catch (e) { console.error("Error starting work group: ", e); showToast("업무 시작 중 오류가 발생했습니다.", true); }
};
export const addMembersToWorkGroup = async (members, task, groupId) => { /* 기존 코드 유지 */
    const notClockedInMembers = members.filter(member => !appState.dailyAttendance?.[member] || appState.dailyAttendance[member].status !== 'active');
    if (notClockedInMembers.length > 0) { showToast(`출근하지 않은 팀원은 추가할 수 없습니다: ${notClockedInMembers.join(', ')}`, true); return; }
    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const batch = writeBatch(db);
        const startTime = getCurrentTime();
        members.forEach(member => {
            const recordId = generateId();
            const newRecordRef = doc(workRecordsColRef, recordId);
            const newRecordData = { id: recordId, member, task, startTime, endTime: null, duration: null, status: 'ongoing', groupId, pauses: [] };
            batch.set(newRecordRef, newRecordData);
        });
        await batch.commit();
    } catch (e) { console.error("Error adding members to work group: ", e); showToast("팀원 추가 중 오류가 발생했습니다.", true); }
};


// --------------------------------------------------------------------------
// 🚨 중요 수정: 아래 함수들이 로컬 appState 대신 Firestore 쿼리를 사용하도록 변경됨
// --------------------------------------------------------------------------

export const stopWorkGroup = (groupId) => {
    // 단순히 확인용으로만 로컬 상태 사용 (실제 동작은 finalizeStopGroup에서 쿼리로 처리)
    finalizeStopGroup(groupId, null);
};

// ✅ [수정] Firestore 쿼리 기반 그룹 종료
export const finalizeStopGroup = async (groupId, quantity) => {
    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const batch = writeBatch(db);
        const endTime = getCurrentTime();
        let taskName = '';
        let updateCount = 0;

        // 1. DB에서 현재 이 그룹ID를 가지고, 'ongoing' 또는 'paused' 상태인 문서만 '직접' 조회
        const q = query(
            workRecordsColRef,
            where("groupId", "==", String(groupId)),
            where("status", "in", ["ongoing", "paused"])
        );
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            showToast("종료할 그룹 업무가 없거나 이미 종료되었습니다.");
            return;
        }

        // 2. 조회된 최신 문서들만 업데이트
        querySnapshot.forEach((docSnap) => {
            const record = docSnap.data();
            taskName = record.task; // 수량 업데이트용 태스크 이름 확보

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
            updateCount++;
        });

        // 3. 수량 업데이트 (필요시)
        if (quantity !== null && taskName) {
            // 수량은 여전히 메인 문서에 있으므로 트랜잭션이나 메인 문서 업데이트 필요
            // 간단하게 기존 방식 유지하되, 더 안전하게 하려면 이것도 트랜잭션으로 처리해야 함.
            // 여기서는 일단 기존 saveStateToFirestore 방식 유지.
            appState.taskQuantities = appState.taskQuantities || {};
            appState.taskQuantities[taskName] = (appState.taskQuantities[taskName] || 0) + (Number(quantity) || 0);
        }

        if (updateCount > 0) {
            await batch.commit();
            if (quantity !== null) {
                saveStateToFirestore();
            }
            showToast(`${updateCount}명의 그룹 업무가 종료되었습니다.`);
        }

    } catch (e) {
        console.error("Error finalizing work group: ", e);
        showToast("그룹 업무 종료 중 오류가 발생했습니다.", true);
    }
};

// ✅ [수정] Firestore 최신 상태 기반 개별 종료
export const stopWorkIndividual = async (recordId) => {
    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const recordRef = doc(workRecordsColRef, recordId);

        // 1. 최신 문서 상태 가져오기 (트랜잭션 사용을 권장하나, getDoc 후 update도 1차적 방어는 됨)
        // 더 확실하게 하기 위해 runTransaction 사용
        await runTransaction(db, async (transaction) => {
            const docSnap = await transaction.get(recordRef);
            if (!docSnap.exists()) {
                throw new Error("기록을 찾을 수 없습니다.");
            }

            const record = docSnap.data();
            if (record.status === 'completed') {
                throw new Error("이미 종료된 업무입니다.");
            }

            const endTime = getCurrentTime();
            let pauses = record.pauses || [];
            if (record.status === 'paused') {
                const lastPause = pauses.length > 0 ? pauses[pauses.length - 1] : null;
                if (lastPause && lastPause.end === null) {
                    lastPause.end = endTime;
                }
            }
            const duration = calcElapsedMinutes(record.startTime, endTime, pauses);

            transaction.update(recordRef, {
                status: 'completed',
                endTime: endTime,
                duration: duration,
                pauses: pauses
            });
        });

        showToast("업무가 종료되었습니다.");

    } catch (e) {
        console.error("Error stopping individual work: ", e);
        // 이미 종료된 경우 등 에러 메시지를 부드럽게 처리
        if (e.message === "이미 종료된 업무입니다." || e.message === "기록을 찾을 수 없습니다.") {
             showToast(e.message, true);
        } else {
             showToast("개별 업무 종료 중 오류가 발생했습니다.", true);
        }
    }
};

// ✅ [수정] Firestore 쿼리 기반 그룹 일시정지
export const pauseWorkGroup = async (groupId) => {
    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const batch = writeBatch(db);
        const currentTime = getCurrentTime();

        // 'ongoing' 상태인 것만 조회하여 일시정지 시킴
        const q = query(workRecordsColRef, where("groupId", "==", String(groupId)), where("status", "==", "ongoing"));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
             showToast("일시정지할 진행 중인 그룹 업무가 없습니다.", true);
             return;
        }

        querySnapshot.forEach((docSnap) => {
            const record = docSnap.data();
            const newPauses = record.pauses || [];
            newPauses.push({ start: currentTime, end: null, type: 'break' });

            batch.update(docSnap.ref, {
                status: 'paused',
                pauses: newPauses
            });
        });

        await batch.commit();
        showToast('그룹 업무가 일시정지 되었습니다.');

    } catch (e) {
        console.error("Error pausing work group: ", e);
        showToast("그룹 업무 정지 중 오류가 발생했습니다.", true);
    }
};

// ✅ [수정] Firestore 쿼리 기반 그룹 재개
export const resumeWorkGroup = async (groupId) => {
    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const batch = writeBatch(db);
        const currentTime = getCurrentTime();

        // 'paused' 상태인 것만 조회하여 재개 시킴
        const q = query(workRecordsColRef, where("groupId", "==", String(groupId)), where("status", "==", "paused"));
        const querySnapshot = await getDocs(q);

         if (querySnapshot.empty) {
             showToast("재개할 일시정지된 그룹 업무가 없습니다.", true);
             return;
        }

        querySnapshot.forEach((docSnap) => {
            const record = docSnap.data();
            const pauses = record.pauses || [];
            const lastPause = pauses.length > 0 ? pauses[pauses.length - 1] : null;

            if (lastPause && lastPause.end === null) {
                lastPause.end = currentTime;
            }

            batch.update(docSnap.ref, {
                status: 'ongoing',
                pauses: pauses
            });
        });

        await batch.commit();
        showToast('그룹 업무를 다시 시작합니다.');

    } catch (e) {
        console.error("Error resuming work group: ", e);
        showToast("그룹 업무 재개 중 오류가 발생했습니다.", true);
    }
};

// ✅ [수정] Firestore 트랜잭션 기반 개별 일시정지
export const pauseWorkIndividual = async (recordId) => {
    try {
        const recordRef = doc(getWorkRecordsCollectionRef(), recordId);
        await runTransaction(db, async (transaction) => {
            const docSnap = await transaction.get(recordRef);
            if (!docSnap.exists()) throw new Error("기록 없음");
            const record = docSnap.data();
            if (record.status !== 'ongoing') throw new Error("진행 중인 업무만 일시정지할 수 있습니다.");

            const currentTime = getCurrentTime();
            const newPauses = record.pauses || [];
            newPauses.push({ start: currentTime, end: null, type: 'break' });

            transaction.update(recordRef, {
                status: 'paused',
                pauses: newPauses
            });
        });
        showToast("업무가 일시정지 되었습니다.");
    } catch (e) {
        console.error("Error pausing individual work: ", e);
        showToast(e.message === "기록 없음" || e.message.includes("진행 중인") ? e.message : "업무 정지 중 오류 발생", true);
    }
};

// ✅ [수정] Firestore 트랜잭션 기반 개별 재개
export const resumeWorkIndividual = async (recordId) => {
    try {
         const recordRef = doc(getWorkRecordsCollectionRef(), recordId);
         await runTransaction(db, async (transaction) => {
            const docSnap = await transaction.get(recordRef);
            if (!docSnap.exists()) throw new Error("기록 없음");
            const record = docSnap.data();
            if (record.status !== 'paused') throw new Error("일시정지된 업무만 재개할 수 있습니다.");

            const currentTime = getCurrentTime();
            const pauses = record.pauses || [];
            const lastPause = pauses.length > 0 ? pauses[pauses.length - 1] : null;
            if (lastPause && lastPause.end === null) {
                lastPause.end = currentTime;
            }

            transaction.update(recordRef, {
                status: 'ongoing',
                pauses: pauses
            });
        });
        showToast("업무가 재개되었습니다.");
    } catch (e) {
        console.error("Error resuming individual work: ", e);
        showToast(e.message === "기록 없음" || e.message.includes("일시정지된") ? e.message : "업무 재개 중 오류 발생", true);
    }
};

// ... (autoPauseForLunch, autoResumeFromLunch 함수도 쿼리 기반이므로 유지) ...
export const autoPauseForLunch = async () => { /* 기존 코드 유지 (이미 쿼리 기반임) */
    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const q = query(workRecordsColRef, where("status", "==", "ongoing"));
        const querySnapshot = await getDocs(q);
        if (querySnapshot.empty) { console.log("Auto-pause: No ongoing tasks."); return 0; }
        const batch = writeBatch(db);
        const currentTime = getCurrentTime();
        let tasksPaused = 0;
        querySnapshot.forEach(doc => {
            const record = doc.data();
            const newPauses = record.pauses || [];
            newPauses.push({ start: currentTime, end: null, type: 'lunch' });
            batch.update(doc.ref, { status: 'paused', pauses: newPauses });
            tasksPaused++;
        });
        await batch.commit();
        return tasksPaused;
    } catch (e) { console.error("Error during auto-pause: ", e); return 0; }
};
export const autoResumeFromLunch = async () => { /* 기존 코드 유지 (이미 쿼리 기반임) */
     try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const q = query(workRecordsColRef, where("status", "==", "paused"));
        const querySnapshot = await getDocs(q);
        if (querySnapshot.empty) { console.log("Auto-resume: No paused tasks."); return 0; }
        const batch = writeBatch(db);
        const currentTime = getCurrentTime();
        let tasksResumed = 0;
        querySnapshot.forEach(doc => {
            const record = doc.data();
            const pauses = record.pauses || [];
            const lastPause = pauses.length > 0 ? pauses[pauses.length - 1] : null;
            if (lastPause && lastPause.type === 'lunch' && lastPause.end === null) {
                lastPause.end = currentTime;
                batch.update(doc.ref, { status: 'ongoing', pauses: pauses });
                tasksResumed++;
            }
        });
        if (tasksResumed > 0) { await batch.commit(); }
        return tasksResumed;
    } catch (e) { console.error("Error during auto-resume: ", e); return 0; }
};