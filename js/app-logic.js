import {
    appState, db, auth,
    render, generateId,
    saveStateToFirestore, // ✅ [추가] 진짜 저장 함수 가져오기
    markDataAsDirty,      // ✅ [추가] 진짜 데이터 변경 플래그 함수 가져오기
    AUTO_SAVE_INTERVAL
} from './app.js';

import { debounce, calcElapsedMinutes, getCurrentTime, showToast, getTodayDateString } from './utils.js';

import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ⛔️ [삭제] 중복되고 비어있던 가짜 함수들 제거
// export const markDataAsDirty = () => { };
// async function saveProgress(isAutoSave = false) { }
// export async function saveStateToFirestore() { ... }

// ✅ [수정] app.js에서 가져온 진짜 saveStateToFirestore를 사용하도록 연결
export const debouncedSaveState = debounce(saveStateToFirestore, 1000);

export const startWorkGroup = (members, task) => {
    const groupId = Date.now();
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
    debouncedSaveState();
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
    debouncedSaveState();
};

export const stopWorkGroup = (groupId) => {
    const recordsToStop = (appState.workRecords || []).filter(r => r.groupId == groupId && (r.status === 'ongoing' || r.status === 'paused'));
    if (recordsToStop.length === 0) return;

    finalizeStopGroup(groupId, null);
};

export const finalizeStopGroup = (groupId, quantity) => {
    const endTime = getCurrentTime();
    let taskName = '';
    let changed = false;
    (appState.workRecords || []).forEach(record => {
        if (record.groupId == groupId && (record.status === 'ongoing' || record.status === 'paused')) {
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
        debouncedSaveState();
    }
};

export const stopWorkIndividual = (recordId) => {
    const endTime = getCurrentTime();
    const record = (appState.workRecords || []).find(r => r.id === recordId);
    if (record && (record.status === 'ongoing' || record.status === 'paused')) {
        if (record.status === 'paused') {
            const lastPause = record.pauses?.[record.pauses.length - 1];
            if (lastPause && lastPause.end === null) lastPause.end = endTime;
        }
        record.status = 'completed';
        record.endTime = endTime;
        record.duration = calcElapsedMinutes(record.startTime, endTime, record.pauses);
        render();
        debouncedSaveState();
        showToast(`${record.member}님의 ${record.task} 업무가 종료되었습니다.`);
    } else {
        showToast('이미 완료되었거나 찾을 수 없는 기록입니다.', true);
    }
};

export const pauseWorkGroup = (groupId) => {
    const currentTime = getCurrentTime();
    let changed = false;
    (appState.workRecords || []).forEach(record => {
        if (record.groupId == groupId && record.status === 'ongoing') {
            record.status = 'paused';
            record.pauses = record.pauses || [];
            record.pauses.push({ start: currentTime, end: null, type: 'break' });
            changed = true;
        }
    });
    if (changed) {
        render();
        debouncedSaveState();
        showToast('그룹 업무가 일시정지 되었습니다.');
    }
};

export const resumeWorkGroup = (groupId) => {
    const currentTime = getCurrentTime();
    let changed = false;
    (appState.workRecords || []).forEach(record => {
        if (record.groupId == groupId && record.status === 'paused') {
            record.status = 'ongoing';
            const lastPause = record.pauses?.[record.pauses.length - 1];
            if (lastPause && lastPause.end === null) lastPause.end = currentTime;
            changed = true;
        }
    });
    if (changed) {
        render();
        debouncedSaveState();
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
        debouncedSaveState();
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
        debouncedSaveState();
        showToast(`${record.member}님 ${record.task} 업무 재개.`);
    }
};