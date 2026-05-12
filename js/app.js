// === js/app.js ===
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirebase, loadAppConfig, loadLeaveSchedule } from './config.js';
import { displayCurrentDate, showToast } from './utils.js';
import { renderDashboardLayout, renderRealtimeStatus, renderCompletedWorkLog, updateSummary, renderTaskAnalysis, renderTaskSelectionModal } from './ui.js';
import { initializeAppListeners } from './app-listeners.js';
import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { autoPauseForLunch, autoResumeFromLunch } from './app-logic.js';
import { checkAdminTodoNotifications } from './admin-todo-logic.js';
import { setupWeekendListeners } from './listeners-weekend.js';

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

        if (DOM.userGreeting) {
            DOM.userGreeting.textContent = `${currentUserName}님 (${currentUserRole}), 안녕하세요.`;
            DOM.userGreeting.classList.remove('hidden');
        }
        if (DOM.logoutBtn) DOM.logoutBtn.classList.remove('hidden');

        // 👇 권한 기반 사이드바 메뉴 렌더링 로직 (대분류 동적 숨김 포함)
        const menuOrder = State.appConfig.menuOrder || ['cat-main', 'dashboard', 'quantity', 'history', 'cat-manage', 'weekend', 'leave', 'simulation', 'location', 'cat-admin', 'admin-todo', 'admin-page', 'end-shift'];
        const userPerms = State.appConfig.userPermissions || {};
        const myAllowedMenus = userPerms[currentUserName] || []; // 나에게 허용된 메뉴들

        const pcNav = document.querySelector('aside nav');
        if (pcNav) {
            pcNav.style.display = 'flex';
            pcNav.style.flexDirection = 'column';
        }

        // 1. 모든 메뉴 요소에 우선 순서 및 기본 권한 적용
        menuOrder.forEach((menuId, index) => {
            const isCategory = menuId.startsWith('cat-');
            // 관리자는 무조건 패스, 대분류 자체는 1차 패스(아래에서 재검사), 일반 유저는 허용목록에 있어야 패스
            const hasPermission = isCategory || (currentUserRole === 'admin') || myAllowedMenus.includes(menuId);
            
            const pcBtn = document.querySelector(`nav [data-menu-id="${menuId}"]`);
            const mobileBtn = document.querySelector(`#nav-content [data-menu-id="${menuId}"]`);
            
            if (pcBtn) {
                pcBtn.style.display = hasPermission ? (isCategory ? 'block' : 'flex') : 'none';
                pcBtn.style.order = index;
            }
            if (mobileBtn) {
                mobileBtn.style.display = hasPermission ? (isCategory ? 'block' : 'flex') : 'none';
                mobileBtn.style.order = index;
            }
        });

        // 2. 하위 메뉴가 모두 숨겨진 '대분류'는 화면에서도 스마트하게 숨기기
        ['aside nav', '#nav-content'].forEach(selector => {
            const container = document.querySelector(selector);
            if (!container) return;
            
            const items = Array.from(container.querySelectorAll('[data-menu-id]')).sort((a, b) => {
                return parseInt(a.style.order || 0) - parseInt(b.style.order || 0);
            });

            let currentCategoryNode = null;
            let categoryHasVisibleChild = false;

            items.forEach(item => {
                const isCategory = item.dataset.menuId.startsWith('cat-');
                
                if (isCategory) {
                    // 직전 카테고리가 있었는데 보여지는 하위 메뉴가 0개였다면 숨김
                    if (currentCategoryNode && !categoryHasVisibleChild) {
                        currentCategoryNode.style.display = 'none';
                    }
                    currentCategoryNode = item;
                    categoryHasVisibleChild = false;
                } else {
                    if (item.style.display !== 'none') {
                        categoryHasVisibleChild = true;
                    }
                }
            });
            
            // 마지막 카테고리 잔여 처리
            if (currentCategoryNode && !categoryHasVisibleChild) {
                currentCategoryNode.style.display = 'none';
            }
        });
        
        if (currentUserRole === 'admin') {
            setInterval(checkAdminTodoNotifications, 30000);
        }

        document.getElementById('main-content-area')?.classList.remove('hidden');

        if (DOM.loadingSpinner) DOM.loadingSpinner.style.display = 'none'; 
        renderDashboardLayout(State.appConfig);
        renderTaskSelectionModal(State.appConfig.taskGroups);

    } catch (e) {
        console.error("설정 로드 실패:", e);
        if (DOM.loadingSpinner) DOM.loadingSpinner.style.display = 'none'; 
    }

    displayCurrentDate();
    
    if (State.elapsedTimeTimer) clearInterval(State.elapsedTimeTimer);
    State.setElapsedTimeTimer(setInterval(updateElapsedTimes, 1000));

    if (State.periodicRefreshTimer) clearInterval(State.periodicRefreshTimer);
    State.setPeriodicRefreshTimer(setInterval(render, 30000));

    if (State.autoSaveTimer) clearInterval(State.autoSaveTimer);
    State.setAutoSaveTimer(setInterval(autoSaveProgress, State.AUTO_SAVE_INTERVAL));

    setupFirebaseListeners(render, markDataAsDirty);
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

    setupNotificationListeners();

    onAuthStateChanged(State.auth, async user => {
        if (user) {
            if (DOM.loginModal) DOM.loginModal.classList.add('hidden');
            await startAppAfterLogin(user);
        } else {
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