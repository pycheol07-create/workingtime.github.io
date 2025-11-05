// === app-logic.js (업무 제어 로직) ===

import { appState, render, debouncedSaveState, generateId } from './app.js';
import { getCurrentTime, calcElapsedMinutes, showToast } from './utils.js';

/**
 * 새 업무 그룹 시작
 */
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

/**
 * 기존 업무 그룹에 멤버 추가
 */
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

/**
 * 업무 그룹 중지 요청 (수량 입력 전)
 */
export const stopWorkGroup = (groupId) => {
    finalizeStopGroup(groupId, null);
};

/**
 * 업무 그룹 최종 종료 처리
 */
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

/**
 * 개인 업무 종료
 */
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

/**
 * 그룹 업무 일시정지
 */
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

/**
 * 그룹 업무 재개
 */
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

/**
 * 개인 업무 일시정지
 */
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

/**
 * 개인 업무 재개
 */
export const resumeWorkIndividual = (recordId) => {
    const currentTime = getCurrentTime();
    const record = (appState.workRecords || []).find(r => String(r.id) === String(recordId));
    if (record && record.status === 'paused') {
        record.status = 'ongoing';
        const lastPause = record.pauses?.[record.pauses.length - 1];
        if (lastPause && lastPause.end === null) lastPause.end = currentTime;
        render();
        debouncedSaveState();
        showToast(`${record.member}님 ${record.task} 업무 재개.`);
    }
};