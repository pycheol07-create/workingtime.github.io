// === app.js (파일 분리 후 메인 파일) ===
// 이 파일은 앱의 핵심 상태(State)와 DOM 요소를 정의하고,
// 다른 모듈(logic, history, listeners)이 가져다 쓸 수 있도록 export합니다.
// 또한 앱의 진입점(main, onAuthStateChanged) 역할을 합니다.

// --- 1. Firebase 및 라이브러리 Imports ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, onSnapshot, collection, getDocs, deleteDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// --- 2. 설정 및 유틸리티 Imports ---
import { initializeFirebase, loadAppConfig, loadLeaveSchedule, saveLeaveSchedule } from './config.js';
// ✅ [수정] utils.js에서 debounce도 가져옵니다. (saveStateToFirestore에서 사용)
import { showToast, getTodayDateString, displayCurrentDate, getCurrentTime, formatDuration, formatTimeTo24H, getWeekOfYear, isWeekday, calcElapsedMinutes, debounce } from './utils.js';

// --- 3. UI 렌더링 함수 Imports (ui.js) ---
import {
  getAllDashboardDefinitions,
  DASHBOARD_ITEM_DEFINITIONS,
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
  renderManualAddModalDatalists,
  renderTrendAnalysisCharts,
  trendCharts // ✅ 차트 객체 import
} from './ui.js';

// --- 4. [신규] 분리된 모듈 Imports ---
import { initializeAppListeners } from './app-listeners.js';
// ✅ [수정] app-history-logic에서 필요한 함수들을 app.js(main)에서도 import
import { 
    saveProgress,
    openHistoryQuantityModal,
    requestHistoryDeletion
} from './app-history-logic.js';

// history-excel.js (엑셀 로직)
import {
    downloadHistoryAsExcel,
    downloadAttendanceHistoryAsExcel,
    downloadPeriodHistoryAsExcel 
} from './history-excel.js';


// ========== 5. DOM Elements (모두 EXPORT) ==========
// (다른 모듈, 특히 app-listeners.js에서 사용합니다)

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
export const connectionStatusEl = document.getElementById('connection-status');
export const statusDotEl = document.getElementById('status-dot');
export const teamStatusBoard = document.getElementById('team-status-board');
export const workLogBody = document.getElementById('work-log-body');
export const teamSelectModal = document.getElementById('team-select-modal');
export const deleteConfirmModal = document.getElementById('delete-confirm-modal');
export const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
export const cancelDeleteBtn = document.getElementById('cancel-delete-btn');
export const historyModal = document.getElementById('history-modal');
export const historyModalContentBox = document.getElementById('history-modal-content-box');
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

// ✅ [추가] 업무 리포트 DOM 요소
export const reportPanel = document.getElementById('report-panel');
export const reportTabs = document.getElementById('report-tabs');
export const reportViewContainer = document.getElementById('report-view-container');
export const reportDailyView = document.getElementById('report-daily-view');
export const reportWeeklyView = document.getElementById('report-weekly-view');
export const reportMonthlyView = document.getElementById('report-monthly-view');
export const reportYearlyView = document.getElementById('report-yearly-view');
// ✅ [추가] 끝

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
export const analysisMemberSelect = document.getElementById('analysis-member-select');
export const editLeaveModal = document.getElementById('edit-leave-record-modal');

// 👈 [추가] 기간 조회 DOM 요소들
export const historyStartDateInput = document.getElementById('history-start-date');
export const historyEndDateInput = document.getElementById('history-end-date');
export const historyFilterBtn = document.getElementById('history-filter-btn');
export const historyClearFilterBtn = document.getElementById('history-clear-filter-btn');
export const historyDownloadPeriodExcelBtn = document.getElementById('history-download-period-excel-btn');

// ✅ [추가] 품질 비용(COQ) 설명 모달
export const coqExplanationModal = document.getElementById('coq-explanation-modal');


// ========== 6. Firebase/App State (모두 EXPORT) ==========
export let db, auth;
export let unsubscribeToday;
export let unsubscribeLeaveSchedule;
export let unsubscribeConfig; 
export let elapsedTimeTimer = null;

// ⛔️ [삭제] export let recordCounter = 0;
// ⛔️ [삭제] export let recordIdOrGroupIdToEdit = null;
// ... (isDataDirty를 제외한 모든 export let 변수 선언 삭제) ...

export let isDataDirty = false; // (이 변수는 autoSaveProgress만 사용하므로 그대로 둡니다)
export let autoSaveTimer = null;
export const AUTO_SAVE_INTERVAL = 5 * 60 * 1000; 

// ✅ [추가] 다른 모듈에서 변경해야 하는 모든 변수를 이 context 객체에 넣습니다.
export let context = {
    recordCounter: 0,
    recordIdOrGroupIdToEdit: null,
    editType: null, 
    selectedTaskForStart: null,
    selectedGroupForAdd: null,
    recordToDeleteId: null,
    recordToStopId: null,
    historyKeyToDelete: null, 
    recordToEditId: null,
    deleteMode: 'single',
    groupToStopId: null,
    quantityModalContext: { mode: 'today', dateKey: null, onConfirm: null, onCancel: null },
    tempSelectedMembers: [],
    memberToSetLeave: null,
    memberToCancelLeave: null,
    activeMainHistoryTab: 'work',
    attendanceRecordToDelete: null,
    isMobileTaskViewExpanded: false, // 👈 [추가] 모바일 업무카드 '전체보기' 상태
    isMobileMemberViewExpanded: false, // 👈 [추가] 모바일 팀원현황 '전체보기' 상태
    historyStartDate: null, // 👈 [추가] 이력 조회 시작일
    historyEndDate: null, // 👈 [추가] 이력 조회 종료일
};

export let appState = {
  workRecords: [],
  taskQuantities: {},
// ... (appState, persistentLeaveSchedule, appConfig, LEAVE_TYPES는 기존과 동일) ...
  dailyOnLeaveMembers: [],
  dateBasedOnLeaveMembers: [],
  partTimers: [],
  hiddenGroupIds: [],
  currentUser: null,
  currentUserRole: 'user' 
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

// ✅ [추가] 이 줄을 여기에 추가해야 합니다.
export let allHistoryData = [];

// ⛔️ [삭제] 
// ⛔️ (컨텍스트 변수) ... (export let selectedTaskForStart = null; ... 등 13줄 모두 삭제)
// ⛔️ ...

export const LEAVE_TYPES = ['연차', '외출', '조퇴', '결근', '출장'];

// ========== 7. Core Helpers (EXPORT) ==========
// ✅ [수정] generateId 함수가 context.recordCounter를 사용하도록 수정
export const generateId = () => `${Date.now()}-${++context.recordCounter}`;
export const normalizeName = (s='') => s.normalize('NFC').trim().toLowerCase();

// ========== 8. Core Functions (Timers, Render, Save) (EXPORT) ==========

/**
 * (app-listeners.js가 import)
 * Firestore 'daily_data'에 현재 상태를 저장합니다.
 */
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
    markDataAsDirty(); // Firestore 저장 시 dirty 플래그 설정 (기존 로직 유지)

  } catch (error) {
    console.error('Error saving state to Firestore:', error);
    showToast('데이터 동기화 중 오류 발생.', true);
  }
}

/** (app-listeners.js가 import) */
export const debouncedSaveState = debounce(saveStateToFirestore, 1000);


/** (메인 타이머) */
export const updateElapsedTimes = () => {
  const now = getCurrentTime(); // "HH:MM"

  // 12:30 자동 일시정지
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
      showToast(`점심시간입니다. 진행 중인 ${tasksPaused}개의 업무를 자동 일시정지합니다.`, false);
      debouncedSaveState(); 
    } else {
      debouncedSaveState(); 
    }
  }

  // 13:30 자동 재개
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
      showToast(`점심시간 종료. ${tasksResumed}개의 업무를 자동 재개합니다.`, false);
      debouncedSaveState(); 
    } else {
      debouncedSaveState();
    }
  }
  
  // (진행 시간 UI 업데이트)
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

      } else { // status === 'ongoing'
          const dur = calcElapsedMinutes(startTime, now, currentPauses);
          el.textContent = `(진행: ${formatDuration(dur)})`;
      }
    } catch(e) { /* noop */ }
  });

  // (요약: 총 업무 시간 업데이트)
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

/** (모든 모듈에서 import) */
export const render = () => {
  try {
    // 👈 [수정] context의 모바일 뷰 상태 값을 파라미터로 전달
    renderRealtimeStatus(appState, appConfig.teamGroups, appConfig.keyTasks || [], context.isMobileTaskViewExpanded, context.isMobileMemberViewExpanded);
    renderCompletedWorkLog(appState);
    updateSummary(appState, appConfig); 
    renderTaskAnalysis(appState, appConfig); 
  } catch (e) {
    console.error('Render error:', e);
    showToast('화면 렌더링 오류 발생.', true);
  }
};

/** (모든 모듈에서 import) */
export const markDataAsDirty = () => {
    isDataDirty = true;
};

/** (메인 타이머) */
export const autoSaveProgress = () => {
    if (isDataDirty) {
        // app-history-logic.js에서 가져온 saveProgress 호출
        saveProgress(true); 
        isDataDirty = false; // ✅ [수정] saveProgress 호출 후 플래그 초기화
    }
};

// ⛔️ [삭제] --- 
// ⛔️ app-logic.js로 이동한 함수 (startWorkGroup ~ resumeWorkIndividual) (약 150줄) 삭제
// ⛔️ ---

// ⛔️ [삭제] ---
// ⛔️ app-history-logic.js로 이동한 함수 (saveProgress ~ switchHistoryView) (약 1100줄) 삭제
// ⛔️ ---

// ⛔️ [삭제] ---
// ⛔️ app-listeners.js로 이동한 함수 (모든 if (teamStatusBoard) ... addEventListener) (약 1100줄) 삭제
// ⛔️ ---


// ========== 9. 앱 초기화 (ENTRY POINT) ==========
// (startAppAfterLogin, main, onAuthStateChanged는 app.js에 남겨둡니다)

/**
 * 로그인 성공 후 앱 리스너를 설정하고 데이터를 로드합니다.
 */
async function startAppAfterLogin(user) { 
  const loadingSpinner = document.getElementById('loading-spinner');
  if (loadingSpinner) loadingSpinner.style.display = 'block'; 

  try { 
      if (connectionStatusEl) connectionStatusEl.textContent = '설정 로딩 중...';
      
      appConfig = await loadAppConfig(db); 
      persistentLeaveSchedule = await loadLeaveSchedule(db);
      
      const userEmail = user.email;
      
      if (!userEmail) {
          showToast('로그인 사용자의 이메일 정보를 가져올 수 없습니다. 다시 로그인해주세요.', true);
          // ... (오류 처리) ...
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
          // ... (오류 처리) ...
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
      if (logoutBtn) logoutBtn.classList.remove('hidden');
      if (logoutBtnMobile) logoutBtnMobile.classList.remove('hidden');
      
      // (역할(Role)에 따른 UI 제어)
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

      // (로그인 성공 후 UI 표시)
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
  
  displayCurrentDate();
  if (elapsedTimeTimer) clearInterval(elapsedTimeTimer);
  elapsedTimeTimer = setInterval(updateElapsedTimes, 1000);

  if (autoSaveTimer) clearInterval(autoSaveTimer);
  autoSaveTimer = setInterval(autoSaveProgress, AUTO_SAVE_INTERVAL);

  // (실시간 리스너: 근태 일정)
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

  // (실시간 리스너: 앱 설정)
  const configDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'config', 'mainConfig');
  if (unsubscribeConfig) unsubscribeConfig();
  unsubscribeConfig = onSnapshot(configDocRef, (docSnap) => {
      if (docSnap.exists()) {
          console.log("실시간 앱 설정 감지: 변경 사항을 적용합니다.");
          const loadedConfig = docSnap.data();
          
          // ✅ [수정] config.js의 loadAppConfig와 동일한 마이그레이션 로직을 적용합니다.
          
          const mergedConfig = { ...appConfig, ...loadedConfig }; 
          
          mergedConfig.teamGroups = loadedConfig.teamGroups || appConfig.teamGroups;
          mergedConfig.keyTasks = loadedConfig.keyTasks || appConfig.keyTasks;
          mergedConfig.dashboardItems = loadedConfig.dashboardItems || appConfig.dashboardItems;
          mergedConfig.dashboardCustomItems = { ...(loadedConfig.dashboardCustomItems || {}) };
          mergedConfig.quantityTaskTypes = loadedConfig.quantityTaskTypes || appConfig.quantityTaskTypes;
          
          // ✅ [추가] 품질 비용 항목 실시간 로드
          mergedConfig.qualityCostTasks = loadedConfig.qualityCostTasks || appConfig.qualityCostTasks;

          // ✅ [수정] taskGroups 마이그레이션 로직 (config.js에서 복사)
          if (Array.isArray(loadedConfig.taskGroups)) {
              // 1. Firestore에 이미 새 배열 [] 형식이면 그대로 사용
              mergedConfig.taskGroups = loadedConfig.taskGroups;
          } else if (typeof loadedConfig.taskGroups === 'object' && loadedConfig.taskGroups !== null && !Array.isArray(loadedConfig.taskGroups)) {
              // 2. Firestore에 이전 객체 {} 형식이면 새 배열 [] 형식으로 변환
              console.warn("실시간 감지: 'taskGroups' (객체)를 (배열) 형식으로 마이그레이션합니다.");
              mergedConfig.taskGroups = Object.entries(loadedConfig.taskGroups).map(([groupName, tasks]) => {
                  return { name: groupName, tasks: tasks || [] };
              });
          } else {
              // 3. Firestore에 데이터가 없으면 현재 앱의 설정(appConfig) 유지
              mergedConfig.taskGroups = appConfig.taskGroups;
          }
          
          mergedConfig.memberWages = { ...appConfig.memberWages, ...(loadedConfig.memberWages || {}) };
          mergedConfig.memberEmails = { ...appConfig.memberEmails, ...(loadedConfig.memberEmails || {}) };
          mergedConfig.memberRoles = { ...appConfig.memberRoles, ...(loadedConfig.memberRoles || {}) };
          mergedConfig.quantityToDashboardMap = { ...appConfig.quantityToDashboardMap, ...(loadedConfig.quantityToDashboardMap || {}) };

          appConfig = mergedConfig; // 전역 appConfig 업데이트

          // (이하 렌더링 호출은 동일)
          renderDashboardLayout(appConfig);
          renderTaskSelectionModal(appConfig.taskGroups);
          render(); 
          
          if (addAttendanceMemberDatalist) {
              addAttendanceMemberDatalist.innerHTML = '';
              const staffMembers = (appConfig.teamGroups || []).flatMap(g => g.members);
              const partTimerMembers = (appState.partTimers || []).map(p => p.name);
              const allMembers = [...new Set([...staffMembers, ...partTimerMembers])].sort();
              allMembers.forEach(member => {
                  const option = document.createElement('option');
                  option.value = member;
                  addAttendanceMemberDatalist.appendChild(option);
              });
          }

      } else {
          console.warn("실시간 앱 설정 감지: config 문서가 삭제되었습니다. 로컬 설정을 유지합니다.");
      }
  }, (error) => {
      console.error("앱 설정 실시간 연결 실패:", error);
      showToast("앱 설정 연결에 실패했습니다.", true);
  });

  // (실시간 리스너: 오늘의 데이터)
  const todayDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString());
  if (unsubscribeToday) unsubscribeToday();

  unsubscribeToday = onSnapshot(todayDocRef, (docSnap) => {
    try {
      // ✅ [수정] 업무 목록을 새 배열 구조에서 가져옵니다.
      // [].concat(...Object.values(appConfig.taskGroups || {})) -> (appConfig.taskGroups || []).flatMap(group => group.tasks)
      const taskTypes = (appConfig.taskGroups || []).flatMap(group => group.tasks);
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
 * 앱 메인 함수
 */
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

  // (인증 상태 변경 감지)
  onAuthStateChanged(auth, async user => {
    const loadingSpinner = document.getElementById('loading-spinner');
    if (user) {
      // (로그인 시)
      if (loginModal) loginModal.classList.add('hidden'); 
      if (loadingSpinner) loadingSpinner.style.display = 'block'; 
      await startAppAfterLogin(user); 
    } else {
      // (로그아웃 시)
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
          if(el.querySelector('#completed-log-content') || el.querySelector('#analysis-content')) {
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

  // ✅ [수정] 모든 이벤트 리스너를 app-listeners.js에서 가져와 초기화합니다.
  initializeAppListeners();
  
  // ⛔️ [삭제] ---
  // ⛔️ main() 함수 내부에 있던 모든 리스너 (loginForm, logoutBtn, makeDraggable 등) 삭제
  // ⛔️ ---
  
  
// ⛔️ [삭제] ---
// ⛔️ makeDraggable 함수 정의 (약 50줄) 삭제 (app-listeners.js로 이동)
// ⛔️ ---

// ⛔️ [삭제] ---
// ⛔️ 통합 근태 수정 모달 리스너 (editLeaveModal) (약 150줄) 삭제 (app-listeners.js로 이동)
// ⛔️ ---
}

main(); // 앱 시작