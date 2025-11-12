// === js/app.js (리팩토링 완료) ===

// --- 1. Firebase 및 라이브러리 임포트 ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, onSnapshot, collection, getDocs, deleteDoc, getDoc, runTransaction, query, where, writeBatch, updateDoc, increment } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// --- 2. 모듈 임포트 ---
import { initializeFirebase, loadAppConfig, loadLeaveSchedule, saveLeaveSchedule } from './config.js';
import { showToast, getTodayDateString, displayCurrentDate, getCurrentTime, formatDuration, formatTimeTo24H, getWeekOfYear, isWeekday, calcElapsedMinutes, debounce } from './utils.js';
import {
    renderDashboardLayout,
    renderRealtimeStatus,
    renderCompletedWorkLog,
    updateSummary,
    renderTaskAnalysis,
    renderTaskSelectionModal,
    renderManualAddModalDatalists
} from './ui.js';
import { initializeAppListeners } from './app-listeners.js';

// ✅ [수정] app-history-logic.js 대신 history-data-manager.js에서 직접 임포트
import {
    saveProgress,
    saveDayDataToHistory
} from './history-data-manager.js';

// ✅ [신규] 분리된 DOM 요소와 상태 변수를 가져옵니다.
import * as DOM from './dom-elements.js';
import * as State from './state.js';

// ✅ [추가] app-logic.js에서 점심시간 자동화 함수 임포트
import {
    autoPauseForLunch,
    autoResumeFromLunch
} from './app-logic.js';

// ✅ [신규] app-data.js에서 데이터 함수 임포트
import {
    generateId,
    updateDailyData,
    saveStateToFirestore,
    debouncedSaveState
} from './app-data.js';


// --- 3. 헬퍼 함수 ---
// ⛔️ [삭제] generateId (app-data.js로 이동)
export const normalizeName = (s = '') => s.normalize('NFC').trim().toLowerCase();


// --- 4. 핵심 코어 함수 ---

// ⛔️ [삭제] updateDailyData (app-data.js로 이동)
// ⛔️ [삭제] saveStateToFirestore (app-data.js로 이동)
// ⛔️ [삭제] debouncedSaveState (app-data.js로 이동)

/**
 * ✅ [수정됨] State.appState와 State.context를 사용합니다.
 */
export const updateElapsedTimes = async () => {
    const now = getCurrentTime();
    
    // 12:30 점심시간 자동 일시정지
    if (now === '12:30' && !State.appState.lunchPauseExecuted) {
        State.appState.lunchPauseExecuted = true;
        if (State.context.autoPauseForLunch) {
            try {
                const tasksPaused = await State.context.autoPauseForLunch();
                if (tasksPaused > 0) {
                    showToast(`점심시간입니다. 진행 중인 ${tasksPaused}개의 업무를 자동 일시정지합니다.`, false);
                }
            } catch (e) {
                console.error("Error during auto-pause: ", e);
            }
        }
        saveStateToFirestore(); // lunchPauseExecuted 상태를 저장
    }

    // 13:30 점심시간 자동 재개
    if (now === '13:30' && !State.appState.lunchResumeExecuted) {
        State.appState.lunchResumeExecuted = true;
        if (State.context.autoResumeFromLunch) {
            try {
                const tasksResumed = await State.context.autoResumeFromLunch();
                if (tasksResumed > 0) {
                    showToast(`점심시간 종료. ${tasksResumed}개의 업무를 자동 재개합니다.`, false);
                }
            } catch (e) {
                 console.error("Error during auto-resume: ", e);
            }
        }
        saveStateToFirestore(); // lunchResumeExecuted 상태를 저장
    }

    // 진행 중인 시간 업데이트
    document.querySelectorAll('.ongoing-duration').forEach(el => {
        try {
            const startTime = el.dataset.startTime;
            if (!startTime) return;

            const status = el.dataset.status;
            const pauses = JSON.parse(el.dataset.pausesJson || '[]');
            let currentPauses = pauses || [];

            if (status === 'paused') {
                const lastPause = currentPauses.length > 0 ? currentPauses[currentPauses.length - 1] : null;
                // 현재 휴식 중인 시간을 반영하기 위해 마지막 pause의 끝을 '지금'으로 가정
                const tempPauses = [
                    ...currentPauses.slice(0, -1),
                    { start: lastPause?.start || startTime, end: now }
                ];
                const dur = calcElapsedMinutes(startTime, now, tempPauses);
                el.textContent = `(진행: ${formatDuration(dur)})`;

            } else { // 'ongoing'
                const dur = calcElapsedMinutes(startTime, now, currentPauses);
                el.textContent = `(진행: ${formatDuration(dur)})`;
            }
        } catch (e) { /* noop */ }
    });

    // 상단 현황판의 '업무진행시간' 업데이트
    const completedRecords = (State.appState.workRecords || []).filter(r => r.status === 'completed');
    const totalCompletedMinutes = completedRecords.reduce((sum, r) => sum + (r.duration || 0), 0);
    const ongoingLiveRecords = (State.appState.workRecords || []).filter(r => r.status === 'ongoing');
    let totalOngoingMinutes = 0;
    ongoingLiveRecords.forEach(rec => {
        totalOngoingMinutes += calcElapsedMinutes(rec.startTime, now, rec.pauses);
    });
    
    // 이 ID는 dom-elements.js에 없습니다 (동적으로 생성되는 ID임). 따라서 getElementById 유지.
    const el = document.getElementById('summary-total-work-time');
    if (el) el.textContent = formatDuration(totalCompletedMinutes + totalOngoingMinutes);
};

/**
 * ✅ [수정됨] State.appState, State.appConfig, State.context를 사용합니다.
 */
export const render = () => {
    try {
        renderRealtimeStatus(State.appState, State.appConfig.teamGroups, State.appConfig.keyTasks || [], State.context.isMobileTaskViewExpanded, State.context.isMobileMemberViewExpanded);
        renderCompletedWorkLog(State.appState);
        updateSummary(State.appState, State.appConfig);
        renderTaskAnalysis(State.appState, State.appConfig);
    } catch (e) {
        console.error('Render error:', e);
    }
};

/**
 * ✅ [수정됨] State.setIsDataDirty Setter를 사용합니다.
 */
export const markDataAsDirty = () => {
    State.setIsDataDirty(true);
};

/**
 * ✅ [수정됨] State.isDataDirty, State.appState, State.setIsDataDirty를 사용합니다.
 */
export const autoSaveProgress = () => {
    const hasOngoing = (State.appState.workRecords || []).some(r => r.status === 'ongoing');

    if (State.isDataDirty || hasOngoing) {
        saveProgress(true); 
        State.setIsDataDirty(false);
    }
};

// --- 5. 앱 초기화 및 인증 로직 ---

/**
 * ✅ [수정됨] DOM과 State를 import된 네임스페이스로 접근하고, Setter 함수를 사용합니다.
 */
async function startAppAfterLogin(user) {
    if (DOM.loadingSpinner) DOM.loadingSpinner.style.display = 'block'; // ✅ 수정됨

    try {
        if (DOM.connectionStatusEl) DOM.connectionStatusEl.textContent = '설정 로딩 중...';

        // ✅ Setter를 사용하여 전역 상태 변수 할당
        State.setAppConfig(await loadAppConfig(State.db));
        State.setPersistentLeaveSchedule(await loadLeaveSchedule(State.db));

        // ✅ [신규] 자동화 함수를 context에 등록
        State.context.autoPauseForLunch = autoPauseForLunch;
        State.context.autoResumeFromLunch = autoResumeFromLunch;

        const userEmail = user.email;

        if (!userEmail) {
            showToast('로그인 사용자의 이메일 정보를 가져올 수 없습니다. 다시 로그인해주세요.', true);
            if (DOM.loadingSpinner) DOM.loadingSpinner.style.display = 'none'; // ✅ 수정됨
            if (DOM.connectionStatusEl) DOM.connectionStatusEl.textContent = '인증 오류';
            State.auth.signOut();
            if (DOM.loginModal) DOM.loginModal.classList.remove('hidden');
            return;
        }

        const userEmailLower = userEmail.toLowerCase();
        const memberEmails = State.appConfig.memberEmails || {};
        const memberRoles = State.appConfig.memberRoles || {};

        const emailToMemberMap = Object.entries(memberEmails).reduce((acc, [name, email]) => {
            if (email) acc[email.toLowerCase()] = name;
            return acc;
        }, {});

        const currentUserName = emailToMemberMap[userEmailLower];
        const currentUserRole = memberRoles[userEmailLower] || 'user';

        if (!currentUserName) {
            showToast('로그인했으나 앱에 등록된 사용자가 아닙니다. 관리자에게 문의하세요.', true);
            if (DOM.loadingSpinner) DOM.loadingSpinner.style.display = 'none'; // ✅ 수정됨
            if (DOM.connectionStatusEl) DOM.connectionStatusEl.textContent = '사용자 미등록';
            State.auth.signOut();
            if (DOM.loginModal) DOM.loginModal.classList.remove('hidden');
            return;
        }

        // appState는 객체이므로 직접 수정
        State.appState.currentUser = currentUserName;
        State.appState.currentUserRole = currentUserRole;

        // ✅ DOM 요소는 DOM.xxx로 접근
        if (DOM.userGreeting) {
            DOM.userGreeting.textContent = `${currentUserName}님 (${currentUserRole}), 안녕하세요.`;
            DOM.userGreeting.classList.remove('hidden');
        }
        if (DOM.logoutBtn) DOM.logoutBtn.classList.remove('hidden');
        if (DOM.logoutBtnMobile) DOM.logoutBtnMobile.classList.remove('hidden');

        // 이 ID들은 dom-elements.js에 없습니다. getElementById 유지.
        const pcAttendanceToggle = document.getElementById('personal-attendance-toggle-pc');
        const pcAttendanceLabel = document.getElementById('pc-attendance-label');
        if (pcAttendanceToggle && pcAttendanceLabel) {
            pcAttendanceLabel.textContent = `${currentUserName}님 근태:`;
            pcAttendanceToggle.classList.remove('hidden');
            pcAttendanceToggle.classList.add('flex');
        }
        const mobileAttendanceToggle = document.getElementById('personal-attendance-toggle-mobile');
        if (mobileAttendanceToggle) {
             mobileAttendanceToggle.classList.remove('hidden');
             mobileAttendanceToggle.classList.add('flex');
        }


        // 이 ID는 dom-elements.js에 없습니다. getElementById 유지.
        const adminLinkBtn = document.getElementById('admin-link-btn');
        if (currentUserRole === 'admin') {
            if (adminLinkBtn) adminLinkBtn.style.display = 'flex';
            if (DOM.adminLinkBtnMobile) DOM.adminLinkBtnMobile.style.display = 'flex';
            if (DOM.resetAppBtn) DOM.resetAppBtn.style.display = 'flex';
            if (DOM.resetAppBtnMobile) DOM.resetAppBtnMobile.style.display = 'flex';
            
            if (DOM.openHistoryBtn) DOM.openHistoryBtn.style.display = 'flex';
            // ✅ [수정] 모바일 이력 보기 버튼 표시
            if (DOM.openHistoryBtnMobile) DOM.openHistoryBtnMobile.style.display = 'flex';

        } else {
            if (adminLinkBtn) adminLinkBtn.style.display = 'none';
            if (DOM.adminLinkBtnMobile) DOM.adminLinkBtnMobile.style.display = 'none';
            if (DOM.resetAppBtn) DOM.resetAppBtn.style.display = 'none';
            if (DOM.resetAppBtnMobile) DOM.resetAppBtnMobile.style.display = 'none';
            if (DOM.openHistoryBtn) DOM.openHistoryBtn.style.display = 'none';
            // ✅ [수정] 모바일 이력 보기 버튼 숨김
            if (DOM.openHistoryBtnMobile) DOM.openHistoryBtnMobile.style.display = 'none';
        }

        // 이 ID들은 dom-elements.js에 없습니다. getElementById 유지.
        document.getElementById('current-date-display')?.classList.remove('hidden');
        document.getElementById('top-right-controls')?.classList.remove('hidden');
        document.querySelector('.bg-gray-800.shadow-lg')?.classList.remove('hidden');
        document.getElementById('main-content-area')?.classList.remove('hidden');
        document.querySelectorAll('.p-6.bg-gray-50.rounded-lg.border.border-gray-200').forEach(el => {
            if (el.querySelector('#completed-log-content') || el.querySelector('#analysis-content')) {
                el.classList.remove('hidden');
            }
        });

        if (DOM.loadingSpinner) DOM.loadingSpinner.style.display = 'none'; // ✅ 수정됨
        renderDashboardLayout(State.appConfig);
        renderTaskSelectionModal(State.appConfig.taskGroups);

    } catch (e) {
        console.error("설정 로드 실패:", e);
        showToast("설정 정보 로드에 실패했습니다. 기본값으로 실행합니다.", true);
        if (DOM.loadingSpinner) DOM.loadingSpinner.style.display = 'none'; // ✅ 수정됨
        renderDashboardLayout(State.appConfig);
        renderTaskSelectionModal(State.appConfig.taskGroups);
    }

    displayCurrentDate();
    // ✅ Setter 사용
    if (State.elapsedTimeTimer) clearInterval(State.elapsedTimeTimer);
    State.setElapsedTimeTimer(setInterval(updateElapsedTimes, 1000));

    if (State.periodicRefreshTimer) clearInterval(State.periodicRefreshTimer);
    State.setPeriodicRefreshTimer(setInterval(() => {
        renderCompletedWorkLog(State.appState);
        renderTaskAnalysis(State.appState, State.appConfig);
    }, 30000));

    if (State.autoSaveTimer) clearInterval(State.autoSaveTimer);
    State.setAutoSaveTimer(setInterval(autoSaveProgress, State.AUTO_SAVE_INTERVAL));

    // --- 실시간 리스너 설정 ---
    const leaveScheduleDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'persistent_data', 'leaveSchedule');
    if (State.unsubscribeLeaveSchedule) State.unsubscribeLeaveSchedule();
    // ✅ Setter 사용
    State.setUnsubscribeLeaveSchedule(onSnapshot(leaveScheduleDocRef, (docSnap) => {
        State.setPersistentLeaveSchedule(docSnap.exists() ? docSnap.data() : { onLeaveMembers: [] }); // ✅ Setter 사용
        const today = getTodayDateString();
        State.appState.dateBasedOnLeaveMembers = (State.persistentLeaveSchedule.onLeaveMembers || []).filter(entry => {
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
        State.appState.dateBasedOnLeaveMembers = [];
        render();
    }));

    const configDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'config', 'mainConfig');
    if (State.unsubscribeConfig) State.unsubscribeConfig();
    // ✅ Setter 사용
    State.setUnsubscribeConfig(onSnapshot(configDocRef, (docSnap) => {
        if (docSnap.exists()) {
            console.log("실시간 앱 설정 감지: 변경 사항을 적용합니다.");
            const loadedConfig = docSnap.data();

            const mergedConfig = { ...State.appConfig, ...loadedConfig };

            // ... (기존 병합 로직 동일) ...
            mergedConfig.teamGroups = loadedConfig.teamGroups || State.appConfig.teamGroups;
            mergedConfig.keyTasks = loadedConfig.keyTasks || State.appConfig.keyTasks;
            mergedConfig.dashboardItems = loadedConfig.dashboardItems || State.appConfig.dashboardItems;
            mergedConfig.dashboardCustomItems = { ...(loadedConfig.dashboardCustomItems || {}) };
            mergedConfig.quantityTaskTypes = loadedConfig.quantityTaskTypes || State.appConfig.quantityTaskTypes;
            mergedConfig.qualityCostTasks = loadedConfig.qualityCostTasks || State.appConfig.qualityCostTasks;
            mergedConfig.systemAccounts = loadedConfig.systemAccounts || State.appConfig.systemAccounts || [];

            if (Array.isArray(loadedConfig.taskGroups)) {
                mergedConfig.taskGroups = loadedConfig.taskGroups;
            } else if (typeof loadedConfig.taskGroups === 'object' && loadedConfig.taskGroups !== null && !Array.isArray(loadedConfig.taskGroups)) {
                mergedConfig.taskGroups = Object.entries(loadedConfig.taskGroups).map(([groupName, tasks]) => {
                    return { name: groupName, tasks: Array.isArray(tasks) ? tasks : [] };
                });
            } else {
                mergedConfig.taskGroups = State.appConfig.taskGroups;
            }

            mergedConfig.memberWages = { ...State.appConfig.memberWages, ...(loadedConfig.memberWages || {}) };
            mergedConfig.memberEmails = { ...State.appConfig.memberEmails, ...(loadedConfig.memberEmails || {}) };
            mergedConfig.memberRoles = { ...State.appConfig.memberRoles, ...(loadedConfig.memberRoles || {}) };
            mergedConfig.quantityToDashboardMap = { ...State.appConfig.quantityToDashboardMap, ...(loadedConfig.quantityToDashboardMap || {}) };

            State.setAppConfig(mergedConfig); // ✅ Setter 사용

            renderDashboardLayout(State.appConfig);
            renderTaskSelectionModal(State.appConfig.taskGroups);
            render();

            if (DOM.addAttendanceMemberDatalist) {
                DOM.addAttendanceMemberDatalist.innerHTML = '';
                const staffMembers = (State.appConfig.teamGroups || []).flatMap(g => g.members);
                const partTimerMembers = (State.appState.partTimers || []).map(p => p.name);
                const allMembers = [...new Set([...staffMembers, ...partTimerMembers])].sort();
                allMembers.forEach(member => {
                    const option = document.createElement('option');
                    option.value = member;
                    DOM.addAttendanceMemberDatalist.appendChild(option);
                });
            }

        } else {
            console.warn("실시간 앱 설정 감지: config 문서가 삭제되었습니다. 로컬 설정을 유지합니다.");
        }
    }, (error) => {
        console.error("앱 설정 실시간 연결 실패:", error);
        showToast("앱 설정 연결에 실패했습니다.", true);
    }));

    const todayDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString());
    if (State.unsubscribeToday) State.unsubscribeToday();
    // ✅ Setter 사용
    State.setUnsubscribeToday(onSnapshot(todayDocRef, (docSnap) => {
        try {
            const taskTypes = (State.appConfig.taskGroups || []).flatMap(group => group.tasks);
            const defaultQuantities = {};
            taskTypes.forEach(task => defaultQuantities[task] = 0);

            const data = docSnap.exists() ? docSnap.data() : {};
            
            let legacyState = {};
            if (data.state && typeof data.state === 'string') {
                try {
                    legacyState = JSON.parse(data.state);
                } catch (e) {
                    console.error("Legacy state parse error", e);
                }
            }

            // appState 객체의 속성 업데이트
            State.appState.taskQuantities = { ...defaultQuantities, ...(data.taskQuantities || legacyState.taskQuantities || {}) };
            State.appState.partTimers = data.partTimers || legacyState.partTimers || [];
            State.appState.hiddenGroupIds = data.hiddenGroupIds || legacyState.hiddenGroupIds || [];
            State.appState.dailyOnLeaveMembers = data.onLeaveMembers || legacyState.onLeaveMembers || [];
            State.appState.lunchPauseExecuted = data.lunchPauseExecuted ?? legacyState.lunchPauseExecuted ?? false;
            State.appState.lunchResumeExecuted = data.lunchResumeExecuted ?? legacyState.lunchResumeExecuted ?? false;
            State.appState.confirmedZeroTasks = data.confirmedZeroTasks || legacyState.confirmedZeroTasks || [];
            State.appState.dailyAttendance = data.dailyAttendance || legacyState.dailyAttendance || {};

            State.setIsDataDirty(false); // ✅ Setter 사용

            render();
            // ✅ DOM 접근
            if (DOM.connectionStatusEl) DOM.connectionStatusEl.textContent = '동기화 (메타)';
            if (DOM.statusDotEl) DOM.statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-green-500';
        } catch (parseError) {
            console.error('Error parsing state from Firestore:', parseError);
            showToast('데이터 로딩 중 오류 발생 (파싱 실패).', true);
            if (DOM.connectionStatusEl) DOM.connectionStatusEl.textContent = '데이터 오류';
            if (DOM.statusDotEl) DOM.statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
        }
    }, (error) => {
        console.error('Firebase onSnapshot error:', error);
        showToast('실시간 연결에 실패했습니다.', true);
        if (DOM.connectionStatusEl) DOM.connectionStatusEl.textContent = '연결 오류';
        if (DOM.statusDotEl) DOM.statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
    }));
    
    const workRecordsCollectionRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString(), 'workRecords');
    if (State.unsubscribeWorkRecords) State.unsubscribeWorkRecords();
    // ✅ Setter 사용
    State.setUnsubscribeWorkRecords(onSnapshot(workRecordsCollectionRef, (querySnapshot) => {
        State.appState.workRecords = [];
        querySnapshot.forEach((doc) => {
            State.appState.workRecords.push(doc.data());
        });

        State.appState.workRecords.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

        render();
        
        // ✅ DOM 접근
        if (DOM.connectionStatusEl) DOM.connectionStatusEl.textContent = '동기화 (업무)';
        if (DOM.statusDotEl) DOM.statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-green-500';

    }, (error) => {
        console.error('Firebase workRecords onSnapshot error:', error);
        showToast('업무 기록 실시간 연결에 실패했습니다.', true);
        if (DOM.connectionStatusEl) DOM.connectionStatusEl.textContent = '연결 오류 (업무)';
        if (DOM.statusDotEl) DOM.statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-yellow-500';
    }));
}

/**
 * ✅ [수정됨] DOM과 State를 import된 네임스페이스로 접근하고, Setter 함수를 사용합니다.
 */
async function main() {
    // ✅ DOM 접근
    if (DOM.loadingSpinner) DOM.loadingSpinner.style.display = 'block'; // ✅ 수정됨

    try {
        const firebase = initializeFirebase();
        // ✅ Setter 사용
        State.setDb(firebase.db);
        State.setAuth(firebase.auth);
        
        if (!State.db || !State.auth) {
            if (DOM.loadingSpinner) DOM.loadingSpinner.style.display = 'none'; // ✅ 수정됨
            return;
        }
    } catch (e) {
        console.error("Firebase init failed:", e);
        if (DOM.loadingSpinner) DOM.loadingSpinner.style.display = 'none'; // ✅ 수정됨
        return;
    }

    onAuthStateChanged(State.auth, async user => {
        // ✅ DOM 접근
        if (user) {
            if (DOM.loginModal) DOM.loginModal.classList.add('hidden');
            if (DOM.loadingSpinner) DOM.loadingSpinner.style.display = 'block'; // ✅ 수정됨
            await startAppAfterLogin(user);
        } else {
            if (DOM.connectionStatusEl) DOM.connectionStatusEl.textContent = '인증 필요';
            if (DOM.statusDotEl) DOM.statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-gray-400';

            // ✅ Setter 사용 및 전역 변수 해제
            if (State.unsubscribeToday) { State.unsubscribeToday(); State.setUnsubscribeToday(null); }
            if (State.unsubscribeLeaveSchedule) { State.unsubscribeLeaveSchedule(); State.setUnsubscribeLeaveSchedule(null); }
            if (State.unsubscribeConfig) { State.unsubscribeConfig(); State.setUnsubscribeConfig(null); }
            if (State.elapsedTimeTimer) { clearInterval(State.elapsedTimeTimer); State.setElapsedTimeTimer(null); }
            if (State.periodicRefreshTimer) { clearInterval(State.periodicRefreshTimer); State.setPeriodicRefreshTimer(null); }
            if (State.unsubscribeWorkRecords) { State.unsubscribeWorkRecords(); State.setUnsubscribeWorkRecords(null); }

            // ✅ appState 객체 내부 속성 초기화
            State.appState.workRecords = [];
            State.appState.taskQuantities = {};
            State.appState.dailyOnLeaveMembers = [];
            State.appState.dateBasedOnLeaveMembers = [];
            State.appState.partTimers = [];
            State.appState.hiddenGroupIds = [];
            State.appState.currentUser = null;
            State.appState.currentUserRole = 'user';
            State.appState.confirmedZeroTasks = [];
            State.appState.dailyAttendance = {};
            State.appState.lunchPauseExecuted = false;
            State.appState.lunchResumeExecuted = false;

            // ✅ DOM 접근
            if (DOM.navContent) DOM.navContent.classList.add('hidden');
            if (DOM.userGreeting) DOM.userGreeting.classList.add('hidden');
            if (DOM.logoutBtn) DOM.logoutBtn.classList.add('hidden');
            if (DOM.logoutBtnMobile) DOM.logoutBtnMobile.classList.add('hidden');
            document.getElementById('current-date-display')?.classList.add('hidden');
            document.getElementById('top-right-controls')?.classList.add('hidden');
            document.querySelector('.bg-gray-800.shadow-lg')?.classList.add('hidden');
            document.getElementById('main-content-area')?.classList.add('hidden');
            document.querySelectorAll('.p-6.bg-gray-50.rounded-lg.border.border-gray-200').forEach(el => {
                if (el.querySelector('#completed-log-content') || el.querySelector('#analysis-content')) {
                    el.classList.add('hidden');
                }
            });

            document.getElementById('personal-attendance-toggle-pc')?.classList.add('hidden');
            document.getElementById('personal-attendance-toggle-mobile')?.classList.add('hidden');

            const adminLinkBtn = document.getElementById('admin-link-btn');
            if (adminLinkBtn) adminLinkBtn.style.display = 'none';
            if (DOM.adminLinkBtnMobile) DOM.adminLinkBtnMobile.style.display = 'none';
            if (DOM.resetAppBtn) DOM.resetAppBtn.style.display = 'none';
            if (DOM.resetAppBtnMobile) DOM.resetAppBtnMobile.style.display = 'none';
            if (DOM.openHistoryBtn) DOM.openHistoryBtn.style.display = 'none';
            // ✅ [수정] 모바일 이력 보기 버튼 숨김
            if (DOM.openHistoryBtnMobile) DOM.openHistoryBtnMobile.style.display = 'none';

            if (DOM.loginModal) DOM.loginModal.classList.remove('hidden');
            if (DOM.loadingSpinner) DOM.loadingSpinner.style.display = 'none'; // ✅ 수정됨

            renderDashboardLayout({ dashboardItems: [] });
        }
    });

    initializeAppListeners();
}

main();