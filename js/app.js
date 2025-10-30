// === app.js (업무 마감 팝업 로직 수정) ===

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, onSnapshot, collection, getDocs, deleteDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirebase, loadAppConfig, loadLeaveSchedule, saveLeaveSchedule } from './config.js';
// ✅ [수정] calcElapsedMinutes 추가
import { showToast, getTodayDateString, displayCurrentDate, getCurrentTime, formatDuration, formatTimeTo24H, getWeekOfYear, isWeekday, calcElapsedMinutes } from './utils.js';
import {
  getAllDashboardDefinitions, // ✅ [추가]
  DASHBOARD_ITEM_DEFINITIONS, // ✅ [추가]
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
  renderManualAddModalDatalists, // ✅ [추가]
  renderTrendAnalysisCharts // ✅ [추가]
} from './ui.js';

// ========== DOM Elements ==========
// ... (fullscreenHistoryBtn 제거) ...
// ✅ [추가] 근태 기록 수정 모달 요소
// ✅ [추가] 근태 기록 수동 추가 모달 요소
const addAttendanceRecordModal = document.getElementById('add-attendance-record-modal');
const addAttendanceForm = document.getElementById('add-attendance-form');
const confirmAddAttendanceBtn = document.getElementById('confirm-add-attendance-btn');
const cancelAddAttendanceBtn = document.getElementById('cancel-add-attendance-btn');
const addAttendanceMemberNameInput = document.getElementById('add-attendance-member-name');
const addAttendanceMemberDatalist = document.getElementById('add-attendance-member-datalist');
const addAttendanceTypeSelect = document.getElementById('add-attendance-type');
const addAttendanceStartTimeInput = document.getElementById('add-attendance-start-time');
const addAttendanceEndTimeInput = document.getElementById('add-attendance-end-time');
const addAttendanceStartDateInput = document.getElementById('add-attendance-start-date');
const addAttendanceEndDateInput = document.getElementById('add-attendance-end-date');
const addAttendanceDateKeyInput = document.getElementById('add-attendance-date-key');
const addAttendanceTimeFields = document.getElementById('add-attendance-time-fields');
const addAttendanceDateFields = document.getElementById('add-attendance-date-fields');
const editAttendanceRecordModal = document.getElementById('edit-attendance-record-modal');
const confirmEditAttendanceBtn = document.getElementById('confirm-edit-attendance-btn');
const cancelEditAttendanceBtn = document.getElementById('cancel-edit-attendance-btn');
const editAttendanceMemberName = document.getElementById('edit-attendance-member-name');
const editAttendanceTypeSelect = document.getElementById('edit-attendance-type');
const editAttendanceStartTimeInput = document.getElementById('edit-attendance-start-time');
const editAttendanceEndTimeInput = document.getElementById('edit-attendance-end-time');
const editAttendanceStartDateInput = document.getElementById('edit-attendance-start-date');
const editAttendanceEndDateInput = document.getElementById('edit-attendance-end-date');
const editAttendanceDateKeyInput = document.getElementById('edit-attendance-date-key');
const editAttendanceRecordIndexInput = document.getElementById('edit-attendance-record-index');
const editAttendanceTimeFields = document.getElementById('edit-attendance-time-fields');
const editAttendanceDateFields = document.getElementById('edit-attendance-date-fields');
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
const trendAnalysisPanel = document.getElementById('trend-analysis-panel');
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

// ✅ [추가] 데스크탑 메뉴 버튼
const menuToggleBtn = document.getElementById('menu-toggle-btn');
const menuDropdown = document.getElementById('menu-dropdown');
const openQuantityModalTodayBtn = document.getElementById('open-quantity-modal-today');
// ✅ [추가] 모바일용 메뉴 버튼
const openQuantityModalTodayBtnMobile = document.getElementById('open-quantity-modal-today-mobile');
const adminLinkBtnMobile = document.getElementById('admin-link-btn-mobile');
const resetAppBtnMobile = document.getElementById('reset-app-btn-mobile');
const logoutBtnMobile = document.getElementById('logout-btn-mobile');

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
let unsubscribeConfig; // ✅ [추가]
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
let attendanceRecordToDelete = null; // 근태 이력 삭제 컨텍스트

const LEAVE_TYPES = ['연차', '외출', '조퇴', '결근', '출장'];

// ========== Helpers ==========
// ✅ [수정] generateId와 normalizeName은 남겨두고 calcElapsedMinutes만 삭제합니다.
const generateId = () => `${Date.now()}-${++recordCounter}`;
const normalizeName = (s='') => s.normalize('NFC').trim().toLowerCase();

// ⛔️ [삭제] calcElapsedMinutes 함수 (약 13줄) 삭제
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
// ✅ [수정] updateElapsedTimes 함수 (자동 일시정지/재개 로직으로 교체)
const updateElapsedTimes = () => {
  const now = getCurrentTime(); // "HH:MM"

  // ✅ [수정] 12:30 자동 일시정지 로직
  if (now === '12:30' && !appState.lunchPauseExecuted) {
    // 1. 플래그를 즉시 true로 설정 (중복 실행 방지)
    appState.lunchPauseExecuted = true; 
    let tasksPaused = 0;
    const currentTime = getCurrentTime(); // (정확히 12:30)

    // 2. 'ongoing' 상태인 모든 업무 찾기
    (appState.workRecords || []).forEach(record => {
      if (record.status === 'ongoing') {
        record.status = 'paused';
        record.pauses = record.pauses || [];
        // 3. 'lunch' 타입으로 정지 기록 추가
        record.pauses.push({ start: currentTime, end: null, type: 'lunch' }); 
        tasksPaused++;
      }
    });

    if (tasksPaused > 0) {
      console.log(`Auto-pausing ${tasksPaused} tasks for lunch break at 12:30.`);
      showToast(`점심시간입니다. 진행 중인 ${tasksPaused}개의 업무를 자동 일시정지합니다.`, false);
      debouncedSaveState(); // 변경된 상태 (workRecords + flag) 저장
    } else {
      // 4. 정지할 작업이 없어도, 12:30 로직이 실행되었음을 저장
      debouncedSaveState(); 
    }
  }

  // ✅ [추가] 13:30 자동 재개 로직
  if (now === '13:30' && !appState.lunchResumeExecuted) {
    // 1. 플래그를 즉시 true로 설정 (중복 실행 방지)
    appState.lunchResumeExecuted = true;
    let tasksResumed = 0;
    const currentTime = getCurrentTime(); // (정확히 13:30)

    // 2. 'paused' 상태인 모든 업무 찾기
    (appState.workRecords || []).forEach(record => {
      if (record.status === 'paused') {
        // 3. 마지막 정지 기록이 'lunch' 타입이고 아직 재개되지 않았는지 확인
        const lastPause = record.pauses?.[record.pauses.length - 1];
        if (lastPause && lastPause.type === 'lunch' && lastPause.end === null) {
          // 4. 재개
          record.status = 'ongoing';
          lastPause.end = currentTime; // 정지 종료 시간 기록
          tasksResumed++;
        }
      }
    });

    if (tasksResumed > 0) {
      console.log(`Auto-resuming ${tasksResumed} tasks after lunch break at 13:30.`);
      showToast(`점심시간 종료. ${tasksResumed}개의 업무를 자동 재개합니다.`, false);
      debouncedSaveState(); // 변경된 상태 (workRecords + flag) 저장
    } else {
      // 5. 재개할 작업이 없어도, 13:30 로직이 실행되었음을 저장
      debouncedSaveState();
    }
  }
  
  // --- [이하 기존 타이머 로직 (동일)] ---
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
      hiddenGroupIds: appState.hiddenGroupIds || [],
      
      // ✅ [추가된 부분]
      // 점심시간 자동 일시정지/재개 플래그도 함께 저장합니다.
      lunchPauseExecuted: appState.lunchPauseExecuted || false,
      lunchResumeExecuted: appState.lunchResumeExecuted || false

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
  // ✅ [수정] === 를 == 로 변경
  const recordsToStop = (appState.workRecords || []).filter(r => r.groupId == groupId && (r.status === 'ongoing' || r.status === 'paused'));
  if (recordsToStop.length === 0) return;
  finalizeStopGroup(groupId, null);
};

// ✅ [수정] saveStateToFirestore -> debouncedSaveState
const finalizeStopGroup = (groupId, quantity) => {
  const endTime = getCurrentTime();
  let taskName = '';
  let changed = false;
  (appState.workRecords || []).forEach(record => {
    // ✅ [수정] === 를 == 로 변경
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

// === app.js (pauseWorkGroup 수정) ===

// ✅ [수정] saveStateToFirestore -> debouncedSaveState
const pauseWorkGroup = (groupId) => {
  const currentTime = getCurrentTime();
  let changed = false;
  (appState.workRecords || []).forEach(record => {
    // ✅ [수정] === 를 == 로 변경 (타입 강제 변환 비교)
    if (record.groupId == groupId && record.status === 'ongoing') {
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
    // ✅ [수정] === 를 == 로 변경
    if (record.groupId == groupId && record.status === 'paused') {
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

// === app.js (saveProgress 함수 전체 교체) ===

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

    // 현재 appState의 처리량 (0 이상인 값만 유효 처리)
    const currentQuantities = {};
    for (const task in (appState.taskQuantities || {})) {
      const q = Number(appState.taskQuantities[task]);
      if (!Number.isNaN(q) && q >= 0) { // 0도 저장 가능하도록 >= 0
         currentQuantities[task] = q;
      }
    }

    const currentLeaveMembersCombined = [
        ...(appState.dailyOnLeaveMembers || []),
        ...(appState.dateBasedOnLeaveMembers || [])
    ];
    const currentPartTimers = appState.partTimers || [];

    // 저장할 데이터가 전혀 없는 경우 (최적화)
    if (completedRecordsFromState.length === 0 && Object.keys(currentQuantities).length === 0 && currentLeaveMembersCombined.length === 0 && currentPartTimers.length === 0 && !(existingData.workRecords?.length > 0) && !(existingData.taskQuantities && Object.keys(existingData.taskQuantities).length > 0) && !(existingData.onLeaveMembers?.length > 0) && !(existingData.partTimers?.length > 0)) {
        if (!isAutoSave) {
            showToast('저장할 새로운 완료 기록, 처리량, 근태 정보 또는 알바 정보가 없습니다.', true);
        }
        isDataDirty = false;
        return;
    }

    // 완료된 업무 기록 병합 (중복 제거)
    const combinedRecords = [...(existingData.workRecords || []), ...completedRecordsFromState];
    const uniqueRecords = Array.from(new Map(combinedRecords.map(item => [item.id, item])).values());

    // ✅ [수정] 처리량: 기존 이력 값을 덮어쓰도록 변경
    //    (이력 문서에는 항상 현재 appState의 최신 값이 반영됨)
    const finalQuantities = currentQuantities;

    // 알바 정보 병합 (중복 제거)
    const combinedPartTimers = [...(existingData.partTimers || []), ...currentPartTimers];
    const uniquePartTimers = Array.from(new Map(combinedPartTimers.map(item => [item.id, item])).values());

    // 최종 저장할 데이터 구성
    const dataToSave = {
      workRecords: uniqueRecords,
      taskQuantities: finalQuantities, // 수정된 finalQuantities 사용
      onLeaveMembers: currentLeaveMembersCombined, // 근태는 항상 최신 상태로 덮어쓰기
      partTimers: uniquePartTimers
    };

    // Firestore에 저장
    await setDoc(historyDocRef, dataToSave);

    if (isAutoSave) {
        // 자동 저장 시에는 별도 토스트 메시지 생략 (선택 사항)
        // showToast('진행 상황이 자동 저장되었습니다.', false);
        console.log("Auto-save completed."); // 콘솔 로그로 대체
    } else {
        showToast('현재까지의 기록이 성공적으로 저장되었습니다.');
    }
    isDataDirty = false; // 저장 완료 후 dirty 플래그 초기화

  } catch (e) {
    console.error('Error in saveProgress: ', e);
    showToast(`중간 저장 중 오류가 발생했습니다: ${e.message}`, true);
  }
}

// ✅ [수정] saveDayDataToHistory (업무 마감 로직)
// (진행 중인 업무를 자동으로 종료하는 로직이 이미 포함되어 있음)
// ✅ [수정] saveDayDataToHistory (조퇴 17:30 룰 적용)
async function saveDayDataToHistory(shouldReset) {
  // 1. 진행 중인 업무가 있으면 모두 '완료' 처리
  const ongoingRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused');
  if (ongoingRecords.length > 0) {
    const endTime = getCurrentTime(); // ✅ utils.js에서 가져온 현재 시간
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

  // 2. '완료'된 기록과 현재 수량/근태를 '이력(history)' 문서에 저장
  await saveProgress(false); // 수동 저장(false)으로 호출

  // 3. 실시간 상태(appState) 초기화 - '업무 기록'은 항상 비움
  appState.workRecords = [];
  
  // 4. '초기화'(Reset) 버튼을 눌렀을 때만(shouldReset === true) 추가 초기화
  if (shouldReset) {
      // 4a. 수량, 알바, 숨김 그룹 초기화
      Object.keys(appState.taskQuantities || {}).forEach(task => { appState.taskQuantities[task] = 0; });
      appState.partTimers = [];
      appState.hiddenGroupIds = [];

      // ✅ [수정] 4b. 근태 기록 초기화 (17:30 룰)
      const now = getCurrentTime(); // "HH:MM" 형식
      
      if (now < "17:30") {
          // 17:30 이전이면, '조퇴' 기록만 남기고 나머지는 초기화
          appState.dailyOnLeaveMembers = (appState.dailyOnLeaveMembers || []).filter(entry => entry.type === '조퇴');
      } else {
          // 17:30 이후이면, '조퇴' 포함 모든 일일 근태 초기화
          appState.dailyOnLeaveMembers = [];
      }
      // ✅ [수정 끝]

      showToast('오늘의 업무 기록을 초기화했습니다.');
  } 
  // (else: '업무 마감'일 때는 workRecords만 비우고, 수량/근태/알바는 유지)
  
  // 5. 변경된 실시간 상태(appState)를 Firestore('daily_data')에 즉시 저장
  await saveStateToFirestore(); 
  render();
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
    // ✅ [추가] 오늘 날짜인지 확인
    const todayDateString = getTodayDateString();
    let quantitiesToShow = {};

    // ✅ [수정] 오늘 날짜인지 아닌지에 따라 데이터 소스를 다르게 설정
    if (dateKey === todayDateString) {
        // 1. 오늘 날짜인 경우: 실시간 appState에서 데이터를 가져옴
        quantitiesToShow = appState.taskQuantities || {};
    } else {
        // 2. 과거 날짜인 경우: 기존 로직대로 allHistoryData에서 데이터를 가져옴
        const data = allHistoryData.find(d => d.id === dateKey);
        if (!data) {
            return showToast('해당 날짜의 데이터를 찾을 수 없습니다.', true);
        }
        quantitiesToShow = data.taskQuantities || {};
    }

    // ✅ [수정] data.taskQuantities 대신 위에서 정한 quantitiesToShow를 사용
    renderQuantityModalInputs(quantitiesToShow, appConfig.quantityTaskTypes);
    
    const title = document.getElementById('quantity-modal-title');
    if (title) title.textContent = `${dateKey} 처리량 수정`;

    // --- (이하 context 설정 및 onConfirm 로직은 기존과 동일) ---
    // (onConfirm 로직은 이미 오늘 날짜를 올바르게 처리하고 있습니다)
    quantityModalContext = {
        mode: 'history',
        dateKey,
        onConfirm: async (newQuantities) => {
            const idx = allHistoryData.findIndex(d => d.id === dateKey);
            if (idx === -1 && dateKey !== todayDateString) { // 오늘 날짜가 아닌데 이력이 없으면 오류
                 showToast('이력 데이터를 찾을 수 없어 수정할 수 없습니다.', true);
                 return;
            }
            
            // ✅ [수정] Firestore 저장 전에 로컬 데이터 업데이트
            // (오늘 날짜 이력이 아직 allHistoryData에 없더라도,
            // idx가 -1이 되고 이 부분은 건너뛰므로 안전함)
            if (idx > -1) {
                allHistoryData[idx] = { ...allHistoryData[idx], taskQuantities: newQuantities };
            }

            const historyDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
            try {
                // ✅ [수정] 업데이트된 로컬 데이터를 Firestore에 저장
                // (오늘 날짜 이력이 없었다면 새로 생성, 있었다면 덮어쓰기)
                const dataToSave = (idx > -1) 
                    ? allHistoryData[idx] 
                    : { id: dateKey, taskQuantities: newQuantities, workRecords: [], onLeaveMembers: [], partTimers: [] }; // 새 이력 생성
                
                await setDoc(historyDocRef, dataToSave);
                
                showToast(`${dateKey}의 처리량이 수정되었습니다.`);

                // --- 👇 [수정] 오늘 날짜인 경우 appState도 업데이트 (기존 로직 유지) ---
                if (dateKey === getTodayDateString()) {
                    appState.taskQuantities = newQuantities;
                    render(); // 메인 화면 UI 즉시 갱신 (요약, 분석 등)
                }
                
                // --- 👆 [수정] ---

                // ✅ [수정] 이력 보기 UI 갱신 (오늘 날짜가 아니었다면 allHistoryData 갱신 필요)
                if (dateKey !== todayDateString) {
                     const activeSubTabBtn = historyTabs?.querySelector('button.font-semibold');
                     const currentView = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'daily';
                     switchHistoryView(currentView);
                }

            } catch (e) {
                console.error('Error updating history quantities:', e);
                showToast('처리량 업데이트 중 오류 발생.', true);
                // 오류 시 로컬 데이터 원복 (선택 사항)
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

  // ✅ [추가] 근태 이력 '일별 상세' 보기에서 '수정' 버튼 클릭 리스너
if (attendanceHistoryViewContainer) {
    attendanceHistoryViewContainer.addEventListener('click', (e) => {
        const editBtn = e.target.closest('button[data-action="edit-attendance"]');
        if (editBtn) {
            const dateKey = editBtn.dataset.dateKey;
            const index = parseInt(editBtn.dataset.index, 10);

            if (!dateKey || isNaN(index)) {
                showToast('수정할 기록 정보를 찾는 데 실패했습니다.', true);
                return;
            }

            const dayData = allHistoryData.find(d => d.id === dateKey);
            if (!dayData || !dayData.onLeaveMembers || !dayData.onLeaveMembers[index]) {
                showToast('원본 근태 기록을 찾을 수 없습니다.', true);
                return;
            }

            const record = dayData.onLeaveMembers[index];

            // 1. 모달 필드 채우기
            if (editAttendanceMemberName) editAttendanceMemberName.value = record.member;

            // 2. 유형 선택 (Select) 채우기
            if (editAttendanceTypeSelect) {
                editAttendanceTypeSelect.innerHTML = ''; // 초기화
                LEAVE_TYPES.forEach(type => {
                    const option = document.createElement('option');
                    option.value = type;
                    option.textContent = type;
                    if (type === record.type) {
                        option.selected = true;
                    }
                    editAttendanceTypeSelect.appendChild(option);
                });
            }
            
            // 3. 시간/날짜 필드 채우기
            const isTimeBased = (record.type === '외출' || record.type === '조퇴');
            const isDateBased = (record.type === '연차' || record.type === '출장' || record.type === '결근');

            if (editAttendanceTimeFields) {
                editAttendanceTimeFields.classList.toggle('hidden', !isTimeBased);
                if (editAttendanceStartTimeInput) editAttendanceStartTimeInput.value = record.startTime || '';
                if (editAttendanceEndTimeInput) editAttendanceEndTimeInput.value = record.endTime || '';
            }
            if (editAttendanceDateFields) {
                editAttendanceDateFields.classList.toggle('hidden', !isDateBased);
                if (editAttendanceStartDateInput) editAttendanceStartDateInput.value = record.startDate || '';
                if (editAttendanceEndDateInput) editAttendanceEndDateInput.value = record.endDate || '';
            }

            // 4. 숨겨진 필드에 컨텍스트 저장
            if (editAttendanceDateKeyInput) editAttendanceDateKeyInput.value = dateKey;
            if (editAttendanceRecordIndexInput) editAttendanceRecordIndexInput.value = index;

            // 5. 모달 표시
            if (editAttendanceRecordModal) editAttendanceRecordModal.classList.remove('hidden');
        }
    });
}

// ✅ [수정] 근태 수정 모달 - '저장' 버튼 클릭 리스너 (중복 토스트 및 저장 오류 수정)
if (confirmEditAttendanceBtn) {
    confirmEditAttendanceBtn.addEventListener('click', async () => {
        const dateKey = editAttendanceDateKeyInput.value;
        const index = parseInt(editAttendanceRecordIndexInput.value, 10);
        const newType = editAttendanceTypeSelect.value;

        // --- [추가] 중복 클릭 방지 ---
        confirmEditAttendanceBtn.disabled = true; 
        // -------------------------

        if (!dateKey || isNaN(index)) {
            showToast('저장할 기록 정보를 찾는 데 실패했습니다.', true);
            confirmEditAttendanceBtn.disabled = false; // [추가] 버튼 활성화
            return;
        }

        const dayDataIndex = allHistoryData.findIndex(d => d.id === dateKey);
        if (dayDataIndex === -1) {
             showToast('원본 이력 데이터를 찾을 수 없습니다.', true);
             confirmEditAttendanceBtn.disabled = false; // [추가] 버튼 활성화
             return;
        }
        
        // 원본 데이터 복사 (원본 불변성 유지 시도)
        const dayData = { ...allHistoryData[dayDataIndex] }; 
        // 배열도 깊은 복사
        dayData.onLeaveMembers = dayData.onLeaveMembers ? [...dayData.onLeaveMembers] : []; 
        
        const recordToUpdate = dayData.onLeaveMembers[index];
        if (!recordToUpdate) {
             showToast('원본 근태 기록을 찾을 수 없습니다.', true);
             confirmEditAttendanceBtn.disabled = false; // [추가] 버튼 활성화
             return;
        }

        // 새 데이터 객체 생성
        const updatedRecord = {
            member: recordToUpdate.member, // 이름은 변경 불가
            type: newType
        };

        const isTimeBased = (newType === '외출' || newType === '조퇴');
        const isDateBased = (newType === '연차' || newType === '출장' || newType === '결근');

        try { // --- [추가] 입력 값 검증을 위한 try 블록 ---
            if (isTimeBased) {
                const startTime = editAttendanceStartTimeInput.value;
                const endTime = editAttendanceEndTimeInput.value; // 비어있으면 ''
                if (!startTime) {
                    throw new Error('시간 기반 근태는 시작 시간이 필수입니다.');
                }
                if (endTime && endTime < startTime) {
                     throw new Error('종료 시간은 시작 시간보다 이후여야 합니다.');
                }
                updatedRecord.startTime = startTime;
                updatedRecord.endTime = endTime || null; // 비어있으면 null로 저장
            } else if (isDateBased) {
                const startDate = editAttendanceStartDateInput.value;
                const endDate = editAttendanceEndDateInput.value; // 비어있으면 ''
                 if (!startDate) {
                    throw new Error('날짜 기반 근태는 시작일이 필수입니다.');
                }
                if (endDate && endDate < startDate) {
                     throw new Error('종료일은 시작일보다 이후여야 합니다.');
                }
                updatedRecord.startDate = startDate;
                updatedRecord.endDate = endDate || null; // 비어있으면 null로 저장
            }
        } catch (validationError) { // --- [추가] 입력 값 검증 실패 처리 ---
            showToast(validationError.message, true);
            confirmEditAttendanceBtn.disabled = false; // 버튼 활성화
            return; // 저장 중단
        }


        // 1. 로컬 데이터 (allHistoryData) 업데이트 ★★★
        //    (dayData 객체를 복사했으므로, allHistoryData의 해당 인덱스도 교체 필요)
        const originalRecord = allHistoryData[dayDataIndex].onLeaveMembers[index]; // 원복용
        allHistoryData[dayDataIndex].onLeaveMembers[index] = updatedRecord; // 로컬 배열 직접 수정

        // 2. Firestore에 **업데이트된 전체** 일일 데이터 (allHistoryData[dayDataIndex]) 저장
        const historyDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
        try {
            // ★★★ dayData가 아닌 allHistoryData의 업데이트된 객체를 저장
            await setDoc(historyDocRef, allHistoryData[dayDataIndex]); 
            
            // --- 👇 [수정] 성공 시 토스트는 여기서 한 번만 ---
            showToast('근태 기록이 성공적으로 수정되었습니다.'); 
            // ------------------------------------------

            // 3. UI 갱신
            renderAttendanceDailyHistory(dateKey, allHistoryData);

            // 4. 모달 닫기
            if (editAttendanceRecordModal) editAttendanceRecordModal.classList.add('hidden');

        } catch (e) {
            console.error('Error updating attendance history:', e);
            showToast('근태 기록 저장 중 오류가 발생했습니다.', true);
            // 오류 발생 시 로컬 데이터 원복 (선택적)
            allHistoryData[dayDataIndex].onLeaveMembers[index] = originalRecord; // 원본 레코드로 되돌림
        } finally {
            // --- [추가] 성공/실패 여부와 관계없이 버튼 활성화 ---
            confirmEditAttendanceBtn.disabled = false;
            // ------------------------------------------
        }
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

// ✅ [추가] 메인 화면 '처리량 입력' 버튼 리스너
if (openQuantityModalTodayBtn) {
    openQuantityModalTodayBtn.addEventListener('click', () => {
        if (!auth || !auth.currentUser) {
            showToast('로그인이 필요합니다.', true);
            if (loginModal) loginModal.classList.remove('hidden');
            return;
        }

        // 1. 모달 내용 채우기 (오늘의 appState 기준)
        renderQuantityModalInputs(appState.taskQuantities || {}, appConfig.quantityTaskTypes || []);
        
        // 2. 모달 제목 설정
        const title = document.getElementById('quantity-modal-title');
        if (title) title.textContent = '오늘의 처리량 입력';

        // 3. 컨텍스트 설정 (오늘의 appState를 수정)
        quantityModalContext = {
            mode: 'today',
            dateKey: null,
            // ✅ --- [교체 시작] onConfirm 콜백 함수 전체 ---
            onConfirm: async (newQuantities) => {
                // 1. 메인 화면 상태(appState) 업데이트
                appState.taskQuantities = newQuantities;
                debouncedSaveState(); // Firestore 'daily_data' 저장
                showToast('오늘의 처리량이 저장되었습니다.');
                // 2. 수량이 요약/분석에 영향을 줄 수 있으므로 기본 렌더링 호출
                render();

                // 3. 현황판 UI 동기화 로직
                try {
                    console.log("Syncing quantities to dashboard:", newQuantities); // 확인용 로그

                    const allDefinitions = getAllDashboardDefinitions(appConfig); // 모든 현황판 항목 정의
                    const dashboardItemIds = appConfig.dashboardItems || [];     // 현재 표시 중인 항목 ID 목록
                    const quantityTaskTypes = appConfig.quantityTaskTypes || []; // 처리량 입력 대상 작업 목록
                    const quantitiesFromState = appState.taskQuantities || {}; // Firestore에서 로드된 최신 수량

                    // ✅ [수정] 처리량 이름 -> 현황판 ID 매핑 (설정값 사용)
                    const taskNameToDashboardIdMap = appConfig.quantityToDashboardMap || {};
                    // ⛔️ [삭제] 하드코딩된 매핑 로직 (Object.keys(DASHBOARD_ITEM_DEFINITIONS)...) 전체 삭제
                    
                    // --- 매핑 로직 끝 ---

                    console.log("Using map for sync:", taskNameToDashboardIdMap); // 최종 매핑 확인용 로그

                    console.log("Using map for sync:", taskNameToDashboardIdMap); // 최종 매핑 확인용 로그

                    // 4. appState의 수량을 현황판 요소에 반영
                    for (const task in quantitiesFromState) {
                        // 입력된 task 이름이 quantityTaskTypes 목록에 있는지 먼저 확인 (안전장치)
                        if (!quantityTaskTypes.includes(task)) {
                            console.log(`Skipping sync for task '${task}' as it's not in quantityTaskTypes.`);
                            continue;
                        }

                        const quantity = newQuantities[task] || 0;
                        const targetDashboardId = taskNameToDashboardIdMap[task]; // 매핑된 현황판 ID 찾기

                        console.log(`Processing Task: ${task}, Qty: ${quantity}, Target ID: ${targetDashboardId}`); // 확인용 로그

                        // 매핑된 ID가 있고, 해당 ID의 정의가 있고, 현재 현황판에 표시되는 항목인지 확인
                        if (targetDashboardId && allDefinitions[targetDashboardId] && dashboardItemIds.includes(targetDashboardId)) {
                            const valueId = allDefinitions[targetDashboardId].valueId; // 값 표시 P 태그의 ID (예: 'summary-domestic-invoice')
                            const element = document.getElementById(valueId);        // 해당 P 태그 찾기

                            if (element) {
                                console.log(`Updating dashboard element #${valueId} with quantity ${quantity}`); // 확인용 로그
                                element.textContent = quantity; // P 태그의 텍스트를 새 수량으로 변경
                            } else {
                                console.warn(`Dashboard element with ID #${valueId} not found for task '${task}' (Mapped ID: ${targetDashboardId})`);
                            }
                        } else {
                            console.log(`Task '${task}' has no matching or displayed dashboard item.`); // 확인용 로그
                        }
                    }
                    console.log("Dashboard sync finished."); // 확인용 로그
                } catch (syncError) {
                    console.error("Error during dashboard sync:", syncError);
                    showToast("현황판 업데이트 중 오류 발생.", true);
                }

                // --- 👇 [기존] 오늘 날짜 이력(history) 문서도 업데이트 ---
                const todayDateKey = getTodayDateString();
                const todayHistoryIndex = allHistoryData.findIndex(d => d.id === todayDateKey);
                if (todayHistoryIndex > -1) {
                    const todayHistoryData = allHistoryData[todayHistoryIndex];
                    const updatedHistoryData = { ...todayHistoryData, taskQuantities: newQuantities };
                    allHistoryData[todayHistoryIndex] = updatedHistoryData;
                    const historyDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'history', todayDateKey);
                    try {
                        await setDoc(historyDocRef, updatedHistoryData);
                        console.log("오늘 날짜 이력(history) 처리량도 업데이트되었습니다.");
                    } catch (e) {
                        console.error('오늘 날짜 이력(history) 처리량 업데이트 실패:', e);
                        allHistoryData[todayHistoryIndex] = todayHistoryData;
                    }
                }
                // --- 👆 [기존 끝] ---
            },
            // ✅ --- [교체 끝] onConfirm 콜백 함수 전체 ---
            onCancel: () => {}
        };
// ... (나머지 리스너 코드) ...

        // 4. 모달 버튼 텍스트 설정 (이력 보기와 다르게 설정)
        const cBtn = document.getElementById('confirm-quantity-btn');
        const xBtn = document.getElementById('cancel-quantity-btn');
        if (cBtn) cBtn.textContent = '저장';
        if (xBtn) xBtn.textContent = '취소';
        
        // 5. 모달 열기
        if (quantityModal) quantityModal.classList.remove('hidden');
        
        // 6. 드롭다운 닫기
        if (menuDropdown) menuDropdown.classList.add('hidden');
    });
}

// ✅ [추가] 모바일 '처리량 입력' 버튼 리스너
if (openQuantityModalTodayBtnMobile) {
    openQuantityModalTodayBtnMobile.addEventListener('click', () => {
        if (!auth || !auth.currentUser) {
            showToast('로그인이 필요합니다.', true);
            if (loginModal) loginModal.classList.remove('hidden');
            return;
        }

        // 1. 모달 내용 채우기 (오늘의 appState 기준)
        renderQuantityModalInputs(appState.taskQuantities || {}, appConfig.quantityTaskTypes || []);
        
        // 2. 모달 제목 설정
        const title = document.getElementById('quantity-modal-title');
        if (title) title.textContent = '오늘의 처리량 입력';

        // 3. 컨텍스트 설정 (오늘의 appState를 수정)
        quantityModalContext = {
            mode: 'today',
            dateKey: null,
            onConfirm: (newQuantities) => {
                appState.taskQuantities = newQuantities;
                debouncedSaveState(); // 변경사항 즉시 저장 (디바운스)
                showToast('오늘의 처리량이 저장되었습니다.');
                // 수량이 요약/분석에 영향을 줄 수 있으므로 렌더링
                render(); 
            },
            onCancel: () => {}
        };

        // 4. 모달 버튼 텍스트 설정 (이력 보기와 다르게 설정)
        const cBtn = document.getElementById('confirm-quantity-btn');
        const xBtn = document.getElementById('cancel-quantity-btn');
        if (cBtn) cBtn.textContent = '저장';
        if (xBtn) xBtn.textContent = '취소';
        
        // 5. 모달 열기
        if (quantityModal) quantityModal.classList.remove('hidden');
        
        // 6. (모바일) 햄버거 메뉴 닫기
        if (navContent) navContent.classList.add('hidden');
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

// === app.js (teamStatusBoard Event Listener 전체 수정 - 통합 근태 수정) ===

if (teamStatusBoard) {
  teamStatusBoard.addEventListener('click', (e) => {
    // --- 가장 구체적인 버튼/액션 요소들을 먼저 확인 ---

    // 1. 모바일 토글 버튼들 (변경 없음)
    const toggleMobileBtn = e.target.closest('#toggle-all-tasks-mobile');
    if (toggleMobileBtn) {
        e.stopPropagation(); 
        const grid = document.getElementById('preset-task-grid');
        if (!grid) return;
        const isExpanded = grid.classList.contains('mobile-expanded');
        if (isExpanded) { /* ... */ } else { /* ... */ }
        return;
    }
    const toggleMemberBtn = e.target.closest('#toggle-all-members-mobile');
    if (toggleMemberBtn) {
        e.stopPropagation();
        const container = document.getElementById('all-members-container');
        if (!container) return;
        const isExpanded = container.classList.contains('mobile-expanded');
        if (isExpanded) { /* ... */ } else { /* ... */ }
        return;
    }

    // 2. 카드 내부의 액션 버튼들 (변경 없음)
    const stopGroupButton = e.target.closest('.stop-work-group-btn');
    if (stopGroupButton) { /* ... */ return; }
    const pauseGroupButton = e.target.closest('.pause-work-group-btn');
    if (pauseGroupButton) { /* ... */ return; }
    const resumeGroupButton = e.target.closest('.resume-work-group-btn');
    if (resumeGroupButton) { /* ... */ return; }
    const individualPauseBtn = e.target.closest('[data-action="pause-individual"]');
    if (individualPauseBtn) { /* ... */ return; }
    const individualResumeBtn = e.target.closest('[data-action="resume-individual"]');
    if (individualResumeBtn) { /* ... */ return; }
    const individualStopBtn = e.target.closest('button[data-action="stop-individual"]');
    if (individualStopBtn) { /* ... */ return; }
    const addMemberButton = e.target.closest('.add-member-btn[data-action="add-member"]');
    if (addMemberButton) { /* ... */ return; }

    // --- 버튼 외 클릭 가능한 영역 확인 ---

    // 3. 그룹 시작 시간 수정 영역 (변경 없음)
    const groupTimeDisplay = e.target.closest('.group-time-display[data-action="edit-group-start-time"]');
    if (groupTimeDisplay) { /* ... */ return; }

    // 4. 개별 시작 시간 수정 (시계 아이콘 버튼) (변경 없음)
    const individualEditTimeBtn = e.target.closest('button[data-action="edit-individual-start-time"]');
    if (individualEditTimeBtn) { /* ... */ return; }

    // ⛔️ 5. [삭제] '외출/조퇴' 시간 수정 카드 로직 (edit-leave-start-time) 제거
    // const leaveEditCard = e.target.closest('[data-action="edit-leave-start-time"]'); ... (이 블록 전체 삭제)

    // ✅ 6. [추가] 통합 근태 수정 카드 클릭 (data-action="edit-leave-record")
    const editLeaveCard = e.target.closest('[data-action="edit-leave-record"]');
    if (editLeaveCard) {
        const memberName = editLeaveCard.dataset.memberName;
        const currentType = editLeaveCard.dataset.leaveType;
        const currentStartTime = editLeaveCard.dataset.startTime; // 외출/조퇴용
        const currentStartDate = editLeaveCard.dataset.startDate; // 연차/결근/출장용
        const currentEndTime = editLeaveCard.dataset.endTime;
        const currentEndDate = editLeaveCard.dataset.endDate;

        // 권한 확인 (관리자 또는 본인만 수정 가능)
        const role = appState.currentUserRole || 'user';
        const selfName = appState.currentUser || null;
        if (role !== 'admin' && memberName !== selfName) {
            showToast('본인의 근태 기록만 수정할 수 있습니다.', true);
            return;
        }

        // 모달 요소 가져오기
        const modal = document.getElementById('edit-leave-record-modal');
        const titleEl = document.getElementById('edit-leave-modal-title');
        const nameEl = document.getElementById('edit-leave-member-name');
        const typeSelect = document.getElementById('edit-leave-type');
        const timeFields = document.getElementById('edit-leave-time-fields');
        const dateFields = document.getElementById('edit-leave-date-fields');
        const startTimeInput = document.getElementById('edit-leave-start-time');
        const endTimeInput = document.getElementById('edit-leave-end-time');
        const startDateInput = document.getElementById('edit-leave-start-date');
        const endDateInput = document.getElementById('edit-leave-end-date');
        const originalNameInput = document.getElementById('edit-leave-original-member-name');
        const originalStartInput = document.getElementById('edit-leave-original-start-identifier');
        const originalTypeInput = document.getElementById('edit-leave-original-type');

        if (!modal || !typeSelect) return;

        // 모달 내용 채우기
        titleEl.textContent = `${memberName}님 근태 수정`;
        nameEl.textContent = memberName;

        // 유형 선택 옵션 채우기 및 현재 값 설정
        typeSelect.innerHTML = '';
        LEAVE_TYPES.forEach(type => {
            const option = document.createElement('option');
            option.value = type;
            option.textContent = type;
            if (type === currentType) {
                option.selected = true;
            }
            typeSelect.appendChild(option);
        });

        // 현재 유형에 따라 필드 표시/숨김 및 값 채우기
        const isTimeBased = (currentType === '외출' || currentType === '조퇴');
        const isDateBased = !isTimeBased;

        timeFields.classList.toggle('hidden', !isTimeBased);
        dateFields.classList.toggle('hidden', isTimeBased);

        if (isTimeBased) {
            startTimeInput.value = currentStartTime || '';
            endTimeInput.value = currentEndTime || '';
        } else {
            startDateInput.value = currentStartDate || '';
            endDateInput.value = currentEndDate || '';
        }

        // 숨겨진 필드에 원본 정보 저장 (레코드 식별 및 변경 감지용)
        originalNameInput.value = memberName;
        originalStartInput.value = isTimeBased ? currentStartTime : currentStartDate;
        originalTypeInput.value = isTimeBased ? 'daily' : 'persistent'; // 레코드가 어디 있는지 구분

        modal.classList.remove('hidden');
        return; // 다른 액션(member-toggle-leave) 방지
    }

    // ✅ 7. [수정] 근태 설정 카드 (data-action="member-toggle-leave") - 근태 상태가 *아닐 때만* 실행
    const memberCard = e.target.closest('[data-action="member-toggle-leave"]');
    if (memberCard) {
        // 이 카드는 isOnLeave가 false일 때만 이 data-action을 가짐 (ui.js 수정 확인)
        const memberName = memberCard.dataset.memberName;
        const role = appState.currentUserRole || 'user';
        const selfName = appState.currentUser || null;

        if (role !== 'admin' && memberName !== selfName) {
            showToast('본인의 근태 현황만 설정할 수 있습니다.', true); return;
        }
        const isWorking = (appState.workRecords || []).some(r => r.member === memberName && (r.status === 'ongoing' || r.status === 'paused'));
        if (isWorking) {
            return showToast(`${memberName}님은 현재 업무 중이므로 근태 상태를 변경할 수 없습니다.`, true);
        }
        
        // 근태 설정 모달 열기 (기존 로직)
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
        
        return;
    }

    // --- 위에서 처리되지 않은 경우, 카드 전체 클릭으로 간주 ---

    // 8. 업무 카드 전체 클릭 (시작 또는 기타 업무) (변경 없음)
    const card = e.target.closest('div[data-action]');
    if (card && !e.target.closest('button, a, input, select, .members-list')) {
      const action = card.dataset.action;
      const task = card.dataset.task;
      if (action === 'start-task') { /* ... */ return; } 
      else if (action === 'other') { /* ... */ return; }
    }
  }); // teamStatusBoard 리스너 끝
} // if (teamStatusBoard) 끝

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
  confirmDeleteBtn.addEventListener('click', async () => {
    let stateChanged = false; // 변경 여부 플래그

    if (deleteMode === 'all') {
      const originalLength = appState.workRecords.length;
      appState.workRecords = (appState.workRecords || []).filter(r => r.status !== 'completed');
      if (appState.workRecords.length < originalLength) {
          stateChanged = true;
          showToast('완료된 모든 기록이 삭제되었습니다.');
      } else {
          showToast('삭제할 완료 기록이 없습니다.');
      }
      
    } else if (deleteMode === 'single' && recordToDeleteId) {
      const originalLength = appState.workRecords.length;
      appState.workRecords = (appState.workRecords || []).filter(r => String(r.id) !== String(recordToDeleteId));
      if (appState.workRecords.length < originalLength) {
          stateChanged = true;
          showToast('선택한 기록이 삭제되었습니다.');
      } else {
           showToast('삭제할 기록을 찾지 못했습니다.', true);
      }

    } else if (deleteMode === 'leave' && attendanceRecordToDelete) {
        // ✅ [수정] 통합 근태 기록 삭제 로직
        const { memberName, startIdentifier, recordType } = attendanceRecordToDelete;
        let recordDeleted = false;
        let deletedRecordInfo = ''; // 삭제 성공 메시지용

        if (recordType === 'daily') {
            const index = appState.dailyOnLeaveMembers.findIndex(r => r.member === memberName && r.startTime === startIdentifier);
            if (index > -1) {
                deletedRecordInfo = `${appState.dailyOnLeaveMembers[index].type}`;
                appState.dailyOnLeaveMembers.splice(index, 1);
                stateChanged = true;
                recordDeleted = true;
            }
        } else { // recordType === 'persistent'
            const index = persistentLeaveSchedule.onLeaveMembers.findIndex(r => r.member === memberName && r.startDate === startIdentifier);
            if (index > -1) {
                deletedRecordInfo = `${persistentLeaveSchedule.onLeaveMembers[index].type}`;
                persistentLeaveSchedule.onLeaveMembers.splice(index, 1);
                // Persistent는 즉시 저장 필요
                try {
                    await saveLeaveSchedule(db, persistentLeaveSchedule); 
                    recordDeleted = true;
                } catch (e) {
                     console.error('Error deleting persistent leave record:', e);
                     showToast('근태 기록 삭제 중 Firestore 저장 오류 발생.', true);
                     // 원복 시도 (선택적)
                     // persistentLeaveSchedule.onLeaveMembers.splice(index, 0, removedRecord);
                }
            }
        }

        if (recordDeleted) {
            showToast(`${memberName}님의 '${deletedRecordInfo}' 기록이 삭제되었습니다.`);
            // UI 갱신은 onSnapshot 또는 render() 호출로 처리됨
        } else {
            showToast('삭제할 근태 기록을 찾지 못했습니다.', true);
        }
    }
    
    // 변경사항이 있으면 상태 저장 (Daily 변경 시)
    if (stateChanged && deleteMode !== 'leave') { // 'leave' 모드 중 daily 삭제는 아래에서 처리
         debouncedSaveState();
    }
    // 'leave' 모드에서 daily 기록이 삭제된 경우
    if (deleteMode === 'leave' && attendanceRecordToDelete?.recordType === 'daily' && stateChanged) {
        debouncedSaveState();
    }

    // 모달 닫기 및 컨텍스트 초기화
    if (deleteConfirmModal) deleteConfirmModal.classList.add('hidden');
    recordToDeleteId = null;
    attendanceRecordToDelete = null; // ✅ [유지] leave 모드에서도 이 변수 사용
    deleteMode = 'single'; // 기본값으로 리셋
    
    // UI 갱신 (선택적, onSnapshot이 처리하지만 즉각 반응 위해)
    render();
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

// === app.js (historyMainTabs 리스너 교체) ===

if (historyMainTabs) {
  historyMainTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-main-tab]');
    if (btn) {
      const tabName = btn.dataset.mainTab;
      activeMainHistoryTab = tabName;

      // 모든 탭 비활성화
      document.querySelectorAll('.history-main-tab-btn').forEach(b => {
          b.classList.remove('font-semibold', 'text-blue-600', 'border-b-2', 'border-blue-600');
          b.classList.add('font-medium', 'text-gray-500');
      });
      // 클릭한 탭 활성화
      btn.classList.add('font-semibold', 'text-blue-600', 'border-b-2', 'border-blue-600');
      btn.classList.remove('font-medium', 'text-gray-500');

      // ✅ [추가] 날짜 목록 컨테이너 (왼쪽)
      const dateListContainer = document.getElementById('history-date-list-container');

      // 패널 및 날짜 목록 표시/숨김 처리
      if (tabName === 'work') {
        if (workHistoryPanel) workHistoryPanel.classList.remove('hidden');
        if (attendanceHistoryPanel) attendanceHistoryPanel.classList.add('hidden');
        if (trendAnalysisPanel) trendAnalysisPanel.classList.add('hidden'); // ✅ [추가]
        if (dateListContainer) dateListContainer.style.display = 'block'; // ✅ [추가]

        // 현재 활성화된 서브 탭 기준으로 뷰 전환
        const activeSubTabBtn = historyTabs?.querySelector('button.font-semibold');
        const view = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'daily';
        switchHistoryView(view);
      
      } else if (tabName === 'attendance') { // ✅ [수정] else if
        if (workHistoryPanel) workHistoryPanel.classList.add('hidden');
        if (attendanceHistoryPanel) attendanceHistoryPanel.classList.remove('hidden');
        if (trendAnalysisPanel) trendAnalysisPanel.classList.add('hidden'); // ✅ [추가]
        if (dateListContainer) dateListContainer.style.display = 'block'; // ✅ [추가]

        // 현재 활성화된 서브 탭 기준으로 뷰 전환
        const activeSubTabBtn = attendanceHistoryTabs?.querySelector('button.font-semibold');
        const view = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'attendance-daily';
        switchHistoryView(view);
      
      } else if (tabName === 'trends') { // ✅ [추가]
        if (workHistoryPanel) workHistoryPanel.classList.add('hidden');
        if (attendanceHistoryPanel) attendanceHistoryPanel.classList.add('hidden');
        if (trendAnalysisPanel) trendAnalysisPanel.classList.remove('hidden');
        if (dateListContainer) dateListContainer.style.display = 'none'; // ✅ [추가] 날짜 목록 숨기기
        
        // 차트 렌더링 (이력 데이터와 설정값을 넘겨줌)
        renderTrendAnalysisCharts(allHistoryData, appConfig);
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

// ✅ [추가] 모바일 '초기화' 버튼 리스너
if (resetAppBtnMobile) {
  resetAppBtnMobile.addEventListener('click', () => {
    if (resetAppModal) resetAppModal.classList.remove('hidden');
    // (모바일) 햄버거 메뉴 닫기
    if (navContent) navContent.classList.add('hidden');
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
    // --- 👇 [수정 시작] groupToStopId가 배열일 경우 처리 ---
    if (Array.isArray(groupToStopId) && groupToStopId.length > 0) {
      // 각 groupId에 대해 stopWorkGroup 호출
      groupToStopId.forEach(gid => stopWorkGroup(gid));
    } else if (groupToStopId) { // 이전 버전 호환 (단일 ID)
      stopWorkGroup(groupToStopId);
    }
    // --- [수정 끝] ---
    const stopGroupModal = document.getElementById('stop-group-confirm-modal');
    if (stopGroupModal) stopGroupModal.classList.add('hidden');
    groupToStopId = null; // 초기화
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

            // ✅ [수정] '외출'만 복귀 처리하고, '조퇴'는 else로 빠져 삭제(취소)되도록 복원합니다.
            if (entry.type === '외출') {
                entry.endTime = getCurrentTime(); // '외출'만 복귀 시간 기록
                showToast(`${memberToCancelLeave}님이 복귀 처리되었습니다.`);
                actionTaken = true;
            } else {
                // '조퇴'는 이 로직을 따라 삭제(splice)됩니다.
                appState.dailyOnLeaveMembers.splice(dailyIndex, 1);
                showToast(`${memberToCancelLeave}님의 '${entry.type}' 상태가 취소되었습니다.`);
                actionTaken = true;
            }
            debouncedSaveState(); // 변경사항 저장
        }

        // --- (이하 '연차' 등 영구 근태 취소 로직은 동일) ---
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
      // ✅ [추가] 근태 수정 모달 닫기 시 초기화
      else if (modalId === 'edit-attendance-record-modal') {
          if (editAttendanceDateKeyInput) editAttendanceDateKeyInput.value = '';
          if (editAttendanceRecordIndexInput) editAttendanceRecordIndexInput.value = '';
      }
      // ✅ [추가] 근태 추가 모달 닫기 시 초기화
      else if (modalId === 'add-attendance-record-modal') {
          if (addAttendanceForm) addAttendanceForm.reset();
          if (addAttendanceDateKeyInput) addAttendanceDateKeyInput.value = '';
          if (addAttendanceTimeFields) addAttendanceTimeFields.classList.add('hidden');
          if (addAttendanceDateFields) addAttendanceDateFields.classList.add('hidden');
      }
      // 다른 모달 ID에 대한 초기화 로직 추가...

      // ✅ [추가] 통합 근태 수정 모달 닫기 시 초기화
      else if (modalId === 'edit-leave-record-modal') {
          document.getElementById('edit-leave-original-member-name').value = '';
          document.getElementById('edit-leave-original-start-identifier').value = '';
          document.getElementById('edit-leave-original-type').value = '';
          // 필드 숨김/표시 초기화 (선택적)
          document.getElementById('edit-leave-time-fields').classList.add('hidden');
          document.getElementById('edit-leave-date-fields').classList.add('hidden');
      }
  });
});

// 나머지 닫기 버튼들 및 모달 관련 리스너 (일부 ID 중복될 수 있으므로 확인)
if (cancelCancelLeaveBtn) cancelCancelLeaveBtn.addEventListener('click', () => { if(cancelLeaveConfirmModal) cancelLeaveConfirmModal.classList.add('hidden'); memberToCancelLeave = null; });
if (cancelLeaveBtn) cancelLeaveBtn.addEventListener('click', () => { if(leaveTypeModal) leaveTypeModal.classList.add('hidden'); memberToSetLeave = null; });
if (cancelDeleteBtn) cancelDeleteBtn.addEventListener('click', () => { if(deleteConfirmModal) deleteConfirmModal.classList.add('hidden'); recordToDeleteId = null; attendanceRecordToDelete = null; });
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
// ✅ [추가] 근태 수동 추가 모달 - 취소 버튼
if (cancelAddAttendanceBtn) {
    cancelAddAttendanceBtn.addEventListener('click', () => {
        if (addAttendanceRecordModal) addAttendanceRecordModal.classList.add('hidden');
        if (addAttendanceForm) addAttendanceForm.reset();
        if (addAttendanceDateKeyInput) addAttendanceDateKeyInput.value = '';
        if (addAttendanceTimeFields) addAttendanceTimeFields.classList.add('hidden');
        if (addAttendanceDateFields) addAttendanceDateFields.classList.add('hidden');
    });
}

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

// ✅ [추가] 근태 수동 추가 모달 - 유형 변경 시 날짜/시간 필드 토글
if (addAttendanceTypeSelect) {
    addAttendanceTypeSelect.addEventListener('change', (e) => {
        const selectedType = e.target.value;
        const isTimeBased = (selectedType === '외출' || selectedType === '조퇴');
        const isDateBased = (selectedType === '연차' || selectedType === '출장' || selectedType === '결근');

        if (addAttendanceTimeFields) addAttendanceTimeFields.classList.toggle('hidden', !isTimeBased);
        if (addAttendanceDateFields) addAttendanceDateFields.classList.toggle('hidden', !isDateBased);
    });
}

/**
 * ✅ [추가] 근태 수동 추가 모달의 직원 <datalist>를 채우는 헬퍼 함수
 */
const renderAttendanceAddModalDatalists = (appConfig) => {
    if (!addAttendanceMemberDatalist) return;

    addAttendanceMemberDatalist.innerHTML = '';
    const staffMembers = (appConfig.teamGroups || []).flatMap(g => g.members);
    
    // 이력 추가 시점에는 당일 알바(appState.partTimers)가 아닌,
    // 전체 알바 목록(memberWages)에서 가져오는 것이 더 적절할 수 있으나,
    // 현재 알바 목록은 appState에만 있으므로 appState.partTimers를 사용합니다.
    // (더 나은 방법: appConfig에 '전체 알바' 목록을 두거나, memberWages 키를 사용)
    const partTimerMembers = (appState.partTimers || []).map(p => p.name);
    
    const allMembers = [...new Set([...staffMembers, ...partTimerMembers])].sort();
    
    allMembers.forEach(member => {
        const option = document.createElement('option');
        option.value = member;
        addAttendanceMemberDatalist.appendChild(option);
    });
};

// ✅ [수정] 근태 이력 '일별 상세' 보기 리스너 (수정/삭제/추가 통합)
if (attendanceHistoryViewContainer) {
    attendanceHistoryViewContainer.addEventListener('click', (e) => {
        
        // 1. '수정' 버튼 클릭
        const editBtn = e.target.closest('button[data-action="edit-attendance"]');
        if (editBtn) {
            const dateKey = editBtn.dataset.dateKey;
            const index = parseInt(editBtn.dataset.index, 10);

            if (!dateKey || isNaN(index)) {
                showToast('수정할 기록 정보를 찾는 데 실패했습니다.', true);
                return;
            }

            const dayData = allHistoryData.find(d => d.id === dateKey);
            if (!dayData || !dayData.onLeaveMembers || !dayData.onLeaveMembers[index]) {
                showToast('원본 근태 기록을 찾을 수 없습니다.', true);
                return;
            }

            const record = dayData.onLeaveMembers[index];

            // 1. 모달 필드 채우기
            if (editAttendanceMemberName) editAttendanceMemberName.value = record.member;

            // 2. 유형 선택 (Select) 채우기
            if (editAttendanceTypeSelect) {
                editAttendanceTypeSelect.innerHTML = ''; // 초기화
                LEAVE_TYPES.forEach(type => {
                    const option = document.createElement('option');
                    option.value = type;
                    option.textContent = type;
                    if (type === record.type) {
                        option.selected = true;
                    }
                    editAttendanceTypeSelect.appendChild(option);
                });
            }
            
            // 3. 시간/날짜 필드 채우기
            const isTimeBased = (record.type === '외출' || record.type === '조퇴');
            const isDateBased = (record.type === '연차' || record.type === '출장' || record.type === '결근');

            if (editAttendanceTimeFields) {
                editAttendanceTimeFields.classList.toggle('hidden', !isTimeBased);
                if (editAttendanceStartTimeInput) editAttendanceStartTimeInput.value = record.startTime || '';
                if (editAttendanceEndTimeInput) editAttendanceEndTimeInput.value = record.endTime || '';
            }
            if (editAttendanceDateFields) {
                editAttendanceDateFields.classList.toggle('hidden', !isDateBased);
                if (editAttendanceStartDateInput) editAttendanceStartDateInput.value = record.startDate || '';
                if (editAttendanceEndDateInput) editAttendanceEndDateInput.value = record.endDate || '';
            }

            // 4. 숨겨진 필드에 컨텍스트 저장
            if (editAttendanceDateKeyInput) editAttendanceDateKeyInput.value = dateKey;
            if (editAttendanceRecordIndexInput) editAttendanceRecordIndexInput.value = index;

            // 5. 모달 표시
            if (editAttendanceRecordModal) editAttendanceRecordModal.classList.remove('hidden');
            return; // 다른 버튼과 중복 실행 방지
        }
        
        // 2. '삭제' 버튼 클릭
        const deleteBtn = e.target.closest('button[data-action="delete-attendance"]');
        if (deleteBtn) {
            const dateKey = deleteBtn.dataset.dateKey;
            const index = parseInt(deleteBtn.dataset.index, 10);

            if (!dateKey || isNaN(index)) {
                showToast('삭제할 기록 정보를 찾는 데 실패했습니다.', true);
                return;
            }

            const dayData = allHistoryData.find(d => d.id === dateKey);
            const record = dayData?.onLeaveMembers?.[index];

            if (!record) {
                 showToast('삭제할 근태 기록을 찾을 수 없습니다.', true);
                 return;
            }

            deleteMode = 'attendance';
            attendanceRecordToDelete = { dateKey, index };
            
            const msgEl = document.getElementById('delete-confirm-message');
            if (msgEl) msgEl.textContent = `${record.member}님의 '${record.type}' 기록을 삭제하시겠습니까?`;
            
            if (deleteConfirmModal) deleteConfirmModal.classList.remove('hidden');
            return; // 다른 버튼과 중복 실행 방지
        }

        // 3. '수동 추가' 버튼 클릭 (테이블 바깥쪽)
        const addBtn = e.target.closest('button[data-action="open-add-attendance-modal"]');
        if (addBtn) {
            const dateKey = addBtn.dataset.dateKey;
            if (!dateKey) {
                 showToast('날짜 정보를 찾을 수 없습니다.', true);
                 return;
            }

            // 폼 초기화
            if (addAttendanceForm) addAttendanceForm.reset();
            
            // 날짜 키 설정
            if (addAttendanceDateKeyInput) addAttendanceDateKeyInput.value = dateKey;
            
            // 날짜 기반 유형에 기본 날짜 설정
            if (editAttendanceStartDateInput) editAttendanceStartDateInput.value = dateKey;
            if (editAttendanceEndDateInput) editAttendanceEndDateInput.value = '';

            // 직원 목록 채우기
            renderAttendanceAddModalDatalists(appConfig);

            // 유형 선택(Select) 채우기
            if (addAttendanceTypeSelect) {
                addAttendanceTypeSelect.innerHTML = ''; // 초기화
                LEAVE_TYPES.forEach((type, index) => {
                    const option = document.createElement('option');
                    option.value = type;
                    option.textContent = type;
                    if (index === 0) option.selected = true; // 첫 번째 항목(연차) 기본 선택
                    addAttendanceTypeSelect.appendChild(option);
                });
            }

            // 첫 번째 항목(연차) 기준으로 필드 표시/숨김
            const firstType = LEAVE_TYPES[0] || '';
            const isTimeBased = (firstType === '외출' || firstType === '조퇴');
            const isDateBased = (firstType === '연차' || firstType === '출장' || firstType === '결근');
            if (addAttendanceTimeFields) addAttendanceTimeFields.classList.toggle('hidden', !isTimeBased);
            if (addAttendanceDateFields) addAttendanceDateFields.classList.toggle('hidden', !isDateBased);

            // 모달 표시
            if (addAttendanceRecordModal) addAttendanceRecordModal.classList.remove('hidden');
            return;
        }
    });
}


// ✅ [추가] 근태 '수동 추가' 저장 버튼 리스너
if (confirmAddAttendanceBtn) {
    confirmAddAttendanceBtn.addEventListener('click', async () => {
        const dateKey = addAttendanceDateKeyInput.value;
        const member = addAttendanceMemberNameInput.value.trim();
        const newType = addAttendanceTypeSelect.value;

        if (!dateKey) {
            showToast('저장할 날짜 정보를 찾지 못했습니다.', true);
            return;
        }
        if (!member) {
            showToast('이름을 입력하거나 선택해주세요.', true);
            return;
        }

        const dayDataIndex = allHistoryData.findIndex(d => d.id === dateKey);
        if (dayDataIndex === -1) {
             showToast('원본 이력 데이터를 찾을 수 없습니다.', true);
             return;
        }
        
        const dayData = allHistoryData[dayDataIndex];

        // 새 데이터 객체 생성
        const newRecord = {
            member: member,
            type: newType
        };

        const isTimeBased = (newType === '외출' || newType === '조퇴');
        const isDateBased = (newType === '연차' || newType === '출장' || newType === '결근');

        if (isTimeBased) {
            const startTime = addAttendanceStartTimeInput.value;
            const endTime = addAttendanceEndTimeInput.value; // 비어있으면 ''
            if (!startTime) {
                showToast('시간 기반 근태는 시작 시간이 필수입니다.', true);
                return;
            }
            if (endTime && endTime < startTime) {
                 showToast('종료 시간은 시작 시간보다 이후여야 합니다.', true);
                return;
            }
            newRecord.startTime = startTime;
            newRecord.endTime = endTime || null;
        } else if (isDateBased) {
            const startDate = addAttendanceStartDateInput.value;
            const endDate = addAttendanceEndDateInput.value; // 비어있으면 ''
             if (!startDate) {
                showToast('날짜 기반 근태는 시작일이 필수입니다.', true);
                return;
            }
            if (endDate && endDate < startDate) {
                 showToast('종료일은 시작일보다 이후여야 합니다.', true);
                return;
            }
            newRecord.startDate = startDate;
            newRecord.endDate = endDate || null;
        }

        // 1. 로컬 데이터 (allHistoryData) 업데이트
        if (!dayData.onLeaveMembers) {
            dayData.onLeaveMembers = [];
        }
        dayData.onLeaveMembers.push(newRecord);

        // 2. Firestore에 전체 일일 데이터 (dayData) 저장
        const historyDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
        try {
            await setDoc(historyDocRef, dayData); // dayData 객체 통째로 덮어쓰기
            showToast('근태 기록이 성공적으로 추가되었습니다.');

            // 3. UI 갱신
            renderAttendanceDailyHistory(dateKey, allHistoryData);

            // 4. 모달 닫기
            if (addAttendanceRecordModal) addAttendanceRecordModal.classList.add('hidden');

        } catch (e) {
            console.error('Error adding attendance history:', e);
            showToast('근태 기록 저장 중 오류가 발생했습니다.', true);
            // 오류 발생 시 로컬 데이터 원복
            dayData.onLeaveMembers.pop();
        }
    });
}

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
      if (logoutBtnMobile) { // ✅ 추가
          logoutBtnMobile.classList.remove('hidden');
      }
      
      // --- ✅ [수정] 역할(Role)에 따른 UI 제어 ---
      const adminLinkBtn = document.getElementById('admin-link-btn');
      const resetAppBtn = document.getElementById('reset-app-btn');
      const openManualAddBtn = document.getElementById('open-manual-add-btn');
      const deleteAllCompletedBtn = document.getElementById('delete-all-completed-btn');
      const openHistoryBtn = document.getElementById('open-history-btn'); // ✅ [추가] 이력 보기 버튼

      // ✅ [추가] 모바일 버튼 가져오기
      const adminLinkBtnMobile = document.getElementById('admin-link-btn-mobile');
      const resetAppBtnMobile = document.getElementById('reset-app-btn-mobile');

      if (currentUserRole === 'admin') {
          // 관리자일 경우: 모든 버튼 표시
          if (adminLinkBtn) adminLinkBtn.style.display = 'flex';
          if (adminLinkBtnMobile) adminLinkBtnMobile.style.display = 'flex'; // ✅ 추가
          if (resetAppBtn) resetAppBtn.style.display = 'flex';
          if (resetAppBtnMobile) resetAppBtnMobile.style.display = 'flex'; // ✅ 추가
          if (openHistoryBtn) openHistoryBtn.style.display = 'inline-block'; // ✅ [추가]
          
      } else {
          // 일반 사용자(user)일 경우: 관리자 기능 숨기기
          if (adminLinkBtn) adminLinkBtn.style.display = 'none';
          if (adminLinkBtnMobile) adminLinkBtnMobile.style.display = 'none'; // ✅ 추가
          if (resetAppBtn) resetAppBtn.style.display = 'none';
          if (resetAppBtnMobile) resetAppBtnMobile.style.display = 'none'; // ✅ 추가
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

  // ✅ [추가] 앱 설정(config) 실시간 감지 리스너
  const configDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'config', 'mainConfig');
  if (unsubscribeConfig) unsubscribeConfig();
  unsubscribeConfig = onSnapshot(configDocRef, (docSnap) => {
      if (docSnap.exists()) {
          console.log("실시간 앱 설정 감지: 변경 사항을 적용합니다.");
          const loadedConfig = docSnap.data();
          
          // config.js의 loadAppConfig와 유사한 병합 로직 수행
          // Firestore에 없는 키가 로컬 appConfig에 남아있도록 loadedConfig를 기본으로 병합
          const mergedConfig = { ...appConfig, ...loadedConfig }; 
          
          // 객체/배열은 덮어쓰기 (loadedConfig 우선)
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

          appConfig = mergedConfig; // 전역 appConfig 업데이트

          // 설정이 변경되었으므로 UI 레이아웃과 렌더링을 다시 수행
          renderDashboardLayout(appConfig);
          renderTaskSelectionModal(appConfig.taskGroups);
          render(); // render()는 updateSummary()를 호출하여 현황판 값(수량 포함)을 갱신
          
          // ✅ [추가] 만약 이력 보기 모달이 열려있다면, 근태 추가 목록 등도 갱신
          if (addAttendanceMemberDatalist) {
              renderAttendanceAddModalDatalists(appConfig);
          }

      } else {
          console.warn("실시간 앱 설정 감지: config 문서가 삭제되었습니다. 로컬 설정을 유지합니다.");
      }
  }, (error) => {
      console.error("앱 설정 실시간 연결 실패:", error);
      showToast("앱 설정 연결에 실패했습니다.", true);
  });
  // ✅ [추가 끝]

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
      
      // ✅ [수정된 부분]
      // 점심시간 자동 일시정지/재개 플래그를 불러옵니다.
      appState.lunchPauseExecuted = loadedState.lunchPauseExecuted || false; 
      appState.lunchResumeExecuted = loadedState.lunchResumeExecuted || false;

      isDataDirty = false;

      // ⛔️ [삭제] 이 줄을 삭제해야 새로고침 시 0이 되는 버그가 고쳐집니다.
    // renderDashboardLayout(appConfig);
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

// ✅ [추가] 데스크탑 메뉴 토글 (2/3)
if (menuToggleBtn) {
    menuToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // document 클릭 이벤트로 바로 닫히는 것 방지
        if (menuDropdown) menuDropdown.classList.toggle('hidden');
    });
}

// 3. (app.js 하단의 main 함수 내부로 이동) -> 햄버거 메뉴 바깥 영역 클릭 시 닫기
//    -> main 함수 내부에 넣으면 auth 상태 변경 시마다 중복 등록될 수 있으므로,
//    -> main 함수 *바깥*에서 한 번만 등록하도록 수정.
document.addEventListener('click', (e) => {
    // 햄버거 메뉴 닫기
    if (navContent && hamburgerBtn) { // 요소들이 로드되었는지 확인
        const isClickInsideNav = navContent.contains(e.target);
        const isClickOnHamburger = hamburgerBtn.contains(e.target);
        
        // 메뉴가 열려있고(hidden이 없고), 클릭한 곳이 메뉴 내부도 아니고 햄버거 버튼도 아닐 때
        if (!navContent.classList.contains('hidden') && !isClickInsideNav && !isClickOnHamburger) {
            navContent.classList.add('hidden');
        }
    }

    // ✅ [추가] 데스크탑 메뉴 닫기
    if (menuDropdown && menuToggleBtn) {
        const isClickInsideMenu = menuDropdown.contains(e.target);
        const isClickOnMenuBtn = menuToggleBtn.contains(e.target);
        if (!menuDropdown.classList.contains('hidden') && !isClickInsideMenu && !isClickOnMenuBtn) {
            menuDropdown.classList.add('hidden');
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
      if (unsubscribeConfig) { unsubscribeConfig(); unsubscribeConfig = undefined; } // ✅ [추가]

      appState = { workRecords: [], taskQuantities: {}, dailyOnLeaveMembers: [], dateBasedOnLeaveMembers: [], partTimers: [], hiddenGroupIds: [], currentUser: null, currentUserRole: 'user' };

      // ✅ [추가] 햄버거 메뉴 (3/3) - 로그아웃 시 메뉴 닫기
      if (navContent) navContent.classList.add('hidden');
        
      if (userGreeting) userGreeting.classList.add('hidden');
      if (logoutBtn) logoutBtn.classList.add('hidden');
      if (logoutBtnMobile) logoutBtnMobile.classList.add('hidden'); // ✅ 추가
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
      if (adminLinkBtnMobile) adminLinkBtnMobile.style.display = 'none'; // ✅ 추가
      if (resetAppBtn) resetAppBtn.style.display = 'none';
      if (resetAppBtnMobile) resetAppBtnMobile.style.display = 'none'; // ✅ 추가
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

  // ✅ [추가] 모바일 로그아웃 버튼 리스너
  if (logoutBtnMobile) {
    logoutBtnMobile.addEventListener('click', async () => {
      try {
        await signOut(auth);
        showToast('로그아웃되었습니다.');
        // onAuthStateChanged 리스너가 자동으로 감지하고 UI를 정리함
      } catch (error) {
        console.error('Logout failed (mobile):', error);
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

  // ✅ [추가] '오늘의 업무 분석' 탭 클릭 리스너
const analysisTabs = document.getElementById('analysis-tabs');
if (analysisTabs) {
    analysisTabs.addEventListener('click', (e) => {
        const button = e.target.closest('.analysis-tab-btn');
        if (!button) return;

        const panelId = button.dataset.tabPanel;
        if (!panelId) return;

        // 1. 모든 탭 비활성화
        analysisTabs.querySelectorAll('.analysis-tab-btn').forEach(btn => {
            btn.classList.remove('text-blue-600', 'border-blue-600');
            btn.classList.add('text-gray-500', 'border-transparent', 'hover:text-gray-700', 'hover:border-gray-300');
        });

        // 2. 클릭한 탭 활성화
        button.classList.add('text-blue-600', 'border-blue-600');
        button.classList.remove('text-gray-500', 'border-transparent', 'hover:text-gray-700', 'hover:border-gray-300');

        // 3. 모든 패널 숨기기
        document.querySelectorAll('.analysis-tab-panel').forEach(panel => {
            panel.classList.add('hidden');
        });

        // 4. 대상 패널 보이기
        const panelToShow = document.getElementById(panelId);
        if (panelToShow) {
            panelToShow.classList.remove('hidden');
        }
    });
}

// ✅ [추가] '개인별 통계' 직원 선택 드롭다운 리스너
const analysisMemberSelect = document.getElementById('analysis-member-select');
if (analysisMemberSelect) {
    analysisMemberSelect.addEventListener('change', (e) => {
        const selectedMember = e.target.value;
        // ui.js의 renderPersonalAnalysis 함수 호출 (이 함수는 ui.js에서 수정될 예정)
        renderPersonalAnalysis(selectedMember, appState);
    });
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

// ✅ [추가] 통합 근태 수정 모달 관련 리스너
const editLeaveModal = document.getElementById('edit-leave-record-modal');
if (editLeaveModal) {
    const typeSelect = document.getElementById('edit-leave-type');
    const timeFields = document.getElementById('edit-leave-time-fields');
    const dateFields = document.getElementById('edit-leave-date-fields');
    const confirmBtn = document.getElementById('confirm-edit-leave-record-btn');
    const deleteBtn = document.getElementById('delete-leave-record-btn');
    const cancelBtn = document.getElementById('cancel-edit-leave-record-btn');
    const originalNameInput = document.getElementById('edit-leave-original-member-name');
    const originalStartInput = document.getElementById('edit-leave-original-start-identifier');
    const originalTypeInput = document.getElementById('edit-leave-original-type');

    // --- 유형 변경 시 필드 표시/숨김 ---
    typeSelect?.addEventListener('change', (e) => {
        const selectedType = e.target.value;
        const isTimeBased = (selectedType === '외출' || selectedType === '조퇴');
        timeFields?.classList.toggle('hidden', !isTimeBased);
        dateFields?.classList.toggle('hidden', isTimeBased);
    });

    // --- 저장 버튼 클릭 ---
    confirmBtn?.addEventListener('click', async () => {
        const memberName = originalNameInput.value;
        const originalStart = originalStartInput.value;
        const originalRecordType = originalTypeInput.value; // 'daily' or 'persistent'
        const newType = typeSelect.value;

        if (!memberName || !originalStart || !originalRecordType) {
            showToast('원본 기록 정보를 찾을 수 없습니다.', true); return;
        }

        const isNewTimeBased = (newType === '외출' || newType === '조퇴');
        const isNewDateBased = !isNewTimeBased;
        const isOriginalTimeBased = (originalRecordType === 'daily');
        const isOriginalDateBased = !isOriginalTimeBased;

        let updatedRecord = { member: memberName, type: newType };
        let validationError = null;

        // 값 읽기 및 기본 유효성 검사
        try {
            if (isNewTimeBased) {
                const startTime = document.getElementById('edit-leave-start-time').value;
                const endTime = document.getElementById('edit-leave-end-time').value; // 비어있으면 ''
                if (!startTime) throw new Error('시작 시간은 필수입니다.');
                if (endTime && endTime < startTime) throw new Error('종료 시간은 시작 시간보다 이후여야 합니다.');
                updatedRecord.startTime = startTime;
                updatedRecord.endTime = endTime || null; // 복귀 안했으면 null
            } else { // Date based
                const startDate = document.getElementById('edit-leave-start-date').value;
                const endDate = document.getElementById('edit-leave-end-date').value; // 비어있으면 ''
                if (!startDate) throw new Error('시작일은 필수입니다.');
                if (endDate && endDate < startDate) throw new Error('종료일은 시작일보다 이후여야 합니다.');
                updatedRecord.startDate = startDate;
                updatedRecord.endDate = endDate || null; // 종료일 없으면 null
            }
        } catch (e) {
            validationError = e.message;
        }

        if (validationError) {
            showToast(validationError, true); return;
        }

        // --- 원본 레코드 찾기 및 업데이트 ---
        let foundAndUpdated = false;
        let recordRemoved = null; // 타입 변경 시 삭제된 원본 레코드 저장

        // 1. Daily 레코드에서 찾아보기
        if (isOriginalTimeBased) {
            const index = appState.dailyOnLeaveMembers.findIndex(r => r.member === memberName && r.startTime === originalStart);
            if (index > -1) {
                if (isNewTimeBased) { // Daily -> Daily
                    appState.dailyOnLeaveMembers[index] = updatedRecord;
                } else { // Daily -> Persistent
                    recordRemoved = appState.dailyOnLeaveMembers.splice(index, 1)[0];
                    persistentLeaveSchedule.onLeaveMembers.push(updatedRecord);
                }
                foundAndUpdated = true;
            }
        } 
        // 2. Persistent 레코드에서 찾아보기
        else { // isOriginalDateBased
             // Persistent는 여러 개일 수 있으므로 startIdentifier (startDate)로 정확히 찾아야 함
            const index = persistentLeaveSchedule.onLeaveMembers.findIndex(r => r.member === memberName && r.startDate === originalStart);
            if (index > -1) {
                 if (isNewDateBased) { // Persistent -> Persistent
                    persistentLeaveSchedule.onLeaveMembers[index] = updatedRecord;
                } else { // Persistent -> Daily
                    recordRemoved = persistentLeaveSchedule.onLeaveMembers.splice(index, 1)[0];
                    // Daily에는 같은 멤버의 다른 시간 기반 기록이 있을 수 있으므로 그냥 push
                    appState.dailyOnLeaveMembers.push(updatedRecord);
                }
                foundAndUpdated = true;
            }
        }

        // --- 저장 실행 ---
        if (foundAndUpdated) {
            try {
                let saveDailyPromise = Promise.resolve();
                let savePersistentPromise = Promise.resolve();

                // 변경이 발생한 상태만 저장
                if (isNewTimeBased || isOriginalTimeBased) { // Daily가 변경되었거나, Daily에서 Persistent로 변경된 경우
                    saveDailyPromise = debouncedSaveState(); // 비동기지만 await 안 함 (debounced)
                }
                if (isNewDateBased || isOriginalDateBased) { // Persistent가 변경되었거나, Persistent에서 Daily로 변경된 경우
                     savePersistentPromise = saveLeaveSchedule(db, persistentLeaveSchedule); // await 필요
                }
                
                await savePersistentPromise; // Persistent 저장은 완료될 때까지 기다림
                
                showToast('근태 기록이 성공적으로 수정되었습니다.');
                editLeaveModal.classList.add('hidden');
                // UI 갱신은 onSnapshot 리스너가 처리하지만, 즉각적인 반응을 위해 render() 호출 (선택적)
                render(); 

            } catch (e) {
                console.error('Error saving updated leave record:', e);
                showToast('근태 기록 저장 중 오류 발생.', true);
                // 오류 시 원복 시도 (간단 버전)
                if (recordRemoved) {
                    if (isOriginalTimeBased) appState.dailyOnLeaveMembers.push(recordRemoved);
                    else persistentLeaveSchedule.onLeaveMembers.push(recordRemoved);
                }
                // (더 복잡한 원복 로직은 필요시 추가)
            }
        } else {
            showToast('원본 근태 기록을 찾지 못해 수정할 수 없습니다.', true);
        }
    });

    // --- 삭제 버튼 클릭 ---
    deleteBtn?.addEventListener('click', () => {
        const memberName = originalNameInput.value;
        const originalStart = originalStartInput.value;
        const originalRecordType = originalTypeInput.value; // 'daily' or 'persistent'

        if (!memberName || !originalStart || !originalRecordType) {
            showToast('삭제할 기록 정보를 찾을 수 없습니다.', true); return;
        }

        // 삭제 확인 모달에 정보 전달 및 열기
        deleteMode = 'leave'; // 새로운 삭제 모드
        // 삭제에 필요한 정보 저장 (confirmDeleteBtn 리스너에서 사용)
        attendanceRecordToDelete = { 
            memberName: memberName, 
            startIdentifier: originalStart, 
            recordType: originalRecordType 
        }; 
        
        const msgEl = document.getElementById('delete-confirm-message');
        if (msgEl) msgEl.textContent = `${memberName}님의 근태 기록을 삭제하시겠습니까?`;
        
        editLeaveModal.classList.add('hidden'); // 현재 모달 닫기
        document.getElementById('delete-confirm-modal')?.classList.remove('hidden'); // 확인 모달 열기
    });

    // --- 취소 버튼 클릭 ---
    cancelBtn?.addEventListener('click', () => {
        editLeaveModal.classList.add('hidden');
        // 숨겨진 필드 초기화
        originalNameInput.value = '';
        originalStartInput.value = '';
        originalTypeInput.value = '';
        timeFields.classList.add('hidden');
        dateFields.classList.add('hidden');
    });
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