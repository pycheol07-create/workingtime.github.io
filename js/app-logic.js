// === app-logic.js (수정된 import) ===

// app.js에서 핵심 상태, DB, 헬퍼 함수들을 가져옵니다.
import { 
    appState, db, auth, 
    render, generateId, 
    AUTO_SAVE_INTERVAL 
} from './app.js'; 

// utils.js에서 헬퍼 함수들을 가져옵니다.
import { debounce, calcElapsedMinutes, getCurrentTime, showToast } from './utils.js';

// ✅ [추가] Firebase Firestore의 doc 함수를 가져옵니다.
import { doc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ========== Firestore 저장 ==========

/**
 * 변경 사항이 있음을 표시합니다.
 * (autoSaveProgress가 이 플래그를 확인합니다.)
 */
export const markDataAsDirty = () => {
    // app.js에 있는 isDataDirty 변수에 접근해야 합니다.
    // 하지만 모듈 스코프 때문에 직접 접근은 어렵습니다.
    // -> 이 함수는 app.js에 남겨두는 것이 낫겠습니다. 
    // -> [수정] app.js가 이 함수를 export 하도록 하고, autoSaveProgress가 호출하도록 합니다.
    // -> [재수정] autoSaveProgress가 app.js에 있는 isDataDirty를 직접 확인해야 합니다.
    //    이 구조는 파일 분리를 매우 어렵게 만듭니다.
    
    // [가장 현실적인 구조]
    // app.js가 isDataDirty 변수를 export 하고,
    // autoSaveProgress가 app.js의 saveProgress(true)를 호출하도록 합니다.
    // markDataAsDirty는 app.js에 남깁니다.
    
    // [가장 단순한 구조]
    // app.js가 필요한 모든 것을(isDataDirty 포함) export 하도록 만듭니다.
    // 이 파일에서는 app.js에서 isDataDirty를 import 해왔다고 가정합니다.
    // (app.js 수정 시 export let isDataDirty = false; 로 변경 필요)
};


/**
 * Firestore에 현재 상태를 저장합니다. (app.js에서 가져옴)
 * @param {boolean} [isAutoSave=false] - 자동 저장 모드 여부
 */
async function saveProgress(isAutoSave = false) {
    // 이 함수는 app-history.js로 이동하는 것이 더 적절합니다.
    // 여기서는 Firestore에 *오늘의 실시간 상태*를 저장하는 함수만 남깁니다.
}

/**
 * 현재 appState를 Firestore 'daily_data'에 저장합니다.
 */
export async function saveStateToFirestore() {
  if (!auth || !auth.currentUser) {
    console.warn('Cannot save state: User not authenticated.');
    return;
  }
  try {
    const docRef = doc(db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString()); // getTodayDateString은 app.js에서 export 필요

    const stateToSave = JSON.stringify({
      workRecords: appState.workRecords || [],
      taskQuantities: appState.taskQuantities || {},
      onLeaveMembers: appState.dailyOnLeaveMembers || [],
      partTimers: appState.partTimers || [],
      hiddenGroupIds: appState.hiddenGroupIds || [],
      lunchPauseExecuted: appState.lunchPauseExecuted || false,
      lunchResumeExecuted: appState.lunchResumeExecuted || false
    }, (k, v) => (typeof v === 'function' ? undefined : v));

    if (stateToSave.length > 900000) {
      showToast('저장 데이터가 큽니다. 오래된 기록을 이력으로 옮기거나 정리하세요.', true);
      return;
    }

    await setDoc(docRef, { state: stateToSave });
    
    // markDataAsDirty() 호출 (app.js에서 export 필요)
    // app.js의 markDataAsDirty()를 직접 호출합니다.
    
  } catch (error) {
    console.error('Error saving state to Firestore:', error);
    showToast('데이터 동기화 중 오류 발생.', true);
  }
}

/**
 * 1초 딜레이 후 Firestore 저장을 실행하는 디바운스 함수입니다.
 */
export const debouncedSaveState = debounce(saveStateToFirestore, 1000);


// ========== 업무 그룹/개인 제어 ==========

/**
 * 새 업무 그룹을 시작합니다.
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
 * 기존 업무 그룹에 멤버를 추가합니다.
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
 * 업무 그룹을 중지합니다. (수량 입력 전 단계)
 */
export const stopWorkGroup = (groupId) => {
  const recordsToStop = (appState.workRecords || []).filter(r => r.groupId == groupId && (r.status === 'ongoing' || r.status === 'paused'));
  if (recordsToStop.length === 0) return;
  // finalizeStopGroup는 리스너에서 직접 호출됩니다.
  // 여기서는 수량 입력 모달을 띄우는 로직이 필요합니다.
  // 이 함수는 app-listeners.js에서 직접 처리하는 것이 낫겠습니다.
  
  // [수정] 이 함수는 finalizeStopGroup을 호출하는 것으로 변경합니다.
  // (app.js의 기존 stopWorkGroup 로직)
  finalizeStopGroup(groupId, null);
};

/**
 * 업무 그룹을 최종적으로 중지하고 완료 처리합니다.
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
  
  // 모달 닫기 및 ID 초기화는 app-listeners.js에서 처리
  // if (quantityOnStopModal) quantityOnStopModal.classList.add('hidden');
  // groupToStopId = null;
};

/**
 * 개인 업무를 중지하고 완료 처리합니다.
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
 * 그룹 업무를 일시정지합니다.
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
 * 그룹 업무를 재개합니다.
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
 * 개인 업무를 일시정지합니다.
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
 * 개인 업무를 재개합니다.
 */
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