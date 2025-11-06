import {
    appState, db, auth,
    render, generateId,
    saveStateToFirestore,
    debouncedSaveState,
    AUTO_SAVE_INTERVAL
} from './app.js';

import { calcElapsedMinutes, getCurrentTime, showToast } from './utils.js';

// ✅ [신규] 출근 처리
export const processClockIn = (memberName) => {
    const now = getCurrentTime();
    if (!appState.dailyAttendance) appState.dailyAttendance = {};

    appState.dailyAttendance[memberName] = {
        ...appState.dailyAttendance[memberName],
        inTime: now,
        outTime: null,
        status: 'active' // 활동 중(출근 상태)
    };

    saveStateToFirestore();
    render();
    showToast(`${memberName}님 출근 처리되었습니다. (${now})`);
};

// ✅ [신규] 퇴근 처리
export const processClockOut = (memberName) => {
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

    appState.dailyAttendance[memberName].outTime = now;
    appState.dailyAttendance[memberName].status = 'returned'; // 퇴근(복귀) 상태

    saveStateToFirestore();
    render();
    showToast(`${memberName}님 퇴근 처리되었습니다. (${now})`);
    return true;
};


export const startWorkGroup = (members, task) => {
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
    const recordsToStop = (appState.workRecords || []).filter(r => String(r.groupId) === String(groupId) && (r.status === 'ongoing' || r.status === 'paused'));
    if (recordsToStop.length === 0) return;

    finalizeStopGroup(groupId, null);
};

export const finalizeStopGroup = (groupId, quantity) => {
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