// === app.js (메인 진입점 및 상태 관리) ===

// --- Imports ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, onSnapshot, collection, getDocs, deleteDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import { initializeFirebase, loadAppConfig, loadLeaveSchedule, saveLeaveSchedule } from './config.js';
import { showToast, getTodayDateString, displayCurrentDate, getCurrentTime, formatDuration, formatTimeTo24H, getWeekOfYear, isWeekday, calcElapsedMinutes, debounce } from './utils.js';
import {
  renderDashboardLayout, renderRealtimeStatus, renderCompletedWorkLog, updateSummary,
  renderTaskAnalysis, renderTaskSelectionModal, renderManualAddModalDatalists, trendCharts 
} from './ui.js';
import { initializeAppListeners } from './app-listeners.js';
import { saveProgress, saveDayDataToHistory } from './app-history-logic.js';

// --- DOM Elements (Exported) ---
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
export const cancelTeamSelectBtn = document.getElementById('cancel-team-select-btn');

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
export const reportPanel = document.getElementById('report-panel');
export const reportTabs = document.getElementById('report-tabs');
export const reportViewContainer = document.getElementById('report-view-container');
export const reportDailyView = document.getElementById('report-daily-view');
export const reportWeeklyView = document.getElementById('report-weekly-view');
export const reportMonthlyView = document.getElementById('report-monthly-view');
export const reportYearlyView = document.getElementById('report-yearly-view');

export const deleteHistoryModal = document.getElementById('delete-history-modal');
export const confirmHistoryDeleteBtn = document.getElementById('confirm-history-delete-btn');
export const cancelHistoryDeleteBtn = document.getElementById('cancel-history-delete-btn');
export const historyStartDateInput = document.getElementById('history-start-date');
export const historyEndDateInput = document.getElementById('history-end-date');
export const historyFilterBtn = document.getElementById('history-filter-btn');
export const historyClearFilterBtn = document.getElementById('history-clear-filter-btn');
export const historyDownloadPeriodExcelBtn = document.getElementById('history-download-period-excel-btn');

export const quantityModal = document.getElementById('quantity-modal');
export const confirmQuantityBtn = document.getElementById('confirm-quantity-btn');
export const cancelQuantityBtn = document.getElementById('cancel-quantity-btn');
export const openQuantityModalTodayBtn = document.getElementById('open-quantity-modal-today');
export const openQuantityModalTodayBtnMobile = document.getElementById('open-quantity-modal-today-mobile');
export const quantityOnStopModal = document.getElementById('quantity-on-stop-modal');
export const confirmQuantityOnStopBtn = document.getElementById('confirm-quantity-on-stop');
export const cancelQuantityOnStopBtn = document.getElementById('cancel-quantity-on-stop');

export const deleteAllCompletedBtn = document.getElementById('delete-all-completed-btn');
export const editRecordModal = document.getElementById('edit-record-modal');
export const confirmEditBtn = document.getElementById('confirm-edit-btn');
export const cancelEditBtn = document.getElementById('cancel-edit-btn');
export const saveProgressBtn = document.getElementById('save-progress-btn');
export const endShiftBtn = document.getElementById('end-shift-btn');
export const endShiftConfirmModal = document.getElementById('end-shift-confirm-modal');
export const endShiftConfirmTitle = document.getElementById('end-shift-confirm-title');
export const endShiftConfirmMessage = document.getElementById('end-shift-confirm-message');
export const confirmEndShiftBtn = document.getElementById('confirm-end-shift-btn');
export const cancelEndShiftBtn = document.getElementById('cancel-end-shift-btn');

export const resetAppBtn = document.getElementById('reset-app-btn');
export const resetAppModal = document.getElementById('reset-app-modal');
export const confirmResetAppBtn = document.getElementById('confirm-reset-app-btn');
export const cancelResetAppBtn = document.getElementById('cancel-reset-app-btn');
export const resetAppBtnMobile = document.getElementById('reset-app-btn-mobile');

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
export const editLeaveModal = document.getElementById('edit-leave-record-modal');

export const toggleCompletedLog = document.getElementById('toggle-completed-log');
export const toggleAnalysis = document.getElementById('toggle-analysis');
export const toggleSummary = document.getElementById('toggle-summary');
export const openManualAddBtn = document.getElementById('open-manual-add-btn');
export const manualAddRecordModal = document.getElementById('manual-add-record-modal');
export const confirmManualAddBtn = document.getElementById('confirm-manual-add-btn');
export const cancelManualAddBtn = document.getElementById('cancel-manual-add-btn');
export const manualAddForm = document.getElementById('manual-add-form');

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
export const logoutBtnMobile = document.getElementById('logout-btn-mobile');

export const menuToggleBtn = document.getElementById('menu-toggle-btn');
export const menuDropdown = document.getElementById('menu-dropdown');
export const adminLinkBtnMobile = document.getElementById('admin-link-btn-mobile');
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
export const coqExplanationModal = document.getElementById('coq-explanation-modal');

// --- App State & Config ---
export let db, auth;
export let unsubscribeToday, unsubscribeLeaveSchedule, unsubscribeConfig; 
export let elapsedTimeTimer = null;
export let isDataDirty = false; 
export let autoSaveTimer = null;
export const AUTO_SAVE_INTERVAL = 1 * 60 * 1000; // 1분

export let context = {
    recordCounter: 0,
    recordIdOrGroupIdToEdit: null, editType: null, 
    selectedTaskForStart: null, selectedGroupForAdd: null,
    recordToDeleteId: null, recordToStopId: null,
    historyKeyToDelete: null, recordToEditId: null,
    deleteMode: 'single', groupToStopId: null,
    quantityModalContext: { mode: 'today', dateKey: null, onConfirm: null, onCancel: null },
    tempSelectedMembers: [],
    memberToSetLeave: null, memberToCancelLeave: null,
    activeMainHistoryTab: 'work', attendanceRecordToDelete: null,
    isMobileTaskViewExpanded: false, isMobileMemberViewExpanded: false, 
    historyStartDate: null, historyEndDate: null, 
    reportSortState: {}, currentReportParams: null 
};

export let appState = {
  workRecords: [],
  taskQuantities: {},
  dailyOnLeaveMembers: [],
  dateBasedOnLeaveMembers: [],
  partTimers: [],
  hiddenGroupIds: [],
  currentUser: null,
  currentUserRole: 'user',
  lunchPauseExecuted: false,
  lunchResumeExecuted: false
};
export let persistentLeaveSchedule = { onLeaveMembers: [] };
export let appConfig = {
    teamGroups: [], memberWages: {}, taskGroups: {}, quantityTaskTypes: [],
    defaultPartTimerWage: 10000, keyTasks: []
};
export let allHistoryData = [];
export const LEAVE_TYPES = ['연차', '외출', '조퇴', '결근', '출장'];

// --- Helper Functions ---
export const generateId = () => `${Date.now()}-${++context.recordCounter}`;
export const normalizeName = (s='') => s.normalize('NFC').trim().toLowerCase();
export const markDataAsDirty = () => { isDataDirty = true; };

// --- Core Logic ---
export async function saveStateToFirestore() {
  if (!auth || !auth.currentUser) return;
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
      showToast('저장 데이터가 큽니다. 이력으로 옮기거나 정리하세요.', true);
      return;
    }
    await setDoc(docRef, { state: stateToSave });
    markDataAsDirty(); 
  } catch (error) {
    console.error('Error saving state:', error);
    showToast('데이터 동기화 오류.', true);
  }
}

export const debouncedSaveState = debounce(saveStateToFirestore, 1000);

export const updateElapsedTimes = () => {
  const now = getCurrentTime(); 

  // 점심시간 자동 일시정지 (12:30)
  if (now === '12:30' && !appState.lunchPauseExecuted) {
    appState.lunchPauseExecuted = true; 
    let tasksPaused = 0;
    (appState.workRecords || []).forEach(record => {
      if (record.status === 'ongoing') {
        record.status = 'paused';
        record.pauses = record.pauses || [];
        record.pauses.push({ start: now, end: null, type: 'lunch' }); 
        tasksPaused++;
      }
    });
    if (tasksPaused > 0) showToast(`점심시간. ${tasksPaused}개 업무 자동 일시정지.`, false);
    debouncedSaveState(); 
  }

  // 점심시간 자동 재개 (13:30)
  if (now === '13:30' && !appState.lunchResumeExecuted) {
    appState.lunchResumeExecuted = true;
    let tasksResumed = 0;
    (appState.workRecords || []).forEach(record => {
      if (record.status === 'paused') {
        const lastPause = record.pauses?.[record.pauses.length - 1];
        if (lastPause && lastPause.type === 'lunch' && lastPause.end === null) {
          record.status = 'ongoing';
          lastPause.end = now; 
          tasksResumed++;
        }
      }
    });
    if (tasksResumed > 0) showToast(`점심시간 종료. ${tasksResumed}개 업무 자동 재개.`, false);
    debouncedSaveState();
  }
  
  // 화면 시간 업데이트
  document.querySelectorAll('.ongoing-duration').forEach(el => {
    try {
      const startTime = el.dataset.startTime;
      if (!startTime) return;
      const status = el.dataset.status;
      const pauses = JSON.parse(el.dataset.pausesJson || '[]'); 
      let currentPauses = pauses || [];

      if (status === 'paused') {
          const lastPause = currentPauses.length > 0 ? currentPauses[currentPauses.length - 1] : null;
          const tempPauses = [...currentPauses.slice(0, -1), { start: lastPause?.start || startTime, end: now }];
          el.textContent = `(진행: ${formatDuration(calcElapsedMinutes(startTime, now, tempPauses))})`;
      } else { 
          el.textContent = `(진행: ${formatDuration(calcElapsedMinutes(startTime, now, currentPauses))})`;
      }
    } catch(e) { /* noop */ }
  });

  // 총 업무 시간 업데이트
  const completedMinutes = (appState.workRecords || []).filter(r => r.status === 'completed').reduce((sum, r) => sum + (r.duration || 0), 0);
  const ongoingMinutes = (appState.workRecords || []).filter(r => r.status === 'ongoing').reduce((sum, r) => sum + calcElapsedMinutes(r.startTime, now, r.pauses), 0);
  const el = document.getElementById('summary-total-work-time');
  if (el) el.textContent = formatDuration(completedMinutes + ongoingMinutes);
};

export const render = () => {
  try {
    renderRealtimeStatus(appState, appConfig.teamGroups, appConfig.keyTasks || [], context.isMobileTaskViewExpanded, context.isMobileMemberViewExpanded);
    renderCompletedWorkLog(appState);
    updateSummary(appState, appConfig); 
    renderTaskAnalysis(appState, appConfig); 
  } catch (e) {
    console.error('Render error:', e);
  }
};

export const autoSaveProgress = () => {
    const hasOngoing = (appState.workRecords || []).some(r => r.status === 'ongoing');
    if (isDataDirty || hasOngoing) {
        saveProgress(true); 
        isDataDirty = false; 
    }
};

// --- App Entry Point ---
async function startAppAfterLogin(user) { 
  const loadingSpinner = document.getElementById('loading-spinner');
  if (loadingSpinner) loadingSpinner.style.display = 'block'; 

  try { 
      if (connectionStatusEl) connectionStatusEl.textContent = '설정 로딩 중...';
      appConfig = await loadAppConfig(db); 
      persistentLeaveSchedule = await loadLeaveSchedule(db);
      
      const userEmail = user.email;
      if (!userEmail) throw new Error("이메일 정보 없음");
      
      const userEmailLower = userEmail.toLowerCase();
      const memberEmails = appConfig.memberEmails || {}; 
      const memberRoles = appConfig.memberRoles || {}; 

      const emailToMemberMap = Object.entries(memberEmails).reduce((acc, [name, email]) => {
          if (email) acc[email.toLowerCase()] = name;
          return acc;
      }, {});

      const currentUserName = emailToMemberMap[userEmailLower]; 
      if (!currentUserName) throw new Error("미등록 사용자");

      appState.currentUser = currentUserName;
      appState.currentUserRole = memberRoles[userEmailLower] || 'user';
      
      if (userGreeting) {
          userGreeting.textContent = `${currentUserName}님 (${appState.currentUserRole}), 안녕하세요.`;
          userGreeting.classList.remove('hidden');
      }
      if (logoutBtn) logoutBtn.classList.remove('hidden');
      if (logoutBtnMobile) logoutBtnMobile.classList.remove('hidden');
      
      const isAdmin = appState.currentUserRole === 'admin';
      const adminDisplay = isAdmin ? 'flex' : 'none';
      const historyDisplay = isAdmin ? 'inline-block' : 'none';
      
      ['admin-link-btn', 'admin-link-btn-mobile', 'reset-app-btn', 'reset-app-btn-mobile'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.style.display = adminDisplay;
      });
      if (openHistoryBtn) openHistoryBtn.style.display = historyDisplay;

      // Show Main UI
      ['current-date-display', 'top-right-controls', 'main-content-area'].forEach(id => document.getElementById(id)?.classList.remove('hidden'));
      document.querySelector('.bg-gray-800.shadow-lg')?.classList.remove('hidden');
      document.querySelectorAll('.p-6.bg-gray-50.rounded-lg.border.border-gray-200').forEach(el => el.classList.remove('hidden'));

      if (loadingSpinner) loadingSpinner.style.display = 'none'; 
      renderDashboardLayout(appConfig); 
      renderTaskSelectionModal(appConfig.taskGroups);

  } catch (e) { 
      console.error("앱 시작 실패:", e);
      showToast(e.message === "미등록 사용자" ? "등록된 사용자가 아닙니다." : "초기화 실패.", true);
      if (e.message === "미등록 사용자" || e.message === "이메일 정보 없음") {
          auth.signOut();
          if (loginModal) loginModal.classList.remove('hidden');
      }
      if (loadingSpinner) loadingSpinner.style.display = 'none';
  }
  
  displayCurrentDate();
  if (elapsedTimeTimer) clearInterval(elapsedTimeTimer);
  elapsedTimeTimer = setInterval(updateElapsedTimes, 1000);

  if (autoSaveTimer) clearInterval(autoSaveTimer);
  autoSaveTimer = setInterval(autoSaveProgress, AUTO_SAVE_INTERVAL);

  // Real-time Listeners
  if (unsubscribeLeaveSchedule) unsubscribeLeaveSchedule();
  unsubscribeLeaveSchedule = onSnapshot(doc(db, 'artifacts', 'team-work-logger-v2', 'persistent_data', 'leaveSchedule'), (docSnap) => {
      persistentLeaveSchedule = docSnap.exists() ? docSnap.data() : { onLeaveMembers: [] };
      const today = getTodayDateString();
      appState.dateBasedOnLeaveMembers = (persistentLeaveSchedule.onLeaveMembers || []).filter(entry => {
          if (['연차', '출장', '결근'].includes(entry.type)) {
              return entry.startDate && today >= entry.startDate && today <= (entry.endDate || entry.startDate);
          }
          return false;
      });
      markDataAsDirty();
      render();
  });

  if (unsubscribeConfig) unsubscribeConfig();
  unsubscribeConfig = onSnapshot(doc(db, 'artifacts', 'team-work-logger-v2', 'config', 'mainConfig'), (docSnap) => {
      if (docSnap.exists()) {
          const loaded = docSnap.data();
          appConfig = { ...appConfig, ...loaded, 
              teamGroups: loaded.teamGroups || appConfig.teamGroups,
              keyTasks: loaded.keyTasks || appConfig.keyTasks,
              taskGroups: Array.isArray(loaded.taskGroups) ? loaded.taskGroups : appConfig.taskGroups
          };
          renderDashboardLayout(appConfig);
          renderTaskSelectionModal(appConfig.taskGroups);
          render();
          // Re-populate member datalist if needed
          if (addAttendanceMemberDatalist) {
              addAttendanceMemberDatalist.innerHTML = '';
              [...new Set([...(appConfig.teamGroups||[]).flatMap(g=>g.members), ...(appState.partTimers||[]).map(p=>p.name)])].sort().forEach(m => {
                  const op = document.createElement('option'); op.value = m; addAttendanceMemberDatalist.appendChild(op);
              });
          }
      }
  });

  if (unsubscribeToday) unsubscribeToday();
  unsubscribeToday = onSnapshot(doc(db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString()), (docSnap) => {
    try {
      const loaded = docSnap.exists() ? JSON.parse(docSnap.data().state || '{}') : {};
      appState.workRecords = loaded.workRecords || [];
      appState.taskQuantities = { ...appState.taskQuantities, ...(loaded.taskQuantities || {}) };
      appState.partTimers = loaded.partTimers || [];
      appState.hiddenGroupIds = loaded.hiddenGroupIds || [];
      appState.dailyOnLeaveMembers = loaded.onLeaveMembers || [];
      appState.lunchPauseExecuted = loaded.lunchPauseExecuted || false; 
      appState.lunchResumeExecuted = loaded.lunchResumeExecuted || false;
      isDataDirty = false;
      render(); 
      if (connectionStatusEl) connectionStatusEl.textContent = '동기화';
      if (statusDotEl) statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-green-500';
    } catch (e) {
      console.error('State load error:', e);
      if (connectionStatusEl) connectionStatusEl.textContent = '데이터 오류';
      if (statusDotEl) statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
    }
  }, (error) => {
    console.error('Snapshot error:', error);
    if (connectionStatusEl) connectionStatusEl.textContent = '연결 오류';
    if (statusDotEl) statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
  });
}

async function main() {
  try {
    const fb = initializeFirebase();
    db = fb.db; auth = fb.auth;
    if (!db || !auth) throw new Error("Firebase 초기화 실패");
  } catch (e) {
    console.error(e); return;
  }

  onAuthStateChanged(auth, async user => {
    if (user) {
      if (loginModal) loginModal.classList.add('hidden'); 
      await startAppAfterLogin(user); 
    } else {
      if (connectionStatusEl) connectionStatusEl.textContent = '인증 필요';
      if (statusDotEl) statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-gray-400';
      if (unsubscribeToday) unsubscribeToday();
      if (unsubscribeLeaveSchedule) unsubscribeLeaveSchedule();
      if (unsubscribeConfig) unsubscribeConfig(); 

      // Hide Main UI
      ['nav-content', 'user-greeting', 'logout-btn', 'logout-btn-mobile', 'current-date-display', 'top-right-controls', 'main-content-area'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
      document.querySelector('.bg-gray-800.shadow-lg')?.classList.add('hidden');
      document.querySelectorAll('.p-6.bg-gray-50.rounded-lg.border.border-gray-200').forEach(el => el.classList.add('hidden'));

      if (loginModal) loginModal.classList.remove('hidden');
      document.getElementById('loading-spinner').style.display = 'none';
      renderDashboardLayout({ dashboardItems: [] }); 
    }
  });

  initializeAppListeners();
}

main();