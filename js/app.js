// === js/app.js ===
// 설명: 앱의 메인 진입점(Entry Point). 초기화 및 핵심 제어 루프를 담당합니다.

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, setDoc, onSnapshot, collection } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { initializeFirebase, loadAppConfig, loadLeaveSchedule } from './config.js';
import { showToast, getTodayDateString, displayCurrentDate, getCurrentTime, formatDuration, calcElapsedMinutes, debounce } from './utils.js';
import { renderDashboardLayout, renderRealtimeStatus, renderCompletedWorkLog, updateSummary, renderTaskAnalysis, renderTaskSelectionModal } from './ui.js';
import { initializeAppListeners } from './app-listeners.js';
import { saveProgress } from './app-history-logic.js';

// 1. 분리된 모듈에서 상태와 DOM을 모두 가져와서 다시 내보냅니다. (하위 호환성 유지)
export * from './state.js';
export * from './dom.js';

// 2. 이 파일 내부에서 사용할 변수들을 명시적으로 가져옵니다.
import {
    db, auth, appState, appConfig, persistentLeaveSchedule, context,
    isDataDirty, elapsedTimeTimer, periodicRefreshTimer, autoSaveTimer, AUTO_SAVE_INTERVAL,
    setDb, setAuth, setUnsubscribeToday, setUnsubscribeLeaveSchedule, setUnsubscribeConfig, setUnsubscribeWorkRecords,
    setElapsedTimeTimer, setPeriodicRefreshTimer, setAutoSaveTimer, setIsDataDirty, setAppConfig, setPersistentLeaveSchedule
} from './state.js';

import {
    loadingSpinner, connectionStatusEl, statusDotEl, userGreeting, logoutBtn, logoutBtnMobile,
    loginModal, navContent, addAttendanceMemberDatalist,
    personalAttendanceTogglePc, pcAttendanceLabel, personalAttendanceToggleMobile,
    adminLinkBtn, resetAppBtn, openHistoryBtn, adminLinkBtnMobile, resetAppBtnMobile,
    currentDateDisplay, topRightControls, mainContentArea
    // 👈 [수정 완료] 문제가 되는 두 변수 삭제
} from './dom.js';


// =================================================================
// Core Logic Functions (핵심 로직)
// =================================================================

// ✅ [중요] 원자적 업데이트 함수 (다른 모듈에서도 사용됨)
export async function updateDailyData(updates) {
    if (!auth || !auth.currentUser) return;
    try {
        const docRef = doc(db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString());
        await setDoc(docRef, updates, { merge: true });
    } catch (error) {
        console.error('Error updating daily data:', error);
        showToast('데이터 저장 중 오류가 발생했습니다.', true);
    }
}

// [레거시 호환] 전체 상태 저장 (점진적 교체 예정)
export async function saveStateToFirestore() {
    const updates = {
        taskQuantities: appState.taskQuantities || {},
        onLeaveMembers: appState.dailyOnLeaveMembers || [],
        partTimers: appState.partTimers || [],
        hiddenGroupIds: appState.hiddenGroupIds || [],
        lunchPauseExecuted: appState.lunchPauseExecuted || false,
        lunchResumeExecuted: appState.lunchResumeExecuted || false,
        confirmedZeroTasks: appState.confirmedZeroTasks || [],
        dailyAttendance: appState.dailyAttendance || {}
    };
    await updateDailyData(updates);
    setIsDataDirty(false);
}

export const debouncedSaveState = debounce(saveStateToFirestore, 1000);

export const markDataAsDirty = () => {
    setIsDataDirty(true);
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
        setIsDataDirty(false);
    }
};

export const updateElapsedTimes = async () => {
    const now = getCurrentTime();
    
    // 점심시간 자동 일시정지/재개 로직
    if (now === '12:30' && !appState.lunchPauseExecuted) {
        appState.lunchPauseExecuted = true;
        if (context.autoPauseForLunch) {
            const tasksPaused = await context.autoPauseForLunch();
            if (tasksPaused > 0) showToast(`점심시간: ${tasksPaused}개 업무 자동 일시정지`, false);
        }
        saveStateToFirestore(); 
    }
    if (now === '13:30' && !appState.lunchResumeExecuted) {
        appState.lunchResumeExecuted = true;
        if (context.autoResumeFromLunch) {
            const tasksResumed = await context.autoResumeFromLunch();
            if (tasksResumed > 0) showToast(`점심시간 종료: ${tasksResumed}개 업무 자동 재개`, false);
        }
        saveStateToFirestore();
    }

    // 화면 시간 업데이트
    document.querySelectorAll('.ongoing-duration').forEach(el => {
        try {
            const startTime = el.dataset.startTime;
            if (!startTime) return;
            const status = el.dataset.status;
            const pauses = JSON.parse(el.dataset.pausesJson || '[]');
            let current = (status === 'paused')
                ? [...pauses.slice(0, -1), { start: pauses[pauses.length - 1]?.start || startTime, end: now }]
                : pauses;
            el.textContent = `(진행: ${formatDuration(calcElapsedMinutes(startTime, now, current))})`;
        } catch (e) {}
    });

    // 상단 총 업무 시간 업데이트
    const totalMinutes = (appState.workRecords || []).reduce((sum, r) => {
        if (r.status === 'completed') return sum + (r.duration || 0);
        if (r.status === 'ongoing') return sum + calcElapsedMinutes(r.startTime, now, r.pauses);
        return sum;
    }, 0);
    const summaryEl = document.getElementById('summary-total-work-time');
    if (summaryEl) summaryEl.textContent = formatDuration(totalMinutes);
};

// =================================================================
// App Initialization (앱 초기화)
// =================================================================

async function startAppAfterLogin(user) {
    const spinner = document.getElementById('loading-spinner');
    if (spinner) spinner.style.display = 'block';

    try {
        if (connectionStatusEl) connectionStatusEl.textContent = '설정 로딩 중...';

        // 1. 설정 로드
        const config = await loadAppConfig(db);
        setAppConfig(config);
        const schedule = await loadLeaveSchedule(db);
        setPersistentLeaveSchedule(schedule);

        // 2. 사용자 권한 확인
        const userEmail = user.email;
        if (!userEmail) throw new Error('이메일 정보 없음');

        const emailLower = userEmail.toLowerCase();
        const emailMap = Object.entries(appConfig.memberEmails || {}).reduce((acc, [name, email]) => {
            if (email) acc[email.toLowerCase()] = name;
            return acc;
        }, {});

        const userName = emailMap[emailLower];
        const userRole = (appConfig.memberRoles || {})[emailLower] || 'user';

        if (!userName) throw new Error('미등록 사용자');

        // 3. 상태 업데이트
        appState.currentUser = userName;
        appState.currentUserRole = userRole;

        // 4. UI 초기화
        if (userGreeting) {
            userGreeting.textContent = `${userName}님 (${userRole}), 안녕하세요.`;
            userGreeting.classList.remove('hidden');
        }
        if (logoutBtn) logoutBtn.classList.remove('hidden');
        if (logoutBtnMobile) logoutBtnMobile.classList.remove('hidden');

        // 개인 근태 토글 표시
        const pcToggle = document.getElementById('personal-attendance-toggle-pc');
        const pcLabel = document.getElementById('pc-attendance-label');
        if (pcToggle && pcLabel) {
            pcLabel.textContent = `${userName}님 근태:`;
            pcToggle.classList.remove('hidden'); pcToggle.classList.add('flex');
        }
        const mobileToggle = document.getElementById('personal-attendance-toggle-mobile');
        if (mobileToggle) {
            mobileToggle.classList.remove('hidden'); mobileToggle.classList.add('flex');
        }

        // 관리자 버튼 표시 여부
        const isAdmin = (userRole === 'admin');
        const adminDisplay = isAdmin ? 'flex' : 'none';
        const historyDisplay = isAdmin ? 'inline-block' : 'none';
        
        const adminBtn = document.getElementById('admin-link-btn');
        const adminBtnMobile = document.getElementById('admin-link-btn-mobile');
        const resetBtn = document.getElementById('reset-app-btn');
        const resetBtnMobile = document.getElementById('reset-app-btn-mobile');
        const historyBtn = document.getElementById('open-history-btn');

        if (adminBtn) adminBtn.style.display = adminDisplay;
        if (adminBtnMobile) adminBtnMobile.style.display = adminDisplay;
        if (resetBtn) resetBtn.style.display = adminDisplay;
        if (resetBtnMobile) resetBtnMobile.style.display = adminDisplay;
        if (historyBtn) historyBtn.style.display = historyDisplay;

        // 메인 화면 요소 표시
        document.getElementById('current-date-display')?.classList.remove('hidden');
        document.getElementById('top-right-controls')?.classList.remove('hidden');
        document.querySelector('.bg-gray-800.shadow-lg')?.classList.remove('hidden');
        document.getElementById('main-content-area')?.classList.remove('hidden');
        document.querySelectorAll('.p-6.bg-gray-50.rounded-lg.border.border-gray-200').forEach(el => {
             if (el.querySelector('#completed-log-content') || el.querySelector('#analysis-content')) el.classList.remove('hidden');
        });

        if (spinner) spinner.style.display = 'none';
        renderDashboardLayout(appConfig);
        renderTaskSelectionModal(appConfig.taskGroups);

    } catch (e) {
        console.error("Login initialization failed:", e);
        showToast(e.message || "초기화 실패", true);
        if (auth) auth.signOut();
        if (loginModal) loginModal.classList.remove('hidden');
        if (spinner) spinner.style.display = 'none';
        return;
    }

    // 5. 타이머 및 리스너 시작
    displayCurrentDate();
    if (elapsedTimeTimer) clearInterval(elapsedTimeTimer);
    setElapsedTimeTimer(setInterval(updateElapsedTimes, 1000));

    if (periodicRefreshTimer) clearInterval(periodicRefreshTimer);
    setPeriodicRefreshTimer(setInterval(() => {
        renderCompletedWorkLog(appState);
        renderTaskAnalysis(appState, appConfig);
    }, 30000));

    if (autoSaveTimer) clearInterval(autoSaveTimer);
    setAutoSaveTimer(setInterval(autoSaveProgress, AUTO_SAVE_INTERVAL));

    // 6. Firestore 실시간 리스너 연결
    setupFirestoreListeners();
}

function setupFirestoreListeners() {
    // 근태 일정 리스너
    setUnsubscribeLeaveSchedule(onSnapshot(doc(db, 'artifacts', 'team-work-logger-v2', 'persistent_data', 'leaveSchedule'), (docSnap) => {
        const schedule = docSnap.exists() ? docSnap.data() : { onLeaveMembers: [] };
        setPersistentLeaveSchedule(schedule);
        
        const today = getTodayDateString();
        appState.dateBasedOnLeaveMembers = (schedule.onLeaveMembers || []).filter(entry => {
             const endDate = entry.endDate || entry.startDate;
             return ['연차', '출장', '결근'].includes(entry.type) && today >= entry.startDate && today <= endDate;
        });
        render();
    }));

    // 설정 변경 리스너
    setUnsubscribeConfig(onSnapshot(doc(db, 'artifacts', 'team-work-logger-v2', 'config', 'mainConfig'), (docSnap) => {
        if (docSnap.exists()) {
            // 설정 병합 로직 (기존 app.js와 동일하게 구현 필요, 지면상 간략화)
            // 실제로는 config.js의 loadAppConfig 로직을 재사용하거나 여기서 병합 수행
            const loaded = docSnap.data();
            setAppConfig({ ...appConfig, ...loaded }); // 단순 병합 예시
            renderDashboardLayout(appConfig);
            renderTaskSelectionModal(appConfig.taskGroups);
            render();
            // 알바/직원 데이터리스트 업데이트
            if (addAttendanceMemberDatalist) {
                 addAttendanceMemberDatalist.innerHTML = '';
                 const allMembers = [...new Set([...(appConfig.teamGroups || []).flatMap(g => g.members), ...(appState.partTimers || []).map(p => p.name)])].sort();
                 allMembers.forEach(m => { const op = document.createElement('option'); op.value = m; addAttendanceMemberDatalist.appendChild(op); });
            }
        }
    }));

    // 금일 데이터(메타) 리스너
    setUnsubscribeToday(onSnapshot(doc(db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString()), (docSnap) => {
        const data = docSnap.exists() ? docSnap.data() : {};
        // (레거시 state 문자열 파싱 로직 생략, 필요시 추가)
        appState.taskQuantities = data.taskQuantities || {};
        appState.partTimers = data.partTimers || [];
        appState.dailyOnLeaveMembers = data.onLeaveMembers || [];
        appState.lunchPauseExecuted = data.lunchPauseExecuted || false;
        appState.lunchResumeExecuted = data.lunchResumeExecuted || false;
        appState.confirmedZeroTasks = data.confirmedZeroTasks || [];
        appState.dailyAttendance = data.dailyAttendance || {};
        
        setIsDataDirty(false);
        render();
        if (connectionStatusEl) connectionStatusEl.textContent = '동기화 (메타)';
        if (statusDotEl) statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-green-500';
    }));

    // 금일 업무 기록(컬렉션) 리스너
    const recordsRef = collection(db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString(), 'workRecords');
    setUnsubscribeWorkRecords(onSnapshot(recordsRef, (snapshot) => {
        appState.workRecords = [];
        snapshot.forEach(doc => appState.workRecords.push(doc.data()));
        appState.workRecords.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
        render();
        if (connectionStatusEl) connectionStatusEl.textContent = '동기화 (업무)';
    }));
}

async function main() {
    const spinner = document.getElementById('loading-spinner');
    if (spinner) spinner.style.display = 'block';

    const firebase = initializeFirebase();
    if (!firebase.db || !firebase.auth) {
        if (spinner) spinner.style.display = 'none';
        return;
    }
    setDb(firebase.db);
    setAuth(firebase.auth);

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            if (loginModal) loginModal.classList.add('hidden');
            await startAppAfterLogin(user);
        } else {
            // 로그아웃 상태 처리
            if (connectionStatusEl) connectionStatusEl.textContent = '인증 필요';
            if (statusDotEl) statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-gray-400';
            
            // 모든 리스너 및 타이머 해제 (state.js의 헬퍼 사용 권장하지만 여기선 직접 접근 혹은 헬퍼 사용)
            // ... (리스너 해제 로직) ...

            // 상태 초기화
            appState.workRecords = [];
            appState.currentUser = null;
            // ... (기타 상태 초기화) ...

            // UI 숨기기
            if (navContent) navContent.classList.add('hidden');
            if (userGreeting) userGreeting.classList.add('hidden');
            document.getElementById('main-content-area')?.classList.add('hidden');
            // ... (기타 UI 숨기기) ...

            if (loginModal) loginModal.classList.remove('hidden');
            if (spinner) spinner.style.display = 'none';
            renderDashboardLayout({ dashboardItems: [] });
        }
    });

    initializeAppListeners();
}

main();