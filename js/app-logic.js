// === js/app-logic.js ===
import {
    appState, db, auth,
    render, // ⛔️ render는 이제 사용하지 않지만, 호환성을 위해 일단 둡니다. (제거해도 무방)
    generateId,
    saveStateToFirestore, // ✅ taskQuantities, dailyAttendance 등 메타데이터 저장용
    debouncedSaveState
} from './app.js';

// ✅ [수정] Firestore 함수 및 getTodayDateString 임포트
import { calcElapsedMinutes, getCurrentTime, showToast, getTodayDateString } from './utils.js';
// ✅ [수정] query, where, getDocs 추가
import { doc, collection, setDoc, updateDoc, writeBatch, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


// ✅ [신규] workRecords 컬렉션 참조를 반환하는 헬퍼 함수
const getWorkRecordsCollectionRef = () => {
    const today = getTodayDateString();
    return collection(db, 'artifacts', 'team-work-logger-v2', 'daily_data', today, 'workRecords');
};


// ✅ [수정] 출근 처리 (render 제거)
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
        status: 'active' // 활동 중(출근 상태)
    };

    saveStateToFirestore(); // ✅ dailyAttendance는 메인 문서에 저장
    // ⛔️ render(); // 제거 (onSnapshot이 처리)
    showToast(`${memberName}님 ${isAdminAction ? '관리자에 의해 ' : ''}출근 처리되었습니다. (${now})`);
    return true;
};

// ✅ [수정] 퇴근 처리 (render 제거)
export const processClockOut = (memberName, isAdminAction = false) => {
    // ⛔️ [주의] appState.workRecords는 이제 실시간 캐시입니다.
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

    saveStateToFirestore(); // ✅ dailyAttendance는 메인 문서에 저장
    // ⛔️ render(); // 제거
    showToast(`${memberName}님 ${isAdminAction ? '관리자에 의해 ' : ''}퇴근 처리되었습니다. (${now})`);
    return true;
};

// ✅ [수정] 퇴근 취소 (render 제거)
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

    saveStateToFirestore(); // ✅ dailyAttendance는 메인 문서에 저장
    // ⛔️ render(); // 제거
    showToast(`${memberName}님의 퇴근이 ${isAdminAction ? '관리자에 의해 ' : ''}취소되었습니다. (다시 근무 상태)`);
    return true;
};


// ✅ [수정] Firestore에 직접 문서를 생성 (async 추가)
export const startWorkGroup = async (members, task) => {
    const notClockedInMembers = members.filter(member =>
        !appState.dailyAttendance?.[member] || appState.dailyAttendance[member].status !== 'active'
    );

    if (notClockedInMembers.length > 0) {
        showToast(`아직 출근하지 않은 팀원이 있어 업무를 시작할 수 없습니다: ${notClockedInMembers.join(', ')}`, true);
        return;
    }

    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const batch = writeBatch(db);
        const groupId = generateId();
        const startTime = getCurrentTime();

        members.forEach(member => {
            const recordId = generateId(); // Firestore 문서 ID로 사용
            const newRecordRef = doc(workRecordsColRef, recordId);
            const newRecordData = {
                id: recordId, // 데이터 내부에도 ID 저장 (이력 관리 호환성)
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
        // ⛔️ appState.workRecords.push(...) 제거
        // ⛔️ render() 제거
        // ⛔️ saveStateToFirestore() 제거
    } catch (e) {
        console.error("Error starting work group: ", e);
        showToast("업무 시작 중 오류가 발생했습니다.", true);
    }
};

// ✅ [수정] Firestore에 직접 문서를 생성 (async 추가)
export const addMembersToWorkGroup = async (members, task, groupId) => {
    const notClockedInMembers = members.filter(member =>
        !appState.dailyAttendance?.[member] || appState.dailyAttendance[member].status !== 'active'
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
        // ⛔️ appState.workRecords.push(...) 제거
        // ⛔️ render() 제거
        // ⛔️ saveStateToFirestore() 제거
    } catch (e) {
         console.error("Error adding members to work group: ", e);
         showToast("팀원 추가 중 오류가 발생했습니다.", true);
    }
};

// ✅ [수정] 이 함수는 로컬 캐시를 읽기만 하므로 변경 없음
export const stopWorkGroup = (groupId) => {
    const recordsToStop = (appState.workRecords || []).filter(r => String(r.groupId) === String(groupId) && (r.status === 'ongoing' || r.status === 'paused'));
    if (recordsToStop.length === 0) return;

    finalizeStopGroup(groupId, null);
};

// ✅ [수정] Firestore 문서를 일괄 업데이트 (async 추가)
export const finalizeStopGroup = async (groupId, quantity) => {
    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const batch = writeBatch(db);
        const endTime = getCurrentTime();
        let taskName = '';
        let changed = false;

        // ⛔️ [주의] 로컬 캐시(appState)를 기준으로 업데이트할 문서를 찾습니다.
        (appState.workRecords || []).forEach(record => {
            if (String(record.groupId) === String(groupId) && (record.status === 'ongoing' || record.status === 'paused')) {
                taskName = record.task;
                const recordRef = doc(workRecordsColRef, record.id);
                
                let pauses = record.pauses || [];
                if (record.status === 'paused') {
                    const lastPause = pauses.length > 0 ? pauses[pauses.length - 1] : null;
                    if (lastPause && lastPause.end === null) {
                        lastPause.end = endTime;
                    }
                }
                const duration = calcElapsedMinutes(record.startTime, endTime, pauses);
                
                batch.update(recordRef, {
                    status: 'completed',
                    endTime: endTime,
                    duration: duration,
                    pauses: pauses
                });
                changed = true;
            }
        });

        if (quantity !== null && taskName) {
            appState.taskQuantities = appState.taskQuantities || {};
            appState.taskQuantities[taskName] = (appState.taskQuantities[taskName] || 0) + (Number(quantity) || 0);
        }

        if (changed) {
            await batch.commit();
            // ⛔️ render() 제거
            
            // ✅ taskQuantities가 변경되었을 수 있으므로 메인 문서 저장
            if (quantity !== null) {
                saveStateToFirestore();
            }
        }
    } catch (e) {
         console.error("Error finalizing work group: ", e);
         showToast("그룹 업무 종료 중 오류가 발생했습니다.", true);
    }
};

// ✅ [수정] Firestore 문서를 직접 업데이트 (async 추가)
export const stopWorkIndividual = async (recordId) => {
    try {
        const record = (appState.workRecords || []).find(r => String(r.id) === String(recordId));
        if (record && (record.status === 'ongoing' || record.status === 'paused')) {
            const workRecordsColRef = getWorkRecordsCollectionRef();
            const recordRef = doc(workRecordsColRef, recordId);
            const endTime = getCurrentTime();
            
            let pauses = record.pauses || [];
            if (record.status === 'paused') {
                const lastPause = pauses.length > 0 ? pauses[pauses.length - 1] : null;
                if (lastPause && lastPause.end === null) {
                    lastPause.end = endTime;
                }
            }
            const duration = calcElapsedMinutes(record.startTime, endTime, pauses);

            await updateDoc(recordRef, {
                status: 'completed',
                endTime: endTime,
                duration: duration,
                pauses: pauses
            });

            // ⛔️ render() 제거
            // ⛔️ saveStateToFirestore() 제거
            showToast(`${record.member}님의 ${record.task} 업무가 종료되었습니다.`);
        } else {
            showToast('이미 완료되었거나 찾을 수 없는 기록입니다.', true);
        }
    } catch (e) {
         console.error("Error stopping individual work: ", e);
         showToast("개별 업무 종료 중 오류가 발생했습니다.", true);
    }
};

// ✅ [수정] Firestore 문서를 일괄 업데이트 (async 추가)
export const pauseWorkGroup = async (groupId) => {
    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const batch = writeBatch(db);
        const currentTime = getCurrentTime();
        let changed = false;

        (appState.workRecords || []).forEach(record => {
            if (String(record.groupId) === String(groupId) && record.status === 'ongoing') {
                const recordRef = doc(workRecordsColRef, record.id);
                const newPauses = record.pauses || [];
                newPauses.push({ start: currentTime, end: null, type: 'break' });
                
                batch.update(recordRef, {
                    status: 'paused',
                    pauses: newPauses
                });
                changed = true;
            }
        });

        if (changed) {
            await batch.commit();
            // ⛔️ render() 제거
            // ⛔️ saveStateToFirestore() 제거
            showToast('그룹 업무가 일시정지 되었습니다.');
        }
    } catch (e) {
         console.error("Error pausing work group: ", e);
         showToast("그룹 업무 정지 중 오류가 발생했습니다.", true);
    }
};

// ✅ [수정] Firestore 문서를 일괄 업데이트 (async 추가)
export const resumeWorkGroup = async (groupId) => {
    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const batch = writeBatch(db);
        const currentTime = getCurrentTime();
        let changed = false;

        (appState.workRecords || []).forEach(record => {
            if (String(record.groupId) === String(groupId) && record.status === 'paused') {
                const recordRef = doc(workRecordsColRef, record.id);
                const pauses = record.pauses || [];
                const lastPause = pauses.length > 0 ? pauses[pauses.length - 1] : null;
                
                if (lastPause && lastPause.end === null) {
                    lastPause.end = currentTime;
                }
                
                batch.update(recordRef, {
                    status: 'ongoing',
                    pauses: pauses
                });
                changed = true;
            }
        });
        
        if (changed) {
            await batch.commit();
            // ⛔️ render() 제거
            // ⛔️ saveStateToFirestore() 제거
            showToast('그룹 업무를 다시 시작합니다.');
        }
    } catch (e) {
         console.error("Error resuming work group: ", e);
         showToast("그룹 업무 재개 중 오류가 발생했습니다.", true);
    }
};

// ✅ [수정] Firestore 문서를 직접 업데이트 (async 추가)
export const pauseWorkIndividual = async (recordId) => {
    try {
        const record = (appState.workRecords || []).find(r => String(r.id) === String(recordId));
        if (record && record.status === 'ongoing') {
            const workRecordsColRef = getWorkRecordsCollectionRef();
            const recordRef = doc(workRecordsColRef, recordId);
            const currentTime = getCurrentTime();
            
            const newPauses = record.pauses || [];
            newPauses.push({ start: currentTime, end: null, type: 'break' });
            
            await updateDoc(recordRef, {
                status: 'paused',
                pauses: newPauses
            });
            
            // ⛔️ render() 제거
            // ⛔️ saveStateToFirestore() 제거
            showToast(`${record.member}님 ${record.task} 업무 일시정지.`);
        }
    } catch (e) {
         console.error("Error pausing individual work: ", e);
         showToast("개별 업무 정지 중 오류가 발생했습니다.", true);
    }
};

// ✅ [수정] Firestore 문서를 직접 업데이트 (async 추가)
export const resumeWorkIndividual = async (recordId) => {
    try {
        const record = (appState.workRecords || []).find(r => String(r.id) === String(recordId));
        if (record && record.status === 'paused') {
            const workRecordsColRef = getWorkRecordsCollectionRef();
            const recordRef = doc(workRecordsColRef, recordId);
            const currentTime = getCurrentTime();
            
            const pauses = record.pauses || [];
            const lastPause = pauses.length > 0 ? pauses[pauses.length - 1] : null;
            if (lastPause && lastPause.end === null) {
                lastPause.end = currentTime;
            }
            
            await updateDoc(recordRef, {
                status: 'ongoing',
                pauses: pauses
            });
            
            // ⛔️ render() 제거
            // ⛔️ saveStateToFirestore() 제거
            showToast(`${record.member}님 ${record.task} 업무 재개.`);
        }
    } catch (e) {
         console.error("Error resuming individual work: ", e);
         showToast("개별 업무 재개 중 오류가 발생했습니다.", true);
    }
};

/**
 * ✅ [신규] 12:30 점심시간 자동 일시정지
 * app.js의 updateElapsedTimes에서 호출됨
 */
export const autoPauseForLunch = async () => {
    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const q = query(workRecordsColRef, where("status", "==", "ongoing"));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            console.log("Auto-pause: No ongoing tasks to pause.");
            return 0; // 0건 처리
        }

        const batch = writeBatch(db);
        const currentTime = getCurrentTime();
        let tasksPaused = 0;

        querySnapshot.forEach(doc => {
            const record = doc.data();
            const newPauses = record.pauses || [];
            newPauses.push({ start: currentTime, end: null, type: 'lunch' });
            
            batch.update(doc.ref, {
                status: 'paused',
                pauses: newPauses
            });
            tasksPaused++;
        });

        await batch.commit();
        return tasksPaused; // 처리한 건수 반환

    } catch (e) {
        console.error("Error during auto-pause for lunch: ", e);
        showToast("점심시간 자동 정지 중 오류 발생", true);
        return 0;
    }
};

/**
 * ✅ [신규] 13:30 점심시간 자동 재개
 * app.js의 updateElapsedTimes에서 호출됨
 */
export const autoResumeFromLunch = async () => {
    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        // 'lunch' 타입의 pause가 있는지 확인하는 쿼리는 Firestore에서 복잡함.
        // 우선 'paused' 상태인 것만 가져와서 클라이언트에서 필터링.
        const q = query(workRecordsColRef, where("status", "==", "paused"));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            console.log("Auto-resume: No paused tasks to resume.");
            return 0;
        }

        const batch = writeBatch(db);
        const currentTime = getCurrentTime();
        let tasksResumed = 0;

        querySnapshot.forEach(doc => {
            const record = doc.data();
            const pauses = record.pauses || [];
            const lastPause = pauses.length > 0 ? pauses[pauses.length - 1] : null;

            // 마지막 pause가 'lunch' 타입이고, 아직 안 끝났는지 확인
            if (lastPause && lastPause.type === 'lunch' && lastPause.end === null) {
                lastPause.end = currentTime;
                
                batch.update(doc.ref, {
                    status: 'ongoing',
                    pauses: pauses
                });
                tasksResumed++;
            }
        });

        if (tasksResumed > 0) {
            await batch.commit();
        }
        return tasksResumed; // 처리한 건수 반환

    } catch (e) {
        console.error("Error during auto-resume from lunch: ", e);
        showToast("점심시간 자동 재개 중 오류 발생", true);
        return 0;
    }
};