// === app.js (업무 마감 팝업 로직 수정) ===

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, onSnapshot, collection, getDocs, deleteDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirebase, loadAppConfig, loadLeaveSchedule, saveLeaveSchedule } from './config.js';
import { showToast, getTodayDateString, displayCurrentDate, getCurrentTime, formatDuration, formatTimeTo24H, getWeekOfYear, isWeekday } from './utils.js';
import {
  renderRealtimeStatus,
  renderCompletedWorkLog,
  updateSummary,
  renderTaskAnalysis,
  renderPersonalAnalysis,
  renderTaskSelectionModal,
  renderTeamSelectionModalContent,
  renderQuantityModalInputs,
  renderLeaveTypeModalOptions,
  renderAttendanceDailyHistory,
  renderAttendanceWeeklyHistory,
  renderAttendanceMonthlyHistory,
  renderWeeklyHistory,
  renderMonthlyHistory,
  renderDashboardLayout,
  renderManualAddModalDatalists // ✅ [추가]
} from './ui.js';

// ========== DOM Elements ==========
// ... (fullscreenHistoryBtn 제거) ...
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
const cancelTeamSelectBtn = document.getElementById('cancel-team-select-btn');
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

// ✅ [추가] 수동 기록 추가 모달 요소
const openManualAddBtn = document.getElementById('open-manual-add-btn');
const manualAddRecordModal = document.getElementById('manual-add-record-modal');
const confirmManualAddBtn = document.getElementById('confirm-manual-add-btn');
const cancelManualAddBtn = document.getElementById('cancel-manual-add-btn');
const manualAddForm = document.getElementById('manual-add-form');

// ✅ [추가] 업무 마감 확인 모달 요소
const endShiftConfirmModal = document.getElementById('end-shift-confirm-modal');
const endShiftConfirmTitle = document.getElementById('end-shift-confirm-title');
const endShiftConfirmMessage = document.getElementById('end-shift-confirm-message');
const confirmEndShiftBtn = document.getElementById('confirm-end-shift-btn');
const cancelEndShiftBtn = document.getElementById('cancel-end-shift-btn');

// ✅ [추가] 로그인 모달 요소
const loginModal = document.getElementById('login-modal');
const loginForm = document.getElementById('login-form');
const loginEmailInput = document.getElementById('login-email');
const loginPasswordInput = document.getElementById('login-password');
const loginSubmitBtn = document.getElementById('login-submit-btn');
const loginErrorMsg = document.getElementById('login-error-message');
const loginButtonText = document.getElementById('login-button-text');
const loginButtonSpinner = document.getElementById('login-button-spinner');

// ✅ [추가] 로그아웃 버튼 및 사용자 인사말
const userGreeting = document.getElementById('user-greeting');
const logoutBtn = document.getElementById('logout-btn');

// ✅ [추가] 햄버거 메뉴 (1/3)
const hamburgerBtn = document.getElementById('hamburger-btn');
const navContent = document.getElementById('nav-content');

// === app.js (상단 DOM 요소 추가) ===

// ✅ [추가] 시작 시간 수정 모달 요소
const editStartTimeModal = document.getElementById('edit-start-time-modal');
const editStartTimeModalTitle = document.getElementById('edit-start-time-modal-title');
const editStartTimeModalMessage = document.getElementById('edit-start-time-modal-message');
const editStartTimeInput = document.getElementById('edit-start-time-input');
const editStartTimeContextIdInput = document.getElementById('edit-start-time-context-id');
const editStartTimeContextTypeInput = document.getElementById('edit-start-time-context-type');
const confirmEditStartTimeBtn = document.getElementById('confirm-edit-start-time-btn');
const cancelEditStartTimeBtn = document.getElementById('cancel-edit-start-time-btn');


// ========== Firebase/App State ==========
// ... (이전과 동일) ...
let db, auth;
let unsubscribeToday;
let unsubscribeLeaveSchedule;
let elapsedTimeTimer = null;
let recordCounter = 0;
let recordIdOrGroupIdToEdit = null;
let editType = null; // 'group' or 'individual'

let isDataDirty = false;
let autoSaveTimer = null;
const AUTO_SAVE_INTERVAL = 5 * 60 * 1000;

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

// ✅ [추가] 디바운스 헬퍼 함수
const debounce = (func, delay) => {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
};

// ========== 타이머 ==========
// ✅ [수정] updateElapsedTimes 함수 (DOM에서 직접 데이터 읽도록 최적화)
const updateElapsedTimes = () => {
  const now = getCurrentTime();
  document.querySelectorAll('.ongoing-duration').forEach(el => {
    try {
      const startTime = el.dataset.startTime;
      if (!startTime) return;

      const status = el.dataset.status;
      // ✅ [수정] data-pauses-json 속성 읽기
      const pauses = JSON.parse(el.dataset.pausesJson || '[]'); 
      
      let currentPauses = pauses || [];

      if (status === 'paused') {
          const lastPause = currentPauses.length > 0 ? currentPauses[currentPauses.length - 1] : null;
          // 이 로직은 그룹 대표 레코드 1개를 기준으로 하므로,
          // UI.js에서 data-status="paused"를 올바르게 설정해주는 것이 중요합니다.
          const tempPauses = [
              ...currentPauses.slice(0, -1),
              { start: lastPause?.start || startTime, end: now }
          ];
          const dur = calcElapsedMinutes(startTime, now, tempPauses);
          el.textContent = `(진행: ${formatDuration(dur)})`;

      } else { // status === 'ongoing'
          const dur = calcElapsedMinutes(startTime, now, currentPauses);
          el.textContent = `(진행: ${formatDuration(dur)})`;
      }

    } catch(e) { 
        /* noop */ 
        // console.error("Timer update error", e) // 디버깅 시 주석 해제
    }
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
    updateSummary(appState, appConfig); // ✅ appConfig 전체 전달 확인
    renderTaskAnalysis(appState, appConfig); // ✅ appConfig 전달 확인
  } catch (e) {
    console.error('Render error:', e);
    showToast('화면 렌더링 오류 발생.', true);
  }
};

// ========== Firestore 저장 ==========
// ... (이전과 동일) ...
const markDataAsDirty = () => {
    if (!isDataDirty) {
        // console.log("Auto-save: Data marked as dirty.");
    }
    isDataDirty = true;
};

const autoSaveProgress = () => {
    if (isDataDirty) {
        // console.log("Auto-save: Dirty data found. Saving progress...");
        saveProgress(true); // true = 자동 저장 모드
    } else {
        // console.log("Auto-save: No changes to save.");
    }
};

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
    markDataAsDirty(); // Firestore 저장 시 dirty 플래그 설정 (기존 로직 유지)

  } catch (error) {
    console.error('Error saving state to Firestore:', error);
    showToast('데이터 동기화 중 오류 발생.', true);
  }
}

// ✅ [추가] 디바운스된 Firestore 저장 함수 (1초 딜레이)
const debouncedSaveState = debounce(saveStateToFirestore, 1000);

// ========== 업무 그룹/개인 제어 ==========
// ... (이전과 동일) ...
// ✅ [수정] saveStateToFirestore -> debouncedSaveState
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
  render(); // [추가]
  debouncedSaveState();
};

// ✅ [수정] saveStateToFirestore -> debouncedSaveState
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
  render(); // [추가]
  debouncedSaveState();
};

const stopWorkGroup = (groupId) => {
  const recordsToStop = (appState.workRecords || []).filter(r => r.groupId === groupId && (r.status === 'ongoing' || r.status === 'paused'));
  if (recordsToStop.length === 0) return;
  finalizeStopGroup(groupId, null);
};

// ✅ [수정] saveStateToFirestore -> debouncedSaveState
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

  if (changed) {
    render(); // [추가]
    debouncedSaveState();
  }
  if (quantityOnStopModal) quantityOnStopModal.classList.add('hidden');
  groupToStopId = null;
};

// ✅ [수정] saveStateToFirestore -> debouncedSaveState
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
    render(); // [추가]
    debouncedSaveState();
    showToast(`${record.member}님의 ${record.task} 업무가 종료되었습니다.`);
  } else {
    showToast('이미 완료되었거나 찾을 수 없는 기록입니다.', true);
  }
};

// ✅ [수정] saveStateToFirestore -> debouncedSaveState
const pauseWorkGroup = (groupId) => {
  const currentTime = getCurrentTime();
  let changed = false;
  (appState.workRecords || []).forEach(record => {
    if (record.groupId === groupId && record.status === 'ongoing') {
      record.status = 'paused';
      record.pauses = record.pauses || [];
      // ✅ [수정] 'type: 'break'' 추가
      record.pauses.push({ start: currentTime, end: null, type: 'break' });
      changed = true;
    }
  });
  if (changed) { 
    render(); // [추가]
    debouncedSaveState(); 
    showToast('그룹 업무가 일시정지 되었습니다.'); 
  }
};

// ✅ [수정] saveStateToFirestore -> debouncedSaveState
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
  if (changed) { 
    render(); // [추가]
    debouncedSaveState(); 
    showToast('그룹 업무를 다시 시작합니다.'); 
  }
};

// === app.js (일부) ===

// ✅ [수정] saveStateToFirestore -> debouncedSaveState
const pauseWorkIndividual = (recordId) => {
  const currentTime = getCurrentTime();
  const record = (appState.workRecords || []).find(r => String(r.id) === String(recordId));
  if (record && record.status === 'ongoing') {
    record.status = 'paused';
    record.pauses = record.pauses || [];
    // ✅ [수정] 'type: 'break'' 추가
    record.pauses.push({ start: currentTime, end: null, type: 'break' });
    render(); // [추가]
    debouncedSaveState();
    showToast(`${record.member}님 ${record.task} 업무 일시정지.`);
  }
};

// ✅ [수정] saveStateToFirestore -> debouncedSaveState
const resumeWorkIndividual = (recordId) => {
  const currentTime = getCurrentTime();
  const record = (appState.workRecords || []).find(r => String(r.id) === String(recordId));
  if (record && record.status === 'paused') {
    record.status = 'ongoing';
    const lastPause = record.pauses?.[record.pauses.length - 1];
    if (lastPause && lastPause.end === null) {
      lastPause.end = currentTime;
    }
    render(); // [추가]
    debouncedSaveState();
    showToast(`${record.member}님 ${record.task} 업무 재개.`);
  }
};

// ... (saveProgress 함수는 이전과 동일) ...
async function saveProgress(isAutoSave = false) {
  const dateStr = getTodayDateString();
  
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

    if (completedRecordsFromState.length === 0 && Object.keys(currentQuantities).length === 0 && currentLeaveMembersCombined.length === 0 && currentPartTimers.length === 0 && !(existingData.onLeaveMembers?.length > 0) && !(existingData.partTimers?.length > 0)) {
        if (!isAutoSave) {
            showToast('저장할 새로운 완료 기록, 처리량, 근태 정보 또는 알바 정보가 없습니다.', true);
        }
        isDataDirty = false;
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

    if (isAutoSave) {
        showToast('진행 상황이 자동 저장되었습니다.', false);
    } else {
        showToast('현재까지의 기록이 성공적으로 저장되었습니다.');
    }
    isDataDirty = false;

  } catch (e) {
    console.error('Error in saveProgress: ', e);
    showToast(`중간 저장 중 오류가 발생했습니다: ${e.message}`, true);
  }
}

// ✅ [수정] saveDayDataToHistory (업무 마감 로직)
// (진행 중인 업무를 자동으로 종료하는 로직이 이미 포함되어 있음)
// ✅ [수정] shouldReset 시 debouncedSaveState가 아닌 즉시 saveStateToFirestore 호출
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

  await saveProgress(false); // 수동 저장(false)으로 호출

  appState.workRecords = [];
  Object.keys(appState.taskQuantities || {}).forEach(task => { appState.taskQuantities[task] = 0; });
  appState.dailyOnLeaveMembers = [];
  appState.partTimers = [];
  appState.hiddenGroupIds = [];

  if (shouldReset) {
    // ✅ [수정] 초기화 시에는 디바운스를 사용하지 않고 즉시 저장하여 반영합니다.
    await saveStateToFirestore(); 
    showToast('오늘의 업무 기록을 초기화했습니다.');
    render();
  } else {
      // ✅ [수정] 단순 마감 시에도 즉시 저장합니다.
      await saveStateToFirestore();
      render();
  }
}
// ... (fetchAllHistoryData, loadAndRenderHistoryList, openHistoryQuantityModal, renderHistoryDetail, requestHistoryDeletion, 엑셀 함수, switchHistoryView 함수들은 이전과 동일) ...
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
    allHistoryData = []; // 데이터 초기화

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

    // ✅ [수정] 목록 렌더링을 switchHistoryView에 위임
    // 기본 활성화된 탭(메인 탭, 서브 탭)을 기준으로 뷰를 전환
    const activeSubTabBtn = (activeMainHistoryTab === 'work')
        ? historyTabs?.querySelector('button.font-semibold')
        : attendanceHistoryTabs?.querySelector('button.font-semibold');
    const activeView = activeSubTabBtn ? activeSubTabBtn.dataset.view : (activeMainHistoryTab === 'work' ? 'daily' : 'attendance-daily');
    
    switchHistoryView(activeView); 
};

/**
 * [신규] 이력 목록(왼쪽)을 모드(일/주/월)에 맞게 렌더링합니다.
 * @param {string} mode - 'day', 'week', 'month'
 */
const renderHistoryDateListByMode = (mode = 'day') => {
    if (!historyDateList) return;
    historyDateList.innerHTML = '';

    let keys = [];
    
    if (mode === 'day') {
        keys = allHistoryData.map(d => d.id);
        // (allHistoryData는 이미 내림차순 정렬됨)
    } else if (mode === 'week') {
        const weekSet = new Set(allHistoryData.map(d => getWeekOfYear(new Date(d.id + "T00:00:00"))));
        keys = Array.from(weekSet).sort((a, b) => b.localeCompare(a));
    } else if (mode === 'month') {
        const monthSet = new Set(allHistoryData.map(d => d.id.substring(0, 7)));
        keys = Array.from(monthSet).sort((a, b) => b.localeCompare(a));
    }

    if (keys.length === 0) {
        historyDateList.innerHTML = '<li><div class="p-4 text-center text-gray-500">데이터 없음</div></li>';
        return;
    }

    keys.forEach(key => {
        const li = document.createElement('li');
        li.innerHTML = `<button data-key="${key}" class="history-date-btn w-full text-left p-3 rounded-md hover:bg-blue-100 transition focus:outline-none focus:ring-2 focus:ring-blue-300">${key}</button>`;
        historyDateList.appendChild(li);
    });

    // 첫 번째 항목 자동 선택
    const firstButton = historyDateList.firstChild?.querySelector('button');
    if (firstButton) {
        firstButton.classList.add('bg-blue-100', 'font-bold');
        // 첫 번째 항목의 컨텐츠를 로드
        // (단, 일별 보기일 때만 자동 로드, 주/월은 이미 switchHistoryView에서 전체 로드됨)
        if (mode === 'day') {
             // ✅ 전일 데이터 찾기 (첫 번째 항목은 전일 데이터가 없음)
             const previousDayData = (allHistoryData.length > 1) ? allHistoryData[1] : null;

             if (activeMainHistoryTab === 'work') {
                renderHistoryDetail(firstButton.dataset.key, previousDayData);
             } else {
                renderAttendanceDailyHistory(firstButton.dataset.key, allHistoryData);
             }
        }
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

const renderHistoryDetail = (dateKey, previousDayData = null) => {
  const view = document.getElementById('history-daily-view');
  if (!view) return;
  view.innerHTML = '<div class="text-center text-gray-500">데이터 로딩 중...</div>';
  
  // ✅ [수정] allHistoryData, appConfig를 app.js의 전역 스코프에서 참조
  const data = allHistoryData.find(d => d.id === dateKey);
  if (!data) { 
      view.innerHTML = '<div class="text-center text-red-500">해당 날짜의 데이터를 찾을 수 없습니다.</div>'; 
      return; 
  }

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

  // --- 1. 현재일(Current) 데이터 계산 ---
  const totalSumDuration = records.reduce((sum, r) => sum + (r.duration || 0), 0);
  const totalQuantity = Object.values(quantities).reduce((sum, q) => sum + (Number(q) || 0), 0);

  const taskDurations = records.reduce((acc, rec) => { acc[rec.task] = (acc[rec.task] || 0) + (rec.duration || 0); return acc; }, {});
  
  const taskCosts = records.reduce((acc, rec) => {
      const wage = wageMap[rec.member] || 0;
      const cost = ((Number(rec.duration) || 0) / 60) * wage;
      acc[rec.task] = (acc[rec.task] || 0) + cost;
      return acc;
  }, {});
  
  // (throughput, costPerItem 계산)
  const taskMetrics = {};
  // ✅ [수정] Object.keys(...).concat(...) -> new Set([...Object.keys(...), ...Object.keys(...)])
  const allTaskKeys = new Set([...Object.keys(taskDurations), ...Object.keys(quantities)]);
  allTaskKeys.forEach(task => {
      // if (!taskMetrics[task]) { // (Set으로 처리하므로 중복 체크 불필요)
          const duration = taskDurations[task] || 0;
          const cost = taskCosts[task] || 0;
          const qty = Number(quantities[task]) || 0;
          
          taskMetrics[task] = {
              duration: duration,
              cost: cost,
              quantity: qty,
              avgThroughput: duration > 0 ? (qty / duration) : 0,
              avgCostPerItem: qty > 0 ? (cost / qty) : 0
          };
      // }
  });


  // --- 2. 전일(Previous) 데이터 계산 ---
  let prevTaskMetrics = {};
  if (previousDayData) {
      const prevRecords = previousDayData.workRecords || [];
      const prevQuantities = previousDayData.taskQuantities || {};

      const prevTaskDurations = prevRecords.reduce((acc, rec) => { acc[rec.task] = (acc[rec.task] || 0) + (rec.duration || 0); return acc; }, {});
      
      const prevTaskCosts = prevRecords.reduce((acc, rec) => {
          const wage = wageMap[rec.member] || 0;
          const cost = ((Number(rec.duration) || 0) / 60) * wage;
          acc[rec.task] = (acc[rec.task] || 0) + cost;
          return acc;
      }, {});

      // ✅ [수정] new Set([...Object.keys(...), ...Object.keys(...)])
      const allPrevTaskKeys = new Set([...Object.keys(prevTaskDurations), ...Object.keys(prevQuantities)]);
      allPrevTaskKeys.forEach(task => {
          // if (!prevTaskMetrics[task]) { // (Set으로 처리하므로 중복 체크 불필요)
              const duration = prevTaskDurations[task] || 0;
              const cost = prevTaskCosts[task] || 0;
              const qty = Number(prevQuantities[task]) || 0;
              
              prevTaskMetrics[task] = {
                  duration: duration,
                  cost: cost,
                  quantity: qty,
                  avgThroughput: duration > 0 ? (qty / duration) : 0,
                  avgCostPerItem: qty > 0 ? (cost / qty) : 0
              };
          // }
      });
  }
  
  // ✅ [추가] getDiffHtmlForMetric 헬퍼 함수 (app.js 스코프 내에 임시 정의)
  // (원래 ui.js에 넣으려 했으나, app.js에서도 필요하므로 여기에 임시 정의)
  // (utils.js에서 formatDuration을 가져와야 함)
  const getDiffHtmlForMetric = (metric, current, previous) => {
      const currValue = current || 0;
      const prevValue = previous || 0;
  
      if (prevValue === 0) {
          if (currValue > 0) return `<span class="text-xs text-gray-400 ml-1" title="이전 기록 없음">(new)</span>`;
          return ''; // 둘 다 0
      }
      
      const diff = currValue - prevValue;
      if (Math.abs(diff) < 0.001) return `<span class="text-xs text-gray-400 ml-1">(-)</span>`;
      
      const percent = (diff / prevValue) * 100;
      const sign = diff > 0 ? '↑' : '↓';
      
      let colorClass = 'text-gray-500';
      if (metric === 'avgThroughput' || metric === 'avgStaff' || metric === 'quantity') { // quantity 추가
          colorClass = diff > 0 ? 'text-green-600' : 'text-red-600';
      } else if (metric === 'avgCostPerItem' || metric === 'avgTime' || metric === 'duration') { // duration 추가
          colorClass = diff > 0 ? 'text-red-600' : 'text-green-600';
      }
      
      let diffStr = '';
      let prevStr = '';
      if (metric === 'avgTime' || metric === 'duration') {
          diffStr = formatDuration(Math.abs(diff));
          prevStr = formatDuration(prevValue);
      } else if (metric === 'avgStaff' || metric === 'avgCostPerItem' || metric === 'quantity') {
          diffStr = Math.abs(diff).toFixed(0);
          prevStr = prevValue.toFixed(0);
      } else { // avgThroughput
          diffStr = Math.abs(diff).toFixed(2);
          prevStr = prevValue.toFixed(2);
      }
  
      return `<span class="text-xs ${colorClass} ml-1 font-mono" title="이전: ${prevStr}">
                  ${sign} ${diffStr} (${percent.toFixed(0)}%)
              </span>`;
  };


  // --- 3. HTML 렌더링 ---
  
  const avgThroughput = totalSumDuration > 0 ? (totalQuantity / totalSumDuration).toFixed(2) : '0.00';

  // (비업무 시간 계산 - 기존과 동일)
  let nonWorkHtml = '';
  if (isWeekday(dateKey)) {
    const totalPotentialMinutes = activeMembersCount * 8 * 60; // 8시간 기준
    const nonWorkMinutes = Math.max(0, totalPotentialMinutes - totalSumDuration);
    const percentage = totalPotentialMinutes > 0 ? (nonWorkMinutes / totalPotentialMinutes * 100).toFixed(1) : 0;
    nonWorkHtml = `<div class="bg-white p-4 rounded-lg shadow-sm text-center flex-1 min-w-[120px]"><h4 class="text-sm font-semibold text-gray-500">총 비업무시간</h4><p class="text-xl font-bold text-gray-700">${formatDuration(nonWorkMinutes)}</p><p class="text-xs text-gray-500 mt-1">(추정치, ${percentage}%)</p></div>`;
  } else {
    nonWorkHtml = `<div class="bg-white p-4 rounded-lg shadow-sm text-center flex-1 min-w-[120px] flex flex-col justify-center items-center"><h4 class="text-sm font-semibold text-gray-500">총 비업무시간</h4><p class="text-lg font-bold text-gray-400">주말</p></div>`;
  }

  let html = `
    <div class="mb-6 pb-4 border-b flex justify-between items-center">
      <h3 class="text-2xl font-bold text-gray-800">${dateKey} (전일 대비)</h3>
      <div>
        <button class="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-1 px-3 rounded-md text-sm" onclick="openHistoryQuantityModal('${dateKey}')">처리량 수정</button>
        <button class="bg-green-600 hover:bg-green-700 text-white font-semibold py-1 px-3 rounded-md text-sm ml-2" onclick="downloadHistoryAsExcel('${dateKey}')">엑셀 (전체)</button>
        <button class="bg-red-600 hover:bg-red-700 text-white font-semibold py-1 px-3 rounded-md text-sm ml-2" onclick="requestHistoryDeletion('${dateKey}')">삭제</button>
      </div>
    </div>
    <div class="flex flex-wrap gap-4 mb-6">
      <div class="bg-white p-4 rounded-lg shadow-sm text-center flex-1 min-w-[120px]"><h4 class="text-sm font-semibold text-gray-500">근무 인원</h4><p class="text-2xl font-bold text-gray-800">${activeMembersCount} 명</p></div>
      <div class="bg-white p-4 rounded-lg shadow-sm text-center flex-1 min-w-[120px]"><h4 class="text-sm font-semibold text-gray-500">총합 시간</h4><p class="text-2xl font-bold text-gray-800">${formatDuration(totalSumDuration)}</p></div>
      ${nonWorkHtml}
      <div class="bg-white p-4 rounded-lg shadow-sm text-center flex-1 min-w-[150px]"><h4 class="text-sm font-semibold text-gray-500">총 처리량</h4><p class="text-2xl font-bold text-gray-800">${totalQuantity} 개</p></div>
      <div class="bg-white p-4 rounded-lg shadow-sm text-center flex-1 min-w-[150px]"><h4 class="text-sm font-semibold text-gray-500">분당 평균 처리량</h4><p class="text-2xl font-bold text-gray-800">${avgThroughput} 개/분</p></div>
    </div>
  `;
  
  // === [수정] 3개 카드(처리량, 분당처리량, 개당처리비용) 렌더링 로직 수정 ===
  html += `<div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">`;
  
  // 1. 업무별 처리량 (Quantity)
  html += `<div class="bg-white p-4 rounded-lg shadow-sm"><h4 class="text-lg font-bold mb-3 text-gray-700">업무별 처리량</h4><div class="space-y-2 max-h-48 overflow-y-auto">`;
  let hasQuantities = false;
  Object.entries(taskMetrics)
    .filter(([, metrics]) => metrics.quantity > 0)
    .sort(([a],[b]) => a.localeCompare(b))
    .forEach(([task, metrics]) => {
      hasQuantities = true;
      const prevQty = prevTaskMetrics[task]?.quantity || 0;
      const diffHtml = previousDayData ? getDiffHtmlForMetric('quantity', metrics.quantity, prevQty) : '';
      html += `<div class="flex justify-between items-center text-sm border-b pb-1">
                 <span class="font-semibold text-gray-600">${task}</span>
                 <span>${metrics.quantity} 개 ${diffHtml}</span>
               </div>`;
    });
  if (!hasQuantities) html += `<p class="text-gray-500 text-sm">입력된 처리량이 없습니다.</p>`;
  html += `</div></div>`;

  // 2. 업무별 분당 처리량 (Throughput)
  html += `<div class="bg-white p-4 rounded-lg shadow-sm"><h4 class="text-lg font-bold mb-3 text-gray-700">업무별 분당 처리량</h4><div class="space-y-2 max-h-48 overflow-y-auto">`;
  let hasThroughput = false;
  Object.entries(taskMetrics)
    .filter(([, metrics]) => metrics.quantity > 0) // 처리량이 있는 것만 표시
    .sort(([a],[b]) => a.localeCompare(b))
    .forEach(([task, metrics]) => {
      hasThroughput = true;
      const prevThroughput = prevTaskMetrics[task]?.avgThroughput || 0;
      const diffHtml = previousDayData ? getDiffHtmlForMetric('avgThroughput', metrics.avgThroughput, prevThroughput) : '';
      html += `<div class="flex justify-between items-center text-sm border-b pb-1">
                 <span class="font-semibold text-gray-600">${task}</span>
                 <span>${metrics.avgThroughput.toFixed(2)} 개/분 ${diffHtml}</span>
               </div>`;
    });
  if (!hasThroughput) html += `<p class="text-gray-500 text-sm">입력된 처리량이 없습니다.</p>`;
  html += `</div></div>`;

  // 3. 업무별 개당 처리비용 (CostPerItem)
  html += `<div class="bg-white p-4 rounded-lg shadow-sm"><h4 class="text-lg font-bold mb-3 text-gray-700">업무별 개당 처리비용</h4><div class="space-y-2 max-h-48 overflow-y-auto">`;
  let hasCostPerItem = false;
  Object.entries(taskMetrics)
    .filter(([, metrics]) => metrics.quantity > 0) // 처리량이 있는 것만 표시
    .sort(([a],[b]) => a.localeCompare(b))
    .forEach(([task, metrics]) => {
      hasCostPerItem = true;
      const prevCostPerItem = prevTaskMetrics[task]?.avgCostPerItem || 0;
      const diffHtml = previousDayData ? getDiffHtmlForMetric('avgCostPerItem', metrics.avgCostPerItem, prevCostPerItem) : '';
      html += `<div class="flex justify-between items-center text-sm border-b pb-1">
                 <span class="font-semibold text-gray-600">${task}</span>
                 <span>${metrics.avgCostPerItem.toFixed(0)} 원/개 ${diffHtml}</span>
               </div>`;
    });
  if (!hasCostPerItem) html += `<p class="text-gray-500 text-sm">처리량이 없어 계산 불가.</p>`;
  html += `</div></div>`;
  html += `</div>`; // grid 닫기

  // 4. 업무별 시간 비중 (Duration)
  html += `<div class="bg-white p-4 rounded-lg shadow-sm"><h4 class="text-lg font-bold mb-3 text-gray-700">업무별 시간 비중</h4><div class="space-y-3">`;
  Object.entries(taskMetrics)
    .filter(([, metrics]) => metrics.duration > 0)
    .sort(([,a],[,b]) => b.duration - a.duration)
    .forEach(([task, metrics]) => {
      const percentage = totalSumDuration > 0 ? (metrics.duration / totalSumDuration * 100).toFixed(1) : 0;
      const prevDuration = prevTaskMetrics[task]?.duration || 0;
      // ✅ [수정] duration은 '높을수록 좋음'이 아니므로, 'duration' 메트릭(낮을수록 좋음-빨간색)으로 수정
      const diffHtml = previousDayData ? getDiffHtmlForMetric('duration', metrics.duration, prevDuration) : ''; 
      
      html += `
        <div>
          <div class="flex justify-between items-center mb-1 text-sm">
            <span class="font-semibold text-gray-600">${task}</span>
            <span>${formatDuration(metrics.duration)} (${percentage}%) ${diffHtml}</span>
          </div>
          <div class="w-full bg-gray-200 rounded-full h-2.5"><div class="bg-blue-600 h-2.5 rounded-full" style="width: ${percentage}%"></div></div>
        </div>`;
    });
  // ✅ [수정] Object.keys(taskMetrics).every(...) -> Object.values(taskMetrics).every(...)
  if (Object.values(taskMetrics).every(m => (m.duration || 0) <= 0)) {
    html += `<p class="text-gray-500 text-sm">기록된 업무 시간이 없습니다.</p>`;
  }
  html += `</div></div>`;

  view.innerHTML = html;
};

window.requestHistoryDeletion = (dateKey) => {
  historyKeyToDelete = dateKey;
  if (deleteHistoryModal) deleteHistoryModal.classList.remove('hidden');
};


// =================================================================
// ✅ [수정] 엑셀 다운로드 함수 (일별+주별+월별 시트 통합)
// =================================================================

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

window.downloadHistoryAsExcel = async (dateKey) => {
    try {
        // --- 1. 데이터 준비 (현재일, 전일, 전체, WageMap) ---
        const data = allHistoryData.find(d => d.id === dateKey);
        if (!data) {
            return showToast('해당 날짜의 데이터를 찾을 수 없습니다.', true);
        }
        
        // [신규] 전일 데이터 찾기
        const currentIndex = allHistoryData.findIndex(d => d.id === dateKey);
        const previousDayData = (currentIndex > -1 && currentIndex + 1 < allHistoryData.length) 
                                ? allHistoryData[currentIndex + 1] 
                                : null;

        const workbook = XLSX.utils.book_new();

        const historyWageMap = {};
        (allHistoryData || []).forEach(dayData => {
            (dayData.partTimers || []).forEach(pt => {
                if (pt && pt.name && !historyWageMap[pt.name]) {
                     historyWageMap[pt.name] = pt.wage || 0;
                }
            });
        });
        const combinedWageMap = { ...historyWageMap, ...(appConfig.memberWages || {}) };

        // --- 2. Sheet 1: 상세 기록 (기존과 동일) ---
        const dailyRecords = data.workRecords || [];
        const dailyQuantities = data.taskQuantities || {};
        
        const sheet1Headers = ['팀원', '업무 종류', '시작 시간', '종료 시간', '소요 시간(분)'];
        const sheet1Data = dailyRecords.map(r => ({
            '팀원': r.member || '',
            '업무 종류': r.task || '',
            '시작 시간': formatTimeTo24H(r.startTime),
            '종료 시간': formatTimeTo24H(r.endTime),
            '소요 시간(분)': Math.round(Number(r.duration) || 0)
        }));
        const worksheet1 = XLSX.utils.json_to_sheet(sheet1Data, { header: sheet1Headers });
        if (sheet1Data.length > 0) appendTotalRow(worksheet1, sheet1Data, sheet1Headers);
        fitToColumn(worksheet1);
        XLSX.utils.book_append_sheet(workbook, worksheet1, `상세 기록 (${dateKey})`);

        // --- 3. Sheet 2: 업무 요약 (✅ 전일비 추가) ---
        
        // 3a. 전일 데이터 계산
        let prevTaskSummary = {};
        if (previousDayData) {
            const prevRecords = previousDayData.workRecords || [];
            (prevRecords).forEach(r => {
                if (!prevTaskSummary[r.task]) {
                    prevTaskSummary[r.task] = { totalDuration: 0, totalCost: 0, members: new Set() };
                }
                const wage = combinedWageMap[r.member] || 0;
                const cost = ((Number(r.duration) || 0) / 60) * wage;
                prevTaskSummary[r.task].totalDuration += (Number(r.duration) || 0);
                prevTaskSummary[r.task].totalCost += cost;
                prevTaskSummary[r.task].members.add(r.member);
            });
        }
        
        // 3b. 현재일 데이터 계산
        const summaryByTask = {};
        dailyRecords.forEach(r => {
            if (!summaryByTask[r.task]) {
                summaryByTask[r.task] = { totalDuration: 0, totalCost: 0, members: new Set() };
            }
            const wage = combinedWageMap[r.member] || 0;
            const cost = ((Number(r.duration) || 0) / 60) * wage;
            summaryByTask[r.task].totalDuration += (Number(r.duration) || 0);
            summaryByTask[r.task].totalCost += cost;
            summaryByTask[r.task].members.add(r.member); 
        });
        
        // ✅ [수정] Sheet 2 헤더 (전일비 항목 추가)
        const sheet2Headers = [
            '업무 종류', 
            '진행 인원수', '총 소요 시간(분)', '총 인건비(원)', '총 처리량(개)', '개당 처리비용(원)',
            '진행 인원수(전일비)', '총 시간(전일비)', '총 인건비(전일비)', '총 처리량(전일비)', '개당 처리비용(전일비)'
        ];
        
        // 3c. Sheet 2 데이터 조합
        const sheet2Data = Object.keys(summaryByTask).sort().map(task => {
            const taskQty = Number(dailyQuantities[task]) || 0;
            const taskCost = summaryByTask[task].totalCost;
            const costPerItem = (taskQty > 0) ? (taskCost / taskQty) : 0;
            const staffCount = summaryByTask[task].members.size;
            const duration = summaryByTask[task].totalDuration;
            
            // 전일 데이터 조회
            const prevSummary = prevTaskSummary[task] || { totalDuration: 0, totalCost: 0, members: new Set() };
            const prevQty = Number(previousDayData?.taskQuantities?.[task]) || 0;
            const prevCost = prevSummary.totalCost;
            const prevCostPerItem = (prevQty > 0) ? (prevCost / prevQty) : 0;
            const prevStaffCount = prevSummary.members.size;
            const prevDuration = prevSummary.totalDuration;

            return {
                '업무 종류': task,
                '진행 인원수': staffCount,
                '총 소요 시간(분)': Math.round(duration),
                '총 인건비(원)': Math.round(taskCost),
                '총 처리량(개)': taskQty,
                '개당 처리비용(원)': Math.round(costPerItem),
                // ✅ [추가] 전일비 계산 (단순 차이)
                '진행 인원수(전일비)': staffCount - prevStaffCount,
                '총 시간(전일비)': Math.round(duration - prevDuration),
                '총 인건비(전일비)': Math.round(taskCost - prevCost),
                '총 처리량(전일비)': taskQty - prevQty,
                '개당 처리비용(전일비)': Math.round(costPerItem - prevCostPerItem)
            };
        });
        
        const worksheet2 = XLSX.utils.json_to_sheet(sheet2Data, { header: sheet2Headers });
        if (sheet2Data.length > 0) appendTotalRow(worksheet2, sheet2Data, sheet2Headers); // (총합계 로직은 차이값은 무시하고 합계만 계산함)
        fitToColumn(worksheet2);
        XLSX.utils.book_append_sheet(workbook, worksheet2, `업무 요약 (${dateKey})`);

        // --- 4. Sheet 3: 파트별 인건비 (기존과 동일) ---
        const sheet3Headers = ['파트', '총 인건비(원)'];
        const memberToPartMap = new Map();
        (appConfig.teamGroups || []).forEach(group => group.members.forEach(member => memberToPartMap.set(member, group.name)));
        const summaryByPart = {};
        dailyRecords.forEach(r => {
            const part = memberToPartMap.get(r.member) || '알바';
            if (!summaryByPart[part]) summaryByPart[part] = { totalCost: 0 };
            const wage = combinedWageMap[r.member] || 0;
            const cost = ((Number(r.duration) || 0) / 60) * wage;
            summaryByPart[part].totalCost += cost;
        });
        const sheet3Data = Object.keys(summaryByPart).sort().map(part => ({
            '파트': part,
            '총 인건비(원)': Math.round(summaryByPart[part].totalCost)
        }));
        const worksheet3 = XLSX.utils.json_to_sheet(sheet3Data, { header: sheet3Headers });
        if (sheet3Data.length > 0) appendTotalRow(worksheet3, sheet3Data, sheet3Headers);
        fitToColumn(worksheet3);
        XLSX.utils.book_append_sheet(workbook, worksheet3, `파트 인건비 (${dateKey})`);

        // --- 5. Sheet 4: 주별 요약 (✅ 신규 항목 추가) ---
        const weeklyData = (allHistoryData || []).reduce((acc, day) => {
            if (!day || !day.id || !day.workRecords || typeof day.id !== 'string') return acc;
            try {
                const dateObj = new Date(day.id);
                if (isNaN(dateObj.getTime())) return acc;
                const weekKey = getWeekOfYear(dateObj);
                if (!weekKey) return acc;
                if (!acc[weekKey]) acc[weekKey] = { workRecords: [], taskQuantities: {} };
                acc[weekKey].workRecords.push(...(day.workRecords || []).map(r => ({ ...r, date: day.id })));
                Object.entries(day.taskQuantities || {}).forEach(([task, qty]) => {
                    acc[weekKey].taskQuantities[task] = (acc[weekKey].taskQuantities[task] || 0) + (Number(qty) || 0);
                });
            } catch (e) { console.error("Error processing day in weekly aggregation:", day.id, e); }
            return acc;
        }, {});

        const sheet4Data = [];
        // ✅ [수정] Sheet 4 헤더 (신규 항목 추가)
        const sheet4Headers = ['주(Week)', '업무', '총 시간(분)', '총 인건비(원)', '총 처리량(개)', '평균 처리량(개/분)', '평균 처리비용(원/개)', '총 참여인원(명)', '평균 처리시간(건)'];
        const sortedWeeks = Object.keys(weeklyData).sort((a,b) => a.localeCompare(b));

        for (const weekKey of sortedWeeks) {
            const dataset = weeklyData[weekKey];
            const records = dataset.workRecords || [];
            const quantities = dataset.taskQuantities || {};
            const taskSummary = records.reduce((acc, r) => {
                if (!r || !r.task) return acc;
                if (!acc[r.task]) acc[r.task] = { duration: 0, cost: 0, members: new Set(), recordCount: 0 }; // ✅
                acc[r.task].duration += (r.duration || 0);
                const wage = combinedWageMap[r.member] || 0;
                acc[r.task].cost += ((r.duration || 0) / 60) * wage;
                acc[r.task].members.add(r.member); // ✅
                acc[r.task].recordCount += 1; // ✅
                return acc;
            }, {});
            Object.entries(quantities || {}).forEach(([task, qtyValue]) => {
                const qty = Number(qtyValue) || 0;
                if (!taskSummary[task]) taskSummary[task] = { duration: 0, cost: 0, members: new Set(), recordCount: 0 }; // ✅
                taskSummary[task].quantity = (taskSummary[task].quantity || 0) + qty;
            });
            Object.keys(taskSummary).sort().forEach(task => {
                const summary = taskSummary[task];
                const qty = summary.quantity || 0;
                const duration = summary.duration || 0;
                const cost = summary.cost || 0;
                const avgThroughput = duration > 0 ? (qty / duration).toFixed(2) : '0.00';
                const avgCostPerItem = qty > 0 ? (cost / qty).toFixed(0) : '0';
                // ✅ [추가] 신규 항목 계산
                const avgStaff = summary.members.size;
                const avgTime = (summary.recordCount > 0) ? (duration / summary.recordCount) : 0;
                
                sheet4Data.push({
                    '주(Week)': weekKey,
                    '업무': task,
                    '총 시간(분)': Math.round(duration),
                    '총 인건비(원)': Math.round(cost),
                    '총 처리량(개)': qty,
                    '평균 처리량(개/분)': avgThroughput,
                    '평균 처리비용(원/개)': avgCostPerItem,
                    '총 참여인원(명)': avgStaff, // ✅
                    '평균 처리시간(건)': formatDuration(avgTime) // ✅ (엑셀에서는 분 단위 숫자가 나을 수 있지만, 일단 UI와 통일)
                });
            });
        }
        const worksheet4 = XLSX.utils.json_to_sheet(sheet4Data, { header: sheet4Headers });
        fitToColumn(worksheet4);
        XLSX.utils.book_append_sheet(workbook, worksheet4, '주별 업무 요약 (전체)');

        // --- 6. Sheet 5: 월별 요약 (✅ 신규 항목 추가) ---
        const monthlyData = (allHistoryData || []).reduce((acc, day) => {
            if (!day || !day.id || !day.workRecords || typeof day.id !== 'string' || day.id.length < 7) return acc;
            try {
                const monthKey = day.id.substring(0,7);
                if (!/^\d{4}-\d{2}$/.test(monthKey)) return acc;
                if (!acc[monthKey]) acc[monthKey] = { workRecords: [], taskQuantities: {} };
                acc[monthKey].workRecords.push(...(day.workRecords || []).map(r => ({ ...r, date: day.id })));
                Object.entries(day.taskQuantities || {}).forEach(([task, qty]) => {
                    acc[monthKey].taskQuantities[task] = (acc[monthKey].taskQuantities[task] || 0) + (Number(qty) || 0);
                });
            } catch (e) { console.error("Error processing day in monthly aggregation:", day.id, e); }
            return acc;
        }, {});

        const sheet5Data = [];
        // ✅ [수정] Sheet 5 헤더 (신규 항목 추가)
        const sheet5Headers = ['월(Month)', '업무', '총 시간(분)', '총 인건비(원)', '총 처리량(개)', '평균 처리량(개/분)', '평균 처리비용(원/개)', '총 참여인원(명)', '평균 처리시간(건)'];
        const sortedMonths = Object.keys(monthlyData).sort((a,b) => a.localeCompare(b));

        for (const monthKey of sortedMonths) {
            const dataset = monthlyData[monthKey];
            const records = dataset.workRecords || [];
            const quantities = dataset.taskQuantities || {};
            const taskSummary = records.reduce((acc, r) => {
                if (!r || !r.task) return acc;
                if (!acc[r.task]) acc[r.task] = { duration: 0, cost: 0, members: new Set(), recordCount: 0 }; // ✅
                acc[r.task].duration += (r.duration || 0);
                const wage = combinedWageMap[r.member] || 0;
                acc[r.task].cost += ((r.duration || 0) / 60) * wage;
                acc[r.task].members.add(r.member); // ✅
                acc[r.task].recordCount += 1; // ✅
                return acc;
            }, {});
            Object.entries(quantities || {}).forEach(([task, qtyValue]) => {
                const qty = Number(qtyValue) || 0;
                if (!taskSummary[task]) taskSummary[task] = { duration: 0, cost: 0, members: new Set(), recordCount: 0 }; // ✅
                taskSummary[task].quantity = (taskSummary[task].quantity || 0) + qty;
            });
            Object.keys(taskSummary).sort().forEach(task => {
                const summary = taskSummary[task];
                const qty = summary.quantity || 0;
                const duration = summary.duration || 0;
                const cost = summary.cost || 0;
                const avgThroughput = duration > 0 ? (qty / duration).toFixed(2) : '0.00';
                const avgCostPerItem = qty > 0 ? (cost / qty).toFixed(0) : '0';
                 // ✅ [추가] 신규 항목 계산
                const avgStaff = summary.members.size;
                const avgTime = (summary.recordCount > 0) ? (duration / summary.recordCount) : 0;
                
                sheet5Data.push({
                    '월(Month)': monthKey,
                    '업무': task,
                    '총 시간(분)': Math.round(duration),
                    '총 인건비(원)': Math.round(cost),
                    '총 처리량(개)': qty,
                    '평균 처리량(개/분)': avgThroughput,
                    '평균 처리비용(원/개)': avgCostPerItem,
                    '총 참여인원(명)': avgStaff, // ✅
                    '평균 처리시간(건)': formatDuration(avgTime) // ✅
                });
            });
        }
        const worksheet5 = XLSX.utils.json_to_sheet(sheet5Data, { header: sheet5Headers });
        fitToColumn(worksheet5);
        XLSX.utils.book_append_sheet(workbook, worksheet5, '월별 업무 요약 (전체)');

        XLSX.writeFile(workbook, `업무기록_${dateKey}_및_전체요약.xlsx`);

    } catch (error) {
        console.error('Excel export failed:', error);
        showToast('Excel 파일 생성에 실패했습니다.', true);
    }
};

window.downloadAttendanceHistoryAsExcel = async (dateKey) => {
    try {
        const data = allHistoryData.find(d => d.id === dateKey);
        if (!data) {
            return showToast('해당 날짜의 데이터를 찾을 수 없습니다.', true);
        }

        const workbook = XLSX.utils.book_new();

        const dailyRecords = data.onLeaveMembers || [];
        const sheet1Data = dailyRecords
            .sort((a, b) => (a.member || '').localeCompare(b.member || ''))
            .map(entry => {
                let detailText = '-';
                if (entry.startTime) {
                    detailText = formatTimeTo24H(entry.startTime);
                    if (entry.endTime) detailText += ` ~ ${formatTimeTo24H(entry.endTime)}`;
                    else if (entry.type === '외출') detailText += ' ~';
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
        
        const worksheet1 = XLSX.utils.json_to_sheet(sheet1Data, { header: ['이름', '유형', '시간 / 기간'] });
        fitToColumn(worksheet1);
        XLSX.utils.book_append_sheet(workbook, worksheet1, `근태 기록 (${dateKey})`);

        const weeklyData = (allHistoryData || []).reduce((acc, day) => {
            if (!day || !day.id || !day.onLeaveMembers || day.onLeaveMembers.length === 0 || typeof day.id !== 'string') return acc;
            try {
                 const dateObj = new Date(day.id);
                 if (isNaN(dateObj.getTime())) return acc;
                 const weekKey = getWeekOfYear(dateObj);
                 if (!weekKey) return acc;
                if (!acc[weekKey]) acc[weekKey] = { leaveEntries: [], dateKeys: new Set() };
                day.onLeaveMembers.forEach(entry => {
                    if (entry && entry.type && entry.member) {
                        if (entry.startDate) {
                            const currentDate = day.id;
                            const startDate = entry.startDate;
                            const endDate = entry.endDate || entry.startDate;
                            if (currentDate >= startDate && currentDate <= endDate) {
                                acc[weekKey].leaveEntries.push({ ...entry, date: day.id });
                            }
                        } else {
                            acc[weekKey].leaveEntries.push({ ...entry, date: day.id });
                        }
                    }
                });
                acc[weekKey].dateKeys.add(day.id);
            } catch (e) { console.error("Error processing day in attendance weekly aggregation:", day.id, e); }
            return acc;
        }, {});

        const sheet2Data = [];
        const sheet2Headers = ['주(Week)', '이름', '유형', '횟수/일수'];
        const sortedWeeks = Object.keys(weeklyData).sort((a,b) => a.localeCompare(b));

        for (const weekKey of sortedWeeks) {
            const weekSummaryData = weeklyData[weekKey];
            const summary = weekSummaryData.leaveEntries.reduce((acc, entry) => {
                const key = `${entry.member}-${entry.type}`;
                if (!acc[key]) acc[key] = { member: entry.member, type: entry.type, count: 0, days: 0 };
                if(entry.startDate) acc[key].count += 1;
                else acc[key].count += 1;
                return acc;
            }, {});

            Object.values(summary).forEach(item => {
                 if (['연차', '출장', '결근'].includes(item.type)) {
                     item.days = item.count;
                 }
            });

            Object.values(summary).sort((a,b) => a.member.localeCompare(b.member)).forEach(item => {
                sheet2Data.push({
                    '주(Week)': weekKey,
                    '이름': item.member,
                    '유형': item.type,
                    '횟수/일수': item.days > 0 ? `${item.days}일` : `${item.count}회`
                });
            });
        }
        const worksheet2 = XLSX.utils.json_to_sheet(sheet2Data, { header: sheet2Headers });
        fitToColumn(worksheet2);
        XLSX.utils.book_append_sheet(workbook, worksheet2, '주별 근태 요약 (전체)');

        const monthlyData = (allHistoryData || []).reduce((acc, day) => {
            if (!day || !day.id || !day.onLeaveMembers || day.onLeaveMembers.length === 0 || typeof day.id !== 'string' || day.id.length < 7) return acc;
             try {
                const monthKey = day.id.substring(0, 7);
                 if (!/^\d{4}-\d{2}$/.test(monthKey)) return acc;
                if (!acc[monthKey]) acc[monthKey] = { leaveEntries: [], dateKeys: new Set() };
                day.onLeaveMembers.forEach(entry => {
                     if (entry && entry.type && entry.member) {
                        if (entry.startDate) {
                            const currentDate = day.id;
                            const startDate = entry.startDate;
                            const endDate = entry.endDate || entry.startDate;
                            if (currentDate >= startDate && currentDate <= endDate) {
                                acc[monthKey].leaveEntries.push({ ...entry, date: day.id });
                            }
                        } else {
                            acc[monthKey].leaveEntries.push({ ...entry, date: day.id });
                        }
                    }
                });
                acc[monthKey].dateKeys.add(day.id);
            } catch (e) { console.error("Error processing day in attendance monthly aggregation:", day.id, e); }
            return acc;
        }, {});

        const sheet3Data = [];
        const sheet3Headers = ['월(Month)', '이름', '유형', '횟수/일수'];
        const sortedMonths = Object.keys(monthlyData).sort((a,b) => a.localeCompare(b));

        for (const monthKey of sortedMonths) {
            const monthSummaryData = monthlyData[monthKey];
            const summary = monthSummaryData.leaveEntries.reduce((acc, entry) => {
                const key = `${entry.member}-${entry.type}`;
                if (!acc[key]) acc[key] = { member: entry.member, type: entry.type, count: 0, days: 0 };
                if(entry.startDate) acc[key].count += 1;
                else acc[key].count += 1;
                return acc;
            }, {});

            Object.values(summary).forEach(item => {
                 if (['연차', '출장', '결근'].includes(item.type)) {
                     item.days = item.count;
                 }
            });

            Object.values(summary).sort((a,b) => a.member.localeCompare(b.member)).forEach(item => {
                sheet3Data.push({
                    '월(Month)': monthKey,
                    '이름': item.member,
                    '유형': item.type,
                    '횟수/일수': item.days > 0 ? `${item.days}일` : `${item.count}회`
                });
            });
        }
        const worksheet3 = XLSX.utils.json_to_sheet(sheet3Data, { header: sheet3Headers });
        fitToColumn(worksheet3);
        XLSX.utils.book_append_sheet(workbook, worksheet3, '월별 근태 요약 (전체)');

        XLSX.writeFile(workbook, `근태기록_${dateKey}_및_전체요약.xlsx`);

    } catch (error) {
        console.error('Attendance Excel export failed:', error);
        showToast('근태 Excel 파일 생성에 실패했습니다.', true);
    }
};


const switchHistoryView = (view) => {
  // ... (allViews, historyTabs, attendanceHistoryTabs 관련 코드는 기존과 동일) ...
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

  // ✅ [수정] 왼쪽 날짜 목록 컨테이너 항상 표시 (기존 수정 사항 유지)
  const dateListContainer = document.getElementById('history-date-list-container');
  if (dateListContainer) {
      dateListContainer.style.display = 'block'; 
  }

  // ⛔️ [삭제] selectedDateKey 찾는 로직 (목록 렌더링 시 처리)
  // let selectedDateKey = null; ... (이하 3줄 삭제)

  let viewToShow = null;
  let tabToActivate = null;
  
  // ✅ [추가] 모드에 따른 왼쪽 목록 렌더링
  let listMode = 'day'; // 기본값

  switch(view) {
      case 'daily':
          listMode = 'day'; // ✅
          viewToShow = document.getElementById('history-daily-view');
          tabToActivate = historyTabs?.querySelector('button[data-view="daily"]');
          // ✅ [수정] 렌더링 호출을 renderHistoryDateListByMode로 위임
          // if (selectedDateKey) renderHistoryDetail(selectedDateKey); ... (else if ... 삭제)
          break;
      case 'weekly':
          listMode = 'week'; // ✅
          viewToShow = document.getElementById('history-weekly-view');
          tabToActivate = historyTabs?.querySelector('button[data-view="weekly"]');
          renderWeeklyHistory(allHistoryData, appConfig); // (컨텐츠는 미리 렌더링)
          break;
      case 'monthly':
          listMode = 'month'; // ✅
          viewToShow = document.getElementById('history-monthly-view');
          tabToActivate = historyTabs?.querySelector('button[data-view="monthly"]');
          renderMonthlyHistory(allHistoryData, appConfig); // (컨텐츠는 미리 렌더링)
          break;
      case 'attendance-daily':
          listMode = 'day'; // ✅
          viewToShow = document.getElementById('history-attendance-daily-view');
          tabToActivate = attendanceHistoryTabs?.querySelector('button[data-view="attendance-daily"]');
          // ✅ [수정] 렌더링 호출을 renderHistoryDateListByMode로 위임
          // if (selectedDateKey) renderAttendanceDailyHistory(selectedDateKey, allHistoryData); ... (else if ... 삭제)
          break;
      case 'attendance-weekly':
          listMode = 'week'; // ✅
          viewToShow = document.getElementById('history-attendance-weekly-view');
          tabToActivate = attendanceHistoryTabs?.querySelector('button[data-view="attendance-weekly"]');
          renderAttendanceWeeklyHistory(allHistoryData); // (컨텐츠는 미리 렌더링)
          break;
      case 'attendance-monthly':
          listMode = 'month'; // ✅
          viewToShow = document.getElementById('history-attendance-monthly-view');
          tabToActivate = attendanceHistoryTabs?.querySelector('button[data-view="attendance-monthly"]');
          renderAttendanceMonthlyHistory(allHistoryData); // (컨텐츠는 미리 렌더링)
          break;
  }
  
  // ✅ [추가] 목록 렌더링 호출 (컨텐츠 렌더링 이후)
  renderHistoryDateListByMode(listMode);

  if (viewToShow) viewToShow.classList.remove('hidden');
  if (tabToActivate) {
      tabToActivate.classList.add('font-semibold', 'text-blue-600', 'border-blue-600', 'border-b-2');
      tabToActivate.classList.remove('text-gray-500');
  }
};


// ⛔️ [수정 1] '#open-history-btn' 리스너에서 전체화면 코드 제거 및 초기화 로직 추가
if (openHistoryBtn) {
  openHistoryBtn.addEventListener('click', async () => {
    // ✅ [추가] 현재 로그인 상태 확인 (기존 로직 유지)
    if (!auth || !auth.currentUser) {
        showToast('이력을 보려면 로그인이 필요합니다.', true);
        if (historyModal && !historyModal.classList.contains('hidden')) {
             historyModal.classList.add('hidden'); // 혹시 열렸으면 닫기
        }
        if (loginModal) loginModal.classList.remove('hidden'); // 로그인 모달 표시
        return; // 함수 종료
    }
      
    // --- 로그인 상태인 경우 계속 진행 ---
    if (historyModal) {
      historyModal.classList.remove('hidden'); // 이력 모달 표시
      
      // ✅ [추가] 팝업 위치/스타일 초기화 로직
      // (드래그로 인해 변경된 스타일을 모달을 열 때마다 초기화)
      const contentBox = document.getElementById('history-modal-content-box');
      const overlay = document.getElementById('history-modal');
      
      if (contentBox && overlay && contentBox.dataset.hasBeenUncentered === 'true') {
          // 1. 오버레이에 flex/centering 클래스 다시 추가
          overlay.classList.add('flex', 'items-center', 'justify-center');
          
          // 2. 컨텐츠 박스의 position/top/left 스타일 제거 (가운데 정렬 복원)
          contentBox.style.position = '';
          contentBox.style.top = '';
          contentBox.style.left = '';
          
          // 3. 플래그 리셋
          contentBox.dataset.hasBeenUncentered = 'false';
      }
      
      // ⛔️ [삭제] 기존 전체화면 요청 블록 (try...catch) 전체 삭제
      /*
      const contentElement = historyModal.querySelector('.bg-white');
      if (contentElement) {
        try {
          if (contentElement.requestFullscreen) await contentElement.requestFullscreen();
          else if (contentElement.webkitRequestFullscreen) await contentElement.webkitRequestFullscreen();
          else if (contentElement.msRequestFullscreen) await contentElement.msRequestFullscreen();
        } catch (err) {
          console.warn("전체 화면 요청 실패 (무시됨):", err); 
        }
      }
      */
      
      // 데이터 로드 및 렌더링 (기존 로직 유지)
      try {
          await loadAndRenderHistoryList(); 
      } catch (loadError) {
          console.error("이력 데이터 로딩 중 오류:", loadError);
          showToast("이력 데이터를 불러오는 중 오류가 발생했습니다.", true);
      }
    }
  });
}

// ✅ [추가] 수동 기록 추가 모달 열기
if (openManualAddBtn) {
    openManualAddBtn.addEventListener('click', () => {
        // 모달을 열 때마다 최신 직원/업무 목록으로 채웁니다.
        renderManualAddModalDatalists(appState, appConfig);
        if (manualAddForm) manualAddForm.reset(); // 폼 초기화
        if (manualAddRecordModal) manualAddRecordModal.classList.remove('hidden');
    });
}

// ✅ [추가] 수동 기록 추가 모달 - 저장
if (confirmManualAddBtn) {
    confirmManualAddBtn.addEventListener('click', () => {
        const member = document.getElementById('manual-add-member')?.value.trim();
        const task = document.getElementById('manual-add-task')?.value.trim();
        const startTime = document.getElementById('manual-add-start-time')?.value;
        const endTime = document.getElementById('manual-add-end-time')?.value;

        if (!member || !task || !startTime || !endTime) {
            showToast('모든 필드를 올바르게 입력해주세요.', true);
            return;
        }

        if (endTime < startTime) {
            showToast('종료 시간은 시작 시간보다 이후여야 합니다.', true);
            return;
        }

        const newId = generateId();
        const duration = calcElapsedMinutes(startTime, endTime, []);

        const newRecord = {
            id: newId,
            member: member,
            task: task,
            startTime: startTime,
            endTime: endTime,
            duration: duration,
            status: 'completed', // 수동 추가는 항상 '완료' 상태
            groupId: null,
            pauses: []
        };

        appState.workRecords.push(newRecord);
        debouncedSaveState(); // 변경사항 저장

        showToast('수동 기록이 추가되었습니다.');
        if (manualAddRecordModal) manualAddRecordModal.classList.add('hidden');
        if (manualAddForm) manualAddForm.reset();
    });
}

// ✅ [추가] 수동 기록 추가 모달 - 취소
if (cancelManualAddBtn) {
    cancelManualAddBtn.addEventListener('click', () => {
        if (manualAddRecordModal) manualAddRecordModal.classList.add('hidden');
        if (manualAddForm) manualAddForm.reset();
    });
}

// ✅ [추가] 수동 기록 추가 모달 (공통 닫기 버튼용)
// document.querySelectorAll('.modal-close-btn').forEach(btn => { ... } 리스너 내부에
// else if (modalId === 'manual-add-record-modal') {
//    if (manualAddForm) manualAddForm.reset();
// }

// ✅ [수정] 전체 화면 버튼 관련 리스너 제거
// if (fullscreenHistoryBtn) { ... } // 이 부분 전체 삭제
// document.addEventListener('fullscreenchange', ...) // 첫 번째 fullscreenchange 리스너 삭제

if (teamStatusBoard) {
  teamStatusBoard.addEventListener('click', (e) => {
    // --- 가장 구체적인 버튼/액션 요소들을 먼저 확인 ---

    // 1. 모바일 토글 버튼들
    const toggleMobileBtn = e.target.closest('#toggle-all-tasks-mobile');
    if (toggleMobileBtn) {
        e.stopPropagation(); // ✅ 중요: 다른 핸들러 방지
        // ... (토글 로직 동일) ...
        const grid = document.getElementById('preset-task-grid');
        if (!grid) return;
        const isExpanded = grid.classList.contains('mobile-expanded');
        if (isExpanded) {
            grid.classList.remove('mobile-expanded');
            grid.querySelectorAll('.mobile-task-hidden').forEach(card => {
                card.classList.add('hidden');
                card.classList.remove('flex');
            });
            toggleMobileBtn.textContent = '전체보기';
            toggleMobileBtn.classList.remove('bg-blue-100', 'text-blue-800');
            toggleMobileBtn.classList.add('bg-gray-200', 'text-gray-800');
        } else {
            grid.classList.add('mobile-expanded');
            grid.querySelectorAll('.mobile-task-hidden.hidden').forEach(card => {
                card.classList.remove('hidden');
                card.classList.add('flex');
            });
            toggleMobileBtn.textContent = '내 업무';
            toggleMobileBtn.classList.add('bg-blue-100', 'text-blue-800');
            toggleMobileBtn.classList.remove('bg-gray-200', 'text-gray-800');
        }
        return;
    }
    const toggleMemberBtn = e.target.closest('#toggle-all-members-mobile');
    if (toggleMemberBtn) {
        e.stopPropagation(); // ✅ 중요: 다른 핸들러 방지
        // ... (토글 로직 동일) ...
        const container = document.getElementById('all-members-container');
        if (!container) return;
        const isExpanded = container.classList.contains('mobile-expanded');
        if (isExpanded) {
            container.classList.remove('mobile-expanded');
            container.querySelectorAll('.mobile-member-hidden').forEach(card => {
                card.classList.add('hidden');
                card.classList.remove('flex');
            });
            toggleMemberBtn.textContent = '전체보기';
            toggleMemberBtn.classList.remove('bg-blue-100', 'text-blue-800');
            toggleMemberBtn.classList.add('bg-gray-200', 'text-gray-800');
        } else {
            container.classList.add('mobile-expanded');
            container.querySelectorAll('.mobile-member-hidden.hidden').forEach(card => {
                card.classList.remove('hidden');
                card.classList.add('flex');
            });
            toggleMemberBtn.textContent = '내 현황';
            toggleMemberBtn.classList.add('bg-blue-100', 'text-blue-800');
            toggleMemberBtn.classList.remove('bg-gray-200', 'text-gray-800');
        }
        return;
    }

    // 2. 카드 내부의 액션 버튼들 (정지, 재개, 종료, 인원추가)
    const stopGroupButton = e.target.closest('.stop-work-group-btn');
    if (stopGroupButton) {
        e.stopPropagation(); // ✅ 중요
        groupToStopId = Number(stopGroupButton.dataset.groupId);
        const stopGroupModal = document.getElementById('stop-group-confirm-modal');
        if (stopGroupModal) {
            const card = stopGroupButton.closest('div[data-group-id]');
            const taskName = card ? card.querySelector('.font-bold.text-lg')?.textContent.replace(' (일시정지)','').trim() : '이 그룹';
            const msgEl = document.getElementById('stop-group-confirm-message');
            if (msgEl) msgEl.textContent = `'${taskName}' 업무를 전체 종료하시겠습니까?`;
            stopGroupModal.classList.remove('hidden');
        }
        return;
    }
    const pauseGroupButton = e.target.closest('.pause-work-group-btn');
    if (pauseGroupButton) { e.stopPropagation(); pauseWorkGroup(Number(pauseGroupButton.dataset.groupId)); return; }
    const resumeGroupButton = e.target.closest('.resume-work-group-btn');
    if (resumeGroupButton) { e.stopPropagation(); resumeWorkGroup(Number(resumeGroupButton.dataset.groupId)); return; }

    const individualPauseBtn = e.target.closest('[data-action="pause-individual"]');
    if (individualPauseBtn) { e.stopPropagation(); pauseWorkIndividual(individualPauseBtn.dataset.recordId); return; }
    const individualResumeBtn = e.target.closest('[data-action="resume-individual"]');
    if (individualResumeBtn) { e.stopPropagation(); resumeWorkIndividual(individualResumeBtn.dataset.recordId); return; }
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
    const addMemberButton = e.target.closest('.add-member-btn[data-action="add-member"]');
    if (addMemberButton) {
        e.stopPropagation();
        const groupId = Number(addMemberButton.dataset.groupId);
        const task = addMemberButton.dataset.task;
        selectedTaskForStart = task;
        selectedGroupForAdd = groupId;
        renderTeamSelectionModalContent(task, appState, appConfig.teamGroups);
        const titleEl = document.getElementById('team-select-modal-title');
        if (titleEl) titleEl.textContent = `'${task}' 업무에 인원 추가`;
        if (teamSelectModal) teamSelectModal.classList.remove('hidden');
        return;
    }

    // --- 버튼 외 클릭 가능한 영역 확인 ---

    // 3. 그룹 시작 시간 수정 영역
    const groupTimeDisplay = e.target.closest('.group-time-display[data-action="edit-group-start-time"]');
    if (groupTimeDisplay) {
        // stopPropagation 불필요 (하위에 더 이상 액션 없음)
        const groupId = groupTimeDisplay.dataset.groupId;
        const currentStartTime = groupTimeDisplay.dataset.currentStartTime;
        const taskName = groupTimeDisplay.closest('.flex-col.h-full')?.querySelector('.font-bold.text-lg')?.textContent.replace(' (일시정지)', '').trim() || '그룹';
        if (groupId && currentStartTime) {
            recordIdOrGroupIdToEdit = Number(groupId);
            editType = 'group';
            if (editStartTimeModalTitle) editStartTimeModalTitle.textContent = `'${taskName}' 그룹 시간 변경`;
            if (editStartTimeModalMessage) editStartTimeModalMessage.textContent = `그룹 전체의 시작 시간을 변경합니다. 현재: ${currentStartTime}`;
            if (editStartTimeInput) editStartTimeInput.value = currentStartTime;
            if (editStartTimeContextIdInput) editStartTimeContextIdInput.value = recordIdOrGroupIdToEdit;
            if (editStartTimeContextTypeInput) editStartTimeContextTypeInput.value = editType;
            if (editStartTimeModal) editStartTimeModal.classList.remove('hidden');
        }
        return;
    }

    // 4. 개별 시작 시간 수정 영역 (단, 내부 액션 버튼 클릭은 제외)
    const memberRow = e.target.closest('.member-row[data-action="edit-individual-start-time"]');
    if (memberRow && !e.target.closest('.member-actions button')) { // 액션 버튼 클릭 시 이 로직 실행 안 함
        // stopPropagation 불필요
        const recordId = memberRow.dataset.recordId;
        const currentStartTime = memberRow.dataset.currentStartTime;
        const memberName = memberRow.querySelector('.font-semibold')?.textContent || '팀원';
        const taskName = memberRow.closest('.flex-col.h-full')?.querySelector('.font-bold.text-lg')?.textContent.replace(' (일시정지)', '').trim() || '업무';
        if (recordId && currentStartTime) {
            recordIdOrGroupIdToEdit = recordId;
            editType = 'individual';
            if (editStartTimeModalTitle) editStartTimeModalTitle.textContent = `${memberName}님 시간 변경`;
            if (editStartTimeModalMessage) editStartTimeModalMessage.textContent = `'${taskName}' 업무의 시작 시간을 변경합니다. 현재: ${currentStartTime}`;
            if (editStartTimeInput) editStartTimeInput.value = currentStartTime;
            if (editStartTimeContextIdInput) editStartTimeContextIdInput.value = recordIdOrGroupIdToEdit;
            if (editStartTimeContextTypeInput) editStartTimeContextTypeInput.value = editType;
            if (editStartTimeModal) editStartTimeModal.classList.remove('hidden');
        }
        return;
    }

    // 5. 근태 설정 카드
    const memberCard = e.target.closest('[data-member-toggle-leave]');
    if (memberCard) {
        // ... (근태 설정/취소 로직 동일) ...
        const memberName = memberCard.dataset.memberToggleLeave;
        const role = appState.currentUserRole || 'user';
        const selfName = appState.currentUser || null;
        if (role !== 'admin' && memberName !== selfName) {
            showToast('본인의 근태 현황만 설정할 수 있습니다.', true); return;
        }
        const isWorking = (appState.workRecords || []).some(r => r.member === memberName && (r.status === 'ongoing' || r.status === 'paused'));
        if (isWorking) {
            return showToast(`${memberName}님은 현재 업무 중이므로 근태 상태를 변경할 수 없습니다.`, true);
        }
        const combinedOnLeaveMembers = [...(appState.dailyOnLeaveMembers || []), ...(appState.dateBasedOnLeaveMembers || [])];
        const currentLeaveEntry = combinedOnLeaveMembers.find(item => item.member === memberName && !(item.type === '외출' && item.endTime));
        if (currentLeaveEntry) {
            const leaveType = currentLeaveEntry.type; memberToCancelLeave = memberName;
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
            } else if (leaveDateInputsDiv) { leaveDateInputsDiv.classList.add('hidden'); }
            if(leaveTypeModal) leaveTypeModal.classList.remove('hidden');
        }
        return;
    }

    // --- 위에서 처리되지 않은 경우, 카드 전체 클릭으로 간주 ---

    // 6. 업무 카드 전체 클릭 (시작 또는 기타 업무)
    const card = e.target.closest('div[data-action]');
     // 🚨 수정: 클릭 제외 대상에서 .group-time-display, .member-row 제거 (이미 위에서 처리)
    if (card && !e.target.closest('button, a, input, select, .members-list')) {
      const action = card.dataset.action;
      const task = card.dataset.task;

      if (action === 'start-task') {
        selectedTaskForStart = task; selectedGroupForAdd = null;
        renderTeamSelectionModalContent(task, appState, appConfig.teamGroups);
        const titleEl = document.getElementById('team-select-modal-title');
        if (titleEl) titleEl.textContent = `'${task}' 업무 시작`;
        if (teamSelectModal) teamSelectModal.classList.remove('hidden');
        return; // ✅ 추가
      } else if (action === 'other') {
        selectedTaskForStart = null; selectedGroupForAdd = null;
        if (taskSelectModal) taskSelectModal.classList.remove('hidden');
        return; // ✅ 추가
      }
      // 'add-member' 액션은 버튼에서 직접 처리됨
    }
  });
}

// ... (workLogBody 리스너는 이전과 동일) ...
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

// ... (deleteAllCompletedBtn, confirmDeleteBtn 리스너는 이전과 동일) ...
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
    debouncedSaveState(); // ✅ [수정]
    if (deleteConfirmModal) deleteConfirmModal.classList.add('hidden');
    recordToDeleteId = null;
    deleteMode = 'single';
  });
}

// ✅ [수정] '업무 마감' 버튼 리스너 (카운트 로직 변경)
if (endShiftBtn) {
  endShiftBtn.addEventListener('click', () => {
    const ongoingRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused');
    
    if (ongoingRecords.length > 0) {
        // [수정] 진행 중인 '업무 종류'의 갯수를 셉니다.
        const ongoingTaskNames = new Set(ongoingRecords.map(r => r.task));
        const ongoingTaskCount = ongoingTaskNames.size;

        // 진행 중인 업무가 있으면 모달 표시
        if (endShiftConfirmTitle) endShiftConfirmTitle.textContent = `진행 중인 업무 ${ongoingTaskCount}종`;
        if (endShiftConfirmMessage) endShiftConfirmMessage.textContent = `총 ${ongoingRecords.length}명이 참여 중인 ${ongoingTaskCount}종의 업무가 있습니다. 모두 종료하고 마감하시겠습니까?`;
        if (endShiftConfirmModal) endShiftConfirmModal.classList.remove('hidden');
    } else {
        // 진행 중인 업무가 없으면 즉시 마감
        saveDayDataToHistory(false);
        showToast('업무 마감 처리 완료. 오늘의 기록을 이력에 저장하고 초기화했습니다.');
    }
  });
}

// ✅ [추가] '업무 마감 확인' 모달 버튼 리스너
if (confirmEndShiftBtn) {
    confirmEndShiftBtn.addEventListener('click', () => {
        // saveDayDataToHistory(false)가 이미 자동 종료 로직을 포함함
        saveDayDataToHistory(false);
        showToast('업무 마감 처리 완료. 오늘의 기록을 이력에 저장하고 초기화했습니다.');
        if (endShiftConfirmModal) endShiftConfirmModal.classList.add('hidden');
    });
}

if (cancelEndShiftBtn) {
    cancelEndShiftBtn.addEventListener('click', () => {
        if (endShiftConfirmModal) endShiftConfirmModal.classList.add('hidden');
    });
}


if (saveProgressBtn) {
  saveProgressBtn.addEventListener('click', () => saveProgress(false));
}

// ⛔️ [수정 3] 'closeHistoryBtn' 리스너 수정 (단순 닫기 기능만 남김)
if (closeHistoryBtn) {
  closeHistoryBtn.addEventListener('click', () => {
    /* ⛔️ [삭제]
    if (document.fullscreenElement) { // 전체 화면 상태에서 닫기 버튼 누르면
        document.exitFullscreen(); // 전체 화면 종료 (fullscreenchange 리스너가 모달 닫음)
    } else if (historyModal) {
        historyModal.classList.add('hidden'); // 일반 상태면 그냥 닫음
    }
    */
    // ✅ [수정]
    if (historyModal) {
        historyModal.classList.add('hidden'); // 그냥 닫음
    }
  });
}

if (historyDateList) {
  historyDateList.addEventListener('click', (e) => {
    const btn = e.target.closest('.history-date-btn');
    if (btn) {
      historyDateList.querySelectorAll('button').forEach(b => b.classList.remove('bg-blue-100', 'font-bold'));
      btn.classList.add('bg-blue-100', 'font-bold');
      const dateKey = btn.dataset.key; // (day, week, month 키가 됨)
      
      const activeSubTabBtn = (activeMainHistoryTab === 'work')
        ? historyTabs?.querySelector('button.font-semibold')
        : attendanceHistoryTabs?.querySelector('button.font-semibold');
      const activeView = activeSubTabBtn ? activeSubTabBtn.dataset.view : (activeMainHistoryTab === 'work' ? 'daily' : 'attendance-daily');
      
      if (activeView === 'daily') {
          // ✅ [수정] 클릭된 dateKey(일) 기준 전일 데이터 찾기
          const currentIndex = allHistoryData.findIndex(d => d.id === dateKey);
          const previousDayData = (currentIndex > -1 && currentIndex + 1 < allHistoryData.length) 
                                ? allHistoryData[currentIndex + 1] 
                                : null;
          renderHistoryDetail(dateKey, previousDayData);

      } else if (activeView === 'attendance-daily') {
          renderAttendanceDailyHistory(dateKey, allHistoryData);
      
      } else if (activeView === 'weekly' || activeView === 'monthly' || activeView === 'attendance-weekly' || activeView === 'attendance-monthly') {
          // ✅ [수정] 스크롤 로직 (dateKey가 이미 week/month 키임)
          const targetKey = dateKey; 

          // (근태 탭은 스크롤 대상이 없음)
          if (activeView === 'weekly' || activeView === 'monthly') {
              const summaryCard = document.getElementById(`summary-card-${targetKey}`);
              if (summaryCard) {
                  summaryCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  summaryCard.classList.add('ring-2', 'ring-blue-400', 'transition-all', 'duration-300');
                  setTimeout(() => {
                      summaryCard.classList.remove('ring-2', 'ring-blue-400');
                  }, 2000); 
              }
          }
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
        await loadAndRenderHistoryList();
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
      activeMainHistoryTab = tabName;

      document.querySelectorAll('.history-main-tab-btn').forEach(b => {
          b.classList.remove('font-semibold', 'text-blue-600', 'border-b-2', 'border-blue-600');
          b.classList.add('font-medium', 'text-gray-500');
      });
      btn.classList.add('font-semibold', 'text-blue-600', 'border-b-2', 'border-blue-600');
      btn.classList.remove('font-medium', 'text-gray-500');

      if (tabName === 'work') {
        if (workHistoryPanel) workHistoryPanel.classList.remove('hidden');
        if (attendanceHistoryPanel) attendanceHistoryPanel.classList.add('hidden');
        const activeSubTabBtn = historyTabs?.querySelector('button.font-semibold');
        const view = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'daily';
        switchHistoryView(view);
      } else {
        if (workHistoryPanel) workHistoryPanel.classList.add('hidden');
        if (attendanceHistoryPanel) attendanceHistoryPanel.classList.remove('hidden');
        const activeSubTabBtn = attendanceHistoryTabs?.querySelector('button.font-semibold');
        const view = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'attendance-daily';
        switchHistoryView(view);
      }
    }
  });
}

if (attendanceHistoryTabs) {
  attendanceHistoryTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-view]');
    if (btn) {
      switchHistoryView(btn.dataset.view);
    }
  });
}


if (resetAppBtn) {
  resetAppBtn.addEventListener('click', () => {
    if (resetAppModal) resetAppModal.classList.remove('hidden');
  });
}
if (confirmResetAppBtn) {
  confirmResetAppBtn.addEventListener('click', async () => {
    await saveDayDataToHistory(true);
    if (resetAppModal) resetAppModal.classList.add('hidden');
  });
}

if (confirmQuantityBtn) {
  confirmQuantityBtn.addEventListener('click', () => {
    const inputs = quantityModal.querySelectorAll('input[data-task]');
    const newQuantities = {};
    inputs.forEach(input => {
      const task = input.dataset.task;
      const quantity = Number(input.value) || 0;
      if (quantity > 0) newQuantities[task] = quantity;
    });
    if (quantityModalContext.onConfirm) {
      quantityModalContext.onConfirm(newQuantities);
    }
    if (quantityModal) quantityModal.classList.add('hidden');
  });
}

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

    record.task = newTask;
    record.startTime = newStart;
    record.endTime = newEnd;
    record.duration = calcElapsedMinutes(newStart, newEnd, record.pauses);

    debouncedSaveState(); // ✅ [수정]
    showToast('기록이 수정되었습니다.');
    if (editRecordModal) editRecordModal.classList.add('hidden');
    recordToEditId = null;
  });
}

if (confirmQuantityOnStopBtn) {
  confirmQuantityOnStopBtn.addEventListener('click', () => {
    if (groupToStopId) {
      const input = document.getElementById('quantity-on-stop-input');
      const quantity = input ? (Number(input.value) || 0) : null;
      finalizeStopGroup(groupToStopId, quantity);
      if(input) input.value = '';
    }
  });
}

if (taskSelectModal) {
  taskSelectModal.addEventListener('click', (e) => {
    const btn = e.target.closest('.task-select-btn');
    if (btn) {
      const task = btn.dataset.task;
      if (taskSelectModal) taskSelectModal.classList.add('hidden');

      selectedTaskForStart = task;
      selectedGroupForAdd = null;
      renderTeamSelectionModalContent(task, appState, appConfig.teamGroups);
      const titleEl = document.getElementById('team-select-modal-title');
      if (titleEl) titleEl.textContent = `'${task}' 업무 시작`;
      if (teamSelectModal) teamSelectModal.classList.remove('hidden');
    }
  });
}

if (confirmStopIndividualBtn) {
  confirmStopIndividualBtn.addEventListener('click', () => {
    if (recordToStopId) {
      stopWorkIndividual(recordToStopId);
    }
    if (stopIndividualConfirmModal) stopIndividualConfirmModal.classList.add('hidden');
    recordToStopId = null;
  });
}

const confirmStopGroupBtn = document.getElementById('confirm-stop-group-btn');
if (confirmStopGroupBtn) {
  confirmStopGroupBtn.addEventListener('click', () => {
    if (groupToStopId) {
      stopWorkGroup(groupToStopId);
    }
    const stopGroupModal = document.getElementById('stop-group-confirm-modal');
    if (stopGroupModal) stopGroupModal.classList.add('hidden');
    groupToStopId = null;
  });
}

const cancelStopGroupBtn = document.getElementById('cancel-stop-group-btn');
if (cancelStopGroupBtn) {
  cancelStopGroupBtn.addEventListener('click', () => {
    const stopGroupModal = document.getElementById('stop-group-confirm-modal');
    if (stopGroupModal) stopGroupModal.classList.add('hidden');
    groupToStopId = null;
  });
}
// [여기까지 추가]

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
        debouncedSaveState(); // ✅ [수정]

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
        await saveLeaveSchedule(db, persistentLeaveSchedule); // ✅ [유지] 이건 즉시 실행 (onSnapshot 트리거)
        markDataAsDirty();
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
            debouncedSaveState(); // ✅ [수정]
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
            await saveLeaveSchedule(db, persistentLeaveSchedule); // ✅ [유지] 이건 즉시 실행 (onSnapshot 트리거)
            markDataAsDirty();
            actionTaken = true;
        }

        if (!actionTaken) {
             showToast(`${memberToCancelLeave}님의 근태 정보를 찾을 수 없습니다.`, true);
        }

        if(cancelLeaveConfirmModal) cancelLeaveConfirmModal.classList.add('hidden');
        memberToCancelLeave = null;
    });
}

// ... (모달 공통 닫기 버튼 및 나머지 닫기 버튼 리스너들은 이전과 동일) ...
// === app.js (기존 modal-close-btn 리스너 덮어쓰기) ===
document.querySelectorAll('.modal-close-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
      const modal = e.target.closest('.fixed.inset-0');
      // ✅ [수정] history-modal 내부의 닫기 버튼은 제외 (별도 처리)
      if (!modal || modal.id === 'history-modal') return;

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
      } else if (modalId === 'stop-group-confirm-modal') { // [추가]
          groupToStopId = null; // [추가]
      } else if (modalId === 'stop-individual-confirm-modal') {
          recordToStopId = null;
      } else if (modalId === 'edit-part-timer-modal') {
          // (알바 수정 모달 닫기 로직 - 이미 존재)
      } else if (modalId === 'manual-add-record-modal') { // ✅ [추가]
          if (manualAddForm) manualAddForm.reset();
      } 
      // ✅ [추가] 시작 시간 수정 모달 닫기 시 초기화
      else if (modalId === 'edit-start-time-modal') { 
          recordIdOrGroupIdToEdit = null;
          editType = null;
          if (editStartTimeInput) editStartTimeInput.value = '';
          if (editStartTimeContextIdInput) editStartTimeContextIdInput.value = '';
          if (editStartTimeContextTypeInput) editStartTimeContextTypeInput.value = '';
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
// ✅ [추가] '업무 마감 확인' 모달의 취소 버튼
if (cancelEndShiftBtn) cancelEndShiftBtn.addEventListener('click', () => { if(endShiftConfirmModal) endShiftConfirmModal.classList.add('hidden'); });


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

        debouncedSaveState(); // ✅ [수정]
        // 즉각적인 UI 반응을 위해 렌더링은 바로 호출
        renderTeamSelectionModalContent(selectedTaskForStart, appState, appConfig.teamGroups);
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
        debouncedSaveState(); // ✅ [수정]
        // 즉각적인 UI 반응을 위해 렌더링은 바로 호출
        renderTeamSelectionModalContent(selectedTaskForStart, appState, appConfig.teamGroups);
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
    
    debouncedSaveState(); // ✅ [수정]
    
    // 즉각적인 UI 반응을 위해 렌더링은 바로 호출
    renderTeamSelectionModalContent(selectedTaskForStart, appState, appConfig.teamGroups);
    if (editPartTimerModal) editPartTimerModal.classList.add('hidden');
    showToast('알바 이름이 수정되었습니다.');
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

// ✅ [삭제] 여기 있던 첫 번째 startAppAfterLogin 함수 정의를 삭제했습니다.

// ✅ [수정] startAppAfterLogin 함수 (역할 확인 및 UI 제어 로직 추가)
async function startAppAfterLogin(user) { 
  const loadingSpinner = document.getElementById('loading-spinner');
  if (loadingSpinner) loadingSpinner.style.display = 'block'; 

  try { 
      if (connectionStatusEl) connectionStatusEl.textContent = '설정 로딩 중...';
      
      // 설정 로드
      appConfig = await loadAppConfig(db); 
      persistentLeaveSchedule = await loadLeaveSchedule(db);
      
      const userEmail = user.email;
      
      if (!userEmail) {
          showToast('로그인 사용자의 이메일 정보를 가져올 수 없습니다. 다시 로그인해주세요.', true);
          console.error(`Logged in user object has null email. User ID: ${user.uid}`);
          const loadingSpinner = document.getElementById('loading-spinner');
          if (loadingSpinner) loadingSpinner.style.display = 'none';
          if (connectionStatusEl) connectionStatusEl.textContent = '인증 오류';
          auth.signOut(); 
          if (loginModal) loginModal.classList.remove('hidden'); 
          return;
      }
      
      // --- ✅ [수정] 역할 확인 로직 ---
      const userEmailLower = userEmail.toLowerCase();
      const memberEmails = appConfig.memberEmails || {}; 
      const memberRoles = appConfig.memberRoles || {}; // { "park@test.com": "admin", ... }

      const emailToMemberMap = Object.entries(memberEmails).reduce((acc, [name, email]) => {
          if (email) acc[email.toLowerCase()] = name;
          return acc;
      }, {});

      const currentUserName = emailToMemberMap[userEmailLower]; 
      
      // ✅ [추가] 역할 조회 (없으면 'user' 기본값)
      const currentUserRole = memberRoles[userEmailLower] || 'user';
      // ------------------------------------

      if (!currentUserName) {
          showToast('로그인했으나 앱에 등록된 사용자가 아닙니다. 관리자에게 문의하세요.', true);
          console.warn(`User ${userEmail} logged in but not found in appConfig.memberEmails.`);
          if (loadingSpinner) loadingSpinner.style.display = 'none';
          if (connectionStatusEl) connectionStatusEl.textContent = '사용자 미등록';
          auth.signOut(); 
          if (loginModal) loginModal.classList.remove('hidden'); 
          return;
      }
      
      // ✅ [성공] appState에 현재 사용자 이름 및 "역할" 저장
      appState.currentUser = currentUserName;
      appState.currentUserRole = currentUserRole; // ✅ 역할 저장!
      
      if (userGreeting) {
          // ✅ [수정] 역할도 함께 표시 (선택 사항)
          userGreeting.textContent = `${currentUserName}님 (${currentUserRole}), 안녕하세요.`;
          userGreeting.classList.remove('hidden');
      }
      if (logoutBtn) {
          logoutBtn.classList.remove('hidden');
      }
      
      // --- ✅ [수정] 역할(Role)에 따른 UI 제어 ---
      const adminLinkBtn = document.getElementById('admin-link-btn');
      const resetAppBtn = document.getElementById('reset-app-btn');
      const openManualAddBtn = document.getElementById('open-manual-add-btn');
      const deleteAllCompletedBtn = document.getElementById('delete-all-completed-btn');
      const openHistoryBtn = document.getElementById('open-history-btn'); // ✅ [추가] 이력 보기 버튼

      if (currentUserRole === 'admin') {
          // 관리자일 경우: 모든 버튼 표시
          if (adminLinkBtn) adminLinkBtn.style.display = 'flex';
          if (resetAppBtn) resetAppBtn.style.display = 'flex';
          if (openManualAddBtn) openManualAddBtn.style.display = 'inline-block';
          if (deleteAllCompletedBtn) deleteAllCompletedBtn.style.display = 'inline-block';
          if (openHistoryBtn) openHistoryBtn.style.display = 'inline-block'; // ✅ [추가]
          
      } else {
          // 일반 사용자(user)일 경우: 관리자 기능 숨기기
          if (adminLinkBtn) adminLinkBtn.style.display = 'none';
          if (resetAppBtn) resetAppBtn.style.display = 'none';
          if (openManualAddBtn) openManualAddBtn.style.display = 'none';
          if (deleteAllCompletedBtn) deleteAllCompletedBtn.style.display = 'none';
          if (openHistoryBtn) openHistoryBtn.style.display = 'none'; // ✅ [추가]
      }
      // ------------------------------------------

      document.getElementById('current-date-display')?.classList.remove('hidden');
      document.getElementById('top-right-controls')?.classList.remove('hidden');
      document.querySelector('.bg-gray-800.shadow-lg')?.classList.remove('hidden'); 
      document.getElementById('main-content-area')?.classList.remove('hidden'); 
      document.querySelectorAll('.p-6.bg-gray-50.rounded-lg.border.border-gray-200').forEach(el => { 
          if(el.querySelector('#completed-log-content') || el.querySelector('#analysis-content')) {
              el.classList.remove('hidden');
          }
      });


      if (loadingSpinner) loadingSpinner.style.display = 'none'; 
      renderDashboardLayout(appConfig); 
      renderTaskSelectionModal(appConfig.taskGroups);

  } catch (e) { 
      console.error("설정 로드 실패:", e);
      showToast("설정 정보 로드에 실패했습니다. 기본값으로 실행합니다.", true);
      const loadingSpinner = document.getElementById('loading-spinner');
      if (loadingSpinner) loadingSpinner.style.display = 'none';
      renderDashboardLayout(appConfig); 
      renderTaskSelectionModal(appConfig.taskGroups);
  }
  
  // ✅ [수정] try...catch 블록 밖으로 이동 (정상)
  displayCurrentDate();
  if (elapsedTimeTimer) clearInterval(elapsedTimeTimer);
  elapsedTimeTimer = setInterval(updateElapsedTimes, 1000);

  if (autoSaveTimer) clearInterval(autoSaveTimer);
  autoSaveTimer = setInterval(autoSaveProgress, AUTO_SAVE_INTERVAL);

  // --- 기존 onAuthStateChanged 로직을 여기로 이동 ---
  // (이미 user 객체가 있으므로 onAuthStateChanged 대신 리스너만 설정)

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
      
      markDataAsDirty();
      render();
      
  }, (error) => {
      console.error("근태 일정 실시간 연결 실패:", error);
      showToast("근태 일정 연결에 실패했습니다.", true);
      appState.dateBasedOnLeaveMembers = [];
      render();
  });

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

      isDataDirty = false;

      renderDashboardLayout(appConfig); 
      render(); 
      if (connectionStatusEl) connectionStatusEl.textContent = '동기화';
      if (statusDotEl) statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-green-500';
    } catch (parseError) {
      console.error('Error parsing state from Firestore:', parseError);
      showToast('데이터 로딩 중 오류 발생 (파싱 실패).', true);
      appState = { workRecords: [], taskQuantities: {}, dailyOnLeaveMembers: [], dateBasedOnLeaveMembers: [], partTimers: [], hiddenGroupIds: [] };
      renderDashboardLayout(appConfig); 
      render();
      if (connectionStatusEl) connectionStatusEl.textContent = '데이터 오류';
      if (statusDotEl) statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
    }
  }, (error) => {
    console.error('Firebase onSnapshot error:', error);
    showToast('실시간 연결에 실패했습니다.', true);
    appState = { workRecords: [], taskQuantities: {}, dailyOnLeaveMembers: [], dateBasedOnLeaveMembers: [], partTimers: [], hiddenGroupIds: [] };
    renderDashboardLayout(appConfig); 
    render();
    if (connectionStatusEl) connectionStatusEl.textContent = '연결 오류';
    if (statusDotEl) statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
  });
}

// ... (중간 함수들 동일) ...

// ========== 이벤트 리스너 ==========

// ✅ [추가] 햄버거 메뉴 (2/3)
if (hamburgerBtn && navContent) {
    // 1. 햄버거 버튼 클릭 시 메뉴 토글
    hamburgerBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // document 클릭 이벤트로 바로 닫히는 것 방지
        navContent.classList.toggle('hidden');
    });

    // 2. 메뉴 안의 버튼/링크 클릭 시 메뉴 닫기 (모바일에서만)
    navContent.addEventListener('click', (e) => {
        if (window.innerWidth < 768 && e.target.closest('a, button')) {
            navContent.classList.add('hidden');
        }
    });
}

// 3. (app.js 하단의 main 함수 내부로 이동) -> 햄버거 메뉴 바깥 영역 클릭 시 닫기
//    -> main 함수 내부에 넣으면 auth 상태 변경 시마다 중복 등록될 수 있으므로,
//    -> main 함수 *바깥*에서 한 번만 등록하도록 수정.
document.addEventListener('click', (e) => {
    if (navContent && hamburgerBtn) { // 요소들이 로드되었는지 확인
        const isClickInsideNav = navContent.contains(e.target);
        const isClickOnHamburger = hamburgerBtn.contains(e.target);
        
        // 메뉴가 열려있고(hidden이 없고), 클릭한 곳이 메뉴 내부도 아니고 햄버거 버튼도 아닐 때
        if (!navContent.classList.contains('hidden') && !isClickInsideNav && !isClickOnHamburger) {
            navContent.classList.add('hidden');
        }
    }
});

// ✅ [추가] 시작 시간 수정 모달 - 저장 버튼
if (confirmEditStartTimeBtn) {
    confirmEditStartTimeBtn.addEventListener('click', () => {
        const newStartTime = editStartTimeInput?.value;
        const contextId = editStartTimeContextIdInput?.value;
        const contextType = editStartTimeContextTypeInput?.value;

        if (!newStartTime || !contextId || !contextType) {
            showToast('시간 변경 정보를 가져올 수 없습니다.', true);
            return;
        }

        let updated = false;
        if (contextType === 'group') {
            const groupId = Number(contextId);
            appState.workRecords.forEach(record => {
                if (record.groupId === groupId && (record.status === 'ongoing' || record.status === 'paused')) {
                    record.startTime = newStartTime;
                    updated = true;
                    // 진행 중인 기록은 duration 재계산 불필요 (타이머가 처리)
                }
            });
            if (updated) showToast('그룹 시작 시간이 변경되었습니다.');

        } else if (contextType === 'individual') {
            const recordId = contextId; // ID는 문자열일 수 있음
            const recordIndex = appState.workRecords.findIndex(r => String(r.id) === String(recordId));
            if (recordIndex !== -1) {
                appState.workRecords[recordIndex].startTime = newStartTime;
                updated = true;
                // 진행 중인 기록은 duration 재계산 불필요
                showToast('개별 시작 시간이 변경되었습니다.');
            } else {
                showToast('해당 기록을 찾을 수 없습니다.', true);
            }
        }

        if (updated) {
            debouncedSaveState(); // 변경사항 저장
            render(); // UI 즉시 업데이트
        }

        // 모달 닫기 및 초기화
        if (editStartTimeModal) editStartTimeModal.classList.add('hidden');
        recordIdOrGroupIdToEdit = null;
        editType = null;
        if (editStartTimeInput) editStartTimeInput.value = '';
        if (editStartTimeContextIdInput) editStartTimeContextIdInput.value = '';
        if (editStartTimeContextTypeInput) editStartTimeContextTypeInput.value = '';
    });
}

// ✅ [추가] 시작 시간 수정 모달 - 취소 버튼
if (cancelEditStartTimeBtn) {
    cancelEditStartTimeBtn.addEventListener('click', () => {
        if (editStartTimeModal) editStartTimeModal.classList.add('hidden');
        // 변수 초기화
        recordIdOrGroupIdToEdit = null;
        editType = null;
        if (editStartTimeInput) editStartTimeInput.value = '';
        if (editStartTimeContextIdInput) editStartTimeContextIdInput.value = '';
        if (editStartTimeContextTypeInput) editStartTimeContextTypeInput.value = '';
    });
}


// ... (openHistoryBtn 리스너는 이제 역할에 따라 숨겨지므로 수정 불필요) ...

// ========== 앱 초기화 ==========
async function main() {
  const loadingSpinner = document.getElementById('loading-spinner');
  if (loadingSpinner) loadingSpinner.style.display = 'block';

  try {
    const firebase = initializeFirebase();
    db = firebase.db;
    auth = firebase.auth;
    if (!db || !auth) {
      if (loadingSpinner) loadingSpinner.style.display = 'none';
      return; 
    }
  } catch (e) {
    console.error("Firebase init failed:", e);
    if (loadingSpinner) loadingSpinner.style.display = 'none';
    return;
  }

  // ✅ [수정] 인증 상태 변경 감지 리스너 설정
  onAuthStateChanged(auth, async user => {
    // ... (기존 onAuthStateChanged 내부 로직은 수정 없음) ...
    const loadingSpinner = document.getElementById('loading-spinner');

    if (user) {
      // ... (로그인 시 로직 동일, startAppAfterLogin 호출) ...
      if (loginModal) loginModal.classList.add('hidden'); 
      if (loadingSpinner) loadingSpinner.style.display = 'block'; 
      
      await startAppAfterLogin(user); 

    } else {
      // --- 사용자가 로그아웃한 경우 ---
      if (connectionStatusEl) connectionStatusEl.textContent = '인증 필요';
      if (statusDotEl) statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-gray-400';

      if (unsubscribeToday) { unsubscribeToday(); unsubscribeToday = undefined; }
      if (unsubscribeLeaveSchedule) { unsubscribeLeaveSchedule(); unsubscribeLeaveSchedule = undefined; }

      appState = { workRecords: [], taskQuantities: {}, dailyOnLeaveMembers: [], dateBasedOnLeaveMembers: [], partTimers: [], hiddenGroupIds: [], currentUser: null, currentUserRole: 'user' };

      // ✅ [추가] 햄버거 메뉴 (3/3) - 로그아웃 시 메뉴 닫기
      if (navContent) navContent.classList.add('hidden');
        
      if (userGreeting) userGreeting.classList.add('hidden');
      if (logoutBtn) logoutBtn.classList.add('hidden');
      document.getElementById('current-date-display')?.classList.add('hidden');
      document.getElementById('top-right-controls')?.classList.add('hidden');
      document.querySelector('.bg-gray-800.shadow-lg')?.classList.add('hidden'); 
      document.getElementById('main-content-area')?.classList.add('hidden'); 
      document.querySelectorAll('.p-6.bg-gray-50.rounded-lg.border.border-gray-200').forEach(el => { 
          if(el.querySelector('#completed-log-content') || el.querySelector('#analysis-content')) {
              el.classList.add('hidden');
          }
      });
      
      // --- ✅ [수정] 로그아웃 시 관리자 버튼들도 숨김 처리 ---
      const adminLinkBtn = document.getElementById('admin-link-btn');
      const resetAppBtn = document.getElementById('reset-app-btn');
      const openManualAddBtn = document.getElementById('open-manual-add-btn');
      const deleteAllCompletedBtn = document.getElementById('delete-all-completed-btn');
      const openHistoryBtn = document.getElementById('open-history-btn'); // ✅ [추가]
      
      if (adminLinkBtn) adminLinkBtn.style.display = 'none';
      if (resetAppBtn) resetAppBtn.style.display = 'none';
      if (openManualAddBtn) openManualAddBtn.style.display = 'none';
      if (deleteAllCompletedBtn) deleteAllCompletedBtn.style.display = 'none';
      if (openHistoryBtn) openHistoryBtn.style.display = 'none'; // ✅ [추가]
      // ----------------------------------------------------

      if (loginModal) loginModal.classList.remove('hidden');
      if (loadingSpinner) loadingSpinner.style.display = 'none';

      renderDashboardLayout({ dashboardItems: [] }); 
    }
  });


  // ✅ [추가] 로그인 폼 제출 이벤트 리스너
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault(); // 폼 기본 제출 방지
        
        const email = loginEmailInput.value;
        const password = loginPasswordInput.value;

        if (!email || !password) {
            if (loginErrorMsg) {
                loginErrorMsg.textContent = '이메일과 비밀번호를 모두 입력하세요.';
                loginErrorMsg.classList.remove('hidden');
            }
            return;
        }

        // 로딩 상태 표시
        if (loginSubmitBtn) loginSubmitBtn.disabled = true;
        if (loginButtonText) loginButtonText.classList.add('hidden');
        if (loginButtonSpinner) loginButtonSpinner.classList.remove('hidden');
        if (loginErrorMsg) loginErrorMsg.classList.add('hidden');

        try {
            // Firebase로 이메일/비밀번호 로그인 시도
            await signInWithEmailAndPassword(auth, email, password);
            // 성공 시 onAuthStateChanged 리스너가 자동으로 감지하고 startAppAfterLogin(user)을 호출함.
            // 따라서 여기서 추가 작업 필요 없음.
            
        } catch (error) {
            // 로그인 실패
            console.error('Login failed:', error.code);
            if (loginErrorMsg) {
                if (error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
                    loginErrorMsg.textContent = '이메일 또는 비밀번호가 잘못되었습니다.';
                } else if (error.code === 'auth/invalid-email') {
                    loginErrorMsg.textContent = '유효하지 않은 이메일 형식입니다.';
                } else {
                    loginErrorMsg.textContent = '로그인에 실패했습니다. 다시 시도하세요.';
                }
                loginErrorMsg.classList.remove('hidden');
            }
        } finally {
            // 로딩 상태 해제
            if (loginSubmitBtn) loginSubmitBtn.disabled = false;
            if (loginButtonText) loginButtonText.classList.remove('hidden');
            if (loginButtonSpinner) loginButtonSpinner.classList.add('hidden');
        }
    });
  }

  // ✅ [수정] 로그아웃 버튼 리스너를 main() 함수 안으로 이동
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await signOut(auth);
        showToast('로그아웃되었습니다.');
        // onAuthStateChanged 리스너가 자동으로 감지하고 UI를 정리함
      } catch (error) {
        console.error('Logout failed:', error);
        showToast('로그아웃에 실패했습니다.', true);
      }
    });
  }

  // ✅ [수정 4] main() 함수 맨 끝에 드래그 기능 활성화 코드 추가
  const historyHeader = document.getElementById('history-modal-header');
  const historyContentBox = document.getElementById('history-modal-content-box');
  if (historyModal && historyHeader && historyContentBox) {
      // historyModal은 이미 전역 변수로 가져왔습니다.
      makeDraggable(historyModal, historyHeader, historyContentBox);
  }
  
} // <-- ✅ main() 함수가 "여기서" 올바르게 닫힘

// ... (makeDraggable 함수는 이전과 동일) ...

/**
 * 모달 팝업을 드래그 가능하게 만듭니다.
 * @param {HTMLElement} modalOverlay - 모달의 배경 오버레이 (e.g., #history-modal)
 * @param {HTMLElement} header - 드래그 핸들 역할을 할 헤더 (e.g., #history-modal-header)
 * @param {HTMLElement} contentBox - 실제 움직일 컨텐츠 박스 (e.g., #history-modal-content-box)
 */
function makeDraggable(modalOverlay, header, contentBox) {
    let isDragging = false;
    let offsetX, offsetY;

    header.addEventListener('mousedown', (e) => {
        // 닫기 버튼이나 다른 버튼을 클릭한 경우 드래그 시작 안 함
        if (e.target.closest('button')) {
            return;
        }
        
        isDragging = true;
        
        // --- "un-centering" 로직 ---
        // 처음 드래그 시 flex 중앙 정렬을 해제하고 absolute 위치로 전환
        if (contentBox.dataset.hasBeenUncentered !== 'true') {
            // 1. 현재 위치 계산 (스타일 변경 전)
            const rect = contentBox.getBoundingClientRect();
            
            // 2. 오버레이(부모)의 centering 클래스 제거
            modalOverlay.classList.remove('flex', 'items-center', 'justify-center');
            
            // 3. 컨텐츠 박스를 absolute로 전환하고 현재 위치 고정
            contentBox.style.position = 'absolute';
            contentBox.style.top = `${rect.top}px`;
            contentBox.style.left = `${rect.left}px`;
            contentBox.style.transform = 'none'; // (혹시 모를 transform 제거)
            
            // 4. 플래그 설정 (다시 열릴 때 초기화를 위해)
            contentBox.dataset.hasBeenUncentered = 'true';
        }
        // --- 끝 ---

        // 마우스 포인터와 박스 좌상단 모서리 사이의 간격 계산
        const rect = contentBox.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        
        // 전체 문서에 mousemove/mouseup 리스너 추가
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    function onMouseMove(e) {
        if (!isDragging) return;

        // 마우스 위치에 따라 새 top, left 계산
        let newLeft = e.clientX - offsetX;
        let newTop = e.clientY - offsetY;

        // 화면 경계 체크 (창 밖으로 나가지 않도록)
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const boxWidth = contentBox.offsetWidth;
        const boxHeight = contentBox.offsetHeight;

        if (newLeft < 0) newLeft = 0;
        if (newTop < 0) newTop = 0;
        if (newLeft + boxWidth > viewportWidth) newLeft = viewportWidth - boxWidth;
        if (newTop + boxHeight > viewportHeight) newTop = viewportHeight - boxHeight;

        contentBox.style.left = `${newLeft}px`;
        contentBox.style.top = `${newTop}px`;
    }

    function onMouseUp() {
        isDragging = false;
        // 리스너 제거
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }
}

// ✅ [추가] 1분(60000ms)마다 페이지 자동 새로고침
setInterval(() => {
    // 사용자가 모달 창을 열어놓고 있을 때는 새로고침하지 않도록 예외 처리 (선택 사항)
    const activeModal = document.querySelector('.fixed.inset-0.z-50:not(.hidden), .fixed.inset-0.z-\[60\]:not(.hidden), .fixed.inset-0.z-\[99\]:not(.hidden)');
    if (!activeModal) { // 열려있는 모달이 없을 때만 새로고침
        location.reload();
    } else {
        console.log("모달이 열려 있어 자동 새로고침을 건너뜁니다."); // 디버깅용 로그
    }
}, 60000); // 60000 밀리초 = 1분

main(); // 앱 시작