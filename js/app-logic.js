// === js/app-logic.js ===

// ✅ [수정] app.js 대신 app-data.js에서 데이터 함수들을 가져옵니다.
import {
    generateId,
    saveStateToFirestore,
    debouncedSaveState,
    updateDailyData
} from './app-data.js';

// ✅ [신규] 핵심 상태 변수들은 state.js에서 가져옵니다.
import {
    appState, db, auth
} from './state.js';

import { calcElapsedMinutes, getCurrentTime, showToast, getTodayDateString } from './utils.js';
// ✅ [필수] increment, updateDoc 등 원자적 연산 함수 임포트
import { doc, collection, setDoc, updateDoc, writeBatch, query, where, getDocs, increment } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


// ✅ [신규] workRecords 컬렉션 참조를 반환하는 헬퍼 함수
const getWorkRecordsCollectionRef = () => {
    const today = getTodayDateString();
    return collection(db, 'artifacts', 'team-work-logger-v2', 'daily_data', today, 'workRecords');
};

// ✅ [신규] 메인 데일리 문서 참조 헬퍼
const getDailyDocRef = () => {
    return doc(db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString());
};


// ✅ [수정] 출근 처리 - 원자적 업데이트 적용
export const processClockIn = async (memberName, isAdminAction = false) => {
    const now = getCurrentTime();
    // 로컬 상태 확인은 UX를 위한 것일 뿐, 실제 데이터 무결성은 Firestore가 보장합니다.
    if (appState.dailyAttendance?.[memberName]?.status === 'active') {
        showToast(`${memberName}님은 이미 출근(Active) 상태입니다.`, true);
        return false;
    }

    try {
        // ✨ Dot Notation을 사용한 원자적 업데이트
        await updateDoc(getDailyDocRef(), {
            [`dailyAttendance.${memberName}`]: {
                inTime: now,
                outTime: null,
                status: 'active' // 활동 중(출근 상태)
            }
        });

        showToast(`${memberName}님 ${isAdminAction ? '관리자에 의해 ' : ''}출근 처리되었습니다. (${now})`);
        return true;
    } catch (e) {
        console.error("Clock-in error:", e);
        // 문서가 없을 경우(하루 첫 출근) 대비한 setDoc fallback
        if (e.code === 'not-found' || e.message.includes('No document to update')) {
             await setDoc(getDailyDocRef(), {
                dailyAttendance: {
                    [memberName]: { inTime: now, outTime: null, status: 'active' }
                }
            }, { merge: true });
             showToast(`${memberName}님 첫 출근 처리되었습니다. (${now})`);
             return true;
        }
        showToast("출근 처리 중 오류가 발생했습니다.", true);
        return false;
    }
};

// ✅ [수정] 퇴근 처리 - 원자적 업데이트 적용
export const processClockOut = async (memberName, isAdminAction = false) => {
    const isWorking = (appState.workRecords || []).some(r =>
        r.member === memberName && (r.status === 'ongoing' || r.status === 'paused')
    );

    if (isWorking) {
        showToast(`${memberName}님은 현재 업무 진행 중이라 퇴근할 수 없습니다. 먼저 업무를 종료해주세요.`, true);
        return false;
    }

    const now = getCurrentTime();

    try {
         // ✨ [개선] setDoc(merge:true) 대신 updateDoc을 사용하여 더 안전하게 업데이트
         await updateDoc(getDailyDocRef(), {
            [`dailyAttendance.${memberName}.outTime`]: now,
            [`dailyAttendance.${memberName}.status`]: 'returned'
        });

        showToast(`${memberName}님 ${isAdminAction ? '관리자에 의해 ' : ''}퇴근 처리되었습니다. (${now})`);
        return true;
    } catch (e) {
        console.error("Clock-out error:", e);
        // HACK: updateDoc은 문서가 없으면 실패합니다. (출근 없이 퇴근 누를 때)
        // 이 경우, '출근 전' 상태이므로 오류를 무시하거나, 'returned'로 강제 생성할 수 있습니다.
        // 여기서는 이미 'active'가 아닌 상태에서만 호출 가능하므로, 오류 발생 시 토스트만 띄웁니다.
        showToast("퇴근 처리 중 오류가 발생했습니다.", true);
        return false;
    }
};

// ✅ [수정] 퇴근 취소 - 원자적 업데이트 적용
export const cancelClockOut = async (memberName, isAdminAction = false) => {
    try {
        // 'status'를 'active'로, 'outTime'을 null로 원자적 업데이트
        await updateDoc(getDailyDocRef(), {
            [`dailyAttendance.${memberName}.status`]: 'active',
            [`dailyAttendance.${memberName}.outTime`]: null
        });

        showToast(`${memberName}님의 퇴근이 ${isAdminAction ? '관리자에 의해 ' : ''}취소되었습니다. (다시 근무 상태)`);
        return true;
    } catch (e) {
        console.error("Cancel clock-out error:", e);
        showToast("퇴근 취소 중 오류가 발생했습니다.", true);
        return false;
    }
};


// ✅ [수정] Firestore에 직접 문서를 생성 (async 추가)
export const startWorkGroup = async (members, task) => {
    // 1. 출근 여부 체크
    const notClockedInMembers = members.filter(member =>
        !appState.dailyAttendance?.[member] || appState.dailyAttendance[member].status !== 'active'
    );

    if (notClockedInMembers.length > 0) {
        showToast(`아직 출근하지 않은 팀원이 있어 업무를 시작할 수 없습니다: ${notClockedInMembers.join(', ')}`, true);
        return;
    }

    // ✨ 2. [신규 추가] 이미 업무 중인지 체크
    const alreadyWorkingMembers = members.filter(member =>
        (appState.workRecords || []).some(r =>
            r.member === member && (r.status === 'ongoing' || r.status === 'paused')
        )
    );
    if (alreadyWorkingMembers.length > 0) {
        showToast(`이미 업무를 진행 중인 팀원이 있습니다: ${alreadyWorkingMembers.join(', ')}`, true);
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
    } catch (e) {
        console.error("Error starting work group: ", e);
        showToast("업무 시작 중 오류가 발생했습니다.", true);
    }
};

// ✅ [수정] Firestore에 직접 문서를 생성 (async 추가)
export const addMembersToWorkGroup = async (members, task, groupId) => {
    // 1. 출근 여부 체크
    const notClockedInMembers = members.filter(member =>
        !appState.dailyAttendance?.[member] || appState.dailyAttendance[member].status !== 'active'
    );

    if (notClockedInMembers.length > 0) {
        showToast(`출근하지 않은 팀원은 추가할 수 없습니다: ${notClockedInMembers.join(', ')}`, true);
        return;
    }

    // ✨ 2. [신규 추가] 이미 업무 중인지 체크
    const alreadyWorkingMembers = members.filter(member =>
        (appState.workRecords || []).some(r =>
            r.member === member && (r.status === 'ongoing' || r.status === 'paused')
        )
    );
    if (alreadyWorkingMembers.length > 0) {
        showToast(`이미 업무를 진행 중인 팀원이 있습니다: ${alreadyWorkingMembers.join(', ')}`, true);
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

// ✅ [수정] 이 함수는 로컬 캐시를 읽기만 하므로 변경 없음
export const stopWorkGroup = (groupId) => {
    // 이 함수는 이제 직접 호출되지 않고 confirmStopGroupBtn 리스너에서 finalizeStopGroup을 바로 호출합니다.
    // 호환성을 위해 남겨둘 수 있습니다.
    finalizeStopGroup(groupId, null);
};

// ✅ [수정] 그룹 종료 시 처리량 업데이트에 'increment' 사용
export const finalizeStopGroup = async (groupId, quantity) => {
    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        // 1. 화면 상태(appState) 대신 Firestore에서 직접 '진행 중' 또는 '일시정지'인 그룹 데이터를 찾습니다.
        const q = query(workRecordsColRef, where("groupId", "==", String(groupId)), where("status", "in", ["ongoing", "paused"]));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            console.warn(`Finalize stop: Group ${groupId} not found or already completed.`);
            return;
        }

        const batch = writeBatch(db);
        const endTime = getCurrentTime();
        let taskName = '';

        // 2. 찾아낸 모든 문서를 'completed'로 일괄 업데이트합니다.
        querySnapshot.forEach(docSnap => {
            const record = docSnap.data();
            taskName = record.task; // 처리량 저장을 위해 업무명 확보

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

        // ✨ 3. 처리량 원자적 증가 (increment 사용)
        if (quantity !== null && taskName && Number(quantity) > 0) {
             // updateDoc을 사용하여 'taskQuantities.{taskName}' 필드만 원자적으로 증가시킵니다.
             await updateDoc(getDailyDocRef(), {
                [`taskQuantities.${taskName}`]: increment(Number(quantity))
            });
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