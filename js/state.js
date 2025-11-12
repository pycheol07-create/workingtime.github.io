// === js/state.js ===
// 설명: 앱의 모든 전역 상태, 컨텍스트, 설정 변수를 정의하고 export합니다.
// (수정: app.js에서 값을 할당할 수 있도록 setter 함수 추가)

// --- Firebase/App State (Re-assigned variables) ---
// 이 변수들은 app.js에서 초기화되거나 재할당됩니다.
export let db = null;
export let auth = null;
export let unsubscribeToday = null;
export let unsubscribeLeaveSchedule = null;
export let unsubscribeConfig = null;
export let elapsedTimeTimer = null;
export let periodicRefreshTimer = null;
export let unsubscribeWorkRecords = null;
export let isDataDirty = false;
export let autoSaveTimer = null;
export let appConfig = {
    teamGroups: [],
    systemAccounts: [],
    memberWages: {},
    memberEmails: {},
    memberRoles: {},
    taskGroups: {},
    quantityTaskTypes: [],
    defaultPartTimerWage: 10000,
    keyTasks: []
};
export let persistentLeaveSchedule = {
    onLeaveMembers: []
};

// --- Setters for Re-assigned variables ---
// app.js가 이 함수들을 호출하여 위의 변수 값을 변경합니다.
export const setDb = (val) => { db = val; };
export const setAuth = (val) => { auth = val; };
export const setUnsubscribeToday = (val) => { unsubscribeToday = val; };
export const setUnsubscribeLeaveSchedule = (val) => { unsubscribeLeaveSchedule = val; };
export const setUnsubscribeConfig = (val) => { appConfig = val; };
export const setElapsedTimeTimer = (val) => { elapsedTimeTimer = val; };
export const setPeriodicRefreshTimer = (val) => { periodicRefreshTimer = val; };
export const setUnsubscribeWorkRecords = (val) => { unsubscribeWorkRecords = val; };
export const setIsDataDirty = (val) => { isDataDirty = val; };
export const setAutoSaveTimer = (val) => { autoSaveTimer = val; };
export const setAppConfig = (val) => { appConfig = val; };
export const setPersistentLeaveSchedule = (val) => { persistentLeaveSchedule = val; };

// --- Constants ---
export const AUTO_SAVE_INTERVAL = 1 * 60 * 1000;
export const LEAVE_TYPES = ['연차', '외출', '조퇴', '결근', '출장'];

// --- State Objects (Mutated, not re-assigned) ---
// 이 객체들은 재할당되지 않고 내부 속성만 변경되므로 const로 선언합니다.
export const context = {
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
    isMobileTaskViewExpanded: false,
    isMobileMemberViewExpanded: false,
    historyStartDate: null,
    historyEndDate: null,
    reportSortState: {},
    currentReportParams: null,
    monthlyRevenues: {},
    memberToAction: null,
    autoPauseForLunch: null,
    autoResumeFromLunch: null
};

export const appState = {
    workRecords: [], // 로컬 캐시
    taskQuantities: {},
    dailyOnLeaveMembers: [],
    dateBasedOnLeaveMembers: [],
    partTimers: [],
    hiddenGroupIds: [],
    currentUser: null,
    currentUserRole: 'user',
    confirmedZeroTasks: [],
    dailyAttendance: {},
    simulationResults: null // ✅ [적용 확인] 이 줄이 있어야 합니다.
};

// --- Data Arrays (Mutated, not re-assigned) ---
export const allHistoryData = [];