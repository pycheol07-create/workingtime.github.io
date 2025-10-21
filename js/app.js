// === 물류팀 업무현황 app.js — 전체 통합 리팩토링 (안정성 + 기존 기능 완전 포함) ===
// ver.2.1 (Admin Page + Firestore Config)
// 변경 요약:
// - config.js의 정적 데이터를 Firestore에서 비동기 로드로 변경
// - main() 함수를 async로 변경하여 설정 로드 후 앱 실행
// - ui.js 함수들에 config 데이터를 파라미터로 전달하도록 수정
// - APP_ID를 config.js와 공유 (config.js에서 관리)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, onSnapshot, collection, getDocs, deleteDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
// [수정] config.js 임포트 변경
import { initializeFirebase, loadConfiguration } from './config.js';
import { showToast, getTodayDateString, displayCurrentDate, getCurrentTime, formatDuration, formatTimeTo24H, getWeekOfYear, isWeekday } from './utils.js';
import {
  renderRealtimeStatus,
  renderCompletedWorkLog,
  updateSummary,
  renderTaskAnalysis,
  renderTaskSelectionModal,
  renderTeamSelectionModalContent,
  renderQuantityModalInputs
} from './ui.js';

// ========== DOM Elements ==========
const connectionStatusEl = document.getElementById('connection-status');
const statusDotEl = document.getElementById('status-dot');
const teamStatusBoard = document.getElementById('team-status-board');
const workLogBody = document.getElementById('work-log-body');

// Modals & Buttons
const teamSelectModal = document.getElementById('team-select-modal');
const deleteConfirmModal = document.getElementById('delete-confirm-modal');
const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
const cancelDeleteBtn = document.getElementById('cancel-delete-btn');
const historyModal = document.getElementById('history-modal');
const openHistoryBtn = document.getElementById('open-history-btn');
const closeHistoryBtn = document.getElementById('close-history-btn');
const historyDateList = document.getElementById('history-date-list');
const historyViewContainer = document.getElementById('history-view-container');
const historyTabs = document.getElementById('history-tabs');
const quantityModal = document.getElementById('quantity-modal');
const confirmQuantityBtn = document.getElementById('confirm-quantity-btn');
const cancelQuantityBtn = document.getElementById('cancel-quantity-btn');
const deleteHistoryModal = document.getElementById('delete-history-modal');
const confirmHistoryDeleteBtn = document.getElementById('confirm-history-delete-btn');
const cancelHistoryDeleteBtn = document.getElementById('cancel-history-delete-btn');
const deleteAllCompletedBtn = document.getElementById('delete-all-completed-btn');
const editRecordModal = document.getElementById('edit-record-modal');
const confirmEditBtn = document.getElementById('confirm-edit-btn');
const cancelEditBtn = document.getElementById('cancel-edit-btn');
const saveProgressBtn = document.getElementById('save-progress-btn');
const quantityOnStopModal = document.getElementById('quantity-on-stop-modal');
const confirmQuantityOnStopBtn = document.getElementById('confirm-quantity-on-stop');
const cancelQuantityOnStopBtn = document.getElementById('cancel-quantity-on-stop');
const endShiftBtn = document.getElementById('end-shift-btn');
const resetAppBtn = document.getElementById('reset-app-btn');
const resetAppModal = document.getElementById('reset-app-modal');
const confirmResetAppBtn = document.getElementById('confirm-reset-app-btn');
const cancelResetAppBtn = document.getElementById('cancel-reset-app-btn');
const taskSelectModal = document.getElementById('task-select-modal');
const stopIndividualConfirmModal = document.getElementById('stop-individual-confirm-modal');
const confirmStopIndividualBtn = document.getElementById('confirm-stop-individual-btn');
const cancelStopIndividualBtn = document.getElementById('cancel-stop-individual-btn');
const stopIndividualConfirmMessage = document.getElementById('stop-individual-confirm-message');
const editPartTimerModal = document.getElementById('edit-part-timer-modal');
const confirmEditPartTimerBtn = document.getElementById('confirm-edit-part-timer-btn');
const cancelEditPartTimerBtn = document.getElementById('cancel-edit-part-timer-btn');
const partTimerNewNameInput = document.getElementById('part-timer-new-name');
const partTimerEditIdInput = document.getElementById('part-timer-edit-id');
const cancelTeamSelectBtn = document.getElementById('cancel-team-select-btn');

// Toggles
const toggleCompletedLog = document.getElementById('toggle-completed-log');
const toggleAnalysis = document.getElementById('toggle-analysis');
const toggleSummary = document.getElementById('toggle-summary');

// ========== Firebase/App State ==========
let db, auth;
let unsubscribeToday;
let elapsedTimeTimer = null;
let recordCounter = 0;
// [수정] APP_ID는 config.js에서 관리 (여기서는 제거)
// const APP_ID = 'team-work-logger-v2';

let appState = {
  workRecords: [],
  taskQuantities: {},
  onLeaveMembers: [],
  partTimers: [],
  hiddenGroupIds: []
};
// [수정] appConfig는 main()에서 Firestore로부터 채워짐
let appConfig = {
    teamGroups: [],
    memberWages: {},
    taskGroups: {},
    quantityTaskTypes: []
};
let selectedTaskForStart = null;
let selectedGroupForAdd = null;
let recordToDeleteId = null;
let recordToStopId = null;
let historyKeyToDelete = null;
let allHistoryData = [];
let recordToEditId = null;
let deleteMode = 'single';
let groupToStopId = null;
let quantityModalContext = { mode: 'today', dateKey: null, onConfirm: null, onCancel: null };
let tempSelectedMembers = [];

// ========== Helpers ==========
const generateId = () => `${Date.now()}-${++recordCounter}`;
const normalizeName = (s='') => s.normalize('NFC').trim().toLowerCase();

const calcElapsedMinutes = (start, end, pauses = []) => {
  if (!start || !end) return 0;
  const s = new Date(`1970-01-01T${start}:00Z`).getTime();
  const e = new Date(`1970-01-01T${end}:00Z`).getTime();
  let total = Math.max(0, e - s);
  (pauses || []).forEach(p => {
    if (p.start && p.end) {
      const ps = new Date(`1970-01-01T${p.start}:00Z`).getTime();
      const pe = new Date(`1970-01-01T${p.end}:00Z`).getTime();
      if (pe > ps) total -= (pe - ps);
    }
  });
  return Math.max(0, total / 60000);
};

// ========== 타이머 ==========
const updateElapsedTimes = () => {
  const now = getCurrentTime();
  document.querySelectorAll('.ongoing-duration').forEach(el => {
    try {
      if (!el?.dataset?.startTime) return;
      const rec = (appState.workRecords || []).find(r => String(r.id) === el.dataset.recordId);
      if (!rec) return;
      const dur = calcElapsedMinutes(el.dataset.startTime, now, rec.pauses);
      el.textContent = `(진행: ${formatDuration(dur)})`;
    } catch { /* noop */ }
  });

  // [수정] 현황판 '업무진행시간'을 실시간(완료 + 진행중)으로 표시
  
  // 1. 완료된 업무 시간 합계
  const completedRecords = (appState.workRecords || []).filter(r => r.status === 'completed');
  const totalCompletedMinutes = completedRecords.reduce((sum, r) => sum + (r.duration || 0), 0);
  
  // 2. 현재 '업무중'인 업무들의 실시간 시간 계산
  const ongoingLiveRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing');
  let totalOngoingMinutes = 0;
  ongoingLiveRecords.forEach(rec => {
      totalOngoingMinutes += calcElapsedMinutes(rec.startTime, now, rec.pauses);
  });

  // 3. DOM 업데이트 (완료 + 진행중)
  const el = document.getElementById('summary-total-work-time');
  if (el) el.textContent = formatDuration(totalCompletedMinutes + totalOngoingMinutes);
};

// ========== 렌더 ==========
const render = () => {
  try {
    // [수정] config 데이터를 파라미터로 전달
    renderRealtimeStatus(appState, appConfig.teamGroups);
    renderCompletedWorkLog(appState);
    updateSummary(appState, appConfig.teamGroups);
    renderTaskAnalysis(appState);
  } catch (e) {
    console.error('Render error:', e);
    showToast('화면 렌더링 오류 발생.', true);
  }
};

// ========== Firestore 저장 ==========
async function saveStateToFirestore() {
  if (!auth || !auth.currentUser) {
    console.warn('Cannot save state: User not authenticated.');
    return;
  }
  try {
    const docRef = doc(db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString());
    const stateToSave = JSON.stringify({
      workRecords: appState.workRecords || [],
      taskQuantities: appState.taskQuantities || {},
      onLeaveMembers: appState.onLeaveMembers || [],
      partTimers: appState.partTimers || [],
      hiddenGroupIds: appState.hiddenGroupIds || []
    }, (k, v) => (typeof v === 'function' ? undefined : v));

    if (stateToSave.length > 900000) {
      showToast('저장 데이터가 큽니다. 오래된 기록을 이력으로 옮기거나 정리하세요.', true);
      return;
    }

    await setDoc(docRef, { state: stateToSave });
  } catch (error) {
    console.error('Error saving state to Firestore:', error);
    showToast('데이터 동기화 중 오류 발생.', true);
  }
}

// ========== 업무 그룹 제어 ==========
const startWorkGroup = (members, task) => {
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
  saveStateToFirestore();
};

const addMembersToWorkGroup = (members, task, groupId) => {
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
  saveStateToFirestore();
};

const stopWorkGroup = (groupId) => {
  const recordsToStop = (appState.workRecords || []).filter(r => r.groupId === groupId && (r.status === 'ongoing' || r.status === 'paused'));
  if (recordsToStop.length === 0) return;
  finalizeStopGroup(groupId, null);
};

const finalizeStopGroup = (groupId, quantity) => {
  const endTime = getCurrentTime();
  let taskName = '';
  let changed = false;
  (appState.workRecords || []).forEach(record => {
    if (record.groupId === groupId && (record.status === 'ongoing' || record.status === 'paused')) {
      taskName = record.task;
      // 일시정지 종료 보정
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

  if (changed) saveStateToFirestore();
  if (quantityOnStopModal) quantityOnStopModal.classList.add('hidden');
  groupToStopId = null;
};

const stopWorkIndividual = (recordId) => {
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
    saveStateToFirestore();
    showToast(`${record.member}님의 ${record.task} 업무가 종료되었습니다.`);
  } else {
    showToast('이미 완료되었거나 찾을 수 없는 기록입니다.', true);
  }
};

const pauseWorkGroup = (groupId) => {
  const currentTime = getCurrentTime();
  let changed = false;
  (appState.workRecords || []).forEach(record => {
    if (record.groupId === groupId && record.status === 'ongoing') {
      record.status = 'paused';
      record.pauses = record.pauses || [];
      record.pauses.push({ start: currentTime, end: null });
      changed = true;
    }
  });
  if (changed) { saveStateToFirestore(); showToast('업무가 일시정지 되었습니다.'); }
};

const resumeWorkGroup = (groupId) => {
  const currentTime = getCurrentTime();
  let changed = false;
  (appState.workRecords || []).forEach(record => {
    if (record.groupId === groupId && record.status === 'paused') {
      record.status = 'ongoing';
      const lastPause = record.pauses?.[record.pauses.length - 1];
      if (lastPause && lastPause.end === null) lastPause.end = currentTime;
      changed = true;
    }
  });
  if (changed) { saveStateToFirestore(); showToast('업무를 다시 시작합니다.'); }
};

// ========== 저장/이력 ==========
async function saveProgress() {
  const dateStr = getTodayDateString();
  showToast('현재까지 완료된 기록을 저장합니다...');
  const historyDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'history', dateStr);
  try {
    const docSnap = await getDoc(historyDocRef);
    const existingData = docSnap.exists() ? (docSnap.data() || { workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [] }) : { workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [] };
    const completedRecordsFromState = (appState.workRecords || []).filter(r => r.status === 'completed');

    const currentQuantities = {};
    for (const task in (appState.taskQuantities || {})) {
      const q = Number(appState.taskQuantities[task]);
      if (!Number.isNaN(q) && q > 0) currentQuantities[task] = q;
    }

    if (completedRecordsFromState.length === 0 && Object.keys(currentQuantities).length === 0) {
      return showToast('저장할 새로운 완료 기록이나 처리량이 없습니다.', true);
    }

    const combinedRecords = [...(existingData.workRecords || []), ...completedRecordsFromState];
    const uniqueRecords = Array.from(new Map(combinedRecords.map(item => [item.id, item])).values());

    const finalQuantities = { ...(existingData.taskQuantities || {}) };
    for (const task in currentQuantities) {
      finalQuantities[task] = (Number(finalQuantities[task]) || 0) + Number(currentQuantities[task]);
    }

    const dataToSave = {
      workRecords: uniqueRecords,
      taskQuantities: finalQuantities,
      onLeaveMembers: appState.onLeaveMembers || [],
      partTimers: appState.partTimers || []
    };

    await setDoc(historyDocRef, dataToSave);

    // [수정] 중간 저장 시 현재 상태(완료 리스트)를 초기화하는 로직 제거
    // appState.workRecords = (appState.workRecords || []).filter(r => r.status !== 'completed');
    // Object.keys(appState.taskQuantities || {}).forEach(task => { appState.taskQuantities[task] = 0; });
    // await saveStateToFirestore();
    showToast('현재까지의 기록이 성공적으로 저장되었습니다.');
    // render();
  } catch (e) {
    console.error('Error in saveProgress: ', e);
    showToast(`중간 저장 중 오류가 발생했습니다: ${e.message}`, true);
  }
}

async function saveDayDataToHistory(shouldReset) {
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
    await saveStateToFirestore();
  }

  await saveProgress(); // <-- 이제 이 함수는 저장만 하고, 현재 상태를 초기화하지 않음

  // [수정] '업무 마감' 시에만 리스트를 초기화하도록 로직을 이관
  appState.workRecords = (appState.workRecords || []).filter(r => r.status !== 'completed');
  Object.keys(appState.taskQuantities || {}).forEach(task => { appState.taskQuantities[task] = 0; });

  if (shouldReset) {
    appState.hiddenGroupIds = [];
    appState.onLeaveMembers = [];
    await saveStateToFirestore(); // <-- 여기서 초기화된 상태(빈 리스트)를 저장
    showToast('오늘의 업무 기록을 초기화했습니다.');
    render(); // <-- 초기화된 리스트를 화면에 렌더링
  }
}

// ========== 이력 보기 ==========
async function fetchAllHistoryData() {
  const historyCollectionRef = collection(db, 'artifacts', 'team-work-logger-v2', 'history');
  try {
    const querySnapshot = await getDocs(historyCollectionRef);
    allHistoryData = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      if (data && data.workRecords) { allHistoryData.push({ id: doc.id, ...data }); }
    });
    return allHistoryData;
  } catch (error) {
    console.error('Error fetching all history data:', error);
    showToast('전체 이력 로딩 실패', true);
    return [];
  }
}

const loadAndRenderHistoryList = async () => {
  if (!historyDateList) return;
  historyDateList.innerHTML = '<li><div class="p-4 text-center text-gray-500">이력 로딩 중...</div></li>';
  allHistoryData = [];

  const historyData = await fetchAllHistoryData();

  if (historyData.length === 0) {
    historyDateList.innerHTML = '<li><div class="p-4 text-center text-gray-500">저장된 이력이 없습니다.</div></li>';
    const dailyView = document.getElementById('history-daily-view');
    const weeklyView = document.getElementById('history-weekly-view');
    const monthlyView = document.getElementById('history-monthly-view');
    if (dailyView) dailyView.innerHTML = '';
    if (weeklyView) weeklyView.innerHTML = '';
    if (monthlyView) monthlyView.innerHTML = '';
    return;
  }

  const dates = historyData.map(d => d.id).sort((a, b) => b.localeCompare(a));
  historyDateList.innerHTML = '';
  dates.forEach(dateKey => {
    const li = document.createElement('li');
    li.innerHTML = `<button data-key="${dateKey}" class="history-date-btn w-full text-left p-3 rounded-md hover:bg-blue-100 transition focus:outline-none focus:ring-2 focus:ring-blue-300">${dateKey}</button>`;
    historyDateList.appendChild(li);
  });

  if (historyDateList.firstChild) {
    const firstButton = historyDateList.firstChild.querySelector('button');
    if (firstButton) {
      firstButton.classList.add('bg-blue-100', 'font-bold');
      switchHistoryView('daily');
      renderHistoryDetail(firstButton.dataset.key);
    }
  } else {
    switchHistoryView('daily');
    const dailyView = document.getElementById('history-daily-view');
    if (dailyView) dailyView.innerHTML = '<div class="text-center text-gray-500 p-8">표시할 이력이 없습니다.</div>';
  }
};

window.openHistoryQuantityModal = (dateKey) => {
  const data = allHistoryData.find(d => d.id === dateKey);
  if (!data) return showToast('해당 날짜의 데이터를 찾을 수 없습니다.', true);

  // [수정] 동적 처리량 항목 전달
  renderQuantityModalInputs(data.taskQuantities || {}, appConfig.quantityTaskTypes);
  const title = document.getElementById('quantity-modal-title');
  if (title) title.textContent = `${dateKey} 처리량 수정`;

  quantityModalContext = {
    mode: 'history',
    dateKey,
    onConfirm: async (newQuantities) => {
      const idx = allHistoryData.findIndex(d => d.id === dateKey);
      if (idx === -1) return;
      allHistoryData[idx].taskQuantities = newQuantities;
      const historyDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
      try {
        await setDoc(historyDocRef, allHistoryData[idx]);
        showToast(`${dateKey}의 처리량이 수정되었습니다.`);
        renderHistoryDetail(dateKey);
      } catch (e) {
        console.error('Error updating history quantities:', e);
        showToast('처리량 업데이트 중 오류 발생.', true);
      }
    },
    onCancel: () => {}
  };

  const cBtn = document.getElementById('confirm-quantity-btn');
  const xBtn = document.getElementById('cancel-quantity-btn');
  if (cBtn) cBtn.textContent = '수정 저장';
  if (xBtn) xBtn.textContent = '취소';
  if (quantityModal) quantityModal.classList.remove('hidden');
};

const renderHistoryDetail = (dateKey) => {
  const view = document.getElementById('history-daily-view');
  if (!view) return;
  view.innerHTML = '<div class="text-center text-gray-500">데이터 로딩 중...</div>';
  const data = allHistoryData.find(d => d.id === dateKey);
  if (!data) { view.innerHTML = '<div class="text-center text-red-500">해당 날짜의 데이터를 찾을 수 없습니다.</div>'; return; }

  const records = data.workRecords || [];
  const quantities = data.taskQuantities || {};
  const onLeaveMembers = data.onLeaveMembers || [];
  const partTimersFromHistory = data.partTimers || [];

  // [수정] teamGroups를 전역 appConfig에서 참조
  const allRegularMembers = new Set((appConfig.teamGroups || []).flatMap(g => g.members));
  const activeMembersCount = allRegularMembers.size - onLeaveMembers.length + partTimersFromHistory.length;
  const totalSumDuration = records.reduce((sum, r) => sum + (r.duration || 0), 0);

  const taskDurations = records.reduce((acc, rec) => { acc[rec.task] = (acc[rec.task] || 0) + (rec.duration || 0); return acc; }, {});
  
  // [추가] 업무별 인건비 계산
  const taskCosts = records.reduce((acc, rec) => {
      const wage = appConfig.memberWages[rec.member] || 0; // config에서 인건비 조회
      const cost = ((Number(rec.duration) || 0) / 60) * wage; // 분 단위를 시간 단위로 변경하여 비용 계산
      acc[rec.task] = (acc[rec.task] || 0) + cost;
      return acc;
  }, {});

  const totalQuantity = Object.values(quantities).reduce((sum, q) => sum + (Number(q) || 0), 0);
  const avgThroughput = totalSumDuration > 0 ? (totalQuantity / totalSumDuration).toFixed(2) : '0.00';

  let nonWorkHtml = '';
  if (isWeekday(dateKey)) {
    const totalPotentialMinutes = activeMembersCount * 8 * 60;
    const nonWorkMinutes = totalPotentialMinutes - totalSumDuration;
    const percentage = totalPotentialMinutes > 0 ? Math.max(0, nonWorkMinutes / totalPotentialMinutes * 100).toFixed(1) : 0;
    nonWorkHtml = `<div class="bg-white p-4 rounded-lg shadow-sm text-center"><h4 class="text-sm font-semibold text-gray-500">총 비업무시간</h4><p class="text-xl font-bold text-gray-700">${formatDuration(nonWorkMinutes > 0 ? nonWorkMinutes : 0)}</p><p class="text-xs text-gray-500 mt-1">(추정치, ${percentage}%)</p></div>`;
  } else {
    nonWorkHtml = `<div class="bg-white p-4 rounded-lg shadow-sm text-center flex flex-col justify-center items-center"><h4 class="text-sm font-semibold text-gray-500">총 비업무시간</h4><p class="text-lg font-bold text-gray-400">주말</p></div>`;
  }

  let html = `
    <div class="mb-6 pb-4 border-b flex justify-between items-center">
      <h3 class="text-2xl font-bold text-gray-800">${dateKey}</h3>
      <div>
        <button class="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-1 px-3 rounded-md text-sm" onclick="openHistoryQuantityModal('${dateKey}')">처리량 수정</button>
        <button class="bg-green-600 hover:bg-green-700 text-white font-semibold py-1 px-3 rounded-md text-sm ml-2" onclick="downloadHistoryAsExcel('${dateKey}')">엑셀</button>
        <button class="bg-red-600 hover:bg-red-700 text-white font-semibold py-1 px-3 rounded-md text-sm ml-2" onclick="requestHistoryDeletion('${dateKey}')">삭제</button>
      </div>
    </div>
    <div class="grid grid-cols-2 lg:grid-cols-6 gap-4 mb-6">
      <div class="bg-white p-4 rounded-lg shadow-sm text-center"><h4 class="text-sm font-semibold text-gray-500">근무 인원</h4><p class="text-2xl font-bold text-gray-800">${activeMembersCount} 명</p></div>
      <div class="bg-white p-4 rounded-lg shadow-sm text-center"><h4 class="text-sm font-semibold text-gray-500">총합 시간</h4><p class="text-2xl font-bold text-gray-800">${formatDuration(totalSumDuration)}</p></div>
      ${nonWorkHtml}
      <div class="bg-white p-4 rounded-lg shadow-sm text-center col-span-2"><h4 class="text-sm font-semibold text-gray-500">총 처리량</h4><p class="text-2xl font-bold text-gray-800">${totalQuantity} 개</p></div>
      <div class="bg-white p-4 rounded-lg shadow-sm text-center"><h4 class="text-sm font-semibold text-gray-500">분당 평균 처리량</h4><p class="text-2xl font-bold text-gray-800">${avgThroughput} 개/분</p></div>
    </div>
  `;

  // [수정] md:grid-cols-2 -> md:grid-cols-3 로 변경
  html += `<div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">`;
  html += `<div class="bg-white p-4 rounded-lg shadow-sm"><h4 class="text-lg font-bold mb-3 text-gray-700">업무별 처리량</h4><div class="space-y-2 max-h-48 overflow-y-auto">`;
  let hasQuantities = false;
  Object.entries(quantities)
    .filter(([, qty]) => Number(qty) > 0)
    .sort(([a],[b]) => a.localeCompare(b))
    .forEach(([task, qty]) => {
      hasQuantities = true;
      html += `<div class="flex justify-between items-center text-sm border-b pb-1"><span class="font-semibold text-gray-600">${task}</span><span>${qty} 개</span></div>`;
    });
  if (!hasQuantities) html += `<p class="text-gray-500 text-sm">입력된 처리량이 없습니다.</p>`;
  html += `</div></div>`;

  html += `<div class="bg-white p-4 rounded-lg shadow-sm"><h4 class="text-lg font-bold mb-3 text-gray-700">업무별 분당 처리량</h4><div class="space-y-2 max-h-48 overflow-y-auto">`;
  let hasThroughput = false;
  Object.entries(quantities)
    .filter(([, qty]) => Number(qty) > 0)
    .sort(([a],[b]) => a.localeCompare(b))
    .forEach(([task, qty]) => {
      hasThroughput = true;
      const durationForTask = taskDurations[task] || 0;
      const throughputForTask = durationForTask > 0 ? ((Number(qty) || 0) / durationForTask).toFixed(2) : '0.00';
      html += `<div class="flex justify-between items-center text-sm border-b pb-1"><span class="font-semibold text-gray-600">${task}</span><span>${throughputForTask} 개/분</span></div>`;
    });
  if (!hasThroughput) html += `<p class="text-gray-500 text-sm">입력된 처리량이 없습니다.</p>`;
  html += `</div></div>`;

  // [추가] 개당 처리비용 카드
  html += `<div class="bg-white p-4 rounded-lg shadow-sm"><h4 class="text-lg font-bold mb-3 text-gray-700">업무별 개당 처리비용</h4><div class="space-y-2 max-h-48 overflow-y-auto">`;
  let hasCostPerItem = false;
  Object.entries(quantities)
    .filter(([, qty]) => Number(qty) > 0)
    .sort(([a],[b]) => a.localeCompare(b))
    .forEach(([task, qty]) => {
      hasCostPerItem = true;
      const costForTask = taskCosts[task] || 0;
      const qtyNum = Number(qty) || 1; // 0으로 나누기 방지
      const costPerItem = costForTask / qtyNum;
      html += `<div class="flex justify-between items-center text-sm border-b pb-1"><span class="font-semibold text-gray-600">${task}</span><span>${costPerItem.toFixed(0)} 원/개</span></div>`;
    });
  if (!hasCostPerItem) html += `<p class="text-gray-500 text-sm">처리량이 없어 계산 불가.</p>`;
  html += `</div></div>`;

  html += `</div>`; // 그리드 닫기

  html += `<div class="bg-white p-4 rounded-lg shadow-sm"><h4 class="text-lg font-bold mb-3 text-gray-700">업무별 시간 비중</h4><div class="space-y-3">`;
  Object.entries(taskDurations)
    .filter(([, duration]) => duration > 0)
    .sort(([,a],[,b]) => b - a)
    .forEach(([task, duration]) => {
      const percentage = totalSumDuration > 0 ? (duration / totalSumDuration * 100).toFixed(1) : 0;
      html += `
        <div>
          <div class="flex justify-between items-center mb-1 text-sm">
            <span class="font-semibold text-gray-600">${task}</span>
            <span>${formatDuration(duration)} (${percentage}%)</span>
          </div>
          <div class="w-full bg-gray-200 rounded-full h-2.5"><div class="bg-blue-600 h-2.5 rounded-full" style="width: ${percentage}%"></div></div>
        </div>`;
    });
  if (Object.keys(taskDurations).every(k => (taskDurations[k] || 0) <= 0)) {
    html += `<p class="text-gray-500 text-sm">기록된 업무 시간이 없습니다.</p>`;
  }
  html += `</div></div>`;

  view.innerHTML = html;
};

const renderSummaryView = (mode, dataset, periodKey) => {
  const records = dataset.workRecords || [];
  const quantities = dataset.taskQuantities || {};
  const total = records.reduce((s, r) => s + (r.duration || 0), 0);
  const byTask = records.reduce((acc, r) => { acc[r.task] = (acc[r.task] || 0) + (r.duration || 0); return acc; }, {});
  const totalQty = Object.values(quantities).reduce((s, q) => s + (Number(q) || 0), 0);

  let html = `<div class="bg-white p-4 rounded-lg shadow-sm"><div class="flex justify-between items-center mb-3"><h3 class="text-xl font-bold">${periodKey}</h3></div>`;
  html += `<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
    <div class="bg-gray-50 p-3 rounded"><div class="text-xs text-gray-500">총 시간</div><div class="text-lg font-bold">${formatDuration(total)}</div></div>
    <div class="bg-gray-50 p-3 rounded"><div class="text-xs text-gray-500">총 처리량</div><div class="text-lg font-bold">${totalQty} 개</div></div>
    <div class="bg-gray-50 p-3 rounded"><div class="text-xs text-gray-500">평균 처리량</div><div class="text-lg font-bold">${ total > 0 ? (totalQty/total).toFixed(2) : '0.00'} 개/분</div></div>
  </div>`;

  html += `<div class="mt-4">`;
  Object.entries(byTask).sort(([,a],[,b]) => b-a).forEach(([task, min]) => {
    const pct = total>0 ? (min/total*100).toFixed(1) : 0;
    html += `<div class="flex justify-between text-sm"><span class="font-semibold text-gray-700">${task}</span><span>${formatDuration(min)} (${pct}%)</span></div>`;
  });
  html += `</div></div>`;
  return html;
};

const renderWeeklyHistory = () => {
  const view = document.getElementById('history-weekly-view');
  if (!view) return;
  view.innerHTML = '<div class="text-center text-gray-500">주별 데이터 집계 중...</div>';

  const weeklyData = allHistoryData.reduce((acc, day) => {
    if (!day.id || !day.workRecords) return acc;
    try {
      const weekKey = getWeekOfYear(new Date(day.id));
      if (!acc[weekKey]) acc[weekKey] = { workRecords: [], taskQuantities: {} };
      acc[weekKey].workRecords.push(...(day.workRecords || []));
      Object.entries(day.taskQuantities || {}).forEach(([task, qty]) => {
        acc[weekKey].taskQuantities[task] = (acc[weekKey].taskQuantities[task] || 0) + (Number(qty) || 0);
      });
    } catch (e) { /* noop */ }
    return acc;
  }, {});

  const sortedWeeks = Object.keys(weeklyData).sort((a,b) => b.localeCompare(a));
  if (sortedWeeks.length === 0) { view.innerHTML = '<div class="text-center text-gray-500">주별 데이터가 없습니다.</div>'; return; }
  view.innerHTML = sortedWeeks.map(weekKey => renderSummaryView('weekly', weeklyData[weekKey], weekKey)).join('<div class="my-4 border-t"></div>');
};

const renderMonthlyHistory = () => {
  const view = document.getElementById('history-monthly-view');
  if (!view) return;
  view.innerHTML = '<div class="text-center text-gray-500">월별 데이터 집계 중...</div>';

  const monthlyData = allHistoryData.reduce((acc, day) => {
    if (!day.id || !day.workRecords) return acc;
    try {
      const monthKey = day.id.substring(0,7);
      if (!acc[monthKey]) acc[monthKey] = { workRecords: [], taskQuantities: {} };
      acc[monthKey].workRecords.push(...(day.workRecords || []));
      Object.entries(day.taskQuantities || {}).forEach(([task, qty]) => {
        acc[monthKey].taskQuantities[task] = (acc[monthKey].taskQuantities[task] || 0) + (Number(qty) || 0);
      });
    } catch (e) { /* noop */ }
    return acc;
  }, {});

  const sortedMonths = Object.keys(monthlyData).sort((a,b) => b.localeCompare(a));
  if (sortedMonths.length === 0) { view.innerHTML = '<div class="text-center text-gray-500">월별 데이터가 없습니다.</div>'; return; }
  view.innerHTML = sortedMonths.map(monthKey => renderSummaryView('monthly', monthlyData[monthKey], monthKey)).join('<div class="my-4 border-t"></div>');
};

window.requestHistoryDeletion = (dateKey) => {
  historyKeyToDelete = dateKey;
  if (deleteHistoryModal) deleteHistoryModal.classList.remove('hidden');
};

// 엑셀 다운로드
window.downloadHistoryAsExcel = async (dateKey) => {
  try {
    const data = allHistoryData.find(d => d.id === dateKey);
    if (!data || !data.workRecords || data.workRecords.length === 0) {
      return showToast('다운로드할 데이터가 없습니다.', true);
    }
    const records = data.workRecords;
    const quantities = data.taskQuantities || {}; // [추가] 처리량 데이터 가져오기

    // [수정] 합계 행 계산 로직 변경 (개당 처리비용 재계산)
    const appendTotalRow = (ws, data, headers) => {
      if (!data || data.length === 0) return;
      const total = {};
      const sums = {};

      // 1. 합산이 필요한 모든 열의 합계를 먼저 계산
      headers.forEach(header => {
          if (header.includes('(분)') || header.includes('(원)') || header.includes('(개)')) {
              sums[header] = data.reduce((acc, row) => acc + (Number(row[header]) || 0), 0);
          }
      });

      // 2. 합계 행(total object) 생성
      headers.forEach((header, index) => {
          if (index === 0) {
              total[header] = '총 합계';
          } else if (header.includes('(분)') || header.includes('총 인건비(원)') || header.includes('총 처리량(개)')) {
              // '총 소요 시간', '총 인건비', '총 처리량'은 단순 합산
              total[header] = Math.round(sums[header]);
          } else if (header === '개당 처리비용(원)') {
              // '개당 처리비용'은 (총 인건비 / 총 처리량)으로 재계산
              const totalCost = sums['총 인건비(원)'] || 0;
              const totalQty = sums['총 처리량(개)'] || 0;
              const totalCostPerItem = (totalQty > 0) ? (totalCost / totalQty) : 0;
              total[header] = Math.round(totalCostPerItem);
          } else {
              total[header] = '';
          }
      });
      XLSX.utils.sheet_add_json(ws, [total], { skipHeader: true, origin: -1 });
    };

    const sheet1Headers = ['팀원', '업무 종류', '시작 시간', '종료 시간', '소요 시간(분)'];
    const sheet1Data = records.map(r => ({
      '팀원': r.member || '',
      '업무 종류': r.task || '',
      '시작 시간': formatTimeTo24H(r.startTime),
      '종료 시간': formatTimeTo24H(r.endTime),
      '소요 시간(분)': Math.round(Number(r.duration) || 0)
    }));
    const worksheet1 = XLSX.utils.json_to_sheet(sheet1Data, { header: sheet1Headers });
    appendTotalRow(worksheet1, sheet1Data, sheet1Headers);

    // [수정] Sheet 2 헤더 변경
    const sheet2Headers = ['업무 종류', '총 소요 시간(분)', '총 인건비(원)', '총 처리량(개)', '개당 처리비용(원)'];
    const summaryByTask = {};
    records.forEach(r => {
      if (!summaryByTask[r.task]) summaryByTask[r.task] = { totalDuration: 0, totalCost: 0 };
      const wage = appConfig.memberWages[r.member] || 0;
      const cost = ((Number(r.duration) || 0) / 60) * wage;
      summaryByTask[r.task].totalDuration += (Number(r.duration) || 0);
      summaryByTask[r.task].totalCost += cost;
    });

    // [수정] Sheet 2 데이터 생성 로직 변경 (처리량, 개당 비용 추가)
    const sheet2Data = Object.keys(summaryByTask).sort().map(task => {
      const taskQty = Number(quantities[task]) || 0;
      const taskCost = summaryByTask[task].totalCost;
      const costPerItem = (taskQty > 0) ? (taskCost / taskQty) : 0;

      return {
        '업무 종류': task,
        '총 소요 시간(분)': Math.round(summaryByTask[task].totalDuration),
        '총 인건비(원)': Math.round(taskCost),
        '총 처리량(개)': taskQty,
        '개당 처리비용(원)': Math.round(costPerItem)
      };
    });
    const worksheet2 = XLSX.utils.json_to_sheet(sheet2Data, { header: sheet2Headers });
    appendTotalRow(worksheet2, sheet2Data, sheet2Headers); // 수정된 합계 로직 사용

    const sheet3Headers = ['파트', '총 인건비(원)'];
    const memberToPartMap = new Map();
    // [수정] teamGroups를 전역 appConfig에서 참조
    (appConfig.teamGroups || []).forEach(group => group.members.forEach(member => memberToPartMap.set(member, group.name)));
    const summaryByPart = {};
    records.forEach(r => {
      const part = memberToPartMap.get(r.member) || '기타';
      if (!summaryByPart[part]) summaryByPart[part] = { totalCost: 0 };
      const wage = appConfig.memberWages[r.member] || 0;
      const cost = ((Number(r.duration) || 0) / 60) * wage;
      summaryByPart[part].totalCost += cost;
    });
    const sheet3Data = Object.keys(summaryByPart).sort().map(part => ({
      '파트': part,
      '총 인건비(원)': Math.round(summaryByPart[part].totalCost)
    }));
    const worksheet3 = XLSX.utils.json_to_sheet(sheet3Data, { header: sheet3Headers });
    appendTotalRow(worksheet3, sheet3Data, sheet3Headers);

    const fitToColumn = (ws) => {
      const objectMaxLength = [];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
      if (!data || data.length === 0) return;
      if (data[0]) {
        Object.keys(data[0]).forEach((key, index) => {
          objectMaxLength[index] = String(data[0][key]).length;
        });
      }
      data.slice(1).forEach(row => {
        Object.keys(row).forEach((key, index) => {
          const cellLength = String(row[key] ?? '').length;
          objectMaxLength[index] = Math.max(objectMaxLength[index] || 10, cellLength);
        });
      });
      ws['!cols'] = objectMaxLength.map(w => ({ width: w + 2 }));
    };

    fitToColumn(worksheet1);
    fitToColumn(worksheet2);
    fitToColumn(worksheet3);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet1, '상세 기록');
    XLSX.utils.book_append_sheet(workbook, worksheet2, '업무별 요약');
    XLSX.utils.book_append_sheet(workbook, worksheet3, '파트별 인건비');
    XLSX.writeFile(workbook, `업무기록_${dateKey}.xlsx`);
  } catch (error) {
    console.error('Excel export failed:', error);
    showToast('Excel 파일 생성에 실패했습니다.', true);
  }
};

const switchHistoryView = (view) => {
  const dateListContainer = document.getElementById('history-date-list-container');
  const dailyView = document.getElementById('history-daily-view');
  const weeklyView = document.getElementById('history-weekly-view');
  const monthlyView = document.getElementById('history-monthly-view');

  if (dateListContainer) dateListContainer.style.display = view === 'daily' ? 'block' : 'none';
  if (historyTabs) {
    historyTabs.querySelectorAll('button').forEach(btn => {
      const isActive = btn.dataset.view === view;
      btn.classList.toggle('font-semibold', isActive);
      btn.classList.toggle('text-blue-600', isActive);
      btn.classList.toggle('border-b-2', isActive);
      btn.classList.toggle('border-blue-600', isActive);
      btn.classList.toggle('text-gray-500', !isActive);
    });
  }
  if (historyViewContainer) {
    Array.from(historyViewContainer.children).forEach(child => {
      child.classList.toggle('hidden', child.id !== `history-${view}-view`);
    });
  }

  if (view === 'daily') {
    const selectedDateBtn = historyDateList?.querySelector('button.font-bold');
    if (selectedDateBtn) renderHistoryDetail(selectedDateBtn.dataset.key);
    else if (dailyView) dailyView.innerHTML = '<div class="text-center text-gray-500 p-8">왼쪽 목록에서 날짜를 선택하세요.</div>';
  } else if (view === 'weekly') {
    renderWeeklyHistory();
  } else if (view === 'monthly') {
    renderMonthlyHistory();
  }
};

// ========== 이벤트 리스너 ==========
if (teamStatusBoard) {
  teamStatusBoard.addEventListener('click', (e) => {
    const stopGroupButton = e.target.closest('.stop-work-group-btn');
    if (stopGroupButton) { stopWorkGroup(Number(stopGroupButton.dataset.groupId)); return; }
    const pauseGroupButton = e.target.closest('.pause-work-group-btn');
    if (pauseGroupButton) { pauseWorkGroup(Number(pauseGroupButton.dataset.groupId)); return; }
    const resumeGroupButton = e.target.closest('.resume-work-group-btn');
    if (resumeGroupButton) { resumeWorkGroup(Number(resumeGroupButton.dataset.groupId)); return; }

    const individualStopBtn = e.target.closest('[data-action="stop-individual"]');
    if (individualStopBtn) {
      e.stopPropagation();
      const recordId = individualStopBtn.dataset.recordId;
      const record = (appState.workRecords || []).find(r => String(r.id) === String(recordId));
      if (record) {
        recordToStopId = record.id;
        if (stopIndividualConfirmMessage) stopIndividualConfirmMessage.textContent = `${record.member}님의 '${record.task}' 업무를 종료하시겠습니까?`;
        if (stopIndividualConfirmModal) stopIndividualConfirmModal.classList.remove('hidden');
      }
      return;
    }

    const memberCard = e.target.closest('[data-member-toggle-leave]');
    if (memberCard) {
      const memberName = memberCard.dataset.memberToggleLeave;
      const isWorking = (appState.workRecords || []).some(r => r.member === memberName && (r.status === 'ongoing' || r.status === 'paused'));
      if (isWorking) return showToast(`${memberName}님은 현재 업무 중이므로 휴무로 변경할 수 없습니다.`, true);
      appState.onLeaveMembers = appState.onLeaveMembers || [];
      const idx = appState.onLeaveMembers.indexOf(memberName);
      if (idx > -1) { appState.onLeaveMembers.splice(idx, 1); showToast(`${memberName}님의 휴무가 취소되었습니다.`); }
      else { appState.onLeaveMembers.push(memberName); showToast(`${memberName}님이 휴무로 설정되었습니다.`); }
      saveStateToFirestore();
      return;
    }

    const card = e.target.closest('div[data-action]');
    if (card) {
      if (e.target.closest('button, .members-list')) return;
      const action = card.dataset.action;
      const task = card.dataset.task;
      if (action === 'start-task') {
        selectedTaskForStart = task; selectedGroupForAdd = null;
        // [수정] config 데이터 전달
        renderTeamSelectionModalContent(task, appState, appConfig.teamGroups);
        const titleEl = document.getElementById('team-select-modal-title');
        if (titleEl) titleEl.textContent = `'${task}' 업무 시작`;
        if (teamSelectModal) teamSelectModal.classList.remove('hidden');
      } else if (action === 'other') {
        selectedTaskForStart = null; selectedGroupForAdd = null;
        if (taskSelectModal) taskSelectModal.classList.remove('hidden');
      } else if (action === 'add-member') {
        const groupId = Number(card.dataset.groupId);
        selectedTaskForStart = task; selectedGroupForAdd = groupId;
        // [수정] config 데이터 전달
        renderTeamSelectionModalContent(task, appState, appConfig.teamGroups);
        const titleEl = document.getElementById('team-select-modal-title');
        if (titleEl) titleEl.textContent = `'${task}' 업무에 인원 추가`;
        if (teamSelectModal) teamSelectModal.classList.remove('hidden');
      }
    }
  });
}

if (workLogBody) {
  workLogBody.addEventListener('click', (e) => {
    const targetButton = e.target.closest('button');
    if (!targetButton) return;
    const action = targetButton.dataset.action;
    const recordId = targetButton.dataset.recordId;

    if (action === 'edit') {
      recordToEditId = recordId;
      const record = (appState.workRecords || []).find(r => String(r.id) === String(recordId));
      if (!record) return;
      const memberNameInput = document.getElementById('edit-member-name');
      const taskSelect = document.getElementById('edit-task-type');
      const startTimeInput = document.getElementById('edit-start-time');
      const endTimeInput = document.getElementById('edit-end-time');

      if (memberNameInput) memberNameInput.value = record.member;
      if (taskSelect) {
        taskSelect.innerHTML = '';
        // [수정] appConfig.taskGroups 사용
        Object.entries(appConfig.taskGroups || {}).forEach(([groupName, tasks]) => {
          const optgroup = document.createElement('optgroup');
          optgroup.label = groupName;
          tasks.sort().forEach(task => {
            const option = document.createElement('option');
            option.value = task; option.textContent = task; if (task === record.task) option.selected = true; optgroup.appendChild(option);
          });
          taskSelect.appendChild(optgroup);
        });
      }
      if (startTimeInput) startTimeInput.value = record.startTime || '';
      if (endTimeInput) endTimeInput.value = record.endTime || '';
      if (editRecordModal) editRecordModal.classList.remove('hidden');
    } else if (action === 'delete') {
      deleteMode = 'single';
      recordToDeleteId = recordId;
      const msgEl = document.getElementById('delete-confirm-message');
      if (msgEl) msgEl.textContent = '정말로 이 기록을 삭제하시겠습니까?';
      if (deleteConfirmModal) deleteConfirmModal.classList.remove('hidden');
    }
  });
}

if (deleteAllCompletedBtn) deleteAllCompletedBtn.addEventListener('click', () => {
  deleteMode = 'all';
  const msgEl = document.getElementById('delete-confirm-message');
  if (msgEl) msgEl.textContent = '정말로 오늘 완료된 모든 기록을 삭제하시겠습니까?';
  if (deleteConfirmModal) deleteConfirmModal.classList.remove('hidden');
});

if (confirmDeleteBtn) confirmDeleteBtn.addEventListener('click', () => {
  appState.workRecords = appState.workRecords || [];
  if (deleteMode === 'single' && recordToDeleteId !== null) {
    appState.workRecords = appState.workRecords.filter(record => String(record.id) !== String(recordToDeleteId));
    showToast('기록이 삭제되었습니다.');
  } else if (deleteMode === 'all') {
    appState.workRecords = appState.workRecords.filter(record => record.status !== 'completed');
    showToast('완료된 모든 기록이 삭제되었습니다.');
  }
  saveStateToFirestore();
  if (deleteConfirmModal) deleteConfirmModal.classList.add('hidden');
  recordToDeleteId = null;
  deleteMode = 'single';
});

if (endShiftBtn) endShiftBtn.addEventListener('click', () => {
  // [수정] config 데이터 전달
  renderQuantityModalInputs(appState.taskQuantities, appConfig.quantityTaskTypes);
  const titleEl = document.getElementById('quantity-modal-title');
  const confirmBtn = document.getElementById('confirm-quantity-btn');
  const cancelBtn = document.getElementById('cancel-quantity-btn');
  if (titleEl) titleEl.textContent = '업무 마감 전 처리량 입력';
  if (confirmBtn) confirmBtn.textContent = '저장하고 마감';
  if (cancelBtn) cancelBtn.textContent = '저장 없이 마감';

  quantityModalContext = {
    mode: 'end-shift',
    onConfirm: (newQuantities) => { appState.taskQuantities = newQuantities; saveDayDataToHistory(true); },
    onCancel: () => { saveDayDataToHistory(true); }
  };
  if (quantityModal) quantityModal.classList.remove('hidden');
});

if (saveProgressBtn) saveProgressBtn.addEventListener('click', saveProgress);

if (openHistoryBtn) openHistoryBtn.addEventListener('click', () => { loadAndRenderHistoryList(); if (historyModal) historyModal.classList.remove('hidden'); });
if (closeHistoryBtn) closeHistoryBtn.addEventListener('click', () => { if (historyModal) historyModal.classList.add('hidden'); });

if (historyDateList) historyDateList.addEventListener('click', (e) => {
  const button = e.target.closest('button.history-date-btn');
  if (button) {
    document.querySelectorAll('#history-date-list button').forEach(btn => btn.classList.remove('bg-blue-100', 'font-bold'));
    button.classList.add('bg-blue-100', 'font-bold');
    switchHistoryView('daily');
    renderHistoryDetail(button.dataset.key);
  }
});

if (historyTabs) historyTabs.addEventListener('click', (e) => {
  const button = e.target.closest('button.history-tab-btn');
  if (button && button.dataset.view) switchHistoryView(button.dataset.view);
});

if (confirmHistoryDeleteBtn) confirmHistoryDeleteBtn.addEventListener('click', async () => {
  if (historyKeyToDelete) {
    const docRef = doc(db, 'artifacts', 'team-work-logger-v2', 'history', historyKeyToDelete);
    try {
      await deleteDoc(docRef);
      showToast('선택한 날짜의 기록이 삭제되었습니다.');
      loadAndRenderHistoryList();
      const dailyView = document.getElementById('history-daily-view');
      if (dailyView) dailyView.innerHTML = '<div class="text-center text-gray-500 p-8">왼쪽 목록에서 날짜를 선택하세요.</div>';
    } catch (error) {
      console.error('Error deleting history data:', error);
      showToast('이력 삭제 중 오류 발생.', true);
    }
  }
  if (deleteHistoryModal) deleteHistoryModal.classList.add('hidden');
  historyKeyToDelete = null;
});

if (resetAppBtn) resetAppBtn.addEventListener('click', () => { if (resetAppModal) resetAppModal.classList.remove('hidden'); });

if (confirmResetAppBtn) confirmResetAppBtn.addEventListener('click', async () => {
  try {
    const docRef = doc(db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString());
    await deleteDoc(docRef);
    
    // [수정] taskTypes를 appConfig에서 동적으로 가져와서 초기화
    const taskTypes = [].concat(...Object.values(appConfig.taskGroups || {}));
    appState = { workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [], hiddenGroupIds: [] };
    taskTypes.forEach(task => appState.taskQuantities[task] = 0);
    
    render();
    showToast('데이터가 초기화되었습니다.');
  } catch (error) {
    console.error('Error resetting data:', error);
    showToast('초기화 중 오류가 발생했습니다.', true);
  }
  if (resetAppModal) resetAppModal.classList.add('hidden');
});

if (confirmQuantityBtn) confirmQuantityBtn.addEventListener('click', () => {
  const inputs = document.querySelectorAll('#modal-task-quantity-inputs input');
  const newQuantities = {};
  inputs.forEach(input => {
    const task = input.dataset.task;
    const value = Number(input.value);
    newQuantities[task] = (!Number.isNaN(value) && value >= 0) ? value : 0;
  });
  if (quantityModalContext.onConfirm) quantityModalContext.onConfirm(newQuantities);
  if (quantityModal) quantityModal.classList.add('hidden');
});

if (confirmEditBtn) confirmEditBtn.addEventListener('click', () => {
  if (recordToEditId == null) return;
  const idx = (appState.workRecords || []).findIndex(r => String(r.id) === String(recordToEditId));
  if (idx === -1) { if (editRecordModal) editRecordModal.classList.add('hidden'); recordToEditId = null; return; }
  const record = appState.workRecords[idx];

  const newStart = document.getElementById('edit-start-time')?.value;
  const newEnd = document.getElementById('edit-end-time')?.value;
  const newTask = document.getElementById('edit-task-type')?.value;
  const newMember = document.getElementById('edit-member-name')?.value;

  if (!newMember || !newTask || !newStart || !newEnd || newStart >= newEnd) {
    showToast('입력값을 확인해주세요. (종료 시간 > 시작 시간)', true);
    return;
  }

  const updated = { ...record, member: newMember, task: newTask, startTime: newStart, endTime: newEnd };
  updated.duration = calcElapsedMinutes(newStart, newEnd, updated.pauses || []);
  appState.workRecords[idx] = updated;
  saveStateToFirestore();
  showToast('기록이 수정되었습니다.');
  if (editRecordModal) editRecordModal.classList.add('hidden');
  recordToEditId = null;
});

if (confirmQuantityOnStopBtn) confirmQuantityOnStopBtn.addEventListener('click', () => {
  const input = document.getElementById('quantity-on-stop-input');
  const quantity = Number(input?.value) || 0;
  finalizeStopGroup(groupToStopId, quantity);
});

if (taskSelectModal) taskSelectModal.addEventListener('click', e => {
  if (e.target.classList.contains('task-select-btn')) {
    const task = e.target.dataset.task;
    selectedTaskForStart = task; selectedGroupForAdd = null;
    taskSelectModal.classList.add('hidden');
    // [수정] config 데이터 전달
    renderTeamSelectionModalContent(task, appState, appConfig.teamGroups);
    const titleEl = document.getElementById('team-select-modal-title');
    if (titleEl) titleEl.textContent = `'${task}' 업무 시작`;
    if (teamSelectModal) teamSelectModal.classList.remove('hidden');
  }
});

if (confirmStopIndividualBtn) confirmStopIndividualBtn.addEventListener('click', () => {
  if (recordToStopId != null) stopWorkIndividual(recordToStopId);
  if (stopIndividualConfirmModal) stopIndividualConfirmModal.classList.add('hidden');
  recordToStopId = null;
});

// 공통 모달 닫기 버튼
document.querySelectorAll('.modal-close-btn').forEach(btn => {
  btn.addEventListener('click', (e) => { e.target.closest('.fixed.inset-0')?.classList.add('hidden'); });
});

// 개별 취소 버튼들
if (cancelDeleteBtn) cancelDeleteBtn.addEventListener('click', () => deleteConfirmModal.classList.add('hidden'));
if (cancelQuantityBtn) cancelQuantityBtn.addEventListener('click', () => { if (quantityModalContext.onCancel) quantityModalContext.onCancel(); quantityModal.classList.add('hidden'); });
if (cancelHistoryDeleteBtn) cancelHistoryDeleteBtn.addEventListener('click', () => deleteHistoryModal.classList.add('hidden'));
if (cancelEditBtn) cancelEditBtn.addEventListener('click', () => editRecordModal.classList.add('hidden'));
if (cancelResetAppBtn) cancelResetAppBtn.addEventListener('click', () => resetAppModal.classList.add('hidden'));
if (cancelQuantityOnStopBtn) cancelQuantityOnStopBtn.addEventListener('click', () => quantityOnStopModal.classList.add('hidden'));
if (cancelStopIndividualBtn) cancelStopIndividualBtn.addEventListener('click', () => stopIndividualConfirmModal.classList.add('hidden'));
if (cancelEditPartTimerBtn) cancelEditPartTimerBtn.addEventListener('click', () => editPartTimerModal.classList.add('hidden'));
if (cancelTeamSelectBtn) cancelTeamSelectBtn.addEventListener('click', () => { teamSelectModal.classList.add('hidden'); tempSelectedMembers = []; selectedTaskForStart = null; selectedGroupForAdd = null; });

// 토글: mobile에서만 동작 + class만 사용
[toggleCompletedLog, toggleAnalysis, toggleSummary].forEach(toggle => {
  if (!toggle) return;
  toggle.addEventListener('click', () => {
    if (window.innerWidth >= 768) return;
    const content = toggle.nextElementSibling;
    const arrow = toggle.querySelector('svg');
    if (!content) return;
    content.classList.toggle('hidden');
    if (arrow) arrow.classList.toggle('rotate-180');
  });
});

// 팀 선택 모달 내 클릭
if (teamSelectModal) teamSelectModal.addEventListener('click', e => {
  // 개인 선택 토글
  const card = e.target.closest('button[data-member-name]');
  if (card && !card.disabled) {
    const memberName = card.dataset.memberName;
    const i = tempSelectedMembers.indexOf(memberName);
    if (i > -1) { tempSelectedMembers.splice(i,1); card.classList.remove('ring-2','ring-blue-500','bg-blue-100'); }
    else { tempSelectedMembers.push(memberName); card.classList.add('ring-2','ring-blue-500','bg-blue-100'); }
    return;
  }

  // 그룹 전체 선택/해제
  const selectAllBtn = e.target.closest('.group-select-all-btn');
  if (selectAllBtn) {
    const groupName = selectAllBtn.dataset.groupName;
    const memberListContainer = teamSelectModal.querySelector(`div[data-group-name="${groupName}"]`);
    if (!memberListContainer) return;
    const memberCards = Array.from(memberListContainer.querySelectorAll('button[data-member-name]'));
    const availableMembers = memberCards.filter(c => !c.disabled).map(c => c.dataset.memberName);
    if (availableMembers.length === 0) return;
    const areAllSelected = availableMembers.every(m => tempSelectedMembers.includes(m));
    if (areAllSelected) {
      tempSelectedMembers = tempSelectedMembers.filter(m => !availableMembers.includes(m));
      memberCards.forEach(c => { if (!c.disabled) c.classList.remove('ring-2','ring-blue-500','bg-blue-100'); });
    } else {
      availableMembers.forEach(m => { if (!tempSelectedMembers.includes(m)) tempSelectedMembers.push(m); });
      memberCards.forEach(c => { if (!c.disabled) c.classList.add('ring-2','ring-blue-500','bg-blue-100'); });
    }
    return;
  }

  // 알바 추가
  const addPartTimerBtn = e.target.closest('#add-part-timer-modal-btn');
  if (addPartTimerBtn) {
    appState.partTimers = appState.partTimers || [];
    let counter = appState.partTimers.length + 1;
    const baseName = '알바 ';
    // [수정] appConfig.teamGroups 사용
    const existingNames = (appConfig.teamGroups || []).flatMap(g => g.members).concat(appState.partTimers.map(p => p.name));
    let newName = `${baseName}${counter}`;
    while (existingNames.includes(newName)) { counter++; newName = `${baseName}${counter}`; }
    const newId = Date.now();
    appState.partTimers.push({ id: newId, name: newName });
    // [수정] config 데이터 전달
    saveStateToFirestore().then(() => renderTeamSelectionModalContent(selectedTaskForStart, appState, appConfig.teamGroups));
    return;
  }

  // 알바 수정 열기
  const editPartTimerBtn = e.target.closest('.edit-part-timer-btn');
  if (editPartTimerBtn) {
    const id = Number(editPartTimerBtn.dataset.partTimerId);
    const pt = (appState.partTimers || []).find(p => p.id === id);
    if (pt) {
      if (partTimerEditIdInput) partTimerEditIdInput.value = id;
      if (partTimerNewNameInput) partTimerNewNameInput.value = pt.name;
      if (editPartTimerModal) editPartTimerModal.classList.remove('hidden');
    }
    return;
  }

  // 알바 삭제
  const deletePartTimerBtn = e.target.closest('.delete-part-timer-btn');
  if (deletePartTimerBtn) {
    const id = Number(deletePartTimerBtn.dataset.partTimerId);
    appState.partTimers = (appState.partTimers || []).filter(p => p.id !== id);
    // [수정] config 데이터 전달
    saveStateToFirestore().then(() => renderTeamSelectionModalContent(selectedTaskForStart, appState, appConfig.teamGroups));
    return;
  }
});

if (confirmEditPartTimerBtn) confirmEditPartTimerBtn.addEventListener('click', () => {
  const id = Number(partTimerEditIdInput?.value);
  const idx = (appState.partTimers || []).findIndex(p => p.id === id);
  if (idx === -1) { if (editPartTimerModal) editPartTimerModal.classList.add('hidden'); return; }
  const partTimer = appState.partTimers[idx];
  const newNameRaw = partTimerNewNameInput?.value || '';
  const newName = newNameRaw.trim();
  if (!newName) { showToast('알바 이름은 비워둘 수 없습니다.', true); return; }

  const nOld = normalizeName(partTimer.name);
  const nNew = normalizeName(newName);
  if (nOld === nNew) { if (editPartTimerModal) editPartTimerModal.classList.add('hidden'); return; }

  // [수정] appConfig.teamGroups 사용
  const allNamesNorm = (appConfig.teamGroups || []).flatMap(g => g.members).map(normalizeName)
    .concat((appState.partTimers || []).filter((p, i) => i !== idx).map(p => normalizeName(p.name)));
  if (allNamesNorm.includes(nNew)) { showToast('해당 이름은 이미 사용 중입니다.', true); return; }

  const oldName = partTimer.name;
  appState.partTimers[idx] = { ...partTimer, name: newName };
  appState.workRecords = (appState.workRecords || []).map(r => (r.member === oldName ? { ...r, member: newName } : r));
  saveStateToFirestore().then(() => {
    // [수정] config 데이터 전달
    renderTeamSelectionModalContent(selectedTaskForStart, appState, appConfig.teamGroups);
    if (editPartTimerModal) editPartTimerModal.classList.add('hidden');
    showToast('알바 이름이 수정되었습니다.');
  });
});

// 팀 선택 완료
const confirmTeamSelectBtn = document.getElementById('confirm-team-select-btn');
if (confirmTeamSelectBtn) confirmTeamSelectBtn.addEventListener('click', () => {
  if (tempSelectedMembers.length === 0) { showToast('추가할 팀원을 선택해주세요.', true); return; }
  if (selectedGroupForAdd !== null) {
    addMembersToWorkGroup(tempSelectedMembers, selectedTaskForStart, selectedGroupForAdd);
    showToast(`${selectedTaskForStart} 업무에 인원이 추가되었습니다.`);
  } else if (selectedTaskForStart) {
    startWorkGroup(tempSelectedMembers, selectedTaskForStart);
    showToast(`${selectedTaskForStart} 업무를 시작합니다.`);
  }
  if (teamSelectModal) teamSelectModal.classList.add('hidden');
  tempSelectedMembers = []; selectedTaskForStart = null; selectedGroupForAdd = null;
});

// ========== 앱 초기화 ==========
// [수정] main 함수를 async로 변경
async function main() {
  if (connectionStatusEl) connectionStatusEl.textContent = '연결 중...';
  if (statusDotEl) statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-yellow-500 animate-pulse';

  // 1. Firebase 초기화
  try {
      const { app, db: fdb, auth: fath } = initializeFirebase();
      if (!app || !fdb || !fath) throw new Error("Firebase 초기화 실패");
      db = fdb;
      auth = fath;
  } catch (error) {
      console.error('Firebase 초기화 실패:', error);
      showToast('Firebase 초기화에 실패했습니다.', true);
      if (connectionStatusEl) connectionStatusEl.textContent = '초기화 실패';
      if (statusDotEl) statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
      return;
  }

  // 2. [신규] Firestore에서 설정 로드
  try {
      if (connectionStatusEl) connectionStatusEl.textContent = '설정 로딩 중...';
      appConfig = await loadConfiguration(db);
      // appConfig 로드 후 UI 초기화
      renderTaskSelectionModal(appConfig.taskGroups);
  } catch (e) {
      console.error("설정 로드 실패:", e);
      showToast("설정 정보 로드에 실패했습니다. 기본값으로 실행합니다.", true);
  }

  // 3. 기존 로직 실행
  displayCurrentDate();
  if (elapsedTimeTimer) clearInterval(elapsedTimeTimer);
  elapsedTimeTimer = setInterval(updateElapsedTimes, 1000);

  // [수정] taskTypes를 appConfig에서 동적으로 가져옴
  const taskTypes = [].concat(...Object.values(appConfig.taskGroups || {}));
  const defaultState = { workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [], hiddenGroupIds: [] };
  taskTypes.forEach(task => defaultState.taskQuantities[task] = 0);
  appState = defaultState;

  // 4. 인증 및 스냅샷 리스너 설정
  onAuthStateChanged(auth, async user => {
    if (user) {
      const todayDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString());
      if (unsubscribeToday) unsubscribeToday();

      unsubscribeToday = onSnapshot(todayDocRef, (docSnap) => {
        try {
          // [수정] taskTypes를 appConfig에서 동적으로 가져옴
          const taskTypes = [].concat(...Object.values(appConfig.taskGroups || {}));
          const defaultState = { workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [], hiddenGroupIds: [] };
          taskTypes.forEach(task => defaultState.taskQuantities[task] = 0);

          const loadedState = docSnap.exists() ? JSON.parse(docSnap.data().state || '{}') : {};
          appState = {
            ...defaultState,
            ...loadedState,
            workRecords: loadedState.workRecords || [],
            taskQuantities: loadedState.taskQuantities || defaultState.taskQuantities,
            onLeaveMembers: loadedState.onLeaveMembers || [],
            partTimers: loadedState.partTimers || [],
            hiddenGroupIds: loadedState.hiddenGroupIds || []
          };
          render();
          if (connectionStatusEl) connectionStatusEl.textContent = '동기화';
          if (statusDotEl) statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-green-500';
        } catch (parseError) {
          console.error('Error parsing state from Firestore:', parseError);
          showToast('데이터 로딩 중 오류 발생 (파싱 실패).', true);
          // [수정] taskTypes를 appConfig에서 동적으로 가져옴
          const taskTypes = [].concat(...Object.values(appConfig.taskGroups || {}));
          appState = { workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [], hiddenGroupIds: [] };
          taskTypes.forEach(task => appState.taskQuantities[task] = 0);
          render();
          if (connectionStatusEl) connectionStatusEl.textContent = '데이터 오류';
          if (statusDotEl) statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
        }
      }, (error) => {
        console.error('Firebase onSnapshot error:', error);
        showToast('실시간 연결에 실패했습니다.', true);
        if (connectionStatusEl) connectionStatusEl.textContent = '연결 오류';
        if (statusDotEl) statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
        // [수정] taskTypes를 appConfig에서 동적으로 가져옴
        const taskTypes = [].concat(...Object.values(appConfig.taskGroups || {}));
        appState = { workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [], hiddenGroupIds: [] };
        taskTypes.forEach(task => appState.taskQuantities[task] = 0);
        render();
      });
    } else {
      if (connectionStatusEl) connectionStatusEl.textContent = '인증 필요';
      if (statusDotEl) statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-gray-400';
      if (unsubscribeToday) { unsubscribeToday(); unsubscribeToday = undefined; }
      // [수정] taskTypes를 appConfig에서 동적으로 가져옴
      const taskTypes = [].concat(...Object.values(appConfig.taskGroups || {}));
      appState = { workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [], hiddenGroupIds: [] };
      taskTypes.forEach(task => appState.taskQuantities[task] = 0);
      render();
    }
  });

  signInAnonymously(auth).catch(error => {
    console.error('Anonymous sign-in failed:', error);
    showToast('자동 인증에 실패했습니다.', true);
    if (connectionStatusEl) connectionStatusEl.textContent = '인증 실패';
    if (statusDotEl) statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
  });
}

main();