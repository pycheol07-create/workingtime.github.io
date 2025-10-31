// === js/actions.js ===

import { appState, persistentLeaveSchedule, appConfig, setAppConfig, setPersistentLeaveSchedule, setAppState } from './store.js';
import { debouncedSaveState, saveLeaveSchedule, saveProgress, saveStateToFirestore } from './api.js';
import { showToast, getCurrentTime, calcElapsedMinutes, generateId, getTodayDateString } from './utils.js';
import { render } from './ui/index.js'; // 전체 UI 갱신을 위해

// --- 1. 업무 그룹/개인 제어 (app.js에서 이동) ---

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
  
  // (처리량 입력 로직은 listeners.js에서 처리하고,
  // 여기서는 순수하게 종료만 하거나, finalize를 호출)
  // 여기서는 app.js의 기존 로직대로 finalizeStopGroup을 호출
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
  
  // (모달 닫기 및 컨텍스트 초기화는 listeners.js에서 수행)
  // if (quantityOnStopModal) quantityOnStopModal.classList.add('hidden');
  // groupToStopId = null;
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

// --- 2. 마감 및 초기화 (app.js에서 이동) ---

/**
 * 업무 마감 또는 앱 초기화를 수행합니다.
 * (app.js의 saveDayDataToHistory에서 이동)
 * @param {boolean} shouldReset - true면 수량, 알바, 근태 등 모두 초기화
 */
export async function saveDayDataToHistory(shouldReset) {
  // 1. 진행 중인 업무 완료 처리
  const ongoingRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused');
  if (ongoingRecords.length > 0) {
    const endTime = getCurrentTime();
    ongoingRecords.forEach(rec => {
      if (rec.status === 'paused') {
        const lastPause = rec.pauses?.[rec.pauses.length - 1];
        if (lastPause && lastPause.end === null) lastPause.end = endTime;
      }
      rec.status = 'completed';
      rec.endTime = endTime;
      rec.duration = calcElapsedMinutes(rec.startTime, endTime, rec.pauses);
    });
  }

  // 2. 'history' 문서에 저장 (api.js 호출)
  await saveProgress(false); // 수동 저장(false)으로 호출

  // 3. 실시간 상태(appState) 초기화 - '업무 기록'은 항상 비움
  appState.workRecords = [];
  
  // 4. '초기화'(Reset)일 때만 추가 초기화
  if (shouldReset) {
      Object.keys(appState.taskQuantities || {}).forEach(task => { appState.taskQuantities[task] = 0; });
      appState.partTimers = [];
      appState.hiddenGroupIds = [];

      // 17:30 룰 적용 (조퇴 기록)
      const now = getCurrentTime();
      if (now < "17:30") {
          appState.dailyOnLeaveMembers = (appState.dailyOnLeaveMembers || []).filter(entry => entry.type === '조퇴');
      } else {
          appState.dailyOnLeaveMembers = [];
      }
      
      showToast('오늘의 업무 기록을 초기화했습니다.');
  } 
  
  // 5. 변경된 실시간 상태(appState)를 Firestore('daily_data')에 즉시 저장
  await saveStateToFirestore(); // api.js 호출 (debounce 아님)
  render();
}

// --- 3. 근태 관리 (app.js 리스너에서 분리) ---

/**
 * 근태 설정 (외출, 조퇴, 연차 등)
 */
export async function handleLeaveRequest(memberName, leaveType, startDate, endDate) {
    const leaveData = { member: memberName, type: leaveType };

    if (leaveType === '외출' || leaveType === '조퇴') {
        leaveData.startTime = getCurrentTime();
        if (leaveType === '조퇴') leaveData.endTime = "17:30"; // 조퇴는 17:30 자동 복귀 (가정)

        appState.dailyOnLeaveMembers = appState.dailyOnLeaveMembers.filter(item => item.member !== memberName);
        appState.dailyOnLeaveMembers.push(leaveData);
        debouncedSaveState(); // api.js 호출

    } else if (leaveType === '연차' || leaveType === '출장' || leaveType === '결근') {
        leaveData.startDate = startDate;
        if (endDate) {
            leaveData.endDate = endDate;
        }

        persistentLeaveSchedule.onLeaveMembers = persistentLeaveSchedule.onLeaveMembers.filter(item => item.member !== memberName);
        persistentLeaveSchedule.onLeaveMembers.push(leaveData);
        await saveLeaveSchedule(persistentLeaveSchedule); // api.js 호출
    }

    showToast(`${memberName}님을 '${leaveType}'(으)로 설정했습니다.`);
}

/**
 * 근태 복귀/취소 처리
 */
export async function handleCancelLeave(memberName) {
    const todayDateString = getTodayDateString();
    let actionTaken = false;

    // 1. Daily 근태 (외출, 조퇴) 복귀/취소
    const dailyIndex = appState.dailyOnLeaveMembers.findIndex(item => item.member === memberName);
    if (dailyIndex > -1) {
        const entry = appState.dailyOnLeaveMembers[dailyIndex];

        if (entry.type === '외출') {
            entry.endTime = getCurrentTime(); // '외출'만 복귀 시간 기록
            showToast(`${memberName}님이 복귀 처리되었습니다.`);
            actionTaken = true;
        } else {
            // '조퇴' 등은 삭제(취소)
            appState.dailyOnLeaveMembers.splice(dailyIndex, 1);
            showToast(`${memberName}님의 '${entry.type}' 상태가 취소되었습니다.`);
            actionTaken = true;
        }
        debouncedSaveState(); // api.js 호출
    }

    // 2. Persistent 근태 (연차, 출장 등) 복귀/취소
    const persistentIndex = persistentLeaveSchedule.onLeaveMembers.findIndex(item => item.member === memberName);
    if (persistentIndex > -1) {
        const entry = persistentLeaveSchedule.onLeaveMembers[persistentIndex];
        const isLeaveActiveToday = entry.startDate <= todayDateString && (!entry.endDate || todayDateString <= entry.endDate);

        if (isLeaveActiveToday) {
            // 오늘이 휴무일인 경우 -> 어제 날짜로 종료일 변경
            const today = new Date();
            today.setDate(today.getDate() - 1);
            const yesterday = today.toISOString().split('T')[0];
            if (yesterday < entry.startDate) {
                // 시작일이 오늘/내일이었으면 그냥 삭제
                persistentLeaveSchedule.onLeaveMembers.splice(persistentIndex, 1);
                showToast(`${memberName}님의 '${entry.type}' 일정이 취소되었습니다.`);
            } else {
                // 시작일이 과거였으면 어제까지로 수정
                entry.endDate = yesterday;
                showToast(`${memberName}님이 복귀 처리되었습니다. (${entry.type}이 ${yesterday}까지로 수정됨)`);
            }
        } else {
            // 미래의 휴무일정 -> 그냥 삭제
            persistentLeaveSchedule.onLeaveMembers.splice(persistentIndex, 1);
            showToast(`${memberName}님의 '${entry.type}' 일정이 취소되었습니다.`);
        }
        await saveLeaveSchedule(persistentLeaveSchedule); // api.js 호출
        actionTaken = true;
    }

    if (!actionTaken) {
         showToast(`${memberName}님의 근태 정보를 찾을 수 없습니다.`, true);
    }
}