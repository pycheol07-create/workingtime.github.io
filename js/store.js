// === js/store.js ===

import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, APP_ID } from './firebase.js';
import { getTodayDateString, showToast } from './utils.js';
import { renderDashboardLayout, renderTaskSelectionModal, render } from './ui/index.js';

// --- 1. 전역 상태 변수 정의 ---

export let appState = {
  workRecords: [],
  taskQuantities: {},
  dailyOnLeaveMembers: [],    // '외출', '조퇴' 등 오늘 하루만 유효한 근태
  dateBasedOnLeaveMembers: [], // '연차', '출장' 등 날짜 범위로 지정된 근태 (onSnapshot이 채움)
  partTimers: [],
  hiddenGroupIds: [],
  currentUser: null,           // 로그인한 사용자 이름
  currentUserRole: 'user',     // 'user' 또는 'admin'
  lunchPauseExecuted: false,   // 12:30 점심시간 자동 일시정지 실행 여부
  lunchResumeExecuted: false,  // 13:30 점심시간 자동 재개 실행 여부
};

export let persistentLeaveSchedule = {
    onLeaveMembers: [] // '연차', '출장' 등의 원본 데이터
};

export let appConfig = {
    teamGroups: [],
    memberWages: {},
    memberEmails: {},
    memberRoles: {},
    taskGroups: {},
    quantityTaskTypes: [],
    defaultPartTimerWage: 10000,
    keyTasks: [],
    dashboardItems: [],
    dashboardCustomItems: {},
    quantityToDashboardMap: {}
};

// --- 2. 상태 변수 업데이트 함수 (Setter) ---
// (필요시 사용, 현재는 onSnapshot이 직접 수정)
export function setAppState(newState) {
    appState = { ...appState, ...newState };
}
export function setAppConfig(newConfig) {
    appConfig = newConfig;
}
export function setPersistentLeaveSchedule(newSchedule) {
    persistentLeaveSchedule = newSchedule;
}
export function updateTaskQuantities(newQuantities) {
    appState.taskQuantities = newQuantities;
}
export function updateWorkRecords(newRecords) {
    appState.workRecords = newRecords;
}
// ... (기타 상태 업데이트 함수들) ...

// --- 3. 실시간 리스너 (app.js에서 이동) ---

let unsubscribeToday;
let unsubscribeLeaveSchedule;
let unsubscribeConfig;

/**
 * 앱의 모든 실시간 Firestore 리스너를 시작합니다.
 */
export function startRealtimeListeners() {
    
    // 1. 근태 일정 (persistent_data)
    const leaveScheduleDocRef = doc(db, 'artifacts', APP_ID, 'persistent_data', 'leaveSchedule');
    if (unsubscribeLeaveSchedule) unsubscribeLeaveSchedule();
    unsubscribeLeaveSchedule = onSnapshot(leaveScheduleDocRef, (docSnap) => {
        persistentLeaveSchedule = docSnap.exists() ? docSnap.data() : { onLeaveMembers: [] };

        const today = getTodayDateString();
        // 오늘 날짜에 해당하는 '연차', '출장', '결근'만 필터링
        appState.dateBasedOnLeaveMembers = (persistentLeaveSchedule.onLeaveMembers || []).filter(entry => {
            if (entry.type === '연차' || entry.type === '출장' || entry.type === '결근') {
                const endDate = entry.endDate || entry.startDate;
                return entry.startDate && typeof entry.startDate === 'string' &&
                       today >= entry.startDate && today <= (endDate || entry.startDate);
            }
            return false;
        });
        
        // (markDataAsDirty()는 API 호출 시로 이동)
        render(); // UI 갱신
        
    }, (error) => {
        console.error("근태 일정 실시간 연결 실패:", error);
        showToast("근태 일정 연결에 실패했습니다.", true);
        appState.dateBasedOnLeaveMembers = [];
        render();
    });

    // 2. 앱 설정 (config)
    const configDocRef = doc(db, 'artifacts', APP_ID, 'config', 'mainConfig');
    if (unsubscribeConfig) unsubscribeConfig();
    unsubscribeConfig = onSnapshot(configDocRef, (docSnap) => {
        if (docSnap.exists()) {
            console.log("실시간 앱 설정 감지: 변경 사항을 적용합니다.");
            const loadedConfig = docSnap.data();
            
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
            render(); 
            
            // (근태 추가 모달 목록 갱신은 listeners.js에서 처리)

        } else {
            console.warn("실시간 앱 설정 감지: config 문서가 삭제되었습니다. 로컬 설정을 유지합니다.");
        }
    }, (error) => {
        console.error("앱 설정 실시간 연결 실패:", error);
        showToast("앱 설정 연결에 실패했습니다.", true);
    });

    // 3. 오늘의 실시간 업무 현황 (daily_data)
    const todayDocRef = doc(db, 'artifacts', APP_ID, 'daily_data', getTodayDateString());
    if (unsubscribeToday) unsubscribeToday();

    const statusDotEl = document.getElementById('status-dot');
    const connectionStatusEl = document.getElementById('connection-status');

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

        // (isDataDirty = false; -> API 호출 시로 이동)

        render(); 
        
        if (connectionStatusEl) connectionStatusEl.textContent = '동기화';
        if (statusDotEl) statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-green-500';

      } catch (parseError) {
        console.error('Error parsing state from Firestore:', parseError);
        showToast('데이터 로딩 중 오류 발생 (파싱 실패).', true);
        appState = { ...appState, workRecords: [], taskQuantities: {}, dailyOnLeaveMembers: [], partTimers: [], hiddenGroupIds: [] };
        render();
        if (connectionStatusEl) connectionStatusEl.textContent = '데이터 오류';
        if (statusDotEl) statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
      }
    }, (error) => {
      console.error('Firebase onSnapshot error:', error);
      showToast('실시간 연결에 실패했습니다.', true);
      appState = { ...appState, workRecords: [], taskQuantities: {}, dailyOnLeaveMembers: [], partTimers: [], hiddenGroupIds: [] };
      render();
      if (connectionStatusEl) connectionStatusEl.textContent = '연결 오류';
      if (statusDotEl) statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
    });
}

/**
 * 모든 실시간 리스너를 중지합니다. (로그아웃 시 사용)
 */
export function stopRealtimeListeners() {
    if (unsubscribeToday) { unsubscribeToday(); unsubscribeToday = undefined; }
    if (unsubscribeLeaveSchedule) { unsubscribeLeaveSchedule(); unsubscribeLeaveSchedule = undefined; }
    if (unsubscribeConfig) { unsubscribeConfig(); unsubscribeConfig = undefined; }
}

/**
 * 앱이 오프라인일 때 UI를 설정합니다.
 */
export function setOfflineState() {
    const statusDotEl = document.getElementById('status-dot');
    const connectionStatusEl = document.getElementById('connection-status');
    if (connectionStatusEl) connectionStatusEl.textContent = '인증 필요';
    if (statusDotEl) statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-gray-400';

    // 전역 상태 초기화
    appState = {
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
    
    // (appConfig는 비우지 않고, 로그인 시 새로 로드)

    // UI 숨기기
    document.getElementById('user-greeting')?.classList.add('hidden');
    document.getElementById('logout-btn')?.classList.add('hidden');
    document.getElementById('logout-btn-mobile')?.classList.add('hidden');
    document.getElementById('current-date-display')?.classList.add('hidden');
    document.getElementById('top-right-controls')?.classList.add('hidden');
    document.querySelector('.bg-gray-800.shadow-lg')?.classList.add('hidden'); 
    document.getElementById('main-content-area')?.classList.add('hidden'); 
    document.querySelectorAll('.p-6.bg-gray-50.rounded-lg.border.border-gray-200').forEach(el => { 
        if(el.querySelector('#completed-log-content') || el.querySelector('#analysis-content')) {
            el.classList.add('hidden');
        }
    });
    
    // 관리자 버튼 숨기기
    document.getElementById('admin-link-btn')?.style.display = 'none';
    document.getElementById('admin-link-btn-mobile')?.style.display = 'none';
    document.getElementById('reset-app-btn')?.style.display = 'none';
    document.getElementById('reset-app-btn-mobile')?.style.display = 'none';
    document.getElementById('open-history-btn')?.style.display = 'none';

    renderDashboardLayout({ dashboardItems: [] }); // 대시보드 비우기
}