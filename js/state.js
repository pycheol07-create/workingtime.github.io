// === js/state.js ===
// 설명: 앱의 모든 전역 상태, 컨텍스트, 설정 변수를 정의하고 export합니다.

// --- Firebase/App State (Re-assigned variables) ---
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

// --- Setters ---
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
// ✅ [수정] '지각' 추가
export const LEAVE_TYPES = ['연차', '지각', '조퇴', '외출', '결근', '출장'];

// --- State Objects ---
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
    autoResumeFromLunch: null,
    
    // 근태 이력 정렬/필터 상태
    attendanceSortState: {
        daily: { key: 'member', dir: 'asc' },
        weekly: { key: 'member', dir: 'asc' },
        monthly: { key: 'member', dir: 'asc' }
    },
    attendanceFilterState: {
        daily: { member: '', type: '' },
        weekly: { member: '' },
        monthly: { member: '' }
    },
    activeFilterDropdown: null 
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
    simulationResults: null 
};

// --- Data Arrays ---
export const allHistoryData = [];