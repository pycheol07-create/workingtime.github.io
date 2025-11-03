// === app.js (파일 분리 적용, 핵심 로직 및 상태 관리 담당) ===

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, onSnapshot, collection, getDocs, deleteDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirebase, loadAppConfig, loadLeaveSchedule, saveLeaveSchedule } from './config.js';
import { showToast, getTodayDateString, displayCurrentDate, getCurrentTime, formatDuration, formatTimeTo24H, getWeekOfYear, isWeekday, calcElapsedMinutes, normalizeName, debounce } from './utils.js';
import {
  getAllDashboardDefinitions,
  renderRealtimeStatus,
  renderCompletedWorkLog,
  updateSummary,
  renderTaskAnalysis,
  renderPersonalAnalysis,
  renderTaskSelectionModal,
  renderTeamSelectionModalContent,
  renderQuantityModalInputs,
  renderLeaveTypeModalOptions,
  renderDashboardLayout,
  renderManualAddModalDatalists,
  renderTrendAnalysisCharts,
  trendCharts // ❗️ ui.js의 trendCharts 객체를 가져옴
} from './ui.js';

// ❗️ 새 파일들 임포트
import { loadAndRenderHistoryList, switchHistoryView } from './app-history.js';
import { setupDynamicEventListeners } from './app-events.js';

// ========== DOM Elements (Export) ==========
// (다른 파일에서 import할 수 있도록 export합니다)
export const connectionStatusEl = document.getElementById('connection-status');
export const statusDotEl = document.getElementById('status-dot');
export const teamStatusBoard = document.getElementById('team-status-board');
export const workLogBody = document.getElementById('work-log-body');
export const teamSelectModal = document.getElementById('team-select-modal');
export const deleteConfirmModal = document.getElementById('delete-confirm-modal');
export const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
export const cancelDeleteBtn = document.getElementById('cancel-delete-btn');
export const historyModal = document.getElementById('history-modal');
export const openHistoryBtn = document.getElementById('open-history-btn');
export const closeHistoryBtn = document.getElementById('close-history-btn');
export const historyDateList = document.getElementById('history-date-list');
export const historyViewContainer = document.getElementById('history-view-container');
export const historyTabs = document.getElementById('history-tabs');
export const historyMainTabs = document.getElementById('history-main-tabs');
export const workHistoryPanel = document.getElementById('work-history-panel');
export const attendanceHistoryPanel = document.getElementById('attendance-history-panel');
export const attendanceHistoryTabs = document.getElementById('attendance-history-tabs');
export const attendanceHistoryViewContainer = document.getElementById('attendance-history-view-container');
export const trendAnalysisPanel = document.getElementById('trend-analysis-panel');
export const historyAttendanceDailyView = document.getElementById('history-attendance-daily-view');
export const historyAttendanceWeeklyView = document.getElementById('history-attendance-weekly-view');
export const historyAttendanceMonthlyView = document.getElementById('history-attendance-monthly-view');
export const quantityModal = document.getElementById('quantity-modal');
export const confirmQuantityBtn = document.getElementById('confirm-quantity-btn');
export const cancelQuantityBtn = document.getElementById('cancel-quantity-btn');
export const deleteHistoryModal = document.getElementById('delete-history-modal');
export const confirmHistoryDeleteBtn = document.getElementById('confirm-history-delete-btn');
export const cancelHistoryDeleteBtn = document.getElementById('cancel-history-delete-btn');
export const deleteAllCompletedBtn = document.getElementById('delete-all-completed-btn');
export const editRecordModal = document.getElementById('edit-record-modal');
export const confirmEditBtn = document.getElementById('confirm-edit-btn');
export const cancelEditBtn = document.getElementById('cancel-edit-btn');
export const saveProgressBtn = document.getElementById('save-progress-btn');
export const quantityOnStopModal = document.getElementById('quantity-on-stop-modal');
export const confirmQuantityOnStopBtn = document.getElementById('confirm-quantity-on-stop');
export const cancelQuantityOnStopBtn = document.getElementById('cancel-quantity-on-stop');
export const endShiftBtn = document.getElementById('end-shift-btn');
export const resetAppBtn = document.getElementById('reset-app-btn');
export const resetAppModal = document.getElementById('reset-app-modal');
export const confirmResetAppBtn = document.getElementById('confirm-reset-app-btn');
export const cancelResetAppBtn = document.getElementById('cancel-reset-app-btn');
export const taskSelectModal = document.getElementById('task-select-modal');
export const stopIndividualConfirmModal = document.getElementById('stop-individual-confirm-modal');
export const confirmStopIndividualBtn = document.getElementById('confirm-stop-individual-btn');
export const cancelStopIndividualBtn = document.getElementById('cancel-stop-individual-btn');
export const stopIndividualConfirmMessage = document.getElementById('stop-individual-confirm-message');
export const editPartTimerModal = document.getElementById('edit-part-timer-modal');
export const confirmEditPartTimerBtn = document.getElementById('confirm-edit-part-timer-btn');
export const cancelEditPartTimerBtn = document.getElementById('cancel-edit-part-timer-btn');
export const partTimerNewNameInput = document.getElementById('part-timer-new-name');
export const partTimerEditIdInput = document.getElementById('part-timer-edit-id');
export const cancelTeamSelectBtn = document.getElementById('cancel-team-select-btn');
export const leaveTypeModal = document.getElementById('leave-type-modal');
export const leaveModalTitle = document.getElementById('leave-modal-title');
export const leaveMemberNameSpan = document.getElementById('leave-member-name');
export const leaveTypeOptionsContainer = document.getElementById('leave-type-options');
export const confirmLeaveBtn = document.getElementById('confirm-leave-btn');
export const cancelLeaveBtn = document.getElementById('cancel-leave-btn');
export const leaveDateInputsDiv = document.getElementById('leave-date-inputs');
export const leaveStartDateInput = document.getElementById('leave-start-date-input');
export const leaveEndDateInput = document.getElementById('leave-end-date-input');
export const cancelLeaveConfirmModal = document.getElementById('cancel-leave-confirm-modal');
export const confirmCancelLeaveBtn = document.getElementById('confirm-cancel-leave-btn');
export const cancelCancelLeaveBtn = document.getElementById('cancel-cancel-leave-btn');
export const cancelLeaveConfirmMessage = document.getElementById('cancel-leave-confirm-message');
export const toggleCompletedLog = document.getElementById('toggle-completed-log');
export const toggleAnalysis = document.getElementById('toggle-analysis');
export const toggleSummary = document.getElementById('toggle-summary');
export const openManualAddBtn = document.getElementById('open-manual-add-btn');
export const manualAddRecordModal = document.getElementById('manual-add-record-modal');
export const confirmManualAddBtn = document.getElementById('confirm-manual-add-btn');
export const cancelManualAddBtn = document.getElementById('cancel-manual-add-btn');
export const manualAddForm = document.getElementById('manual-add-form');
export const endShiftConfirmModal = document.getElementById('end-shift-confirm-modal');
export const endShiftConfirmTitle = document.getElementById('end-shift-confirm-title');
export const endShiftConfirmMessage = document.getElementById('end-shift-confirm-message');
export const confirmEndShiftBtn = document.getElementById('confirm-end-shift-btn');
export const cancelEndShiftBtn = document.getElementById('cancel-end-shift-btn');
export const loginModal = document.getElementById('login-modal');
export const loginForm = document.getElementById('login-form');
export const loginEmailInput = document.getElementById('login-email');
export const loginPasswordInput = document.getElementById('login-password');
export const loginSubmitBtn = document.getElementById('login-submit-btn');
export const loginErrorMsg = document.getElementById('login-error-message');
export const loginButtonText = document.getElementById('login-button-text');
export const loginButtonSpinner = document.getElementById('login-button-spinner');
export const userGreeting = document.getElementById('user-greeting');
export const logoutBtn = document.getElementById('logout-btn');
export const menuToggleBtn = document.getElementById('menu-toggle-btn');
export const menuDropdown = document.getElementById('menu-dropdown');
export const openQuantityModalTodayBtn = document.getElementById('open-quantity-modal-today');
export const openQuantityModalTodayBtnMobile = document.getElementById('open-quantity-modal-today-mobile');
export const adminLinkBtnMobile = document.getElementById('admin-link-btn-mobile');
export const resetAppBtnMobile = document.getElementById('reset-app-btn-mobile');
export const logoutBtnMobile = document.getElementById('logout-btn-mobile');
export const hamburgerBtn = document.getElementById('hamburger-btn');
export const navContent = document.getElementById('nav-content');
export const editStartTimeModal = document.getElementById('edit-start-time-modal');
export const editStartTimeModalTitle = document.getElementById('edit-start-time-modal-title');
export const editStartTimeModalMessage = document.getElementById('edit-start-time-modal-message');
export const editStartTimeInput = document.getElementById('edit-start-time-input');
export const editStartTimeContextIdInput = document.getElementById('edit-start-time-context-id');
export const editStartTimeContextTypeInput = document.getElementById('edit-start-time-context-type');
export const confirmEditStartTimeBtn = document.getElementById('confirm-edit-start-time-btn');
export const cancelEditStartTimeBtn = document.getElementById('cancel-edit-start-time-btn');
export const addAttendanceRecordModal = document.getElementById('add-attendance-record-modal');
export const addAttendanceForm = document.getElementById('add-attendance-form');
export const confirmAddAttendanceBtn = document.getElementById('confirm-add-attendance-btn');
export const cancelAddAttendanceBtn = document.getElementById('cancel-add-attendance-btn');
export const addAttendanceMemberNameInput = document.getElementById('add-attendance-member-name');
export const addAttendanceMemberDatalist = document.getElementById('add-attendance-member-datalist');
export const addAttendanceTypeSelect = document.getElementById('add-attendance-type');
export const addAttendanceStartTimeInput = document.getElementById('add-attendance-start-time');
export const addAttendanceEndTimeInput = document.getElementById('add-attendance-end-time');
export const addAttendanceStartDateInput = document.getElementById('add-attendance-start-date');
export const addAttendanceEndDateInput = document.getElementById('add-attendance-end-date');
export const addAttendanceDateKeyInput = document.getElementById('add-attendance-date-key');
export const addAttendanceTimeFields = document.getElementById('add-attendance-time-fields');
export const addAttendanceDateFields = document.getElementById('add-attendance-date-fields');
export const editAttendanceRecordModal = document.getElementById('edit-attendance-record-modal');
export const confirmEditAttendanceBtn = document.getElementById('confirm-edit-attendance-btn');
export const cancelEditAttendanceBtn = document.getElementById('cancel-edit-attendance-btn');
export const editAttendanceMemberName = document.getElementById('edit-attendance-member-name');
export const editAttendanceTypeSelect = document.getElementById('edit-attendance-type');
export const editAttendanceStartTimeInput = document.getElementById('edit-attendance-start-time');
export const editAttendanceEndTimeInput = document.getElementById('edit-attendance-end-time');
export const editAttendanceStartDateInput = document.getElementById('edit-attendance-start-date');
export const editAttendanceEndDateInput = document.getElementById('edit-attendance-end-date');
export const editAttendanceDateKeyInput = document.getElementById('edit-attendance-date-key');
export const editAttendanceRecordIndexInput = document.getElementById('edit-attendance-record-index');
export const editAttendanceTimeFields = document.getElementById('edit-attendance-time-fields');
export const editAttendanceDateFields = document.getElementById('edit-attendance-date-fields');
export const editLeaveModal = document.getElementById('edit-leave-record-modal');
export const typeSelect = document.getElementById('edit-leave-type');
export const timeFields = document.getElementById('edit-leave-time-fields');
export const dateFields = document.getElementById('edit-leave-date-fields');
export const confirmBtn = document.getElementById('confirm-edit-leave-record-btn');
export const deleteBtn = document.getElementById('delete-leave-record-btn');
export const cancelBtn = document.getElementById('cancel-edit-leave-record-btn');
export const originalNameInput = document.getElementById('edit-leave-original-member-name');
export const originalStartInput = document.getElementById('edit-leave-original-start-identifier');
export const originalTypeInput = document.getElementById('edit-leave-original-type');

// ========== Firebase/App State (Export) ==========
export let db, auth;
export let unsubscribeToday;
export let unsubscribeLeaveSchedule;
export let unsubscribeConfig;
export let elapsedTimeTimer = null;
export let recordCounter = 0;
export let recordIdOrGroupIdToEdit = null;
export let editType = null;

export let isDataDirty = false;
export let autoSaveTimer = null;
const AUTO_SAVE_INTERVAL = 5 * 60 * 1000;

export let appState = {
  workRecords: [],
  taskQuantities: {},
  dailyOnLeaveMembers: [],
  dateBasedOnLeaveMembers: [],
  partTimers: [],
  hiddenGroupIds: []
};
export let persistentLeaveSchedule = {
  onLeaveMembers: []
};
export let appConfig = {
  teamGroups: [],
  memberWages: {},
  taskGroups: {},
  quantityTaskTypes: [],
  defaultPartTimerWage: 10000,
  keyTasks: []
};

export let selectedTaskForStart = null;
export let selectedGroupForAdd = null;
export let recordToDeleteId = null;
export let recordToStopId = null;
export let historyKeyToDelete = null;
export let allHistoryData = [];
export let recordToEditId = null;
export let deleteMode = 'single';
export let groupToStopId = null;
export let quantityModalContext = { mode: 'today', dateKey: null, onConfirm: null, onCancel: null };
export let tempSelectedMembers = [];
export let memberToSetLeave = null;
export let memberToCancelLeave = null;
export let activeMainHistoryTab = 'work';
export let attendanceRecordToDelete = null;

export const LEAVE_TYPES = ['연차', '외출', '조퇴', '결근', '출장'];

// ========== Helpers ==========
// (generateId는 recordCounter를 사용하므로 여기에 둡니다)
export const generateId = () => `${Date.now()}-${++recordCounter}`;
// (normalizeName, calcElapsedMinutes, debounce, calculateDateDifference는 utils.js로 이동)

// ========== 타이머 ==========
export const updateElapsedTimes = () => {
  const now = getCurrentTime();

  if (now === '12:30' && !appState.lunchPauseExecuted) {
    appState.lunchPauseExecuted = true;
    let tasksPaused = 0;
    const currentTime = getCurrentTime();

    (appState.workRecords || []).forEach(record => {
      if (record.status === 'ongoing') {
        record.status = 'paused';
        record.pauses = record.pauses || [];
        record.pauses.push({ start: currentTime, end: null, type: 'lunch' });
        tasksPaused++;
      }
    });

    if (tasksPaused > 0) {
      console.log(`Auto-pausing ${tasksPaused} tasks for lunch break at 12:30.`);
      showToast(`점심시간입니다. 진행 중인 ${tasksPaused}개의 업무를 자동 일시정지합니다.`, false);
      debouncedSaveState();
    } else {
      debouncedSaveState();
    }
  }

  if (now === '13:30' && !appState.lunchResumeExecuted) {
    appState.lunchResumeExecuted = true;
    let tasksResumed = 0;
    const currentTime = getCurrentTime();

    (appState.workRecords || []).forEach(record => {
      if (record.status === 'paused') {
        const lastPause = record.pauses?.[record.pauses.length - 1];
        if (lastPause && lastPause.type === 'lunch' && lastPause.end === null) {
          record.status = 'ongoing';
          lastPause.end = currentTime;
          tasksResumed++;
        }
      }
    });

    if (tasksResumed > 0) {
      console.log(`Auto-resuming ${tasksResumed} tasks after lunch break at 13:30.`);
      showToast(`점심시간 종료. ${tasksResumed}개의 업무를 자동 재개합니다.`, false);
      debouncedSaveState();
    } else {
      debouncedSaveState();
    }
  }

  document.querySelectorAll('.ongoing-duration').forEach(el => {
    try {
      const startTime = el.dataset.startTime;
      if (!startTime) return;

      const status = el.dataset.status;
      const pauses = JSON.parse(el.dataset.pausesJson || '[]');
      let currentPauses = pauses || [];

      if (status === 'paused') {
        const lastPause = currentPauses.length > 0 ? currentPauses[currentPauses.length - 1] : null;
        const tempPauses = [
          ...currentPauses.slice(0, -1),
          { start: lastPause?.start || startTime, end: now }
        ];
        const dur = calcElapsedMinutes(startTime, now, tempPauses);
        el.textContent = `(진행: ${formatDuration(dur)})`;
      } else {
        const dur = calcElapsedMinutes(startTime, now, currentPauses);
        el.textContent = `(진행: ${formatDuration(dur)})`;
      }
    } catch (e) { /* noop */ }
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
export const render = () => {
  try {
    renderRealtimeStatus(appState, appConfig.teamGroups, appConfig.keyTasks || []);
    renderCompletedWorkLog(appState);
    updateSummary(appState, appConfig);
    renderTaskAnalysis(appState, appConfig);
  } catch (e) {
    console.error('Render error:', e);
    showToast('화면 렌더링 오류 발생.', true);
  }
};

// ========== Firestore 저장 ==========
export const markDataAsDirty = () => {
  if (!isDataDirty) {
    // console.log("Auto-save: Data marked as dirty.");
  }
  isDataDirty = true;
};

export const autoSaveProgress = () => {
  if (isDataDirty) {
    // console.log("Auto-save: Dirty data found. Saving progress...");
    saveProgress(true); // true = 자동 저장 모드
  } else {
    // console.log("Auto-save: No changes to save.");
  }
};

export async function saveStateToFirestore() {
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
      hiddenGroupIds: appState.hiddenGroupIds || [],
      lunchPauseExecuted: appState.lunchPauseExecuted || false,
      lunchResumeExecuted: appState.lunchResumeExecuted || false
    }, (k, v) => (typeof v === 'function' ? undefined : v));

    if (stateToSave.length > 900000) {
      showToast('저장 데이터가 큽니다. 오래된 기록을 이력으로 옮기거나 정리하세요.', true);
      return;
    }

    await setDoc(docRef, { state: stateToSave });
    markDataAsDirty();

  } catch (error) {
    console.error('Error saving state to Firestore:', error);
    showToast('데이터 동기화 중 오류 발생.', true);
  }
}

export const debouncedSaveState = debounce(saveStateToFirestore, 1000);

// ========== 업무 그룹/개인 제어 ==========
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
  if (quantityOnStopModal) quantityOnStopModal.classList.add('hidden');
  groupToStopId = null;
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

// ========== 이력 저장 및 앱 초기화 ==========
export async function saveProgress(isAutoSave = false) {
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
      if (!Number.isNaN(q) && q >= 0) {
        currentQuantities[task] = q;
      }
    }

    const currentLeaveMembersCombined = [
      ...(appState.dailyOnLeaveMembers || []),
      ...(appState.dateBasedOnLeaveMembers || [])
    ];
    const currentPartTimers = appState.partTimers || [];

    if (completedRecordsFromState.length === 0 && Object.keys(currentQuantities).length === 0 && currentLeaveMembersCombined.length === 0 && currentPartTimers.length === 0 && !(existingData.workRecords?.length > 0) && !(existingData.taskQuantities && Object.keys(existingData.taskQuantities).length > 0) && !(existingData.onLeaveMembers?.length > 0) && !(existingData.partTimers?.length > 0)) {
      if (!isAutoSave) {
        showToast('저장할 새로운 완료 기록, 처리량, 근태 정보 또는 알바 정보가 없습니다.', true);
      }
      isDataDirty = false;
      return;
    }

    const combinedRecords = [...(existingData.workRecords || []), ...completedRecordsFromState];
    const uniqueRecords = Array.from(new Map(combinedRecords.map(item => [item.id, item])).values());

    const finalQuantities = currentQuantities;

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
      console.log("Auto-save completed.");
    } else {
      showToast('현재까지의 기록이 성공적으로 저장되었습니다.');
    }
    isDataDirty = false;

  } catch (e) {
    console.error('Error in saveProgress: ', e);
    showToast(`중간 저장 중 오류가 발생했습니다: ${e.message}`, true);
  }
}

export async function saveDayDataToHistory(shouldReset) {
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

  await saveProgress(false);

  appState.workRecords = [];

  if (shouldReset) {
    Object.keys(appState.taskQuantities || {}).forEach(task => { appState.taskQuantities[task] = 0; });
    appState.partTimers = [];
    appState.hiddenGroupIds = [];

    const now = getCurrentTime();
    if (now < "17:30") {
      appState.dailyOnLeaveMembers = (appState.dailyOnLeaveMembers || []).filter(entry => entry.type === '조퇴');
    } else {
      appState.dailyOnLeaveMembers = [];
    }

    showToast('오늘의 업무 기록을 초기화했습니다.');
  }

  await saveStateToFirestore();
  render();
}

// ❗️❗️ [삭제] 
// app-history.js로 이동한 모든 함수 (약 1000줄)
// (fetchAllHistoryData, loadAndRenderHistoryList, ... , switchHistoryView)
// ❗️❗️ [삭제]

// ❗️❗️ [삭제]
// app-events.js로 이동한 모든 이벤트 리스너 (약 1200줄)
// (teamStatusBoard.addEventListener, workLogBody.addEventListener, ... , document.addEventListener('click', ...))
// ❗️❗️ [삭제]

// ========== 앱 시작 ==========
export async function startAppAfterLogin(user) {
  const loadingSpinner = document.getElementById('loading-spinner');
  if (loadingSpinner) loadingSpinner.style.display = 'block';

  try {
    if (connectionStatusEl) connectionStatusEl.textContent = '설정 로딩 중...';

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

    const userEmailLower = userEmail.toLowerCase();
    const memberEmails = appConfig.memberEmails || {};
    const memberRoles = appConfig.memberRoles || {};

    const emailToMemberMap = Object.entries(memberEmails).reduce((acc, [name, email]) => {
      if (email) acc[email.toLowerCase()] = name;
      return acc;
    }, {});

    const currentUserName = emailToMemberMap[userEmailLower];
    const currentUserRole = memberRoles[userEmailLower] || 'user';

    if (!currentUserName) {
      showToast('로그인했으나 앱에 등록된 사용자가 아닙니다. 관리자에게 문의하세요.', true);
      console.warn(`User ${userEmail} logged in but not found in appConfig.memberEmails.`);
      if (loadingSpinner) loadingSpinner.style.display = 'none';
      if (connectionStatusEl) connectionStatusEl.textContent = '사용자 미등록';
      auth.signOut();
      if (loginModal) loginModal.classList.remove('hidden');
      return;
    }

    appState.currentUser = currentUserName;
    appState.currentUserRole = currentUserRole;

    if (userGreeting) {
      userGreeting.textContent = `${currentUserName}님 (${currentUserRole}), 안녕하세요.`;
      userGreeting.classList.remove('hidden');
    }
    if (logoutBtn) {
      logoutBtn.classList.remove('hidden');
    }
    if (logoutBtnMobile) {
      logoutBtnMobile.classList.remove('hidden');
    }

    const adminLinkBtn = document.getElementById('admin-link-btn');
    const resetAppBtn = document.getElementById('reset-app-btn');
    const openHistoryBtn = document.getElementById('open-history-btn');
    const adminLinkBtnMobile = document.getElementById('admin-link-btn-mobile');
    const resetAppBtnMobile = document.getElementById('reset-app-btn-mobile');

    if (currentUserRole === 'admin') {
      if (adminLinkBtn) adminLinkBtn.style.display = 'flex';
      if (adminLinkBtnMobile) adminLinkBtnMobile.style.display = 'flex';
      if (resetAppBtn) resetAppBtn.style.display = 'flex';
      if (resetAppBtnMobile) resetAppBtnMobile.style.display = 'flex';
      if (openHistoryBtn) openHistoryBtn.style.display = 'inline-block';
    } else {
      if (adminLinkBtn) adminLinkBtn.style.display = 'none';
      if (adminLinkBtnMobile) adminLinkBtnMobile.style.display = 'none';
      if (resetAppBtn) resetAppBtn.style.display = 'none';
      if (resetAppBtnMobile) resetAppBtnMobile.style.display = 'none';
      if (openHistoryBtn) openHistoryBtn.style.display = 'none';
    }

    document.getElementById('current-date-display')?.classList.remove('hidden');
    document.getElementById('top-right-controls')?.classList.remove('hidden');
    document.querySelector('.bg-gray-800.shadow-lg')?.classList.remove('hidden');
    document.getElementById('main-content-area')?.classList.remove('hidden');
    document.querySelectorAll('.p-6.bg-gray-50.rounded-lg.border.border-gray-200').forEach(el => {
      if (el.querySelector('#completed-log-content') || el.querySelector('#analysis-content')) {
        el.classList.remove('hidden');
      }
    });

    if (loadingSpinner) loadingSpinner.style.display = 'none';
    renderDashboardLayout(appConfig);
    renderTaskSelectionModal(appConfig.taskGroups);

    // ✅ [추가] 이벤트 리스너 설정 함수 호출
    setupDynamicEventListeners();

  } catch (e) {
    console.error("설정 로드 실패:", e);
    showToast("설정 정보 로드에 실패했습니다. 기본값으로 실행합니다.", true);
    const loadingSpinner = document.getElementById('loading-spinner');
    if (loadingSpinner) loadingSpinner.style.display = 'none';
    renderDashboardLayout(appConfig);
    renderTaskSelectionModal(appConfig.taskGroups);
    
    // ✅ [추가] 오류 시에도 이벤트 리스너는 설정
    setupDynamicEventListeners();
  }

  displayCurrentDate();
  if (elapsedTimeTimer) clearInterval(elapsedTimeTimer);
  elapsedTimeTimer = setInterval(updateElapsedTimes, 1000);

  if (autoSaveTimer) clearInterval(autoSaveTimer);
  autoSaveTimer = setInterval(autoSaveProgress, AUTO_SAVE_INTERVAL);

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

  const configDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'config', 'mainConfig');
  if (unsubscribeConfig) unsubscribeConfig();
  unsubscribeConfig = onSnapshot(configDocRef, (docSnap) => {
    if (docSnap.exists()) {
      console.log("실시간 앱 설정 감지: 변경 사항을 적용합니다.");
      const loadedConfig = docSnap.data();
      const mergedConfig = { ...appConfig, ...loadedConfig };
      
      mergedConfig.teamGroups = loadedConfig.teamGroups || appConfig.teamGroups;
      mergedConfig.keyTasks = loadedConfig.keyTasks || appConfig.keyTasks;
      mergedConfig.dashboardItems = loadedConfig.dashboardItems || appConfig.dashboardItems;
      mergedConfig.dashboardCustomItems = { ...(loadedConfig.dashboardCustomItems || {}) };
      mergedConfig.quantityTaskTypes = loadedConfig.quantityTaskTypes || appConfig.quantityTaskTypes;
      mergedConfig.taskGroups = loadedConfig.taskGroups || appConfig.taskGroups;
      mergedConfig.memberWages = { ...appConfig.memberWages, ...(loadedConfig.memberWages || {}) };
      mergedConfig.memberEmails = { ...appConfig.memberEmails, ...(loadedConfig.memberEmails || {}) };
      mergedConfig.memberRoles = { ...appConfig.memberRoles, ...(loadedConfig.memberRoles || {}) };
      mergedConfig.quantityToDashboardMap = { ...appConfig.quantityToDashboardMap, ...(loadedConfig.quantityToDashboardMap || {}) };

      appConfig = mergedConfig;

      renderDashboardLayout(appConfig);
      renderTaskSelectionModal(appConfig.taskGroups);
      render();
      
      if (addAttendanceMemberDatalist) {
        renderAttendanceAddModalDatalists(appConfig); // app-history.js
      }

    } else {
      console.warn("실시간 앱 설정 감지: config 문서가 삭제되었습니다. 로컬 설정을 유지합니다.");
    }
  }, (error) => {
    console.error("앱 설정 실시간 연결 실패:", error);
    showToast("앱 설정 연결에 실패했습니다.", true);
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
      appState.lunchPauseExecuted = loadedState.lunchPauseExecuted || false;
      appState.lunchResumeExecuted = loadedState.lunchResumeExecuted || false;

      isDataDirty = false;

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

/**
 * [app.js -> app-events.js]
 * 모달 팝업을 드래그 가능하게 만듭니다.
 */
export function makeDraggable(modalOverlay, header, contentBox) {
  let isDragging = false;
  let offsetX, offsetY;

  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) {
      return;
    }
    isDragging = true;
    if (contentBox.dataset.hasBeenUncentered !== 'true') {
      const rect = contentBox.getBoundingClientRect();
      modalOverlay.classList.remove('flex', 'items-center', 'justify-center');
      contentBox.style.position = 'absolute';
      contentBox.style.top = `${rect.top}px`;
      contentBox.style.left = `${rect.left}px`;
      contentBox.style.transform = 'none';
      contentBox.dataset.hasBeenUncentered = 'true';
    }
    const rect = contentBox.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  function onMouseMove(e) {
    if (!isDragging) return;
    let newLeft = e.clientX - offsetX;
    let newTop = e.clientY - offsetY;
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
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }
}


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

  onAuthStateChanged(auth, async user => {
    const loadingSpinner = document.getElementById('loading-spinner');

    if (user) {
      if (loginModal) loginModal.classList.add('hidden');
      if (loadingSpinner) loadingSpinner.style.display = 'block';
      await startAppAfterLogin(user); // ❗️ 수정된 startAppAfterLogin 호출
    } else {
      if (connectionStatusEl) connectionStatusEl.textContent = '인증 필요';
      if (statusDotEl) statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-gray-400';

      if (unsubscribeToday) { unsubscribeToday(); unsubscribeToday = undefined; }
      if (unsubscribeLeaveSchedule) { unsubscribeLeaveSchedule(); unsubscribeLeaveSchedule = undefined; }
      if (unsubscribeConfig) { unsubscribeConfig(); unsubscribeConfig = undefined; }

      appState = { workRecords: [], taskQuantities: {}, dailyOnLeaveMembers: [], dateBasedOnLeaveMembers: [], partTimers: [], hiddenGroupIds: [], currentUser: null, currentUserRole: 'user' };

      if (navContent) navContent.classList.add('hidden');
      if (userGreeting) userGreeting.classList.add('hidden');
      if (logoutBtn) logoutBtn.classList.add('hidden');
      if (logoutBtnMobile) logoutBtnMobile.classList.add('hidden');
      document.getElementById('current-date-display')?.classList.add('hidden');
      document.getElementById('top-right-controls')?.classList.add('hidden');
      document.querySelector('.bg-gray-800.shadow-lg')?.classList.add('hidden');
      document.getElementById('main-content-area')?.classList.add('hidden');
      document.querySelectorAll('.p-6.bg-gray-50.rounded-lg.border.border-gray-200').forEach(el => {
        if (el.querySelector('#completed-log-content') || el.querySelector('#analysis-content')) {
          el.classList.add('hidden');
        }
      });

      const adminLinkBtn = document.getElementById('admin-link-btn');
      const resetAppBtn = document.getElementById('reset-app-btn');
      const openHistoryBtn = document.getElementById('open-history-btn');
      if (adminLinkBtn) adminLinkBtn.style.display = 'none';
      if (adminLinkBtnMobile) adminLinkBtnMobile.style.display = 'none';
      if (resetAppBtn) resetAppBtn.style.display = 'none';
      if (resetAppBtnMobile) resetAppBtnMobile.style.display = 'none';
      if (openHistoryBtn) openHistoryBtn.style.display = 'none';

      if (loginModal) loginModal.classList.remove('hidden');
      if (loadingSpinner) loadingSpinner.style.display = 'none';

      renderDashboardLayout({ dashboardItems: [] });
    }
  });
}

main(); // 앱 시작