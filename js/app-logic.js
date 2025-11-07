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