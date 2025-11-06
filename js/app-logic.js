import {
    appState, db, auth,
    render, generateId,
    saveStateToFirestore, // 진짜 저장 함수
    debouncedSaveState,   // 덜 중요한 저장용 (필요시)
    AUTO_SAVE_INTERVAL
} from './app.js';

import { calcElapsedMinutes, getCurrentTime, showToast } from './utils.js';

// 업무 시작/종료 등 중요한 액션은 즉시 저장하여 데이터 충돌 최소화

export const startWorkGroup = (members, task) => {
    const groupId = generateId(); // 문자열 기반의 더 안전한 ID 사용
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
    saveStateToFirestore(); // ✅ 즉시 저장
};

export const addMembersToWorkGroup = (members, task, groupId) => {
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
    saveStateToFirestore(); // ✅ 즉시 저장
};

export const stopWorkGroup = (groupId) => {
    // groupId 비교 시 타입 불일치 방지를 위해 문자열로 변환하여 비교
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
        saveStateToFirestore(); // ✅ 즉시 저장
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
        saveStateToFirestore(); // ✅ 즉시 저장
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
        saveStateToFirestore(); // ✅ 즉시 저장
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
        saveStateToFirestore(); // ✅ 즉시 저장
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
        saveStateToFirestore(); // ✅ 즉시 저장
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
        saveStateToFirestore(); // ✅ 즉시 저장
        showToast(`${record.member}님 ${record.task} 업무 재개.`);
    }
};

// ✨ [신규] 출근 처리 함수
export const clockIn = (memberName) => {
    const now = getCurrentTime();
    if (!appState.commuteRecords) appState.commuteRecords = {};
    
    // 기존 출근 기록이 있으면 inTime 유지 (관리자 강제 출근 시에는 덮어쓸 수도 있지만, 일단 안전하게 유지하거나 덮어쓰기 정책 결정 필요. 여기선 강제 출근의 의미로 덮어씀)
    // 만약 유지하고 싶다면: if (!appState.commuteRecords[memberName]?.inTime) ...
    
    appState.commuteRecords[memberName] = {
        status: 'in',
        inTime: now,
        outTime: null
    };
    
    saveStateToFirestore();
    render();
    showToast(`${memberName}님 출근 처리되었습니다.`);
};

// ✨ [신규] 퇴근 처리 함수
export const clockOut = (memberName) => {
    const now = getCurrentTime();
    if (!appState.commuteRecords || !appState.commuteRecords[memberName]) {
        // 출근 기록이 없으면 새로 생성해서 퇴근 처리 (예외 상황 대비)
        appState.commuteRecords = appState.commuteRecords || {};
        appState.commuteRecords[memberName] = { status: 'in', inTime: null, outTime: null };
    }

    // ⛔️ 진행 중인 업무가 있는지 확인
    const hasOngoingWork = (appState.workRecords || []).some(r => r.member === memberName && r.status !== 'completed');
    if (hasOngoingWork) {
        showToast(`${memberName}님의 진행 중인 업무를 먼저 종료해주세요.`, true);
        return;
    }

    appState.commuteRecords[memberName].status = 'out';
    appState.commuteRecords[memberName].outTime = now;

    saveStateToFirestore();
    render();
    showToast(`${memberName}님 퇴근 처리되었습니다.`);
};

// ✨ [추가] 퇴근 취소 함수
export const cancelClockOut = (memberName) => {
    if (!appState.commuteRecords || !appState.commuteRecords[memberName]) {
         showToast(`${memberName}님의 출퇴근 기록이 없습니다.`, true);
         return;
    }

    if (appState.commuteRecords[memberName].status !== 'out') {
        showToast(`${memberName}님은 현재 퇴근 상태가 아닙니다.`, true);
        return;
    }

    // 상태를 'in'으로 되돌리고, 퇴근 시간만 지움 (원래 출근 시간은 유지됨)
    appState.commuteRecords[memberName].status = 'in';
    appState.commuteRecords[memberName].outTime = null;

    saveStateToFirestore();
    render();
    showToast(`${memberName}님의 퇴근이 취소되었습니다. (다시 근무 상태)`);
};