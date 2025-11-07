// === js/app-logic.js ===
import {
    appState, db, auth,
    render, generateId,
    saveStateToFirestore,
    debouncedSaveState,
    AUTO_SAVE_INTERVAL
} from './app.js';

import { calcElapsedMinutes, getCurrentTime, showToast } from './utils.js';

// ✅ [신규] 출근 처리 (관리자 대리 실행 가능)
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

    saveStateToFirestore();
    render();
    showToast(`${memberName}님 ${isAdminAction ? '관리자에 의해 ' : ''}출근 처리되었습니다. (${now})`);
    return true;
};

// ✅ [신규] 퇴근 처리 (관리자 대리 실행 가능)
export const processClockOut = (memberName, isAdminAction = false) => {
    // 진행 중인 업무가 있는지 확인
    const isWorking = (appState.workRecords || []).some(r =>
        r.member === memberName && (r.status === 'ongoing' || r.status === 'paused')
    );

    if (isWorking) {
        showToast(`${memberName}님은 현재 업무 진행 중이라 퇴근할 수 없습니다. 먼저 업무를 종료해주세요.`, true);
        return false;
    }

    const now = getCurrentTime();
    if (!appState.dailyAttendance) appState.dailyAttendance = {};

    // 기존 출근 기록이 없으면 출근 시간을 현재로 채워줌 (예외 처리)
    if (!appState.dailyAttendance[memberName]) {
         appState.dailyAttendance[memberName] = { inTime: now };
    }

    // 이미 퇴근 상태인지 확인
    if (appState.dailyAttendance[memberName].status === 'returned') {
         showToast(`${memberName}님은 이미 퇴근 처리되었습니다.`, true);
         return false;
    }

    appState.dailyAttendance[memberName].outTime = now;
    appState.dailyAttendance[memberName].status = 'returned'; // 퇴근(복귀) 상태

    saveStateToFirestore();
    render();
    showToast(`${memberName}님 ${isAdminAction ? '관리자에 의해 ' : ''}퇴근 처리되었습니다. (${now})`);
    return true;
};

// ✨ [신규] 퇴근 취소 처리 (퇴근 상태를 다시 출근 상태로 되돌림)
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

    // 상태 복구 (active로 변경하고 퇴근 시간 제거)
    appState.dailyAttendance[memberName] = {
        ...record,
        outTime: null,
        status: 'active'
    };

    saveStateToFirestore();
    render();
    showToast(`${memberName}님의 퇴근이 ${isAdminAction ? '관리자에 의해 ' : ''}취소되었습니다. (다시 근무 상태)`);
    return true;
};


export const startWorkGroup = (members, task) => {
    // ... (기존 코드와 동일)
    // ✅ [수정] 출근하지 않은 인원 체크
    const notClockedInMembers = members.filter(member =>
        !appState.dailyAttendance?.[member] || appState.dailyAttendance[member].status !== 'active'
    );

    if (notClockedInMembers.length > 0) {
        showToast(`아직 출근하지 않은 팀원이 있어 업무를 시작할 수 없습니다: ${notClockedInMembers.join(', ')}`, true);
        return;
    }

    const groupId = generateId();
    const startTime = getCurrentTime();
    const newRecords = members.map(member => ({
        id: generateId(),
        member,
        task,
        startTime,
        endTime: null,
        duration: null,
        status: 'ongoing',
        groupId,
        pauses: []
    }));
    appState.workRecords = appState.workRecords || [];
    appState.workRecords.push(...newRecords);
    render();
    saveStateToFirestore();
};

export const addMembersToWorkGroup = (members, task, groupId) => {
    // ... (기존 코드와 동일)
    // ✅ [수정] 출근하지 않은 인원 체크
    const notClockedInMembers = members.filter(member =>
        !appState.dailyAttendance?.[member] || appState.dailyAttendance[member].status !== 'active'
    );

    if (notClockedInMembers.length > 0) {
        showToast(`출근하지 않은 팀원은 추가할 수 없습니다: ${notClockedInMembers.join(', ')}`, true);
        return;
    }

    const startTime = getCurrentTime();
    const newRecords = members.map(member => ({
        id: generateId(),
        member,
        task,
        startTime,
        endTime: null,
        duration: null,
        status: 'ongoing',
        groupId,
        pauses: []
    }));
    appState.workRecords = appState.workRecords || [];
    appState.workRecords.push(...newRecords);
    render();
    saveStateToFirestore();
};

export const stopWorkGroup = (groupId) => {
    // ... (기존 코드 그대로 유지)
    const recordsToStop = (appState.workRecords || []).filter(r => String(r.groupId) === String(groupId) && (r.status === 'ongoing' || r.status === 'paused'));
    if (recordsToStop.length === 0) return;

    finalizeStopGroup(groupId, null);
};

export const finalizeStopGroup = (groupId, quantity) => {
    // ... (기존 코드 그대로 유지)
    const endTime = getCurrentTime();
    let taskName = '';
    let changed = false;
    (appState.workRecords || []).forEach(record => {
        if (String(record.groupId) === String(groupId) && (record.status === 'ongoing' || record.status === 'paused')) {
            taskName = record.task;
            if (record.status === 'paused') {
                const lastPause = record.pauses?.[record.pauses.length - 1];
                if (lastPause && lastPause.end === null) lastPause.end = endTime;
            }
            record.status = 'completed';
            record.endTime = endTime;
            record.duration = calcElapsedMinutes(record.startTime, endTime, record.pauses);
            changed = true;
        }
    });

    if (quantity !== null && taskName) {
        appState.taskQuantities = appState.taskQuantities || {};
        appState.taskQuantities[taskName] = (appState.taskQuantities[taskName] || 0) + (Number(quantity) || 0);
    }

    if (changed) {
        render();
        saveStateToFirestore();
    }
};

export const stopWorkIndividual = (recordId) => {
    // ... (기존 코드 그대로 유지)
    const endTime = getCurrentTime();
    const record = (appState.workRecords || []).find(r => String(r.id) === String(recordId));
    if (record && (record.status === 'ongoing' || record.status === 'paused')) {
        if (record.status === 'paused') {
            const lastPause = record.pauses?.[record.pauses.length - 1];
            if (lastPause && lastPause.end === null) lastPause.end = endTime;
        }
        record.status = 'completed';
        record.endTime = endTime;
        record.duration = calcElapsedMinutes(record.startTime, endTime, record.pauses);
        render();
        saveStateToFirestore();
        showToast(`${record.member}님의 ${record.task} 업무가 종료되었습니다.`);
    } else {
        showToast('이미 완료되었거나 찾을 수 없는 기록입니다.', true);
    }
};

export const pauseWorkGroup = (groupId) => {
    // ... (기존 코드 그대로 유지)
    const currentTime = getCurrentTime();
    let changed = false;
    (appState.workRecords || []).forEach(record => {
        if (String(record.groupId) === String(groupId) && record.status === 'ongoing') {
            record.status = 'paused';
            record.pauses = record.pauses || [];
            record.pauses.push({ start: currentTime, end: null, type: 'break' });
            changed = true;
        }
    });
    if (changed) {
        render();
        saveStateToFirestore();
        showToast('그룹 업무가 일시정지 되었습니다.');
    }
};

export const resumeWorkGroup = (groupId) => {
    // ... (기존 코드 그대로 유지)
    const currentTime = getCurrentTime();
    let changed = false;
    (appState.workRecords || []).forEach(record => {
        if (String(record.groupId) === String(groupId) && record.status === 'paused') {
            record.status = 'ongoing';
            const lastPause = record.pauses?.[record.pauses.length - 1];
            if (lastPause && lastPause.end === null) lastPause.end = currentTime;
            changed = true;
        }
    });
    if (changed) {
        render();
        saveStateToFirestore();
        showToast('그룹 업무를 다시 시작합니다.');
    }
};

export const pauseWorkIndividual = (recordId) => {
    // ... (기존 코드 그대로 유지)
    const currentTime = getCurrentTime();
    const record = (appState.workRecords || []).find(r => String(r.id) === String(recordId));
    if (record && record.status === 'ongoing') {
        record.status = 'paused';
        record.pauses = record.pauses || [];
        record.pauses.push({ start: currentTime, end: null, type: 'break' });
        render();
        saveStateToFirestore();
        showToast(`${record.member}님 ${record.task} 업무 일시정지.`);
    }
};

export const resumeWorkIndividual = (recordId) => {
    // ... (기존 코드 그대로 유지)
    const currentTime = getCurrentTime();
    const record = (appState.workRecords || []).find(r => String(r.id) === String(recordId));
    if (record && record.status === 'paused') {
        record.status = 'ongoing';
        const lastPause = record.pauses?.[record.pauses.length - 1];
        if (lastPause && lastPause.end === null) {
            lastPause.end = currentTime;
        }
        render();
        saveStateToFirestore();
        showToast(`${record.member}님 ${record.task} 업무 재개.`);
    }
};