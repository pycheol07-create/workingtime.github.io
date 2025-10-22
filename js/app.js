// === app.js (keyTasks를 renderRealtimeStatus로 전달) ===

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, onSnapshot, collection, getDocs, deleteDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirebase, loadAppConfig, loadLeaveSchedule, saveLeaveSchedule } from './config.js';
import { showToast, getTodayDateString, displayCurrentDate, getCurrentTime, formatDuration, formatTimeTo24H, getWeekOfYear, isWeekday } from './utils.js';
import {
  renderRealtimeStatus,
  renderCompletedWorkLog,
  updateSummary,
  renderTaskAnalysis,
  renderTaskSelectionModal,
  renderTeamSelectionModalContent,
  renderQuantityModalInputs,
  renderLeaveTypeModalOptions,
  renderAttendanceDailyHistory,
  renderAttendanceWeeklyHistory,
  renderAttendanceMonthlyHistory,
  renderWeeklyHistory,
  renderMonthlyHistory
} from './ui.js';

// ========== DOM Elements ==========
// ... (이전과 동일) ...
const connectionStatusEl = document.getElementById('connection-status');
const statusDotEl = document.getElementById('status-dot');
const teamStatusBoard = document.getElementById('team-status-board');
const workLogBody = document.getElementById('work-log-body');
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
const historyMainTabs = document.getElementById('history-main-tabs');
const workHistoryPanel = document.getElementById('work-history-panel');
const attendanceHistoryPanel = document.getElementById('attendance-history-panel');
const attendanceHistoryTabs = document.getElementById('attendance-history-tabs');
const attendanceHistoryViewContainer = document.getElementById('attendance-history-view-container');
const historyAttendanceDailyView = document.getElementById('history-attendance-daily-view');
const historyAttendanceWeeklyView = document.getElementById('history-attendance-weekly-view');
const historyAttendanceMonthlyView = document.getElementById('history-attendance-monthly-view');
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
const cancelTeamSelectBtn = document.getElementById('cancel-team-select-btn'); // 취소 버튼 ID 확인
const leaveTypeModal = document.getElementById('leave-type-modal');
const leaveModalTitle = document.getElementById('leave-modal-title');
const leaveMemberNameSpan = document.getElementById('leave-member-name');
const leaveTypeOptionsContainer = document.getElementById('leave-type-options');
const confirmLeaveBtn = document.getElementById('confirm-leave-btn');
const cancelLeaveBtn = document.getElementById('cancel-leave-btn');
const leaveDateInputsDiv = document.getElementById('leave-date-inputs');
const leaveStartDateInput = document.getElementById('leave-start-date-input');
const leaveEndDateInput = document.getElementById('leave-end-date-input');
const cancelLeaveConfirmModal = document.getElementById('cancel-leave-confirm-modal');
const confirmCancelLeaveBtn = document.getElementById('confirm-cancel-leave-btn');
const cancelCancelLeaveBtn = document.getElementById('cancel-cancel-leave-btn');
const cancelLeaveConfirmMessage = document.getElementById('cancel-leave-confirm-message');
const toggleCompletedLog = document.getElementById('toggle-completed-log');
const toggleAnalysis = document.getElementById('toggle-analysis');
const toggleSummary = document.getElementById('toggle-summary');

// ========== Firebase/App State ==========
// ... (이전과 동일) ...
let db, auth;
let unsubscribeToday;
let unsubscribeLeaveSchedule;
let elapsedTimeTimer = null;
let recordCounter = 0;

let appState = {
  workRecords: [],
  taskQuantities: {},
  dailyOnLeaveMembers: [],
  dateBasedOnLeaveMembers: [],
  partTimers: [],
  hiddenGroupIds: []
};
let persistentLeaveSchedule = {
    onLeaveMembers: []
};
let appConfig = {
    teamGroups: [],
    memberWages: {},
    taskGroups: {},
    quantityTaskTypes: [],
    defaultPartTimerWage: 10000,
    keyTasks: [] // [추가]
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
let memberToSetLeave = null;
let memberToCancelLeave = null;
let activeMainHistoryTab = 'work';

const LEAVE_TYPES = ['연차', '외출', '조퇴', '결근', '출장'];

// ========== Helpers ==========
// ... (이전과 동일) ...
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
const calculateDateDifference = (start, end) => {
    if (!start) return 0;
    const startDate = new Date(start);
    const endDate = end ? new Date(end) : new Date(start);
    const startUTC = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const endUTC = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
    const diffTime = endUTC - startUTC;
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
    return diffDays + 1;
};

// ========== 타이머 ==========
const updateElapsedTimes = () => {
  // ... (이전과 동일) ...
  const now = getCurrentTime();
  document.querySelectorAll('.ongoing-duration').forEach(el => {
    try {
      if (!el?.dataset?.startTime) return;
      const rec = (appState.workRecords || []).find(r => String(r.id) === el.dataset.recordId);
      if (!rec) return;

      let currentPauses = rec.pauses || [];
      if (rec.status === 'paused') {
          const lastPause = currentPauses.length > 0 ? currentPauses[currentPauses.length - 1] : null;
          const tempPauses = [
              ...currentPauses.slice(0, -1),
              { start: lastPause?.start || rec.startTime, end: now }
          ];
          const dur = calcElapsedMinutes(el.dataset.startTime, now, tempPauses);
          el.textContent = `(진행: ${formatDuration(dur)})`;

      } else {
          const dur = calcElapsedMinutes(el.dataset.startTime, now, rec.pauses);
          el.textContent = `(진행: ${formatDuration(dur)})`;
      }

    } catch { /* noop */ }
  });

  const completedRecords = (appState.workRecords || []).filter(r => r.status === 'completed');
  const totalCompletedMinutes = completedRecords.reduce((sum, r) => sum + (r.duration || 0), 0);

  const ongoingLiveRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing');
  let totalOngoingMinutes = 0;
  ongoingLiveRecords.forEach(rec => {
      totalOngoingMinutes += calcElapsedMinutes(rec.startTime, now, rec.pauses);
  });

  const el = document.getElementById('summary-total-work-time');
  if (el) el.textContent = formatDuration(totalCompletedMinutes + totalOngoingMinutes);
};

// ========== 렌더 ==========
const render = () => {
  try {
    // [수정] appConfig.keyTasks 전달
    renderRealtimeStatus(appState, appConfig.teamGroups, appConfig.keyTasks || []);
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
  // ... (이전과 동일) ...
  if (!auth || !auth.currentUser) {
    console.warn('Cannot save state: User not authenticated.');
    return;
  }
  try {
    const docRef = doc(db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString());

    const stateToSave = JSON.stringify({
      workRecords: appState.workRecords || [],
      taskQuantities: appState.taskQuantities || {},
      onLeaveMembers: appState.dailyOnLeaveMembers || [],
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

// ========== 업무 그룹/개인 제어 ==========
// ... (이하 모든 업무 제어 함수, 저장/이력 함수, 이벤트 리스너는 이전과 동일) ...
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
  if (changed) { saveStateToFirestore(); showToast('그룹 업무가 일시정지 되었습니다.'); }
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
  if (changed) { saveStateToFirestore(); showToast('그룹 업무를 다시 시작합니다.'); }
};

const pauseWorkIndividual = (recordId) => {
  const currentTime = getCurrentTime();
  const record = (appState.workRecords || []).find(r => String(r.id) === String(recordId));
  if (record && record.status === 'ongoing') {
    record.status = 'paused';
    record.pauses = record.pauses || [];
    record.pauses.push({ start: currentTime, end: null });
    saveStateToFirestore();
    showToast(`${record.member}님 ${record.task} 업무 일시정지.`);
  }
};

const resumeWorkIndividual = (recordId) => {
  const currentTime = getCurrentTime();
  const record = (appState.workRecords || []).find(r => String(r.id) === String(recordId));
  if (record && record.status === 'paused') {
    record.status = 'ongoing';
    const lastPause = record.pauses?.[record.pauses.length - 1];
    if (lastPause && lastPause.end === null) {
      lastPause.end = currentTime;
    }
    saveStateToFirestore();
    showToast(`${record.member}님 ${record.task} 업무 재개.`);
  }
};

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

    const currentLeaveMembersCombined = [
        ...(appState.dailyOnLeaveMembers || []),
        ...(appState.dateBasedOnLeaveMembers || [])
    ];
    const currentPartTimers = appState.partTimers || [];

    if (completedRecordsFromState.length === 0 && Object.keys(currentQuantities).length === 0 && currentLeaveMembersCombined.length === 0 && currentPartTimers.length === 0 && !(existingData.onLeaveMembers?.length > 0) && !(existingData.partTimers?.length > 0)) {
        return showToast('저장할 새로운 완료 기록, 처리량, 근태 정보 또는 알바 정보가 없습니다.', true);
    }

    const combinedRecords = [...(existingData.workRecords || []), ...completedRecordsFromState];
    const uniqueRecords = Array.from(new Map(combinedRecords.map(item => [item.id, item])).values());

    const finalQuantities = { ...(existingData.taskQuantities || {}) };
    for (const task in currentQuantities) {
      finalQuantities[task] = (Number(finalQuantities[task]) || 0) + Number(currentQuantities[task]);
    }

    const combinedPartTimers = [...(existingData.partTimers || []), ...currentPartTimers];
    const uniquePartTimers = Array.from(new Map(combinedPartTimers.map(item => [item.id, item])).values());

    const dataToSave = {
      workRecords: uniqueRecords,
      taskQuantities: finalQuantities,
      onLeaveMembers: currentLeaveMembersCombined,
      partTimers: uniquePartTimers
    };

    await setDoc(historyDocRef, dataToSave);

    showToast('현재까지의 기록이 성공적으로 저장되었습니다.');
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
  }

  await saveProgress(); // 현재 상태를 이력에 저장

  // 일일 데이터 초기화
  appState.workRecords = [];
  Object.keys(appState.taskQuantities || {}).forEach(task => { appState.taskQuantities[task] = 0; });
  appState.dailyOnLeaveMembers = [];
  appState.partTimers = [];
  appState.hiddenGroupIds = [];

  if (shouldReset) {
    await saveStateToFirestore(); // 초기화된 일일 상태 저장
    showToast('오늘의 업무 기록을 초기화했습니다.');
    render();
  } else {
      await saveStateToFirestore(); // 일일 데이터만 비운 상태 저장
      render();
  }
}


async function fetchAllHistoryData() {
  const historyCollectionRef = collection(db, 'artifacts', 'team-work-logger-v2', 'history');
  try {
    const querySnapshot = await getDocs(historyCollectionRef);
    allHistoryData = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      if (data && ( (data.workRecords && data.workRecords.length > 0) || (data.onLeaveMembers && data.onLeaveMembers.length > 0) || (data.partTimers && data.partTimers.length > 0) )) {
         allHistoryData.push({ id: doc.id, ...data });
      }
    });
    allHistoryData.sort((a, b) => b.id.localeCompare(a.id));
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
        const viewsToClear = ['history-daily-view', 'history-weekly-view', 'history-monthly-view', 'history-attendance-daily-view', 'history-attendance-weekly-view', 'history-attendance-monthly-view'];
        viewsToClear.forEach(viewId => {
            const viewEl = document.getElementById(viewId);
            if (viewEl) viewEl.innerHTML = '';
        });
        return;
    }

    const dates = historyData.map(d => d.id);
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
            const activeSubTabBtn = (activeMainHistoryTab === 'work')
                ? historyTabs?.querySelector('button.font-semibold')
                : attendanceHistoryTabs?.querySelector('button.font-semibold');
            const activeView = activeSubTabBtn ? activeSubTabBtn.dataset.view : (activeMainHistoryTab === 'work' ? 'daily' : 'attendance-daily');
            switchHistoryView(activeView);
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

  renderQuantityModalInputs(data.taskQuantities || {}, appConfig.quantityTaskTypes);
  const title = document.getElementById('quantity-modal-title');
  if (title) title.textContent = `${dateKey} 처리량 수정`;

  quantityModalContext = {
    mode: 'history',
    dateKey,
    onConfirm: async (newQuantities) => {
      const idx = allHistoryData.findIndex(d => d.id === dateKey);
      if (idx === -1) return;
      allHistoryData[idx] = { ...allHistoryData[idx], taskQuantities: newQuantities };
      const historyDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
      try {
        await setDoc(historyDocRef, allHistoryData[idx]);
        showToast(`${dateKey}의 처리량이 수정되었습니다.`);
         const activeSubTabBtn = historyTabs?.querySelector('button.font-semibold');
         const currentView = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'daily';
         switchHistoryView(currentView);
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
  const onLeaveMemberEntries = data.onLeaveMembers || [];
  const onLeaveMemberNames = onLeaveMemberEntries.map(entry => entry.member);
  const partTimersFromHistory = data.partTimers || [];

  const wageMap = { ...appConfig.memberWages };
  partTimersFromHistory.forEach(pt => {
      if (!wageMap[pt.name]) {
          wageMap[pt.name] = pt.wage || 0;
      }
  });

  const allRegularMembers = new Set((appConfig.teamGroups || []).flatMap(g => g.members));
  const activeMembersCount = allRegularMembers.size - onLeaveMemberNames.filter(name => allRegularMembers.has(name)).length
                           + partTimersFromHistory.length - onLeaveMemberNames.filter(name => partTimersFromHistory.some(pt => pt.name === name)).length;

  const totalSumDuration = records.reduce((sum, r) => sum + (r.duration || 0), 0);

  const taskDurations = records.reduce((acc, rec) => { acc[rec.task] = (acc[rec.task] || 0) + (rec.duration || 0); return acc; }, {});

  const taskCosts = records.reduce((acc, rec) => {
      const wage = wageMap[rec.member] || 0;
      const cost = ((Number(rec.duration) || 0) / 60) * wage;
      acc[rec.task] = (acc[rec.task] || 0) + cost;
      return acc;
  }, {});

  const totalQuantity = Object.values(quantities).reduce((sum, q) => sum + (Number(q) || 0), 0);
  const avgThroughput = totalSumDuration > 0 ? (totalQuantity / totalSumDuration).toFixed(2) : '0.00';

  let nonWorkHtml = '';
  if (isWeekday(dateKey)) {
    const totalPotentialMinutes = activeMembersCount * 8 * 60; // 8시간 기준
    const nonWorkMinutes = Math.max(0, totalPotentialMinutes - totalSumDuration);
    const percentage = totalPotentialMinutes > 0 ? (nonWorkMinutes / totalPotentialMinutes * 100).toFixed(1) : 0;
    nonWorkHtml = `<div class="bg-white p-4 rounded-lg shadow-sm text-center"><h4 class="text-sm font-semibold text-gray-500">총 비업무시간</h4><p class="text-xl font-bold text-gray-700">${formatDuration(nonWorkMinutes)}</p><p class="text-xs text-gray-500 mt-1">(추정치, ${percentage}%)</p></div>`;
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

  html += `<div class="bg-white p-4 rounded-lg shadow-sm"><h4 class="text-lg font-bold mb-3 text-gray-700">업무별 개당 처리비용</h4><div class="space-y-2 max-h-48 overflow-y-auto">`;
  let hasCostPerItem = false;
  Object.entries(quantities)
    .filter(([, qty]) => Number(qty) > 0)
    .sort(([a],[b]) => a.localeCompare(b))
    .forEach(([task, qty]) => {
      hasCostPerItem = true;
      const costForTask = taskCosts[task] || 0;
      const qtyNum = Number(qty) || 1;
      const costPerItem = costForTask / qtyNum;
      html += `<div class="flex justify-between items-center text-sm border-b pb-1"><span class="font-semibold text-gray-600">${task}</span><span>${costPerItem.toFixed(0)} 원/개</span></div>`;
    });
  if (!hasCostPerItem) html += `<p class="text-gray-500 text-sm">처리량이 없어 계산 불가.</p>`;
  html += `</div></div>`;

  html += `</div>`;

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

window.requestHistoryDeletion = (dateKey) => {
  historyKeyToDelete = dateKey;
  if (deleteHistoryModal) deleteHistoryModal.classList.remove('hidden');
};


window.downloadHistoryAsExcel = async (dateKey) => {
    // ... (이전과 동일) ...
    try {
        const data = allHistoryData.find(d => d.id === dateKey);
        if (!data || !data.workRecords || data.workRecords.length === 0) {
            return showToast('다운로드할 업무 기록이 없습니다.', true);
        }
        const records = data.workRecords;
        const quantities = data.taskQuantities || {};
        const partTimersFromHistory = data.partTimers || [];

        const wageMap = { ...appConfig.memberWages };
        partTimersFromHistory.forEach(pt => {
            if (!wageMap[pt.name]) {
                wageMap[pt.name] = pt.wage || 0;
            }
        });

        const appendTotalRow = (ws, data, headers) => {
            if (!data || data.length === 0) return;
            const total = {};
            const sums = {};

            headers.forEach(header => {
                if (header.includes('(분)') || header.includes('(원)') || header.includes('(개)')) {
                    sums[header] = data.reduce((acc, row) => acc + (Number(row[header]) || 0), 0);
                }
            });

            headers.forEach((header, index) => {
                if (index === 0) {
                    total[header] = '총 합계';
                } else if (header.includes('(분)') || header.includes('총 인건비(원)') || header.includes('총 처리량(개)')) {
                    total[header] = Math.round(sums[header]);
                } else if (header === '개당 처리비용(원)') {
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
        if (sheet1Data.length > 0) appendTotalRow(worksheet1, sheet1Data, sheet1Headers);

        const sheet2Headers = ['업무 종류', '총 소요 시간(분)', '총 인건비(원)', '총 처리량(개)', '개당 처리비용(원)'];
        const summaryByTask = {};
        records.forEach(r => {
            if (!summaryByTask[r.task]) summaryByTask[r.task] = { totalDuration: 0, totalCost: 0 };
            const wage = wageMap[r.member] || 0;
            const cost = ((Number(r.duration) || 0) / 60) * wage;
            summaryByTask[r.task].totalDuration += (Number(r.duration) || 0);
            summaryByTask[r.task].totalCost += cost;
        });

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
        if (sheet2Data.length > 0) appendTotalRow(worksheet2, sheet2Data, sheet2Headers);

        const sheet3Headers = ['파트', '총 인건비(원)'];
        const memberToPartMap = new Map();
        (appConfig.teamGroups || []).forEach(group => group.members.forEach(member => memberToPartMap.set(member, group.name)));
        const summaryByPart = {};
        records.forEach(r => {
            const part = memberToPartMap.get(r.member) || '알바'; // 파트 없으면 알바로 간주
            if (!summaryByPart[part]) summaryByPart[part] = { totalCost: 0 };
            const wage = wageMap[r.member] || 0;
            const cost = ((Number(r.duration) || 0) / 60) * wage;
            summaryByPart[part].totalCost += cost;
        });
        const sheet3Data = Object.keys(summaryByPart).sort().map(part => ({
            '파트': part,
            '총 인건비(원)': Math.round(summaryByPart[part].totalCost)
        }));
        const worksheet3 = XLSX.utils.json_to_sheet(sheet3Data, { header: sheet3Headers });
        if (sheet3Data.length > 0) appendTotalRow(worksheet3, sheet3Data, sheet3Headers);

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

        if (worksheet1) fitToColumn(worksheet1);
        if (worksheet2) fitToColumn(worksheet2);
        if (worksheet3) fitToColumn(worksheet3);

        const workbook = XLSX.utils.book_new();
        if (worksheet1) XLSX.utils.book_append_sheet(workbook, worksheet1, '상세 기록');
        if (worksheet2) XLSX.utils.book_append_sheet(workbook, worksheet2, '업무별 요약');
        if (worksheet3) XLSX.utils.book_append_sheet(workbook, worksheet3, '파트별 인건비');

        XLSX.writeFile(workbook, `업무기록_${dateKey}.xlsx`);
    } catch (error) {
        console.error('Excel export failed:', error);
        showToast('Excel 파일 생성에 실패했습니다.', true);
    }
};

window.downloadAttendanceHistoryAsExcel = async (dateKey) => {
    // ... (이전과 동일) ...
};

const switchHistoryView = (view) => {
  // ... (이전과 동일) ...
  const allViews = [
      document.getElementById('history-daily-view'),
      document.getElementById('history-weekly-view'),
      document.getElementById('history-monthly-view'),
      document.getElementById('history-attendance-daily-view'),
      document.getElementById('history-attendance-weekly-view'),
      document.getElementById('history-attendance-monthly-view')
  ];
  allViews.forEach(v => v && v.classList.add('hidden'));

  if (historyTabs) {
      historyTabs.querySelectorAll('button').forEach(btn => {
          btn.classList.remove('font-semibold', 'text-blue-600', 'border-blue-600', 'border-b-2');
          btn.classList.add('text-gray-500');
      });
  }
  if (attendanceHistoryTabs) {
      attendanceHistoryTabs.querySelectorAll('button').forEach(btn => {
          btn.classList.remove('font-semibold', 'text-blue-600', 'border-blue-600', 'border-b-2');
          btn.classList.add('text-gray-500');
      });
  }

  const dateListContainer = document.getElementById('history-date-list-container');
  const isDailyView = view.includes('daily');
  if (dateListContainer) {
      dateListContainer.style.display = isDailyView ? 'block' : 'none';
  }

  let selectedDateKey = null;
  const selectedDateBtn = historyDateList?.querySelector('button.font-bold');
  if (selectedDateBtn) {
    selectedDateKey = selectedDateBtn.dataset.key;
  }

  let viewToShow = null;
  let tabToActivate = null;

  switch(view) {
      case 'daily':
          viewToShow = document.getElementById('history-daily-view');
          tabToActivate = historyTabs?.querySelector('button[data-view="daily"]');
          if (selectedDateKey) renderHistoryDetail(selectedDateKey);
          else if (viewToShow) viewToShow.innerHTML = '<div class="text-center text-gray-500 p-8">왼쪽 목록에서 날짜를 선택하세요.</div>';
          break;
      case 'weekly':
          viewToShow = document.getElementById('history-weekly-view');
          tabToActivate = historyTabs?.querySelector('button[data-view="weekly"]');
          renderWeeklyHistory(allHistoryData, appConfig); // appConfig 전달
          break;
      case 'monthly':
          viewToShow = document.getElementById('history-monthly-view');
          tabToActivate = historyTabs?.querySelector('button[data-view="monthly"]');
          renderMonthlyHistory(allHistoryData, appConfig); // appConfig 전달
          break;
      case 'attendance-daily':
          viewToShow = document.getElementById('history-attendance-daily-view');
          tabToActivate = attendanceHistoryTabs?.querySelector('button[data-view="attendance-daily"]');
          if (selectedDateKey) renderAttendanceDailyHistory(selectedDateKey, allHistoryData);
          else if (viewToShow) viewToShow.innerHTML = '<div class="text-center text-gray-500 p-8">왼쪽 목록에서 날짜를 선택하세요.</div>';
          break;
      case 'attendance-weekly':
          viewToShow = document.getElementById('history-attendance-weekly-view');
          tabToActivate = attendanceHistoryTabs?.querySelector('button[data-view="attendance-weekly"]');
          renderAttendanceWeeklyHistory(allHistoryData);
          break;
      case 'attendance-monthly':
          viewToShow = document.getElementById('history-attendance-monthly-view');
          tabToActivate = attendanceHistoryTabs?.querySelector('button[data-view="attendance-monthly"]');
          renderAttendanceMonthlyHistory(allHistoryData);
          break;
  }

  if (viewToShow) viewToShow.classList.remove('hidden');
  if (tabToActivate) {
      tabToActivate.classList.add('font-semibold', 'text-blue-600', 'border-blue-600', 'border-b-2');
      tabToActivate.classList.remove('text-gray-500');
  }
};


// ========== 이벤트 리스너 ==========
// ... (모든 이벤트 리스너 코드는 이전과 동일) ...
if (teamStatusBoard) {
  teamStatusBoard.addEventListener('click', (e) => {
    const stopGroupButton = e.target.closest('.stop-work-group-btn');
    if (stopGroupButton) { stopWorkGroup(Number(stopGroupButton.dataset.groupId)); return; }
    const pauseGroupButton = e.target.closest('.pause-work-group-btn');
    if (pauseGroupButton) { pauseWorkGroup(Number(pauseGroupButton.dataset.groupId)); return; }
    const resumeGroupButton = e.target.closest('.resume-work-group-btn');
    if (resumeGroupButton) { resumeWorkGroup(Number(resumeGroupButton.dataset.groupId)); return; }

    const individualPauseBtn = e.target.closest('[data-action="pause-individual"]');
    if (individualPauseBtn) {
        e.stopPropagation();
        pauseWorkIndividual(individualPauseBtn.dataset.recordId);
        return;
    }

    const individualResumeBtn = e.target.closest('[data-action="resume-individual"]');
    if (individualResumeBtn) {
        e.stopPropagation();
        resumeWorkIndividual(individualResumeBtn.dataset.recordId);
        return;
    }

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
      if (isWorking) {
          return showToast(`${memberName}님은 현재 업무 중이므로 근태 상태를 변경할 수 없습니다.`, true);
      }

      const combinedOnLeaveMembers = [...(appState.dailyOnLeaveMembers || []), ...(appState.dateBasedOnLeaveMembers || [])];
      const currentLeaveEntry = combinedOnLeaveMembers.find(item => item.member === memberName && !(item.type === '외출' && item.endTime));


      if (currentLeaveEntry) {
          const leaveType = currentLeaveEntry.type;
          memberToCancelLeave = memberName;

          if(cancelLeaveConfirmMessage) {
              if (leaveType === '외출') {
                  cancelLeaveConfirmMessage.textContent = `${memberName}님을 '복귀' 처리하시겠습니까?`;
                  if (confirmCancelLeaveBtn) confirmCancelLeaveBtn.textContent = '예, 복귀합니다';
              } else {
                  cancelLeaveConfirmMessage.textContent = `${memberName}님의 '${leaveType}' 상태를 '취소'하시겠습니까?`;
                  if (confirmCancelLeaveBtn) confirmCancelLeaveBtn.textContent = '예, 취소합니다';
              }
          }
          if(cancelLeaveConfirmModal) cancelLeaveConfirmModal.classList.remove('hidden');

      } else {
          memberToSetLeave = memberName;
          if(leaveMemberNameSpan) leaveMemberNameSpan.textContent = memberName;
          renderLeaveTypeModalOptions(LEAVE_TYPES);

          if(leaveStartDateInput) leaveStartDateInput.value = getTodayDateString();
          if(leaveEndDateInput) leaveEndDateInput.value = '';
          const firstRadio = leaveTypeOptionsContainer?.querySelector('input[type="radio"]');
          if (firstRadio) {
              const initialType = firstRadio.value;
              if (leaveDateInputsDiv) leaveDateInputsDiv.classList.toggle('hidden', !(initialType === '연차' || initialType === '출장' || initialType === '결근'));
          } else if (leaveDateInputsDiv) {
               leaveDateInputsDiv.classList.add('hidden');
          }
          if(leaveTypeModal) leaveTypeModal.classList.remove('hidden');
      }
      return;
    }

    const card = e.target.closest('div[data-action]');
    if (card) {
      if (e.target.closest('button, .members-list')) return;
      const action = card.dataset.action;
      const task = card.dataset.task;
      if (action === 'start-task') {
        selectedTaskForStart = task; selectedGroupForAdd = null;
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
    const deleteBtn = e.target.closest('button[data-action="delete"]');
    if (deleteBtn) {
      recordToDeleteId = deleteBtn.dataset.recordId;
      deleteMode = 'single';
      const msgEl = document.getElementById('delete-confirm-message');
      if (msgEl) msgEl.textContent = '이 업무 기록을 삭제하시겠습니까?';
      if (deleteConfirmModal) deleteConfirmModal.classList.remove('hidden');
      return;
    }
    const editBtn = e.target.closest('button[data-action="edit"]');
    if (editBtn) {
      recordToEditId = editBtn.dataset.recordId;
      const record = (appState.workRecords || []).find(r => String(r.id) === String(recordToEditId));
      if (record) {
        document.getElementById('edit-member-name').value = record.member;
        document.getElementById('edit-start-time').value = record.startTime || '';
        document.getElementById('edit-end-time').value = record.endTime || '';

        const taskSelect = document.getElementById('edit-task-type');
        taskSelect.innerHTML = ''; // Clear options
        const allTasks = [].concat(...Object.values(appConfig.taskGroups || {}));
        allTasks.forEach(task => {
            const option = document.createElement('option');
            option.value = task;
            option.textContent = task;
            if (task === record.task) option.selected = true;
            taskSelect.appendChild(option);
        });

        if (editRecordModal) editRecordModal.classList.remove('hidden');
      }
      return;
    }
  });
}

if (deleteAllCompletedBtn) {
  deleteAllCompletedBtn.addEventListener('click', () => {
    deleteMode = 'all';
    const msgEl = document.getElementById('delete-confirm-message');
    if (msgEl) msgEl.textContent = '오늘 완료된 모든 업무 기록을 삭제하시겠습니까?';
    if (deleteConfirmModal) deleteConfirmModal.classList.remove('hidden');
  });
}

if (confirmDeleteBtn) {
  confirmDeleteBtn.addEventListener('click', () => {
    if (deleteMode === 'all') {
      appState.workRecords = (appState.workRecords || []).filter(r => r.status !== 'completed');
      showToast('완료된 모든 기록이 삭제되었습니다.');
    } else if (recordToDeleteId) {
      appState.workRecords = (appState.workRecords || []).filter(r => String(r.id) !== String(recordToDeleteId));
      showToast('선택한 기록이 삭제되었습니다.');
    }
    saveStateToFirestore();
    if (deleteConfirmModal) deleteConfirmModal.classList.add('hidden');
    recordToDeleteId = null;
    deleteMode = 'single';
  });
}

if (endShiftBtn) {
  endShiftBtn.addEventListener('click', () => {
    saveDayDataToHistory(false); // false = 마감 (초기화 아님)
    showToast('업무 마감 처리 완료. 오늘의 기록을 이력에 저장하고 초기화했습니다.');
  });
}

if (saveProgressBtn) {
  saveProgressBtn.addEventListener('click', saveProgress);
}

if (openHistoryBtn) {
  openHistoryBtn.addEventListener('click', async () => {
    if (historyModal) {
      historyModal.classList.remove('hidden');
      await loadAndRenderHistoryList();
    }
  });
}

if (closeHistoryBtn) {
  closeHistoryBtn.addEventListener('click', () => {
    if (historyModal) historyModal.classList.add('hidden');
  });
}

if (historyDateList) {
  historyDateList.addEventListener('click', (e) => {
    const btn = e.target.closest('.history-date-btn');
    if (btn) {
      historyDateList.querySelectorAll('button').forEach(b => b.classList.remove('bg-blue-100', 'font-bold'));
      btn.classList.add('bg-blue-100', 'font-bold');
      const dateKey = btn.dataset.key;
      const activeSubTabBtn = (activeMainHistoryTab === 'work')
        ? historyTabs?.querySelector('button.font-semibold')
        : attendanceHistoryTabs?.querySelector('button.font-semibold');
      const activeView = activeSubTabBtn ? activeSubTabBtn.dataset.view : (activeMainHistoryTab === 'work' ? 'daily' : 'attendance-daily');
      if (activeView === 'daily') {
        renderHistoryDetail(dateKey);
      } else if (activeView === 'attendance-daily') {
        renderAttendanceDailyHistory(dateKey, allHistoryData);
      }
    }
  });
}

if (historyTabs) {
  historyTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-view]');
    if (btn) {
      switchHistoryView(btn.dataset.view);
    }
  });
}

if (confirmHistoryDeleteBtn) {
  confirmHistoryDeleteBtn.addEventListener('click', async () => {
    if (historyKeyToDelete) {
      const historyDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'history', historyKeyToDelete);
      try {
        await deleteDoc(historyDocRef);
        showToast(`${historyKeyToDelete} 이력이 삭제되었습니다.`);
        await loadAndRenderHistoryList(); // 삭제 후 목록 새로고침
      } catch (e) {
        console.error('Error deleting history:', e);
        showToast('이력 삭제 중 오류 발생.', true);
      }
    }
    if (deleteHistoryModal) deleteHistoryModal.classList.add('hidden');
    historyKeyToDelete = null;
  });
}

if (historyMainTabs) {
  historyMainTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-main-tab]');
    if (btn) {
      const tabName = btn.dataset.mainTab;
      activeMainHistoryTab = tabName; // 현재 활성 탭 상태 저장

      // 모든 메인 탭 스타일 초기화
      document.querySelectorAll('.history-main-tab-btn').forEach(b => {
          b.classList.remove('font-semibold', 'text-blue-600', 'border-b-2', 'border-blue-600');
          b.classList.add('font-medium', 'text-gray-500');
      });
      // 클릭된 탭 활성화
      btn.classList.add('font-semibold', 'text-blue-600', 'border-b-2', 'border-blue-600');
      btn.classList.remove('font-medium', 'text-gray-500');

      // 패널 교체
      if (tabName === 'work') {
        if (workHistoryPanel) workHistoryPanel.classList.remove('hidden');
        if (attendanceHistoryPanel) attendanceHistoryPanel.classList.add('hidden');
        // 현재 활성화된 서브 탭 뷰로 전환
        const activeSubTabBtn = historyTabs?.querySelector('button.font-semibold');
        const view = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'daily';
        switchHistoryView(view);
      } else { // 'attendance'
        if (workHistoryPanel) workHistoryPanel.classList.add('hidden');
        if (attendanceHistoryPanel) attendanceHistoryPanel.classList.remove('hidden');
        // 현재 활성화된 서브 탭 뷰로 전환
        const activeSubTabBtn = attendanceHistoryTabs?.querySelector('button.font-semibold');
        const view = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'attendance-daily';
        switchHistoryView(view);
      }
    }
  });
}

// [수정] 이력 - 근태 탭 (일별/주별/월별)
if (attendanceHistoryTabs) {
  attendanceHistoryTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-view]');
    if (btn) {
      switchHistoryView(btn.dataset.view);
    }
  });
}

// [수정] 앱 초기화 버튼
if (resetAppBtn) {
  resetAppBtn.addEventListener('click', () => {
    if (resetAppModal) resetAppModal.classList.remove('hidden');
  });
}

// [수정] 앱 초기화 확인
if (confirmResetAppBtn) {
  confirmResetAppBtn.addEventListener('click', async () => {
    await saveDayDataToHistory(true); // true = reset
    if (resetAppModal) resetAppModal.classList.add('hidden');
  });
}

// [수정] 처리량 모달 확인
if (confirmQuantityBtn) {
  confirmQuantityBtn.addEventListener('click', () => {
    const inputs = quantityModal.querySelectorAll('input[data-task]');
    const newQuantities = {};
    inputs.forEach(input => {
      const task = input.dataset.task;
      const quantity = Number(input.value) || 0;
      if (quantity > 0) newQuantities[task] = quantity;
    });
    // 컨텍스트에 저장된 콜백 실행
    if (quantityModalContext.onConfirm) {
      quantityModalContext.onConfirm(newQuantities);
    }
    if (quantityModal) quantityModal.classList.add('hidden');
  });
}

// [수정] 기록 수정 확인
if (confirmEditBtn) {
  confirmEditBtn.addEventListener('click', () => {
    if (!recordToEditId) return;
    const idx = appState.workRecords.findIndex(r => String(r.id) === String(recordToEditId));
    if (idx === -1) {
      showToast('수정할 기록을 찾을 수 없습니다.', true);
      if (editRecordModal) editRecordModal.classList.add('hidden');
      recordToEditId = null;
      return;
    }

    const record = appState.workRecords[idx];
    const newTask = document.getElementById('edit-task-type').value;
    const newStart = document.getElementById('edit-start-time').value;
    const newEnd = document.getElementById('edit-end-time').value;

    if (!newStart || !newEnd || !newTask) {
      showToast('모든 필드를 올바르게 입력해주세요.', true);
      return;
    }

    if (newEnd < newStart) {
        showToast('종료 시간은 시작 시간보다 이후여야 합니다.', true);
        return;
    }

    // 데이터 업데이트
    record.task = newTask;
    record.startTime = newStart;
    record.endTime = newEnd;
    record.duration = calcElapsedMinutes(newStart, newEnd, record.pauses); // 재계산

    saveStateToFirestore();
    showToast('기록이 수정되었습니다.');
    if (editRecordModal) editRecordModal.classList.add('hidden');
    recordToEditId = null;
  });
}

// [수정] 그룹 종료 시 처리량 입력 확인
if (confirmQuantityOnStopBtn) {
  confirmQuantityOnStopBtn.addEventListener('click', () => {
    if (groupToStopId) {
      const input = document.getElementById('quantity-on-stop-input');
      const quantity = input ? (Number(input.value) || 0) : null;
      finalizeStopGroup(groupToStopId, quantity);
      if(input) input.value = ''; // 입력값 초기화
    }
  });
}

// [수정] '기타 업무' 선택 모달
if (taskSelectModal) {
  taskSelectModal.addEventListener('click', (e) => {
    const btn = e.target.closest('.task-select-btn');
    if (btn) {
      const task = btn.dataset.task;
      if (taskSelectModal) taskSelectModal.classList.add('hidden');

      // 팀 선택 모달 열기 로직
      selectedTaskForStart = task;
      selectedGroupForAdd = null;
      renderTeamSelectionModalContent(task, appState, appConfig.teamGroups);
      const titleEl = document.getElementById('team-select-modal-title');
      if (titleEl) titleEl.textContent = `'${task}' 업무 시작`;
      if (teamSelectModal) teamSelectModal.classList.remove('hidden');
    }
  });
}

// [수정] 개인 업무 종료 확인
if (confirmStopIndividualBtn) {
  confirmStopIndividualBtn.addEventListener('click', () => {
    if (recordToStopId) {
      stopWorkIndividual(recordToStopId);
    }
    if (stopIndividualConfirmModal) stopIndividualConfirmModal.classList.add('hidden');
    recordToStopId = null;
  });
}

if (confirmLeaveBtn) confirmLeaveBtn.addEventListener('click', async () => {
    if (!memberToSetLeave) return;

    const selectedTypeInput = document.querySelector('input[name="leave-type"]:checked');
    if (!selectedTypeInput) {
        showToast('근태 유형을 선택해주세요.', true);
        return;
    }
    const leaveType = selectedTypeInput.value;
    const leaveData = { member: memberToSetLeave, type: leaveType };

    if (leaveType === '외출' || leaveType === '조퇴') {
        leaveData.startTime = getCurrentTime();
        if (leaveType === '조퇴') leaveData.endTime = "17:30";

        appState.dailyOnLeaveMembers = appState.dailyOnLeaveMembers.filter(item => item.member !== memberToSetLeave);
        appState.dailyOnLeaveMembers.push(leaveData);
        await saveStateToFirestore();

    } else if (leaveType === '연차' || leaveType === '출장' || leaveType === '결근') {
        const startDate = leaveStartDateInput?.value;
        const endDate = leaveEndDateInput?.value;
        if (!startDate) { showToast('시작일을 입력해주세요.', true); return; }
        leaveData.startDate = startDate;
        if (endDate) {
            if (endDate < startDate) { showToast('종료일은 시작일보다 이후여야 합니다.', true); return; }
            leaveData.endDate = endDate;
        }

        persistentLeaveSchedule.onLeaveMembers = persistentLeaveSchedule.onLeaveMembers.filter(item => item.member !== memberToSetLeave);
        persistentLeaveSchedule.onLeaveMembers.push(leaveData);
        await saveLeaveSchedule(db, persistentLeaveSchedule);
    }

    showToast(`${memberToSetLeave}님을 '${leaveType}'(으)로 설정했습니다.`);
    if(leaveTypeModal) leaveTypeModal.classList.add('hidden');
    memberToSetLeave = null;
});

if (confirmCancelLeaveBtn) {
    confirmCancelLeaveBtn.addEventListener('click', async () => {
        if (!memberToCancelLeave) return;

        const todayDateString = getTodayDateString();
        let actionTaken = false;

        const dailyIndex = appState.dailyOnLeaveMembers.findIndex(item => item.member === memberToCancelLeave);
        if (dailyIndex > -1) {
            const entry = appState.dailyOnLeaveMembers[dailyIndex];
            if (entry.type === '외출') {
                entry.endTime = getCurrentTime();
                showToast(`${memberToCancelLeave}님이 복귀 처리되었습니다.`);
                actionTaken = true;
            } else {
                appState.dailyOnLeaveMembers.splice(dailyIndex, 1);
                showToast(`${memberToCancelLeave}님의 '${entry.type}' 상태가 취소되었습니다.`);
                actionTaken = true;
            }
            await saveStateToFirestore();
        }

        const persistentIndex = persistentLeaveSchedule.onLeaveMembers.findIndex(item => item.member === memberToCancelLeave);
        if (persistentIndex > -1) {
            const entry = persistentLeaveSchedule.onLeaveMembers[persistentIndex];
            const isLeaveActiveToday = entry.startDate <= todayDateString && (!entry.endDate || todayDateString <= entry.endDate);

            if (isLeaveActiveToday) {
                const today = new Date();
                today.setDate(today.getDate() - 1);
                const yesterday = today.toISOString().split('T')[0];
                if (yesterday < entry.startDate) {
                    persistentLeaveSchedule.onLeaveMembers.splice(persistentIndex, 1);
                    showToast(`${memberToCancelLeave}님의 '${entry.type}' 일정이 취소되었습니다.`);
                } else {
                    entry.endDate = yesterday;
                    showToast(`${memberToCancelLeave}님이 복귀 처리되었습니다. (${entry.type}이 ${yesterday}까지로 수정됨)`);
                }
            } else {
                persistentLeaveSchedule.onLeaveMembers.splice(persistentIndex, 1);
                showToast(`${memberToCancelLeave}님의 '${entry.type}' 일정이 취소되었습니다.`);
            }
            await saveLeaveSchedule(db, persistentLeaveSchedule);
            actionTaken = true;
        }

        if (!actionTaken) {
             showToast(`${memberToCancelLeave}님의 근태 정보를 찾을 수 없습니다.`, true);
        }

        if(cancelLeaveConfirmModal) cancelLeaveConfirmModal.classList.add('hidden');
        memberToCancelLeave = null;
    });
}

// [수정] 모달 공통 닫기 버튼 ('X' 버튼) 리스너
document.querySelectorAll('.modal-close-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
      const modal = e.target.closest('.fixed.inset-0');
      if (!modal) return;

      modal.classList.add('hidden');

      const modalId = modal.id;
      if (modalId === 'leave-type-modal') {
          memberToSetLeave = null;
          if(leaveDateInputsDiv) leaveDateInputsDiv.classList.add('hidden');
          const firstRadio = leaveTypeOptionsContainer?.querySelector('input[type="radio"]');
          if (firstRadio) firstRadio.checked = true;
      } else if (modalId === 'cancel-leave-confirm-modal') {
          memberToCancelLeave = null;
      } else if (modalId === 'team-select-modal') {
          tempSelectedMembers = [];
          selectedTaskForStart = null;
          selectedGroupForAdd = null;
          modal.querySelectorAll('button[data-member-name].ring-2').forEach(card => {
              card.classList.remove('ring-2','ring-blue-500','bg-blue-100');
          });
      } else if (modalId === 'delete-confirm-modal') {
          recordToDeleteId = null;
          deleteMode = 'single';
      } else if (modalId === 'delete-history-modal') {
          historyKeyToDelete = null;
      } else if (modalId === 'edit-record-modal') {
          recordToEditId = null;
      } else if (modalId === 'quantity-on-stop-modal') {
          groupToStopId = null;
          const input = document.getElementById('quantity-on-stop-input');
          if(input) input.value = '';
      } else if (modalId === 'stop-individual-confirm-modal') {
          recordToStopId = null;
      } else if (modalId === 'history-modal') {
          // '이력 보기' 모달 닫기
      }
      // 다른 모달 ID에 대한 초기화 로직 추가...
  });
});

// 나머지 닫기 버튼들 및 모달 관련 리스너 (일부 ID 중복될 수 있으므로 확인)
if (cancelCancelLeaveBtn) cancelCancelLeaveBtn.addEventListener('click', () => { if(cancelLeaveConfirmModal) cancelLeaveConfirmModal.classList.add('hidden'); memberToCancelLeave = null; });
if (cancelLeaveBtn) cancelLeaveBtn.addEventListener('click', () => { if(leaveTypeModal) leaveTypeModal.classList.add('hidden'); memberToSetLeave = null; });
if (cancelDeleteBtn) cancelDeleteBtn.addEventListener('click', () => { if(deleteConfirmModal) deleteConfirmModal.classList.add('hidden'); recordToDeleteId = null; });
if (cancelQuantityBtn) cancelQuantityBtn.addEventListener('click', () => { if (quantityModalContext.onCancel) quantityModalContext.onCancel(); if(quantityModal) quantityModal.classList.add('hidden'); });
if (cancelHistoryDeleteBtn) cancelHistoryDeleteBtn.addEventListener('click', () => { if(deleteHistoryModal) deleteHistoryModal.classList.add('hidden'); historyKeyToDelete = null; });
if (cancelEditBtn) cancelEditBtn.addEventListener('click', () => { if(editRecordModal) editRecordModal.classList.add('hidden'); recordToEditId = null; });
if (cancelResetAppBtn) cancelResetAppBtn.addEventListener('click', () => { if(resetAppModal) resetAppModal.classList.add('hidden'); });
if (cancelQuantityOnStopBtn) cancelQuantityOnStopBtn.addEventListener('click', () => { if(quantityOnStopModal) quantityOnStopModal.classList.add('hidden'); groupToStopId = null; });
if (cancelStopIndividualBtn) cancelStopIndividualBtn.addEventListener('click', () => { if(stopIndividualConfirmModal) stopIndividualConfirmModal.classList.add('hidden'); recordToStopId = null; });
if (cancelEditPartTimerBtn) cancelEditPartTimerBtn.addEventListener('click', () => { if(editPartTimerModal) editPartTimerModal.classList.add('hidden'); });
if (cancelTeamSelectBtn) cancelTeamSelectBtn.addEventListener('click', () => {
     if(teamSelectModal) teamSelectModal.classList.add('hidden');
     tempSelectedMembers = []; selectedTaskForStart = null; selectedGroupForAdd = null;
     teamSelectModal.querySelectorAll('button[data-member-name].ring-2').forEach(card => {
        card.classList.remove('ring-2','ring-blue-500','bg-blue-100');
     });
});

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

if (teamSelectModal) teamSelectModal.addEventListener('click', e => {
    const card = e.target.closest('button[data-member-name]');
    if (card && !card.disabled) {
        const memberName = card.dataset.memberName;
        const i = tempSelectedMembers.indexOf(memberName);
        if (i > -1) { tempSelectedMembers.splice(i,1); card.classList.remove('ring-2','ring-blue-500','bg-blue-100'); }
        else { tempSelectedMembers.push(memberName); card.classList.add('ring-2','ring-blue-500','bg-blue-100'); }
        return;
    }

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

    const addPartTimerBtn = e.target.closest('#add-part-timer-modal-btn');
    if (addPartTimerBtn) {
        appState.partTimers = appState.partTimers || [];
        let counter = appState.partTimers.length + 1;
        const baseName = '알바 ';
        const existingNames = (appConfig.teamGroups || []).flatMap(g => g.members).concat(appState.partTimers.map(p => p.name));
        let newName = `${baseName}${counter}`;
        while (existingNames.includes(newName)) { counter++; newName = `${baseName}${counter}`; }

        const newId = Date.now();
        const newWage = appConfig.defaultPartTimerWage || 10000;
        appState.partTimers.push({ id: newId, name: newName, wage: newWage });

        saveStateToFirestore().then(() => renderTeamSelectionModalContent(selectedTaskForStart, appState, appConfig.teamGroups));
        return;
    }

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

    const deletePartTimerBtn = e.target.closest('.delete-part-timer-btn');
    if (deletePartTimerBtn) {
        const id = Number(deletePartTimerBtn.dataset.partTimerId);
        appState.partTimers = (appState.partTimers || []).filter(p => p.id !== id);
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

    const allNamesNorm = (appConfig.teamGroups || []).flatMap(g => g.members).map(normalizeName)
        .concat((appState.partTimers || []).filter((p, i) => i !== idx).map(p => normalizeName(p.name)));
    if (allNamesNorm.includes(nNew)) { showToast('해당 이름은 이미 사용 중입니다.', true); return; }

    const oldName = partTimer.name;
    appState.partTimers[idx] = { ...partTimer, name: newName };
    appState.workRecords = (appState.workRecords || []).map(r => (r.member === oldName ? { ...r, member: newName } : r));
    saveStateToFirestore().then(() => {
        renderTeamSelectionModalContent(selectedTaskForStart, appState, appConfig.teamGroups);
        if (editPartTimerModal) editPartTimerModal.classList.add('hidden');
        showToast('알바 이름이 수정되었습니다.');
    });
});
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
async function main() {
  if (connectionStatusEl) connectionStatusEl.textContent = '연결 중...';
  if (statusDotEl) statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-yellow-500 animate-pulse';

  appState = { workRecords: [], taskQuantities: {}, dailyOnLeaveMembers: [], dateBasedOnLeaveMembers: [], partTimers: [], hiddenGroupIds: [] };

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

  try {
      if (connectionStatusEl) connectionStatusEl.textContent = '설정 로딩 중...';
      appConfig = await loadAppConfig(db);
      persistentLeaveSchedule = await loadLeaveSchedule(db);

      const loadingSpinner = document.getElementById('loading-spinner');
      if (loadingSpinner) loadingSpinner.style.display = 'none';

      renderTaskSelectionModal(appConfig.taskGroups);
  } catch (e) {
      console.error("설정 로드 실패:", e);
      showToast("설정 정보 로드에 실패했습니다. 기본값으로 실행합니다.", true);
      const loadingSpinner = document.getElementById('loading-spinner');
      if (loadingSpinner) loadingSpinner.style.display = 'none';
  }

  displayCurrentDate();
  if (elapsedTimeTimer) clearInterval(elapsedTimeTimer);
  elapsedTimeTimer = setInterval(updateElapsedTimes, 1000);

  const taskTypes = [].concat(...Object.values(appConfig.taskGroups || {}));
  const defaultQuantities = {};
  taskTypes.forEach(task => defaultQuantities[task] = 0);
  appState.taskQuantities = { ...defaultQuantities, ...appState.taskQuantities };

  // [수정] 인증 및 *두 개의* 스냅샷 리스너 설정
  onAuthStateChanged(auth, async user => {
    if (user) {
      // 1. [수정] 영구 근태 일정 리스너 -> dateBasedOnLeaveMembers만 업데이트
      const leaveScheduleDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'persistent_data', 'leaveSchedule');
      if (unsubscribeLeaveSchedule) unsubscribeLeaveSchedule();
      unsubscribeLeaveSchedule = onSnapshot(leaveScheduleDocRef, (docSnap) => {
          persistentLeaveSchedule = docSnap.exists() ? docSnap.data() : { onLeaveMembers: [] };

          const today = getTodayDateString();
          appState.dateBasedOnLeaveMembers = (persistentLeaveSchedule.onLeaveMembers || []).filter(entry => {
              if (entry.type === '연차' || entry.type === '출장' || entry.type === '결근') {
                  const endDate = entry.endDate || entry.startDate;
                  return entry.startDate && typeof entry.startDate === 'string' &&
                         today >= entry.startDate && today <= (endDate || entry.startDate);
              }
              return false;
          });

          render();
      }, (error) => {
          console.error("근태 일정 실시간 연결 실패:", error);
          showToast("근태 일정 연결에 실패했습니다.", true);
          appState.dateBasedOnLeaveMembers = [];
          render();
      });

      // 2. [수정] 일일 업무 데이터 리스너 -> dailyOnLeaveMembers만 업데이트
      const todayDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString());
      if (unsubscribeToday) unsubscribeToday();

      unsubscribeToday = onSnapshot(todayDocRef, (docSnap) => {
        try {
          const taskTypes = [].concat(...Object.values(appConfig.taskGroups || {}));
          const defaultQuantities = {};
          taskTypes.forEach(task => defaultQuantities[task] = 0);

          const loadedState = docSnap.exists() ? JSON.parse(docSnap.data().state || '{}') : {};

          appState.workRecords = loadedState.workRecords || [];
          appState.taskQuantities = { ...defaultQuantities, ...(loadedState.taskQuantities || {}) };
          appState.partTimers = loadedState.partTimers || [];
          appState.hiddenGroupIds = loadedState.hiddenGroupIds || [];
          appState.dailyOnLeaveMembers = loadedState.onLeaveMembers || [];

          render();
          if (connectionStatusEl) connectionStatusEl.textContent = '동기화';
          if (statusDotEl) statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-green-500';
        } catch (parseError) {
          console.error('Error parsing state from Firestore:', parseError);
          showToast('데이터 로딩 중 오류 발생 (파싱 실패).', true);
          appState = { workRecords: [], taskQuantities: {}, dailyOnLeaveMembers: [], dateBasedOnLeaveMembers: [], partTimers: [], hiddenGroupIds: [] };
          render();
          if (connectionStatusEl) connectionStatusEl.textContent = '데이터 오류';
          if (statusDotEl) statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
        }
      }, (error) => {
        console.error('Firebase onSnapshot error:', error);
        showToast('실시간 연결에 실패했습니다.', true);
        appState = { workRecords: [], taskQuantities: {}, dailyOnLeaveMembers: [], dateBasedOnLeaveMembers: [], partTimers: [], hiddenGroupIds: [] };
        render();
        if (connectionStatusEl) connectionStatusEl.textContent = '연결 오류';
        if (statusDotEl) statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
      });
    } else {
      if (connectionStatusEl) connectionStatusEl.textContent = '인증 필요';
      if (statusDotEl) statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-gray-400';
      if (unsubscribeToday) { unsubscribeToday(); unsubscribeToday = undefined; }
      if (unsubscribeLeaveSchedule) { unsubscribeLeaveSchedule(); unsubscribeLeaveSchedule = undefined; }
      appState = { workRecords: [], taskQuantities: {}, dailyOnLeaveMembers: [], dateBasedOnLeaveMembers: [], partTimers: [], hiddenGroupIds: [] };
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

main(); // 앱 시작