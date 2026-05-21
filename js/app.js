// === js/app.js ===
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirebase, loadAppConfig, loadLeaveSchedule } from './config.js';
import { displayCurrentDate, showToast } from './utils.js';
import { renderDashboardLayout, renderRealtimeStatus, renderCompletedWorkLog, updateSummary, renderTaskAnalysis, renderTaskSelectionModal, applyDynamicSidebar } from './ui.js';
import { initializeAppListeners } from './app-listeners.js';
import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { autoPauseForLunch, autoResumeFromLunch } from './app-logic.js';
import { checkAdminTodoNotifications } from './admin-todo-logic.js';
import { setupWeekendListeners } from './listeners-weekend.js';

// ✅ 분리된 모듈 가져오기
import { updateElapsedTimes, autoSaveProgress, markDataAsDirty } from './app-lifecycle.js';
import { setupNotificationListeners } from './app-notifications.js';
import { setupFirebaseListeners, unsubscribeNotifications } from './app-sync.js';

export const normalizeName = (s = '') => s.normalize('NFC').trim().toLowerCase();

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

async function startAppAfterLogin(user) {
    if (DOM.loadingSpinner) DOM.loadingSpinner.style.display = 'block'; 

    try {
        if (DOM.connectionStatusEl) DOM.connectionStatusEl.textContent = '설정 로딩 중...';

        State.setAppConfig(await loadAppConfig(State.db));
        State.setPersistentLeaveSchedule(await loadLeaveSchedule(State.db));

        State.context.autoPauseForLunch = autoPauseForLunch;
        State.context.autoResumeFromLunch = autoResumeFromLunch;

        const userEmail = user.email?.toLowerCase();
        if (!userEmail) {
            State.auth.signOut();
            return;
        }

        const emailToMemberMap = Object.entries(State.appConfig.memberEmails || {}).reduce((acc, [name, email]) => {
            if (email) acc[email.toLowerCase()] = name;
            return acc;
        }, {});

        const systemAccounts = State.appConfig.systemAccounts || [];
        const sysAcc = systemAccounts.find(acc => acc && acc.email && acc.email.toLowerCase() === userEmail);

        const currentUserName = emailToMemberMap[userEmail] || (sysAcc ? sysAcc.name : null);
        const currentUserRole = (State.appConfig.memberRoles || {})[userEmail] || (sysAcc ? sysAcc.role : 'user');

        if (!currentUserName) {
            showToast('앱에 등록된 사용자가 아닙니다. 관리자에게 문의하세요.', true);
            State.auth.signOut();
            return;
        }

        State.appState.currentUser = currentUserName;
        State.appState.currentUserRole = currentUserRole;

        // UI 토글 (Admin vs User) - 기존 로직 유지
        if (DOM.userGreeting) {
            DOM.userGreeting.textContent = `${currentUserName}님 (${currentUserRole}), 안녕하세요.`;
            DOM.userGreeting.classList.remove('hidden');
        }
        if (DOM.logoutBtn) DOM.logoutBtn.classList.remove('hidden');

        // 관리자용 UI
        const adminElements = [document.getElementById('admin-link-btn'), DOM.adminLinkBtnMobile, DOM.resetAppBtn, DOM.resetAppBtnMobile, DOM.openHistoryBtn, DOM.openHistoryBtnMobile, document.getElementById('open-admin-todo-btn')];
        adminElements.forEach(el => { if (el) el.style.display = (currentUserRole === 'admin') ? 'flex' : 'none'; });
        
        if (currentUserRole === 'admin') {
            setInterval(checkAdminTodoNotifications, 30000);
        }

        // 메인 영역 노출
        document.getElementById('main-content-area')?.classList.remove('hidden');

        if (DOM.loadingSpinner) DOM.loadingSpinner.style.display = 'none'; 
        
        // ✨ 신규: 관리자 권한 UI가 세팅된 직후, 메뉴 순서를 동적으로 재배치합니다.
        applyDynamicSidebar(State.appConfig);

        renderDashboardLayout(State.appConfig);
        renderTaskSelectionModal(State.appConfig.taskGroups);

    } catch (e) {
        console.error("설정 로드 실패:", e);
        if (DOM.loadingSpinner) DOM.loadingSpinner.style.display = 'none'; 
    }

    displayCurrentDate();
    
    // ✅ 1. 타이머 설정 (분리된 로직 사용)
    if (State.elapsedTimeTimer) clearInterval(State.elapsedTimeTimer);
    State.setElapsedTimeTimer(setInterval(updateElapsedTimes, 1000));

    if (State.periodicRefreshTimer) clearInterval(State.periodicRefreshTimer);
    State.setPeriodicRefreshTimer(setInterval(render, 30000));

    if (State.autoSaveTimer) clearInterval(State.autoSaveTimer);
    State.setAutoSaveTimer(setInterval(autoSaveProgress, State.AUTO_SAVE_INTERVAL));

    // ✅ 2. Firebase 실시간 동기화 리스너 실행 (분리된 파일 호출)
    setupFirebaseListeners(render, markDataAsDirty);
}

// ✨ 신규: 분할된 HTML 파일들을 동적으로 불러와 뼈대 파일(DOM)에 꽂아 넣는 함수
async function loadHistoryComponents() {
    try {
        // 1. 패널 HTML과 서브 팝업 HTML을 동시에 불러옵니다.
        const [panelsResponse, subModalsResponse] = await Promise.all([
            fetch('components/history-panels.html'),
            fetch('components/history-sub-modals.html')
        ]);

        const panelsHtml = await panelsResponse.text();
        const subModalsHtml = await subModalsResponse.text();

        // 2. 뼈대 파일에 준비해둔 빈 상자를 찾습니다.
        const panelsWrapper = document.getElementById('history-panels-wrapper');
        const subModalsWrapper = document.getElementById('history-sub-modals-wrapper');

        // 3. 내용물을 꽂아 넣습니다.
        if (panelsWrapper && subModalsWrapper) {
            panelsWrapper.innerHTML = panelsHtml;
            subModalsWrapper.innerHTML = subModalsHtml;
            console.log("히스토리 모달 컴포넌트 로드 성공!");
        } else {
            console.warn("히스토리 뼈대 영역(Wrapper)을 찾을 수 없어 조립하지 못했습니다.");
        }
    } catch (error) {
        console.error("컴포넌트를 불러오는 데 실패했습니다:", error);
    }
}

async function main() {
    if (DOM.loadingSpinner) DOM.loadingSpinner.style.display = 'block'; 

    try {
        const firebase = initializeFirebase();
        State.setDb(firebase.db);
        State.setAuth(firebase.auth);
    } catch (e) {
        return;
    }

    // ✨ 신규: 앱이 시작되자마자 가장 먼저 분할된 HTML 파일부터 조립합니다.
    // (그래야 아래에 있는 이벤트 리스너들이 새로 만들어진 HTML 버튼들을 찾을 수 있습니다!)
    await loadHistoryComponents();

    // ✅ 3. 알림 이벤트 리스너 세팅
    setupNotificationListeners();

    onAuthStateChanged(State.auth, async user => {
        if (user) {
            if (DOM.loginModal) DOM.loginModal.classList.add('hidden');
            await startAppAfterLogin(user);
        } else {
            // 로그아웃 초기화
            if (State.unsubscribeToday) State.unsubscribeToday();
            if (State.unsubscribeWorkRecords) State.unsubscribeWorkRecords();
            if (unsubscribeNotifications) unsubscribeNotifications();

            State.appState.workRecords = [];
            State.appState.currentUser = null;
            if (DOM.loginModal) DOM.loginModal.classList.remove('hidden');
        }
    });

    initializeAppListeners();
    setupWeekendListeners();
}

main();