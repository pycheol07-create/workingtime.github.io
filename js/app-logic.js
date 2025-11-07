// === js/app-logic.js ===
import {
    appState, db, auth,
    render,
    generateId,
    saveStateToFirestore,
    debouncedSaveState
} from './app.js';

import { calcElapsedMinutes, getCurrentTime, showToast, getTodayDateString } from './utils.js';
import { doc, collection, setDoc, updateDoc, writeBatch, query, where, getDocs, getDoc, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const getWorkRecordsCollectionRef = () => {
    const today = getTodayDateString();
    return collection(db, 'artifacts', 'team-work-logger-v2', 'daily_data', today, 'workRecords');
};

// ✅ [헬퍼] 최신 근태 정보를 서버에서 직접 조회
const getLatestAttendance = async () => {
    try {
        const todayDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString());
        const docSnap = await getDoc(todayDocRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            const state = data.state ? JSON.parse(data.state) : {};
            return state.dailyAttendance || {};
        }
        return {};
    } catch (e) {
        console.error("최신 근태 정보 조회 실패:", e);
        return appState.dailyAttendance || {};
    }
};

// 1. 출근 처리
export const processClockIn = (memberName, isAdminAction = false) => {
    const now = getCurrentTime();
    if (!appState.dailyAttendance) appState.dailyAttendance = {};

    const currentStatus = appState.dailyAttendance[memberName]?.status;
    if (currentStatus === 'active') {
        showToast(`${memberName}님은 이미 출근(Active) 상태입니다.`, true);
        return false;
    }

    appState.dailyAttendance[memberName] = {
        ...appState.dailyAttendance[memberName],
        inTime: now,
        outTime: null,
        status: 'active'
    };

    saveStateToFirestore();
    showToast(`${memberName}님 ${isAdminAction ? '관리자에 의해 ' : ''}출근 처리되었습니다. (${now})`);
    return true;
};

// 2. 퇴근 처리
export const processClockOut = (memberName, isAdminAction = false) => {
    const isWorking = (appState.workRecords || []).some(r =>
        r.member === memberName && (r.status === 'ongoing' || r.status === 'paused')
    );

    if (isWorking) {
        showToast(`${memberName}님은 현재 업무 진행 중이라 퇴근할 수 없습니다. 먼저 업무를 종료해주세요.`, true);
        return false;
    }

    const now = getCurrentTime();
    if (!appState.dailyAttendance) appState.dailyAttendance = {};

    if (!appState.dailyAttendance[memberName]) {
         appState.dailyAttendance[memberName] = { inTime: now };
    }

    if (appState.dailyAttendance[memberName].status === 'returned') {
         showToast(`${memberName}님은 이미 퇴근 처리되었습니다.`, true);
         return false;
    }

    appState.dailyAttendance[memberName].outTime = now;
    appState.dailyAttendance[memberName].status = 'returned';

    saveStateToFirestore();
    showToast(`${memberName}님 ${isAdminAction ? '관리자에 의해 ' : ''}퇴근 처리되었습니다. (${now})`);
    return true;
};

// 3. 퇴근 취소
export const cancelClockOut = (memberName, isAdminAction = false) => {
    if (!appState.dailyAttendance || !appState.dailyAttendance[memberName]) {
        showToast(`${memberName}님의 출퇴근 기록이 없습니다.`, true);
        return false;
    }

    const record = appState.dailyAttendance[memberName];
    if (record.status !== 'returned') {
         showToast(`${memberName}님은 현재 퇴근 상태가 아닙니다.`, true);
         return false;
    }

    appState.dailyAttendance[memberName] = {
        ...record,
        outTime: null,
        status: 'active'
    };

    saveStateToFirestore();
    showToast(`${memberName}님의 퇴근이 ${isAdminAction ? '관리자에 의해 ' : ''}취소되었습니다. (다시 근무 상태)`);
    return true;
};

// 4. 그룹 업무 시작 (최신 근태 확인 적용)
export const startWorkGroup = async (members, task) => {
    const latestAttendance = await getLatestAttendance();

    const notClockedInMembers = members.filter(member =>
        !latestAttendance[member] || latestAttendance[member].status !== 'active'
    );

    if (notClockedInMembers.length > 0) {
        showToast(`아직 출근하지 않은 팀원이 있어 업무를 시작할 수 없습니다: ${notClockedInMembers.join(', ')}`, true);
        // 로컬 상태 동기화 (선택 사항)
        if (JSON.stringify(appState.dailyAttendance) !== JSON.stringify(latestAttendance)) {
             appState.dailyAttendance = latestAttendance;
        }
        return;
    }

    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const batch = writeBatch(db);
        const groupId = generateId();
        const startTime = getCurrentTime();

        members.forEach(member => {
            const recordId = generateId();
            const newRecordRef = doc(workRecordsColRef, recordId);
            const newRecordData = {
                id: recordId,
                member,
                task,
                startTime,
                endTime: null,
                duration: null,
                status: 'ongoing',
                groupId,
                pauses: []
            };
            batch.set(newRecordRef, newRecordData);
        });

        await batch.commit();
    } catch (e) {
        console.error("Error starting work group: ", e);
        showToast("업무 시작 중 오류가 발생했습니다.", true);
    }
};

// 5. 그룹 인원 추가 (최신 근태 확인 적용)
export const addMembersToWorkGroup = async (members, task, groupId) => {
    const latestAttendance = await getLatestAttendance();

    const notClockedInMembers = members.filter(member =>
        !latestAttendance[member] || latestAttendance[member].status !== 'active'
    );

    if (notClockedInMembers.length > 0) {
        showToast(`출근하지 않은 팀원은 추가할 수 없습니다: ${notClockedInMembers.join(', ')}`, true);
        return;
    }

    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const batch = writeBatch(db);
        const startTime = getCurrentTime();
        
        members.forEach(member => {
            const recordId = generateId();
            const newRecordRef = doc(workRecordsColRef, recordId);
            const newRecordData = {
                id: recordId,
                member,
                task,
                startTime,
                endTime: null,
                duration: null,
                status: 'ongoing',
                groupId,
                pauses: []
            };
            batch.set(newRecordRef, newRecordData);
        });
        
        await batch.commit();
    } catch (e) {
         console.error("Error adding members to work group: ", e);
         showToast("팀원 추가 중 오류가 발생했습니다.", true);
    }
};

export const stopWorkGroup = (groupId) => {
    finalizeStopGroup(groupId, null);
};

// 6. 그룹 업무 종료 (DB 쿼리 기반)
export const finalizeStopGroup = async (groupId, quantity) => {
    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const batch = writeBatch(db);
        const endTime = getCurrentTime();
        let taskName = '';
        let updateCount = 0;

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

        querySnapshot.forEach((docSnap) => {
            const record = docSnap.data();
            taskName = record.task;

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

        if (quantity !== null && taskName) {
            appState.taskQuantities = appState.taskQuantities || {};
            appState.taskQuantities[taskName] = (appState.taskQuantities[taskName] || 0) + (Number(quantity) || 0);
        }

        if (updateCount > 0) {
            await batch.commit();
            if (quantity !== null) {
                saveStateToFirestore();
            }
        }
    } catch (e) {
        console.error("Error finalizing work group: ", e);
        showToast("그룹 업무 종료 중 오류가 발생했습니다.", true);
    }
};

// 7. 개별 업무 종료 (트랜잭션 기반)
export const stopWorkIndividual = async (recordId) => {
    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const recordRef = doc(workRecordsColRef, recordId);

        await runTransaction(db, async (transaction) => {
            const docSnap = await transaction.get(recordRef);
            if (!docSnap.exists()) throw new Error("기록을 찾을 수 없습니다.");
            const record = docSnap.data();
            if (record.status === 'completed') throw new Error("이미 종료된 업무입니다.");

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
        showToast(e.message === "이미 종료된 업무입니다." ? e.message : "개별 업무 종료 중 오류가 발생했습니다.", true);
    }
};

// 8. 그룹 일시정지 (DB 쿼리 기반)
export const pauseWorkGroup = async (groupId) => {
    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const batch = writeBatch(db);
        const currentTime = getCurrentTime();

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
            batch.update(docSnap.ref, { status: 'paused', pauses: newPauses });
        });

        await batch.commit();
        showToast('그룹 업무가 일시정지 되었습니다.');
    } catch (e) {
        console.error("Error pausing work group: ", e);
        showToast("그룹 업무 정지 중 오류가 발생했습니다.", true);
    }
};

// 9. 그룹 재개 (DB 쿼리 기반)
export const resumeWorkGroup = async (groupId) => {
    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const batch = writeBatch(db);
        const currentTime = getCurrentTime();

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
            batch.update(docSnap.ref, { status: 'ongoing', pauses: pauses });
        });

        await batch.commit();
        showToast('그룹 업무를 다시 시작합니다.');
    } catch (e) {
        console.error("Error resuming work group: ", e);
        showToast("그룹 업무 재개 중 오류가 발생했습니다.", true);
    }
};

// 10. 개별 일시정지 (트랜잭션 기반)
export const pauseWorkIndividual = async (recordId) => {
    try {
        const recordRef = doc(getWorkRecordsCollectionRef(), recordId);
        await runTransaction(db, async (transaction) => {
            const docSnap = await transaction.get(recordRef);
            if (!docSnap.exists()) throw new Error("기록 없음");
            if (docSnap.data().status !== 'ongoing') throw new Error("진행 중인 업무만 일시정지할 수 있습니다.");

            const currentTime = getCurrentTime();
            const record = docSnap.data();
            const newPauses = record.pauses || [];
            newPauses.push({ start: currentTime, end: null, type: 'break' });

            transaction.update(recordRef, { status: 'paused', pauses: newPauses });
        });
        showToast("업무가 일시정지 되었습니다.");
    } catch (e) {
        console.error("Error pausing individual work: ", e);
        showToast("업무 정지 중 오류 발생", true);
    }
};

// 11. 개별 재개 (트랜잭션 기반)
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

            transaction.update(recordRef, { status: 'ongoing', pauses: pauses });
        });
        showToast("업무가 재개되었습니다.");
    } catch (e) {
        console.error("Error resuming individual work: ", e);
        showToast("업무 재개 중 오류 발생", true);
    }
};

// 12. 점심시간 자동 정지 (DB 쿼리 기반)
export const autoPauseForLunch = async () => {
    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const q = query(workRecordsColRef, where("status", "==", "ongoing"));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) return 0;

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
    } catch (e) {
        console.error("Error during auto-pause: ", e);
        return 0;
    }
};

// 13. 점심시간 자동 재개 (DB 쿼리 기반)
export const autoResumeFromLunch = async () => {
    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const q = query(workRecordsColRef, where("status", "==", "paused"));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) return 0;

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

        if (tasksResumed > 0) {
            await batch.commit();
        }
        return tasksResumed;
    } catch (e) {
        console.error("Error during auto-resume: ", e);
        return 0;
    }
};