// === app.js (오늘의 처리량 모달, 이력 멤버 목록 토글, 자동 저장 기능 추가) ===

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
  renderMonthlyHistory,
  renderHistoryDetail // ✅ [이력 멤버] renderHistoryDetail import 확인
} from './ui.js';

// ========== DOM Elements ==========
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
const historyDailyView = document.getElementById('history-daily-view'); // ✅ [이력 멤버]
const editTodayQuantityBtn = document.getElementById('edit-today-quantity-btn'); // ✅ [오늘 처리량]

// ========== Firebase/App State ==========
let db, auth;
let unsubscribeToday;
let unsubscribeLeaveSchedule;
let elapsedTimeTimer = null;
let recordCounter = 0;

// ✅ [Auto-save] 자동 저장 관련 변수 추가
let isDataDirty = false; // '중간 저장'이 필요한 변경사항 감지 플래그
let autoSaveTimer = null; // 자동 저장 타이머 ID
const AUTO_SAVE_INTERVAL = 5 * 60 * 1000; // 5분 (300000 ms)

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
    keyTasks: []
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

// ✅ [Auto-save] '중간 저장'이 필요함을 표시하는 함수
const markDataAsDirty = () => {
    if (!isDataDirty) {
        // console.log("Auto-save: Data marked as dirty.");
    }
    isDataDirty = true;
};

// ✅ [Auto-save] 자동 저장 타이머가 호출할 함수
const autoSaveProgress = () => {
    if (isDataDirty) {
        // console.log("Auto-save: Dirty data found. Saving progress...");
        saveProgress(true); // true = 자동 저장 모드
    } else {
        // console.log("Auto-save: No changes to save.");
    }
};

// [수정] saveStateToFirestore: 'daily_data' 저장 및 'dirty' 플래그 설정
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
      onLeaveMembers: appState.dailyOnLeaveMembers || [],
      partTimers: appState.partTimers || [],
      hiddenGroupIds: appState.hiddenGroupIds || []
    }, (k, v) => (typeof v === 'function' ? undefined : v));

    if (stateToSave.length > 900000) {
      showToast('저장 데이터가 큽니다. 오래된 기록을 이력으로 옮기거나 정리하세요.', true);
      return;
    }

    await setDoc(docRef, { state: stateToSave });
    
    // ✅ [Auto-save] 'daily_data'가 변경되었다는 것은 'history'에도 영향을 줄 수 있음을 의미
    // (예: 알바생 추가/삭제, 근태 변경, 업무 완료 등)
    // 따라서 '중간 저장'이 필요하다고 표시(mark)합니다.
    markDataAsDirty();

  } catch (error) {
    console.error('Error saving state to Firestore:', error);
    showToast('데이터 동기화 중 오류 발생.', true);
  }
}

// ========== 업무 그룹/개인 제어 ==========
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

// [수정] '중간 저장' (history 저장) 함수
// isAutoSave 플래그를 받아 자동/수동 저장에 따라 다른 알림을 표시
async function saveProgress(isAutoSave = false) {
  const dateStr = getTodayDateString();
  
  // 수동 저장일 때만 시작 알림 표시
  if (!isAutoSave) {
    showToast('현재까지 완료된 기록을 저장합니다...');
  }
  
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

    // [수정] 저장할 내용이 없는지 검사
    if (completedRecordsFromState.length === 0 && Object.keys(currentQuantities).length === 0 && currentLeaveMembersCombined.length === 0 && currentPartTimers.length === 0 && !(existingData.onLeaveMembers?.length > 0) && !(existingData.partTimers?.length > 0)) {
        
        // 수동 저장일 때만 "저장할 내용 없음" 알림 표시
        if (!isAutoSave) {
            showToast('저장할 새로운 완료 기록, 처리량, 근태 정보 또는 알바 정보가 없습니다.', true);
        }
        
        isDataDirty = false; // 저장할 것이 없으므로 플래그 리셋
        // console.log("Auto-save: No changes to save, flag reset.");
        return;
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

    // [수정] 자동/수동에 따라 다른 성공 알림 표시
    if (isAutoSave) {
        showToast('진행 상황이 자동 저장되었습니다.', false);
    } else {
        showToast('현재까지의 기록이 성공적으로 저장되었습니다.');
    }
    
    // ✅ [Auto-save] 저장이 성공했으므로 dirty 플래그 리셋
    isDataDirty = false;
    // console.log("Auto-save: Data saved, flag reset.");

  } catch (e) {
    console.error('Error in saveProgress: ', e);
    showToast(`중간 저장 중 오류가 발생했습니다: ${e.message}`, true);
    // [중요] 저장 실패 시, isDataDirty 플래그를 리셋하지 않음
    // -> 다음 자동 저장 사이클(5분 뒤)에 다시 저장을 시도함
  }
}

// [수정] '업무 마감' 또는 '초기화' 시 호출되는 함수
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

  // [수정] 수동 저장(false)으로 saveProgress 호출
  await saveProgress(false); // 현재 상태를 이력에 저장

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

// ========== 이력 관련 함수 ==========
async function fetchAllHistoryData() {
  const historyCollectionRef = collection(db, 'artifacts', 'team-work-logger-v2', 'history');
  try {
    const querySnapshot = await getDocs(historyCollectionRef);
    allHistoryData = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      // Ensure essential data exists before adding
      if (data && ( (data.workRecords && data.workRecords.length > 0) || (data.onLeaveMembers && data.onLeaveMembers.length > 0) || (data.partTimers && data.partTimers.length > 0) )) {
         allHistoryData.push({ id: doc.id, ...data });
      }
    });
    // Sort descending by date (document ID)
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
    allHistoryData = []; // Clear previous data

    const historyData = await fetchAllHistoryData();

    if (historyData.length === 0) {
        historyDateList.innerHTML = '<li><div class="p-4 text-center text-gray-500">저장된 이력이 없습니다.</div></li>';
        // Clear all view panes if no history
        const viewsToClear = ['history-daily-view', 'history-weekly-view', 'history-monthly-view', 'history-attendance-daily-view', 'history-attendance-weekly-view', 'history-attendance-monthly-view'];
        viewsToClear.forEach(viewId => {
            const viewEl = document.getElementById(viewId);
            if (viewEl) viewEl.innerHTML = '';
        });
        return;
    }

    const dates = historyData.map(d => d.id);
    historyDateList.innerHTML = ''; // Clear loading message
    dates.forEach(dateKey => {
        const li = document.createElement('li');
        li.innerHTML = `<button data-key="${dateKey}" class="history-date-btn w-full text-left p-3 rounded-md hover:bg-blue-100 transition focus:outline-none focus:ring-2 focus:ring-blue-300">${dateKey}</button>`;
        historyDateList.appendChild(li);
    });

    // Automatically select and load the first date in the list
    if (historyDateList.firstChild) {
        const firstButton = historyDateList.firstChild.querySelector('button');
        if (firstButton) {
            firstButton.classList.add('bg-blue-100', 'font-bold'); // Highlight the first item
            // Determine the active sub-tab view (daily, weekly, etc.)
            const activeSubTabBtn = (activeMainHistoryTab === 'work')
                ? historyTabs?.querySelector('button.font-semibold')
                : attendanceHistoryTabs?.querySelector('button.font-semibold');
            const activeView = activeSubTabBtn ? activeSubTabBtn.dataset.view : (activeMainHistoryTab === 'work' ? 'daily' : 'attendance-daily');
            // Load the detail view for the selected date and active sub-tab
            switchHistoryView(activeView);
        }
    } else {
        // If somehow list is empty after fetch (should not happen if historyData > 0)
        switchHistoryView('daily'); // Default to daily view
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

  // Setup context for the quantity modal (history mode)
  quantityModalContext = {
    mode: 'history',
    dateKey,
    onConfirm: async (newQuantities) => {
      // Find the index of the data to update
      const idx = allHistoryData.findIndex(d => d.id === dateKey);
      if (idx === -1) return; // Should not happen if data was found initially
      // Update the local cache
      allHistoryData[idx] = { ...allHistoryData[idx], taskQuantities: newQuantities };
      // Update Firestore document
      const historyDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
      try {
        await setDoc(historyDocRef, allHistoryData[idx]); // Overwrite with updated data
        showToast(`${dateKey}의 처리량이 수정되었습니다.`);
         // Refresh the current view to reflect changes
         const activeSubTabBtn = historyTabs?.querySelector('button.font-semibold');
         const currentView = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'daily';
         switchHistoryView(currentView); // Reload daily, weekly or monthly view
      } catch (e) {
        console.error('Error updating history quantities:', e);
        showToast('처리량 업데이트 중 오류 발생.', true);
      }
    },
    onCancel: () => {} // No action needed on cancel
  };

  // Update modal button text for clarity
  const cBtn = document.getElementById('confirm-quantity-btn');
  const xBtn = document.getElementById('cancel-quantity-btn');
  if (cBtn) cBtn.textContent = '수정 저장';
  if (xBtn) xBtn.textContent = '취소';
  // Show the modal
  if (quantityModal) quantityModal.classList.remove('hidden');
};

// Note: renderHistoryDetail is now in ui.js

window.requestHistoryDeletion = (dateKey) => {
  historyKeyToDelete = dateKey;
  if (deleteHistoryModal) deleteHistoryModal.classList.remove('hidden');
};


window.downloadHistoryAsExcel = async (dateKey) => {
    try {
        const data = allHistoryData.find(d => d.id === dateKey);
        if (!data || !data.workRecords || data.workRecords.length === 0) {
            return showToast('다운로드할 업무 기록이 없습니다.', true);
        }
        const records = data.workRecords;
        const quantities = data.taskQuantities || {};
        const partTimersFromHistory = data.partTimers || [];

        // Combine base wages with history-specific part-timer wages
        const wageMap = { ...appConfig.memberWages };
        partTimersFromHistory.forEach(pt => {
            if (!wageMap[pt.name]) { // Only add if not already present (config might be newer)
                wageMap[pt.name] = pt.wage || 0;
            }
        });

        // Helper to add a 'Total' row to a worksheet
        const appendTotalRow = (ws, data, headers) => {
            if (!data || data.length === 0) return;
            const total = {};
            const sums = {};

            // Calculate sums for relevant columns
            headers.forEach(header => {
                if (header.includes('(분)') || header.includes('(원)') || header.includes('(개)')) {
                    sums[header] = data.reduce((acc, row) => acc + (Number(row[header]) || 0), 0);
                }
            });

            // Build the total row object
            headers.forEach((header, index) => {
                if (index === 0) {
                    total[header] = '총 합계';
                } else if (header.includes('(분)') || header.includes('총 인건비(원)') || header.includes('총 처리량(개)')) {
                    total[header] = Math.round(sums[header]);
                } else if (header === '개당 처리비용(원)') {
                    // Calculate overall cost per item
                    const totalCost = sums['총 인건비(원)'] || 0;
                    const totalQty = sums['총 처리량(개)'] || 0;
                    const totalCostPerItem = (totalQty > 0) ? (totalCost / totalQty) : 0;
                    total[header] = Math.round(totalCostPerItem);
                } else {
                    total[header] = ''; // Blank for non-numeric columns
                }
            });
            // Append the total row to the sheet
            XLSX.utils.sheet_add_json(ws, [total], { skipHeader: true, origin: -1 });
        };

        // --- Sheet 1: Detailed Records ---
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

        // --- Sheet 2: Summary by Task ---
        const sheet2Headers = ['업무 종류', '총 소요 시간(분)', '총 인건비(원)', '총 처리량(개)', '개당 처리비용(원)'];
        const summaryByTask = {};
        // Aggregate duration and cost per task
        records.forEach(r => {
            if (!summaryByTask[r.task]) summaryByTask[r.task] = { totalDuration: 0, totalCost: 0 };
            const wage = wageMap[r.member] || 0;
            const cost = ((Number(r.duration) || 0) / 60) * wage;
            summaryByTask[r.task].totalDuration += (Number(r.duration) || 0);
            summaryByTask[r.task].totalCost += cost;
        });
        // Map aggregated data to sheet format
        const sheet2Data = Object.keys(summaryByTask).sort().map(task => {
            const taskQty = Number(quantities[task]) || 0;
            const taskCost = summaryByTask[task].totalCost;
            const costPerItem = (taskQty > 0) ? (taskCost / taskQty) : 0; // Avoid division by zero

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

        // --- Sheet 3: Cost by Part/Group ---
        const sheet3Headers = ['파트', '총 인건비(원)'];
        const memberToPartMap = new Map();
        // Create a map from member name to their group name
        (appConfig.teamGroups || []).forEach(group => group.members.forEach(member => memberToPartMap.set(member, group.name)));
        const summaryByPart = {};
        // Aggregate cost per part/group
        records.forEach(r => {
            const part = memberToPartMap.get(r.member) || '알바'; // Default to '알바' if not in a group
            if (!summaryByPart[part]) summaryByPart[part] = { totalCost: 0 };
            const wage = wageMap[r.member] || 0;
            const cost = ((Number(r.duration) || 0) / 60) * wage;
            summaryByPart[part].totalCost += cost;
        });
        // Map aggregated data to sheet format
        const sheet3Data = Object.keys(summaryByPart).sort().map(part => ({
            '파트': part,
            '총 인건비(원)': Math.round(summaryByPart[part].totalCost)
        }));
        const worksheet3 = XLSX.utils.json_to_sheet(sheet3Data, { header: sheet3Headers });
        if (sheet3Data.length > 0) appendTotalRow(worksheet3, sheet3Data, sheet3Headers);

        // --- Auto-fit columns ---
        const fitToColumn = (ws) => {
            const objectMaxLength = [];
            // Get data as array of arrays
            const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
            if (!data || data.length === 0) return;
            // Calculate max width for header row
            if (data[0]) {
                Object.keys(data[0]).forEach((key, index) => {
                    objectMaxLength[index] = String(data[0][key]).length;
                });
            }
            // Calculate max width for data rows
            data.slice(1).forEach(row => {
                Object.keys(row).forEach((key, index) => {
                    const cellLength = String(row[key] ?? '').length; // Handle null/undefined
                    objectMaxLength[index] = Math.max(objectMaxLength[index] || 10, cellLength); // Use a minimum width
                });
            });
            // Set column widths with padding
            ws['!cols'] = objectMaxLength.map(w => ({ width: w + 2 }));
        };

        if (worksheet1) fitToColumn(worksheet1);
        if (worksheet2) fitToColumn(worksheet2);
        if (worksheet3) fitToColumn(worksheet3);

        // --- Create and Download Workbook ---
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
    try {
        const data = allHistoryData.find(d => d.id === dateKey);
        if (!data || !data.onLeaveMembers || data.onLeaveMembers.length === 0) {
            return showToast('다운로드할 근태 기록이 없습니다.', true);
        }
        const records = data.onLeaveMembers;
        // Prepare data for the sheet
        const sheetData = records
            .sort((a, b) => (a.member || '').localeCompare(b.member || '')) // Sort by member name
            .map(entry => {
                let detailText = '-';
                // Format time/date range
                if (entry.startTime) {
                    detailText = formatTimeTo24H(entry.startTime);
                    if (entry.endTime) detailText += ` ~ ${formatTimeTo24H(entry.endTime)}`;
                    else if (entry.type === '외출') detailText += ' ~'; // Indicate ongoing leave
                } else if (entry.startDate) {
                    detailText = entry.startDate;
                    if (entry.endDate && entry.endDate !== entry.startDate) detailText += ` ~ ${entry.endDate}`;
                }
                return {
                    '이름': entry.member || '',
                    '유형': entry.type || '',
                    '시간 / 기간': detailText
                };
            });
        
        const worksheet = XLSX.utils.json_to_sheet(sheetData, { header: ['이름', '유형', '시간 / 기간'] });

        // --- Auto-fit columns ---
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
        fitToColumn(worksheet);

        // --- Create and Download Workbook ---
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, '근태 기록');
        XLSX.writeFile(workbook, `근태기록_${dateKey}.xlsx`);

    } catch (error) {
        console.error('Attendance Excel export failed:', error);
        showToast('근태 Excel 파일 생성에 실패했습니다.', true);
    }
};

const switchHistoryView = (view) => {
  // Hide all view panels first
  const allViews = [
      document.getElementById('history-daily-view'),
      document.getElementById('history-weekly-view'),
      document.getElementById('history-monthly-view'),
      document.getElementById('history-attendance-daily-view'),
      document.getElementById('history-attendance-weekly-view'),
      document.getElementById('history-attendance-monthly-view')
  ];
  allViews.forEach(v => v && v.classList.add('hidden'));

  // Reset styles for all sub-tabs (both work and attendance)
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

  // Show/hide the date list based on whether it's a daily view
  const dateListContainer = document.getElementById('history-date-list-container');
  const isDailyView = view.includes('daily'); // Covers 'daily' and 'attendance-daily'
  if (dateListContainer) {
      dateListContainer.style.display = isDailyView ? 'block' : 'none';
  }

  // Get the currently selected date key from the list
  let selectedDateKey = null;
  const selectedDateBtn = historyDateList?.querySelector('button.font-bold');
  if (selectedDateBtn) {
    selectedDateKey = selectedDateBtn.dataset.key;
  }

  let viewToShow = null;
  let tabToActivate = null;

  // Determine which view panel and tab to activate based on the 'view' argument
  switch(view) {
      case 'daily':
          viewToShow = document.getElementById('history-daily-view');
          tabToActivate = historyTabs?.querySelector('button[data-view="daily"]');
          if (selectedDateKey) renderHistoryDetail(selectedDateKey); // Render daily details if a date is selected
          else if (viewToShow) viewToShow.innerHTML = '<div class="text-center text-gray-500 p-8">왼쪽 목록에서 날짜를 선택하세요.</div>'; // Prompt if no date selected
          break;
      case 'weekly':
          viewToShow = document.getElementById('history-weekly-view');
          tabToActivate = historyTabs?.querySelector('button[data-view="weekly"]');
          renderWeeklyHistory(allHistoryData, appConfig); // Render weekly summary
          break;
      case 'monthly':
          viewToShow = document.getElementById('history-monthly-view');
          tabToActivate = historyTabs?.querySelector('button[data-view="monthly"]');
          renderMonthlyHistory(allHistoryData, appConfig); // Render monthly summary
          break;
      case 'attendance-daily':
          viewToShow = document.getElementById('history-attendance-daily-view');
          tabToActivate = attendanceHistoryTabs?.querySelector('button[data-view="attendance-daily"]');
          if (selectedDateKey) renderAttendanceDailyHistory(selectedDateKey, allHistoryData); // Render daily attendance if date selected
          else if (viewToShow) viewToShow.innerHTML = '<div class="text-center text-gray-500 p-8">왼쪽 목록에서 날짜를 선택하세요.</div>';
          break;
      case 'attendance-weekly':
          viewToShow = document.getElementById('history-attendance-weekly-view');
          tabToActivate = attendanceHistoryTabs?.querySelector('button[data-view="attendance-weekly"]');
          renderAttendanceWeeklyHistory(allHistoryData); // Render weekly attendance summary
          break;
      case 'attendance-monthly':
          viewToShow = document.getElementById('history-attendance-monthly-view');
          tabToActivate = attendanceHistoryTabs?.querySelector('button[data-view="attendance-monthly"]');
          renderAttendanceMonthlyHistory(allHistoryData); // Render monthly attendance summary
          break;
  }

  // Show the selected view panel and highlight the corresponding tab
  if (viewToShow) viewToShow.classList.remove('hidden');
  if (tabToActivate) {
      tabToActivate.classList.add('font-semibold', 'text-blue-600', 'border-blue-600', 'border-b-2');
      tabToActivate.classList.remove('text-gray-500');
  }
};


// ========== 이벤트 리스너 ==========
if (teamStatusBoard) {
  teamStatusBoard.addEventListener('click', (e) => {
    // Stop Group Button
    const stopGroupButton = e.target.closest('.stop-work-group-btn');
    if (stopGroupButton) { stopWorkGroup(Number(stopGroupButton.dataset.groupId)); return; }
    // Pause Group Button
    const pauseGroupButton = e.target.closest('.pause-work-group-btn');
    if (pauseGroupButton) { pauseWorkGroup(Number(pauseGroupButton.dataset.groupId)); return; }
    // Resume Group Button
    const resumeGroupButton = e.target.closest('.resume-work-group-btn');
    if (resumeGroupButton) { resumeWorkGroup(Number(resumeGroupButton.dataset.groupId)); return; }

    // Pause Individual Button
    const individualPauseBtn = e.target.closest('[data-action="pause-individual"]');
    if (individualPauseBtn) {
        e.stopPropagation(); // Prevent card click action
        pauseWorkIndividual(individualPauseBtn.dataset.recordId);
        return;
    }

    // Resume Individual Button
    const individualResumeBtn = e.target.closest('[data-action="resume-individual"]');
    if (individualResumeBtn) {
        e.stopPropagation(); // Prevent card click action
        resumeWorkIndividual(individualResumeBtn.dataset.recordId);
        return;
    }

    // Stop Individual Button -> Show Confirmation Modal
    const individualStopBtn = e.target.closest('[data-action="stop-individual"]');
    if (individualStopBtn) {
      e.stopPropagation(); // Prevent card click action
      const recordId = individualStopBtn.dataset.recordId;
      const record = (appState.workRecords || []).find(r => String(r.id) === String(recordId));
      if (record) {
        recordToStopId = record.id;
        if (stopIndividualConfirmMessage) stopIndividualConfirmMessage.textContent = `${record.member}님의 '${record.task}' 업무를 종료하시겠습니까?`;
        if (stopIndividualConfirmModal) stopIndividualConfirmModal.classList.remove('hidden');
      }
      return;
    }

    // Member Card (for Leave Status Toggle)
    const memberCard = e.target.closest('[data-member-toggle-leave]');
    if (memberCard) {
      const memberName = memberCard.dataset.memberToggleLeave;

      // Check if member is currently working (cannot change leave status)
      const isWorking = (appState.workRecords || []).some(r => r.member === memberName && (r.status === 'ongoing' || r.status === 'paused'));
      if (isWorking) {
          return showToast(`${memberName}님은 현재 업무 중이므로 근태 상태를 변경할 수 없습니다.`, true);
      }

      // Check current leave status (including date-based leave)
      const combinedOnLeaveMembers = [...(appState.dailyOnLeaveMembers || []), ...(appState.dateBasedOnLeaveMembers || [])];
      const currentLeaveEntry = combinedOnLeaveMembers.find(item => item.member === memberName && !(item.type === '외출' && item.endTime)); // Exclude returned '외출'

      if (currentLeaveEntry) {
          // If currently on leave -> Show Cancel/Return Confirmation Modal
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
          // If not on leave -> Show Leave Type Selection Modal
          memberToSetLeave = memberName;
          if(leaveMemberNameSpan) leaveMemberNameSpan.textContent = memberName;
          renderLeaveTypeModalOptions(LEAVE_TYPES); // Populate leave types

          // Reset and configure date inputs based on default selection
          if(leaveStartDateInput) leaveStartDateInput.value = getTodayDateString();
          if(leaveEndDateInput) leaveEndDateInput.value = '';
          const firstRadio = leaveTypeOptionsContainer?.querySelector('input[type="radio"]');
          if (firstRadio) {
              const initialType = firstRadio.value;
              if (leaveDateInputsDiv) leaveDateInputsDiv.classList.toggle('hidden', !(initialType === '연차' || initialType === '출장' || initialType === '결근'));
          } else if (leaveDateInputsDiv) {
               leaveDateInputsDiv.classList.add('hidden'); // Hide if no options (error case)
          }
          if(leaveTypeModal) leaveTypeModal.classList.remove('hidden');
      }
      return;
    }

    // Task Card Click (Start Task / Add Member / Other Task)
    const card = e.target.closest('div[data-action]');
    if (card) {
      // Ignore clicks on buttons or the member list within the card
      if (e.target.closest('button, .members-list')) return;

      const action = card.dataset.action;
      const task = card.dataset.task;

      if (action === 'start-task') {
        // Open team selection modal to start a new task group
        selectedTaskForStart = task; selectedGroupForAdd = null;
        renderTeamSelectionModalContent(task, appState, appConfig.teamGroups);
        const titleEl = document.getElementById('team-select-modal-title');
        if (titleEl) titleEl.textContent = `'${task}' 업무 시작`;
        if (teamSelectModal) teamSelectModal.classList.remove('hidden');
      } else if (action === 'other') {
        // Open the 'select other task' modal
        selectedTaskForStart = null; selectedGroupForAdd = null;
        if (taskSelectModal) taskSelectModal.classList.remove('hidden');
      } else if (action === 'add-member') {
        // Open team selection modal to add members to an existing group
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
    // Delete Button (Single Record) -> Show Confirmation Modal
    const deleteBtn = e.target.closest('button[data-action="delete"]');
    if (deleteBtn) {
      recordToDeleteId = deleteBtn.dataset.recordId;
      deleteMode = 'single';
      const msgEl = document.getElementById('delete-confirm-message');
      if (msgEl) msgEl.textContent = '이 업무 기록을 삭제하시겠습니까?';
      if (deleteConfirmModal) deleteConfirmModal.classList.remove('hidden');
      return;
    }
    // Edit Button -> Show Edit Modal
    const editBtn = e.target.closest('button[data-action="edit"]');
    if (editBtn) {
      recordToEditId = editBtn.dataset.recordId;
      const record = (appState.workRecords || []).find(r => String(r.id) === String(recordToEditId));
      if (record) {
        // Populate the edit modal fields
        document.getElementById('edit-member-name').value = record.member;
        document.getElementById('edit-start-time').value = record.startTime || '';
        document.getElementById('edit-end-time').value = record.endTime || '';

        // Populate the task dropdown
        const taskSelect = document.getElementById('edit-task-type');
        taskSelect.innerHTML = ''; // Clear previous options
        const allTasks = [].concat(...Object.values(appConfig.taskGroups || {})); // Get all possible tasks
        allTasks.forEach(task => {
            const option = document.createElement('option');
            option.value = task;
            option.textContent = task;
            if (task === record.task) option.selected = true; // Select the current task
            taskSelect.appendChild(option);
        });

        if (editRecordModal) editRecordModal.classList.remove('hidden');
      }
      return;
    }
  });
}

// Delete All Completed Button -> Show Confirmation Modal
if (deleteAllCompletedBtn) {
  deleteAllCompletedBtn.addEventListener('click', () => {
    deleteMode = 'all';
    const msgEl = document.getElementById('delete-confirm-message');
    if (msgEl) msgEl.textContent = '오늘 완료된 모든 업무 기록을 삭제하시겠습니까?';
    if (deleteConfirmModal) deleteConfirmModal.classList.remove('hidden');
  });
}

// Confirm Delete Button (handles both single and all)
if (confirmDeleteBtn) {
  confirmDeleteBtn.addEventListener('click', () => {
    if (deleteMode === 'all') {
      // Filter out completed records
      appState.workRecords = (appState.workRecords || []).filter(r => r.status !== 'completed');
      showToast('완료된 모든 기록이 삭제되었습니다.');
    } else if (recordToDeleteId) {
      // Filter out the specific record
      appState.workRecords = (appState.workRecords || []).filter(r => String(r.id) !== String(recordToDeleteId));
      showToast('선택한 기록이 삭제되었습니다.');
    }
    saveStateToFirestore(); // Persist the changes and mark data as dirty
    if (deleteConfirmModal) deleteConfirmModal.classList.add('hidden');
    // Reset state variables
    recordToDeleteId = null;
    deleteMode = 'single';
  });
}

// End Shift Button -> Save final state to history and clear daily data
if (endShiftBtn) {
  endShiftBtn.addEventListener('click', () => {
    saveDayDataToHistory(false); // false = End Shift (save to history, clear daily, but don't reset history)
    showToast('업무 마감 처리 완료. 오늘의 기록을 이력에 저장하고 초기화했습니다.');
  });
}

// Manual Save Progress Button
if (saveProgressBtn) {
  saveProgressBtn.addEventListener('click', () => saveProgress(false)); // false = Manual save
}

// Open History Modal Button
if (openHistoryBtn) {
  openHistoryBtn.addEventListener('click', async () => {
    if (historyModal) {
      historyModal.classList.remove('hidden');
      await loadAndRenderHistoryList(); // Fetch and display history dates
    }
  });
}

// Close History Modal Button
if (closeHistoryBtn) {
  closeHistoryBtn.addEventListener('click', () => {
    if (historyModal) historyModal.classList.add('hidden');
  });
}

// History Date List Click Handler
if (historyDateList) {
  historyDateList.addEventListener('click', (e) => {
    const btn = e.target.closest('.history-date-btn');
    if (btn) {
      // Update selected date styling
      historyDateList.querySelectorAll('button').forEach(b => b.classList.remove('bg-blue-100', 'font-bold'));
      btn.classList.add('bg-blue-100', 'font-bold');
      const dateKey = btn.dataset.key;
      // Re-render the detail view for the newly selected date based on the active sub-tab
      const activeSubTabBtn = (activeMainHistoryTab === 'work')
        ? historyTabs?.querySelector('button.font-semibold')
        : attendanceHistoryTabs?.querySelector('button.font-semibold');
      const activeView = activeSubTabBtn ? activeSubTabBtn.dataset.view : (activeMainHistoryTab === 'work' ? 'daily' : 'attendance-daily');

      // Only re-render if it's a daily view that depends on the selected date
      if (activeView === 'daily') {
        renderHistoryDetail(dateKey);
      } else if (activeView === 'attendance-daily') {
        renderAttendanceDailyHistory(dateKey, allHistoryData);
      }
      // Weekly/Monthly views are independent of the selected date, so no re-render needed here
    }
  });
}

// History Work Sub-Tabs (Daily, Weekly, Monthly) Click Handler
if (historyTabs) {
  historyTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-view]');
    if (btn) {
      switchHistoryView(btn.dataset.view); // Switch the view panel
    }
  });
}

// Confirm History Deletion Button
if (confirmHistoryDeleteBtn) {
  confirmHistoryDeleteBtn.addEventListener('click', async () => {
    if (historyKeyToDelete) {
      const historyDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'history', historyKeyToDelete);
      try {
        await deleteDoc(historyDocRef); // Delete the document from Firestore
        showToast(`${historyKeyToDelete} 이력이 삭제되었습니다.`);
        await loadAndRenderHistoryList(); // Refresh the history list and views
      } catch (e) {
        console.error('Error deleting history:', e);
        showToast('이력 삭제 중 오류 발생.', true);
      }
    }
    if (deleteHistoryModal) deleteHistoryModal.classList.add('hidden');
    historyKeyToDelete = null; // Reset state variable
  });
}

// History Main Tabs (Work vs Attendance) Click Handler
if (historyMainTabs) {
  historyMainTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-main-tab]');
    if (btn) {
      const tabName = btn.dataset.mainTab;
      activeMainHistoryTab = tabName; // Store the active main tab

      // Update main tab styling
      document.querySelectorAll('.history-main-tab-btn').forEach(b => {
          b.classList.remove('font-semibold', 'text-blue-600', 'border-b-2', 'border-blue-600');
          b.classList.add('font-medium', 'text-gray-500');
      });
      btn.classList.add('font-semibold', 'text-blue-600', 'border-b-2', 'border-blue-600');
      btn.classList.remove('font-medium', 'text-gray-500');

      // Show the corresponding panel and hide the other
      if (tabName === 'work') {
        if (workHistoryPanel) workHistoryPanel.classList.remove('hidden');
        if (attendanceHistoryPanel) attendanceHistoryPanel.classList.add('hidden');
        // Switch to the currently active sub-tab within the work panel
        const activeSubTabBtn = historyTabs?.querySelector('button.font-semibold');
        const view = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'daily'; // Default to daily
        switchHistoryView(view);
      } else { // 'attendance'
        if (workHistoryPanel) workHistoryPanel.classList.add('hidden');
        if (attendanceHistoryPanel) attendanceHistoryPanel.classList.remove('hidden');
        // Switch to the currently active sub-tab within the attendance panel
        const activeSubTabBtn = attendanceHistoryTabs?.querySelector('button.font-semibold');
        const view = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'attendance-daily'; // Default to daily attendance
        switchHistoryView(view);
      }
    }
  });
}

// History Attendance Sub-Tabs Click Handler
if (attendanceHistoryTabs) {
  attendanceHistoryTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-view]');
    if (btn) {
      switchHistoryView(btn.dataset.view); // Switch the view panel
    }
  });
}


// Reset App Button -> Show Confirmation Modal
if (resetAppBtn) {
  resetAppBtn.addEventListener('click', () => {
    if (resetAppModal) resetAppModal.classList.remove('hidden');
  });
}
// Confirm Reset App Button
if (confirmResetAppBtn) {
  confirmResetAppBtn.addEventListener('click', async () => {
    await saveDayDataToHistory(true); // true = Reset (save to history AND clear daily data)
    if (resetAppModal) resetAppModal.classList.add('hidden');
  });
}

// Confirm Quantity Button (used for both Today and History)
if (confirmQuantityBtn) {
  confirmQuantityBtn.addEventListener('click', () => {
    const inputs = quantityModal.querySelectorAll('input[data-task]');
    const newQuantities = {};
    inputs.forEach(input => {
      const task = input.dataset.task;
      const quantity = Number(input.value) || 0;
      // Store 0 as well to allow resetting quantities
      newQuantities[task] = quantity;
    });
    // Execute the appropriate callback based on the context (Today or History)
    if (quantityModalContext.onConfirm) {
      quantityModalContext.onConfirm(newQuantities);
    }
    if (quantityModal) quantityModal.classList.add('hidden');
  });
}

// Confirm Edit Record Button (for Today's Completed Log)
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

    // Basic validation
    if (!newStart || !newEnd || !newTask) {
      showToast('모든 필드를 올바르게 입력해주세요.', true);
      return;
    }
    if (newEnd < newStart) {
        showToast('종료 시간은 시작 시간보다 이후여야 합니다.', true);
        return;
    }

    // Update record data
    record.task = newTask;
    record.startTime = newStart;
    record.endTime = newEnd;
    record.duration = calcElapsedMinutes(newStart, newEnd, record.pauses); // Recalculate duration

    saveStateToFirestore(); // Persist changes and mark data as dirty
    showToast('기록이 수정되었습니다.');
    if (editRecordModal) editRecordModal.classList.add('hidden');
    recordToEditId = null; // Reset state variable
  });
}

// Confirm Quantity On Stop Button (when stopping a group)
if (confirmQuantityOnStopBtn) {
  confirmQuantityOnStopBtn.addEventListener('click', () => {
    if (groupToStopId) {
      const input = document.getElementById('quantity-on-stop-input');
      const quantity = input ? (Number(input.value) || 0) : null;
      finalizeStopGroup(groupToStopId, quantity); // Finalize stop with quantity
      if(input) input.value = ''; // Clear input
    }
  });
}

// Task Selection Modal (for 'Other Task') Click Handler
if (taskSelectModal) {
  taskSelectModal.addEventListener('click', (e) => {
    const btn = e.target.closest('.task-select-btn');
    if (btn) {
      const task = btn.dataset.task;
      if (taskSelectModal) taskSelectModal.classList.add('hidden');

      // Open the team selection modal for the chosen task
      selectedTaskForStart = task;
      selectedGroupForAdd = null; // Not adding to an existing group
      renderTeamSelectionModalContent(task, appState, appConfig.teamGroups);
      const titleEl = document.getElementById('team-select-modal-title');
      if (titleEl) titleEl.textContent = `'${task}' 업무 시작`;
      if (teamSelectModal) teamSelectModal.classList.remove('hidden');
    }
  });
}

// Confirm Stop Individual Button
if (confirmStopIndividualBtn) {
  confirmStopIndividualBtn.addEventListener('click', () => {
    if (recordToStopId) {
      stopWorkIndividual(recordToStopId); // Stop the individual record
    }
    if (stopIndividualConfirmModal) stopIndividualConfirmModal.classList.add('hidden');
    recordToStopId = null; // Reset state variable
  });
}


// Confirm Leave Button (Setting leave status)
if (confirmLeaveBtn) confirmLeaveBtn.addEventListener('click', async () => {
    if (!memberToSetLeave) return;

    const selectedTypeInput = document.querySelector('input[name="leave-type"]:checked');
    if (!selectedTypeInput) {
        showToast('근태 유형을 선택해주세요.', true);
        return;
    }
    const leaveType = selectedTypeInput.value;
    const leaveData = { member: memberToSetLeave, type: leaveType };

    // Handle time-based leave (today only) vs date-based leave (persistent)
    if (leaveType === '외출' || leaveType === '조퇴') {
        leaveData.startTime = getCurrentTime();
        if (leaveType === '조퇴') leaveData.endTime = "17:30"; // Assuming standard end time

        // Update daily leave members and save to daily state
        appState.dailyOnLeaveMembers = appState.dailyOnLeaveMembers.filter(item => item.member !== memberToSetLeave); // Remove previous entries for the member
        appState.dailyOnLeaveMembers.push(leaveData);
        await saveStateToFirestore(); // Persist and mark dirty

    } else if (leaveType === '연차' || leaveType === '출장' || leaveType === '결근') {
        // Handle date-range leave
        const startDate = leaveStartDateInput?.value;
        const endDate = leaveEndDateInput?.value;
        if (!startDate) { showToast('시작일을 입력해주세요.', true); return; }
        leaveData.startDate = startDate;
        if (endDate) {
            if (endDate < startDate) { showToast('종료일은 시작일보다 이후여야 합니다.', true); return; }
            leaveData.endDate = endDate;
        }

        // Update persistent leave schedule
        persistentLeaveSchedule.onLeaveMembers = persistentLeaveSchedule.onLeaveMembers.filter(item => item.member !== memberToSetLeave); // Remove previous entries
        persistentLeaveSchedule.onLeaveMembers.push(leaveData);
        await saveLeaveSchedule(db, persistentLeaveSchedule); // Save to persistent store
        markDataAsDirty(); // Mark data as dirty as persistent changes affect history
    }

    showToast(`${memberToSetLeave}님을 '${leaveType}'(으)로 설정했습니다.`);
    if(leaveTypeModal) leaveTypeModal.classList.add('hidden');
    memberToSetLeave = null; // Reset state variable
});

// Confirm Cancel Leave / Return Button
if (confirmCancelLeaveBtn) {
    confirmCancelLeaveBtn.addEventListener('click', async () => {
        if (!memberToCancelLeave) return;

        const todayDateString = getTodayDateString();
        let actionTaken = false;

        // Check daily leave entries first (외출, 조퇴)
        const dailyIndex = appState.dailyOnLeaveMembers.findIndex(item => item.member === memberToCancelLeave);
        if (dailyIndex > -1) {
            const entry = appState.dailyOnLeaveMembers[dailyIndex];
            if (entry.type === '외출' && !entry.endTime) { // Only handle 'return' for ongoing '외출'
                entry.endTime = getCurrentTime(); // Mark as returned
                showToast(`${memberToCancelLeave}님이 복귀 처리되었습니다.`);
                actionTaken = true;
            } else { // Cancel other daily types (like 조퇴) by removing
                const removedType = entry.type;
                appState.dailyOnLeaveMembers.splice(dailyIndex, 1);
                showToast(`${memberToCancelLeave}님의 '${removedType}' 상태가 취소되었습니다.`);
                actionTaken = true;
            }
            await saveStateToFirestore(); // Persist changes and mark dirty
        }

        // Check persistent leave entries (연차, 출장, 결근)
        const persistentIndex = persistentLeaveSchedule.onLeaveMembers.findIndex(item => item.member === memberToCancelLeave);
        if (persistentIndex > -1) {
            const entry = persistentLeaveSchedule.onLeaveMembers[persistentIndex];
            const isLeaveActiveToday = entry.startDate <= todayDateString && (!entry.endDate || todayDateString <= entry.endDate);

            if (isLeaveActiveToday) {
                // If the leave period includes today, adjust the end date to yesterday
                const today = new Date();
                today.setDate(today.getDate() - 1); // Get yesterday's date
                const yesterday = today.toISOString().split('T')[0];
                if (yesterday < entry.startDate) {
                    // If start date is today or later, just remove the entry
                    persistentLeaveSchedule.onLeaveMembers.splice(persistentIndex, 1);
                    showToast(`${memberToCancelLeave}님의 '${entry.type}' 일정이 취소되었습니다.`);
                } else {
                    // Otherwise, set end date to yesterday
                    entry.endDate = yesterday;
                    showToast(`${memberToCancelLeave}님이 복귀 처리되었습니다. (${entry.type}이 ${yesterday}까지로 수정됨)`);
                }
            } else {
                // If leave period is entirely in the future/past, just remove it
                persistentLeaveSchedule.onLeaveMembers.splice(persistentIndex, 1);
                showToast(`${memberToCancelLeave}님의 '${entry.type}' 일정이 취소되었습니다.`);
            }
            await saveLeaveSchedule(db, persistentLeaveSchedule); // Save changes to persistent store
            markDataAsDirty(); // Mark data as dirty
            actionTaken = true;
        }

        if (!actionTaken) {
             showToast(`${memberToCancelLeave}님의 근태 정보를 찾을 수 없습니다.`, true); // Should not happen if modal opened
        }

        if(cancelLeaveConfirmModal) cancelLeaveConfirmModal.classList.add('hidden');
        memberToCancelLeave = null; // Reset state variable
    });
}

// Common Modal Close Button ('X') Listener
document.querySelectorAll('.modal-close-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
      const modal = e.target.closest('.fixed.inset-0'); // Find the parent modal
      if (!modal) return;

      modal.classList.add('hidden'); // Hide the modal

      // Reset specific modal states if necessary
      const modalId = modal.id;
      if (modalId === 'leave-type-modal') {
          memberToSetLeave = null;
          // Reset date inputs visibility and radio selection
          if(leaveDateInputsDiv) leaveDateInputsDiv.classList.add('hidden');
          const firstRadio = leaveTypeOptionsContainer?.querySelector('input[type="radio"]');
          if (firstRadio) firstRadio.checked = true;
      } else if (modalId === 'cancel-leave-confirm-modal') {
          memberToCancelLeave = null;
      } else if (modalId === 'team-select-modal') {
          // Clear selections and reset state
          tempSelectedMembers = [];
          selectedTaskForStart = null;
          selectedGroupForAdd = null;
          // Remove visual selection indicators
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
          if(input) input.value = ''; // Clear input
      } else if (modalId === 'stop-individual-confirm-modal') {
          recordToStopId = null;
      }
      // Add more else if blocks for other modals if needed
  });
});

// Specific Cancel Button Listeners (redundant but safe)
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
// Team Select Modal Cancel Button
if (cancelTeamSelectBtn) cancelTeamSelectBtn.addEventListener('click', () => {
     if(teamSelectModal) teamSelectModal.classList.add('hidden');
     // Reset selections and state
     tempSelectedMembers = []; selectedTaskForStart = null; selectedGroupForAdd = null;
     // Remove visual selection indicators
     teamSelectModal.querySelectorAll('button[data-member-name].ring-2').forEach(card => {
        card.classList.remove('ring-2','ring-blue-500','bg-blue-100');
     });
});

// Accordion Toggles for Mobile View
[toggleCompletedLog, toggleAnalysis, toggleSummary].forEach(toggle => {
  if (!toggle) return;
  toggle.addEventListener('click', () => {
    // Only toggle on smaller screens (mobile)
    if (window.innerWidth >= 768) return; // 768px is Tailwind's 'md' breakpoint
    const content = toggle.nextElementSibling; // Assumes content is the next sibling
    const arrow = toggle.querySelector('svg'); // Find the arrow icon
    if (!content) return;
    content.classList.toggle('hidden'); // Toggle visibility
    if (arrow) arrow.classList.toggle('rotate-180'); // Rotate arrow
  });
});

// Team Selection Modal Interaction Logic (Member Selection, Select All, Add/Edit/Delete Part-timer)
if (teamSelectModal) teamSelectModal.addEventListener('click', e => {
    // Member Card Click (Toggle Selection)
    const card = e.target.closest('button[data-member-name]');
    if (card && !card.disabled) {
        const memberName = card.dataset.memberName;
        const i = tempSelectedMembers.indexOf(memberName);
        if (i > -1) { // If already selected, deselect
            tempSelectedMembers.splice(i,1);
            card.classList.remove('ring-2','ring-blue-500','bg-blue-100');
        } else { // If not selected, select
            tempSelectedMembers.push(memberName);
            card.classList.add('ring-2','ring-blue-500','bg-blue-100');
        }
        return; // Prevent further actions if card was clicked
    }

    // 'Select All' Button Click (Toggle Group Selection)
    const selectAllBtn = e.target.closest('.group-select-all-btn');
    if (selectAllBtn) {
        const groupName = selectAllBtn.dataset.groupName;
        const memberListContainer = teamSelectModal.querySelector(`div[data-group-name="${groupName}"]`);
        if (!memberListContainer) return;

        // Get all member cards and filter available ones
        const memberCards = Array.from(memberListContainer.querySelectorAll('button[data-member-name]'));
        const availableMembers = memberCards.filter(c => !c.disabled).map(c => c.dataset.memberName);
        if (availableMembers.length === 0) return; // No available members in this group

        const areAllSelected = availableMembers.every(m => tempSelectedMembers.includes(m));

        if (areAllSelected) {
            // Deselect all available members in this group
            tempSelectedMembers = tempSelectedMembers.filter(m => !availableMembers.includes(m));
            memberCards.forEach(c => { if (!c.disabled) c.classList.remove('ring-2','ring-blue-500','bg-blue-100'); });
        } else {
            // Select all available members in this group
            availableMembers.forEach(m => { if (!tempSelectedMembers.includes(m)) tempSelectedMembers.push(m); });
            memberCards.forEach(c => { if (!c.disabled) c.classList.add('ring-2','ring-blue-500','bg-blue-100'); });
        }
        return;
    }

    // 'Add Part-timer' Button Click
    const addPartTimerBtn = e.target.closest('#add-part-timer-modal-btn');
    if (addPartTimerBtn) {
        appState.partTimers = appState.partTimers || [];
        // Generate a unique default name (e.g., '알바 1', '알바 2')
        let counter = appState.partTimers.length + 1;
        const baseName = '알바 ';
        const existingNames = (appConfig.teamGroups || []).flatMap(g => g.members).concat(appState.partTimers.map(p => p.name));
        let newName = `${baseName}${counter}`;
        while (existingNames.includes(newName)) { counter++; newName = `${baseName}${counter}`; }

        const newId = Date.now(); // Simple unique ID
        const newWage = appConfig.defaultPartTimerWage || 10000; // Use configured default wage
        // Add new part-timer to state
        appState.partTimers.push({ id: newId, name: newName, wage: newWage });

        // Save state and re-render the modal content
        saveStateToFirestore().then(() => renderTeamSelectionModalContent(selectedTaskForStart, appState, appConfig.teamGroups));
        return;
    }

    // 'Edit Part-timer' Button Click -> Show Edit Modal
    const editPartTimerBtn = e.target.closest('.edit-part-timer-btn');
    if (editPartTimerBtn) {
        const id = Number(editPartTimerBtn.dataset.partTimerId);
        const pt = (appState.partTimers || []).find(p => p.id === id);
        if (pt) {
            // Populate the edit modal
            if (partTimerEditIdInput) partTimerEditIdInput.value = id;
            if (partTimerNewNameInput) partTimerNewNameInput.value = pt.name;
            if (editPartTimerModal) editPartTimerModal.classList.remove('hidden');
        }
        return;
    }

    // 'Delete Part-timer' Button Click
    const deletePartTimerBtn = e.target.closest('.delete-part-timer-btn');
    if (deletePartTimerBtn) {
        const id = Number(deletePartTimerBtn.dataset.partTimerId);
        // Remove part-timer from state
        appState.partTimers = (appState.partTimers || []).filter(p => p.id !== id);
        // Save state and re-render the modal content
        saveStateToFirestore().then(() => renderTeamSelectionModalContent(selectedTaskForStart, appState, appConfig.teamGroups));
        return;
    }
});
// Confirm Edit Part-timer Button
if (confirmEditPartTimerBtn) confirmEditPartTimerBtn.addEventListener('click', () => {
    const id = Number(partTimerEditIdInput?.value);
    const idx = (appState.partTimers || []).findIndex(p => p.id === id);
    if (idx === -1) { if (editPartTimerModal) editPartTimerModal.classList.add('hidden'); return; } // Should not happen

    const partTimer = appState.partTimers[idx];
    const newNameRaw = partTimerNewNameInput?.value || '';
    const newName = newNameRaw.trim();
    if (!newName) { showToast('알바 이름은 비워둘 수 없습니다.', true); return; }

    // Normalize names for comparison and checking duplicates
    const nOld = normalizeName(partTimer.name);
    const nNew = normalizeName(newName);

    // If name hasn't changed, just close the modal
    if (nOld === nNew) { if (editPartTimerModal) editPartTimerModal.classList.add('hidden'); return; }

    // Check if the new name already exists among other members/part-timers
    const allNamesNorm = (appConfig.teamGroups || []).flatMap(g => g.members).map(normalizeName)
        .concat((appState.partTimers || []).filter((p, i) => i !== idx).map(p => normalizeName(p.name))); // Exclude self
    if (allNamesNorm.includes(nNew)) { showToast('해당 이름은 이미 사용 중입니다.', true); return; }

    const oldName = partTimer.name;
    // Update part-timer name in state
    appState.partTimers[idx] = { ...partTimer, name: newName };
    // Update any existing work records with the old name
    appState.workRecords = (appState.workRecords || []).map(r => (r.member === oldName ? { ...r, member: newName } : r));
    // Save state and re-render modal
    saveStateToFirestore().then(() => {
        renderTeamSelectionModalContent(selectedTaskForStart, appState, appConfig.teamGroups);
        if (editPartTimerModal) editPartTimerModal.classList.add('hidden');
        showToast('알바 이름이 수정되었습니다.');
    });
});
// Confirm Team Selection Button (Start Task or Add Members)
if (confirmTeamSelectBtn) confirmTeamSelectBtn.addEventListener('click', () => {
  if (tempSelectedMembers.length === 0) { showToast('추가할 팀원을 선택해주세요.', true); return; }

  if (selectedGroupForAdd !== null) {
    // Add selected members to the existing group
    addMembersToWorkGroup(tempSelectedMembers, selectedTaskForStart, selectedGroupForAdd);
    showToast(`${selectedTaskForStart} 업무에 인원이 추가되었습니다.`);
  } else if (selectedTaskForStart) {
    // Start a new work group with selected members
    startWorkGroup(tempSelectedMembers, selectedTaskForStart);
    showToast(`${selectedTaskForStart} 업무를 시작합니다.`);
  }
  // Close modal and reset state
  if (teamSelectModal) teamSelectModal.classList.add('hidden');
  tempSelectedMembers = []; selectedTaskForStart = null; selectedGroupForAdd = null;
});

// ✅ [이력 멤버] 이력 보기 > 일별 상세 뷰에서 업무 클릭 시 멤버 목록 토글
if (historyDailyView) {
    historyDailyView.addEventListener('click', (e) => {
        const toggleButton = e.target.closest('[data-task-toggle]');
        if (toggleButton) {
            const taskName = toggleButton.dataset.taskToggle;
            // Find the corresponding members div using CSS.escape for special characters in ID
            const membersDiv = historyDailyView.querySelector(`#members-for-${CSS.escape(taskName)}`);
            const arrowIcon = toggleButton.querySelector('.task-toggle-arrow');

            if (membersDiv) {
                membersDiv.classList.toggle('hidden'); // Toggle visibility
            }
            if (arrowIcon) {
                arrowIcon.classList.toggle('rotate-180'); // Rotate arrow
            }
        }
    });
}


// ========== 앱 초기화 ==========
async function main() {
  if (connectionStatusEl) connectionStatusEl.textContent = '연결 중...';
  if (statusDotEl) statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-yellow-500 animate-pulse';

  // Initialize local app state
  appState = { workRecords: [], taskQuantities: {}, dailyOnLeaveMembers: [], dateBasedOnLeaveMembers: [], partTimers: [], hiddenGroupIds: [] };

  // Initialize Firebase
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
      return; // Stop initialization if Firebase fails
  }

  // Load app configuration and persistent leave schedule
  try {
      if (connectionStatusEl) connectionStatusEl.textContent = '설정 로딩 중...';
      appConfig = await loadAppConfig(db);
      persistentLeaveSchedule = await loadLeaveSchedule(db);

      // Hide loading spinner after config load
      const loadingSpinner = document.getElementById('loading-spinner');
      if (loadingSpinner) loadingSpinner.style.display = 'none';

      // Render the 'Other Task' modal content now that config is loaded
      renderTaskSelectionModal(appConfig.taskGroups);
  } catch (e) {
      console.error("설정 로드 실패:", e);
      showToast("설정 정보 로드에 실패했습니다. 기본값으로 실행합니다.", true);
      // Still hide spinner even if config load fails
      const loadingSpinner = document.getElementById('loading-spinner');
      if (loadingSpinner) loadingSpinner.style.display = 'none';
      // Proceed with default/empty config
  }

  // Display current date and start the elapsed time updater
  displayCurrentDate();
  if (elapsedTimeTimer) clearInterval(elapsedTimeTimer);
  elapsedTimeTimer = setInterval(updateElapsedTimes, 1000);

  // ✅ [Auto-save] Start the auto-save timer
  if (autoSaveTimer) clearInterval(autoSaveTimer);
  autoSaveTimer = setInterval(autoSaveProgress, AUTO_SAVE_INTERVAL);
  // console.log(`Auto-save timer started with interval ${AUTO_SAVE_INTERVAL}ms`);

  // Initialize task quantities based on loaded config
  const taskTypes = [].concat(...Object.values(appConfig.taskGroups || {}));
  const defaultQuantities = {};
  taskTypes.forEach(task => defaultQuantities[task] = 0);
  appState.taskQuantities = { ...defaultQuantities, ...appState.taskQuantities }; // Merge defaults with any potentially loaded state

  // Set up Firebase Authentication and Snapshot Listeners
  onAuthStateChanged(auth, async user => {
    if (user) {
      // --- Listener 1: Persistent Leave Schedule ---
      const leaveScheduleDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'persistent_data', 'leaveSchedule');
      if (unsubscribeLeaveSchedule) unsubscribeLeaveSchedule(); // Unsubscribe previous listener if exists
      unsubscribeLeaveSchedule = onSnapshot(leaveScheduleDocRef, (docSnap) => {
          persistentLeaveSchedule = docSnap.exists() ? docSnap.data() : { onLeaveMembers: [] };
          // Filter persistent schedule to get members on leave today
          const today = getTodayDateString();
          appState.dateBasedOnLeaveMembers = (persistentLeaveSchedule.onLeaveMembers || []).filter(entry => {
              if (entry.type === '연차' || entry.type === '출장' || entry.type === '결근') {
                  const endDate = entry.endDate || entry.startDate; // Use start date if end date is missing
                  return entry.startDate && typeof entry.startDate === 'string' &&
                         today >= entry.startDate && today <= endDate;
              }
              return false; // Ignore other types like '외출', '조퇴' from persistent store
          });
          
          markDataAsDirty(); // Mark data dirty as leave changes affect history totals
          render(); // Re-render UI with updated leave status
          
      }, (error) => {
          console.error("근태 일정 실시간 연결 실패:", error);
          showToast("근태 일정 연결에 실패했습니다.", true);
          appState.dateBasedOnLeaveMembers = []; // Clear local state on error
          render();
      });

      // --- Listener 2: Today's Daily Data ---
      const todayDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString());
      if (unsubscribeToday) unsubscribeToday(); // Unsubscribe previous listener

      unsubscribeToday = onSnapshot(todayDocRef, (docSnap) => {
        try {
          // Initialize default quantities again in case config changed between initial load and snapshot
          const taskTypes = [].concat(...Object.values(appConfig.taskGroups || {}));
          const defaultQuantities = {};
          taskTypes.forEach(task => defaultQuantities[task] = 0);

          // Parse state from Firestore or use empty object
          const loadedState = docSnap.exists() ? JSON.parse(docSnap.data().state || '{}') : {};

          // Update local appState with loaded data
          appState.workRecords = loadedState.workRecords || [];
          // Merge default quantities with loaded quantities
          appState.taskQuantities = { ...defaultQuantities, ...(loadedState.taskQuantities || {}) };
          appState.partTimers = loadedState.partTimers || [];
          appState.hiddenGroupIds = loadedState.hiddenGroupIds || [];
          appState.dailyOnLeaveMembers = loadedState.onLeaveMembers || []; // Load daily leave members specifically

          // ✅ [Auto-save] Reset dirty flag because we just loaded the latest state
          isDataDirty = false;
          // console.log("Auto-save: Data loaded from snapshot, flag reset.");

          render(); // Render UI with updated state
          // Update connection status indicator
          if (connectionStatusEl) connectionStatusEl.textContent = '동기화';
          if (statusDotEl) statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-green-500';
        } catch (parseError) {
          console.error('Error parsing state from Firestore:', parseError);
          showToast('데이터 로딩 중 오류 발생 (파싱 실패).', true);
          // Reset local state to defaults on parsing error
          appState = { workRecords: [], taskQuantities: {}, dailyOnLeaveMembers: [], dateBasedOnLeaveMembers: [], partTimers: [], hiddenGroupIds: [] };
          render();
          if (connectionStatusEl) connectionStatusEl.textContent = '데이터 오류';
          if (statusDotEl) statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
        }
      }, (error) => {
        // Handle snapshot listener errors
        console.error('Firebase onSnapshot error:', error);
        showToast('실시간 연결에 실패했습니다.', true);
        // Reset local state on connection error
        appState = { workRecords: [], taskQuantities: {}, dailyOnLeaveMembers: [], dateBasedOnLeaveMembers: [], partTimers: [], hiddenGroupIds: [] };
        render();
        if (connectionStatusEl) connectionStatusEl.textContent = '연결 오류';
        if (statusDotEl) statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
      });
    } else {
      // User is signed out - update UI and clear listeners/state
      if (connectionStatusEl) connectionStatusEl.textContent = '인증 필요';
      if (statusDotEl) statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-gray-400';
      // Unsubscribe from listeners
      if (unsubscribeToday) { unsubscribeToday(); unsubscribeToday = undefined; }
      if (unsubscribeLeaveSchedule) { unsubscribeLeaveSchedule(); unsubscribeLeaveSchedule = undefined; }
      // Reset local state
      appState = { workRecords: [], taskQuantities: {}, dailyOnLeaveMembers: [], dateBasedOnLeaveMembers: [], partTimers: [], hiddenGroupIds: [] };
      render();
    }
  });

   // Attempt anonymous sign-in
   signInAnonymously(auth).catch(error => {
    console.error('Anonymous sign-in failed:', error);
    showToast('자동 인증에 실패했습니다.', true);
    if (connectionStatusEl) connectionStatusEl.textContent = '인증 실패';
    if (statusDotEl) statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
  });
}

main(); // Start the application