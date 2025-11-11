// === js/state.js ===
// 설명: 앱 전체에서 공유되는 전역 상태 변수들을 관리하는 모듈입니다.

// Firebase 및 리스너 핸들
// (초기화는 app.js 또는 config.js에서 수행되고, 여기서는 참조를 저장합니다)
export let db = null;
export let auth = null;
export let unsubscribeToday = null;
export let unsubscribeLeaveSchedule = null;
export let unsubscribeConfig = null;
export let unsubscribeWorkRecords = null;

// 타이머 핸들
export let elapsedTimeTimer = null;
export let periodicRefreshTimer = null;
export let autoSaveTimer = null;

// 상수 및 설정
export const AUTO_SAVE_INTERVAL = 1 * 60 * 1000; // 1분
export const LEAVE_TYPES = ['연차', '외출', '조퇴', '결근', '출장'];

// 상태 플래그
export let isDataDirty = false;

// -------------------------------------------------------------------
// 핵심 상태 객체 (Mutable State Objects)
// -------------------------------------------------------------------

// 1. 작업 컨텍스트 (임시 상태, 모달 간 데이터 전달 등)
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

// 2. 메인 앱 상태 (화면에 표시되는 실시간 데이터)
export let appState = {
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
    lunchPauseExecuted: false,
    lunchResumeExecuted: false
};

// 3. 앱 설정 (Firestore 'config/mainConfig'에서 로드됨)
export let appConfig = {
    teamGroups: [],
    systemAccounts: [],
    memberWages: {},
    taskGroups: {},
    quantityTaskTypes: [],
    defaultPartTimerWage: 10000,
    keyTasks: [],
    // 기본값 보장
    standardDailyWorkHours: { weekday: 8, weekend: 4 }
};

// 4. 영구 근태 일정 (Firestore 'persistent_data/leaveSchedule'에서 로드됨)
export let persistentLeaveSchedule = {
    onLeaveMembers: []
};

// 5. 전체 이력 데이터 (로컬 캐시)
export let allHistoryData = [];


// -------------------------------------------------------------------
// 상태 변경 헬퍼 함수 (Setters)
// -------------------------------------------------------------------
// 다른 모듈에서 import { setDb, setAuth } from './state.js'; 형태로 사용

export const setDb = (newDb) => { db = newDb; };
export const setAuth = (newAuth) => { auth = newAuth; };
export const setUnsubscribeToday = (unsub) => { unsubscribeToday = unsub; };
export const setUnsubscribeLeaveSchedule = (unsub) => { unsubscribeLeaveSchedule = unsub; };
export const setUnsubscribeConfig = (unsub) => { unsubscribeConfig = unsub; };
export const setUnsubscribeWorkRecords = (unsub) => { unsubscribeWorkRecords = unsub; };

export const setElapsedTimeTimer = (timer) => { elapsedTimeTimer = timer; };
export const setPeriodicRefreshTimer = (timer) => { periodicRefreshTimer = timer; };
export const setAutoSaveTimer = (timer) => { autoSaveTimer = timer; };

export const setIsDataDirty = (isDirty) => { isDataDirty = isDirty; };

// 객체 전체를 교체해야 할 때 사용 (예: 설정 로드 완료 시)
export const setAppConfig = (newConfig) => { appConfig = newConfig; };
export const setPersistentLeaveSchedule = (newSchedule) => { persistentLeaveSchedule = newSchedule; };