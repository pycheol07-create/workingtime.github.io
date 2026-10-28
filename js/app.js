// === js/app.js ===
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { waitForPendingWrites } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { initializeFirebase, loadAppConfig, loadLeaveSchedule, loadPrivateConfig, applyPrivateConfig } from './config.js?v=202610281122';
import { displayCurrentDate, showToast } from './utils.js?v=202610281122';
import { renderDashboardLayout, renderRealtimeStatus, renderCompletedWorkLog, updateSummary, renderTaskAnalysis, renderTaskSelectionModal, applyDynamicSidebar } from './ui.js?v=202610281122';
import { initializeAppListeners } from './app-listeners.js?v=202610281122';
import * as DOM from './dom-elements.js?v=202610281122';
import * as State from './state.js?v=202610281122';
import { autoPauseForLunch, autoResumeFromLunch } from './app-logic.js?v=202610281122';
import { subscribeNotices, unsubscribeNotices } from './notice-logic.js?v=202610281122';

// ✅ 분리된 모듈 가져오기
import { updateElapsedTimes, autoSaveProgress, markDataAsDirty } from './app-lifecycle.js?v=202610281122';
import { setupNotificationListeners } from './app-notifications.js?v=202610281122';
import { setupFirebaseListeners, stopFirebaseListeners, whenTodayLoaded } from './app-sync.js?v=202610281122';
import { healYesterdayOnStartup } from './history-data-manager.js?v=202610281122';
import { initWorkCalendarWidget } from './widget-calendar.js?v=202610281122';
import { subscribeLeaveSchedule, unsubscribeLeaveSchedule } from './leave-schedule-sync.js?v=202610281122';
import { subscribeEzadmin, unsubscribeEzadmin } from './ezadmin-sync.js?v=202610281122';
import { subscribeIncomingSchedule, unsubscribeIncomingSchedule } from './widget-incoming-schedule.js?v=202610281122';
import { startSuppliesAlert, stopSuppliesAlert } from './supplies-alert-dash.js?v=202610281122';
import { setShellContext, clearShellMenuCache, onBeforeLeaveSave } from './app-shell-bridge.js?v=202610281122';
import { parseOpenHash } from './app-shell-data.js?v=202610281122';
import { resolve as resolvePerm, can, menuConfigOf } from './lib/perm.js?v=202610281122';

// 이 모듈은 대시보드(index)와 데이터 관리(history.html)가 함께 쓴다. 대시보드에서만 할 일은 이것으로 가른다.
const IS_DASHBOARD = !!(document.body && document.body.dataset.shell === 'index');

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

        // 퇴사자는 여기서 막는다.
        // 권한 목록에서 빼고 메뉴 접근을 해제해도 사이드바만 비질 뿐이다.
        // 출퇴근 토글·업무보드는 nav 밖에 있고, 하위 페이지는 주소를 직접 치면 열린다.
        // ※ 완전한 차단은 Firebase Authentication 에서 계정을 비활성화해야 한다
        //    (브라우저 코드는 우회가 가능하다).
        if ((State.appConfig.resignedMembers || {})[currentUserName]) {
            showToast('퇴사 처리된 계정입니다. 관리자에게 문의하세요.', true);
            State.auth.signOut();
            return;
        }

        // 🔒 급여·원가는 관리자 전용 저장소에서 관리자만 받는다(일반 직원은 요청도 하지 않는다).
        if (currentUserRole === 'admin') {
            try {
                applyPrivateConfig(State.appConfig, await loadPrivateConfig(State.db));
            } catch (e) {
                // 조용히 넘기면 인건비·원가가 0(또는 알바 시급)으로 계산된 리포트가 정상처럼 보인다.
                console.warn('급여·원가 불러오기 실패:', e && e.code);
                showToast('급여·원가를 불러오지 못했습니다. 인건비·원가 숫자가 틀리게 보일 수 있으니 새로고침해 주세요.', true);
            }
        }

        State.appState.currentUser = currentUserName;
        State.appState.currentUserRole = currentUserRole;
        // 기능 권한(권한 개편) — 메뉴·업무 마감·이력 수정 문지기가 이 값 하나로 판정한다. 관리자 = 전체.
        State.appState.perm = resolvePerm(State.appConfig, userEmail, { role: currentUserRole });

        // UI 토글 (Admin vs User) - 기존 로직 유지
        if (DOM.userGreeting) {
            DOM.userGreeting.textContent = `${currentUserName}님 (${currentUserRole}), 안녕하세요.`;
            DOM.userGreeting.classList.remove('hidden');
        }
        // PC·모바일 로그아웃 버튼을 함께 켠다.
        // (모바일 쪽을 빠뜨려 hidden 이 그대로 남아 버튼이 아예 보이지 않았다)
        if (DOM.logoutBtn) DOM.logoutBtn.classList.remove('hidden');
        if (DOM.logoutBtnMobile) DOM.logoutBtnMobile.classList.remove('hidden');

        // 관리자용 UI — 관리자 링크·초기화는 관리자만, 데이터 관리·업무 마감은 기능 권한으로(사이드바와 같은 기준).
        // 🏁 업무 마감 한 번이 전 직원 퇴근시각을 확정하고 그날 원본을 지운다(관리자 = 전체 기능이라 관리자는 그대로 보인다).
        // ⚠️ style.display 'flex'|'none' 방식은 바꾸지 않는다 — 업무마감봇이 #end-shift-btn 의 computed display 로 관리자 여부를 본다.
        const showIf = (els, on) => els.forEach(el => { if (el) el.style.display = on ? 'flex' : 'none'; });
        showIf([document.getElementById('admin-link-btn'), DOM.adminLinkBtnMobile, DOM.resetAppBtn, DOM.resetAppBtnMobile], currentUserRole === 'admin');
        showIf([DOM.openHistoryBtn, DOM.openHistoryBtnMobile], can(State.appState.perm, 'data.view'));
        showIf([DOM.endShiftBtn, DOM.endShiftBtnMobile], can(State.appState.perm, 'dash.endShift'));

        // 메인 영역 노출
        document.getElementById('main-content-area')?.classList.remove('hidden');

        if (DOM.loadingSpinner) DOM.loadingSpinner.style.display = 'none'; 
        
        // ✨ 신규: 관리자 권한 UI가 세팅된 직후, 메뉴 순서를 동적으로 재배치합니다.
        applyDynamicSidebar(State.appConfig);

        // 공통 상단바(js/app-shell.js)에 로그인 상태·메뉴 설정을 넘긴다 — 다른 화면 메뉴는 여기서 채운 캐시를 쓴다.
        // memberName 은 셸 개인 알림 구독용(데이터 관리 화면) — 셸은 이름을 메모리에만 두고 캐시에 넣지 않는다.
        setShellContext({
            signedIn: true, uid: user.uid, email: userEmail, role: currentUserRole, memberName: currentUserName,
            menuConfig: menuConfigOf(State.appConfig)
        });

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
    // 숨겨진 탭은 다시 그리지 않는다(보이게 되면 main() 의 visibilitychange 가 바로 그린다)
    State.setPeriodicRefreshTimer(setInterval(() => { if (!document.hidden) render(); }, 30000));

    if (State.autoSaveTimer) clearInterval(State.autoSaveTimer);
    State.setAutoSaveTimer(setInterval(autoSaveProgress, State.AUTO_SAVE_INTERVAL));

    // ✅ 2. Firebase 실시간 동기화 리스너 실행 (분리된 파일 호출)
    setupFirebaseListeners(render, markDataAsDirty);

    // 🩺 3. 어제 업무기록이 이력에 없으면 자동 복구 (관리자 세션, 하루 1회)
    if (State.appState.currentUserRole === 'admin') {
        healYesterdayOnStartup().catch(e => console.warn('자가복구 건너뜀:', e));
    }

    // 🗓️ 4. 업무 캘린더 위젯 (근태 예정·입고일정 연동 + 일정 등록/수정/삭제)
    initWorkCalendarWidget().catch(e => console.warn('업무 캘린더 초기화 실패:', e));

    // 🔗 5. 근태(연차) 일정 실시간 구독 — 어느 화면에서 바뀌든(다른 사용자 포함)
    //        대시보드 근태예정 위젯·업무 캘린더·내 연차관리가 함께 갱신된다.
    subscribeLeaveSchedule();
    subscribeEzadmin();
    // 🚚 6. 입고일정 — 시트 Apps Script 가 1시간마다 쓰는 문서를 구독 (로그인해야 읽힌다)
    subscribeIncomingSchedule();
    // 📢 7. 중요 알림(공지) — 로그인해야 읽힌다
    subscribeNotices();
    // 📦 8. 비품 발주 알림(발주 권장일 5일 이내) — 대시보드에서 비품 관리 권한이 있을 때만 구독한다
    startSuppliesAlert();
}

// ── 다른 화면에서 대시보드의 창을 열어 달라는 주소(#open=quantity|leave|noti) — UI 1단계 1b ──
// 공통 상단바 메뉴('오늘 처리량 입력'·'내 연차관리')와 알림 종이 index.html#open=… 으로 온다.
// 기존 버튼을 눌러 여는 것과 같은 길로 연다 — 메뉴 권한으로 사이드바에서 빠진 버튼(연결이 끊긴 버튼)이면 열지 않는다.
// 봇(업무마감봇·업무예상알림)은 해시 없이 열기 때문에 여기 걸리지 않는다.
async function handleOpenHash() {
    if (!IS_DASHBOARD) return;
    const what = parseOpenHash(location.hash);
    if (!what) return;
    // 해시는 먼저 지운다 — 새로고침·뒤로가기로 같은 창이 또 열리지 않게
    try { history.replaceState(history.state, '', location.pathname + location.search); } catch (e) { /* 무시 */ }
    if (!State.appState.currentUser) return;
    const pick = (...els) => els.find(el => el && el.isConnected);
    if (what === 'quantity') {
        // 오늘 숫자가 들어오기 전에 열면 빈 칸으로 그려져, 그대로 저장하면 다른 사람이 넣은 처리량을 덮는다 — 첫 스냅샷까지 기다린다.
        const ok = await Promise.race([whenTodayLoaded().then(() => true), new Promise(r => setTimeout(() => r(false), 15000))]);
        if (!ok) { showToast('오늘 데이터를 아직 받지 못해 처리량 입력 창을 열지 않았습니다. 사이드바에서 다시 눌러 주세요.', true); return; }
        const btn = pick(DOM.openQuantityModalTodayBtn, DOM.openQuantityModalTodayBtnMobile);
        if (btn) btn.click();
    } else if (what === 'leave') {
        const btn = pick(DOM.openMyLeaveBtn, DOM.openMyLeaveBtnMobile);
        if (btn) btn.click();
    } else if (what === 'noti') {
        const modal = document.getElementById('notification-modal');
        const bell = pick(document.getElementById('notification-bell-btn'), document.getElementById('notification-bell-btn-mobile'));
        if (modal && modal.classList.contains('hidden') && bell) bell.click();
    }
}

// ── 이동 전 저장 — UI 1단계 1b(같은 탭 이동) ──
// 메뉴로 다른 화면에 가면 이 탭이 닫히는 것과 같다. 1분 자동저장을 기다리지 않고 바뀐 것(dirty)만 바로 쓰고,
// 아직 서버에 안 간 쓰기(처리량 저장 등 — 오프라인·느린 네트워크)가 다 갈 때까지 기다린다(waitForPendingWrites).
// 공통 상단바가 이동 전에 기다려 주고(최대 3초 — 넘기면 상단바가 동기 confirm 으로 묻는다), 탭을 숨기거나 닫을 때도 한 번 더 시도한다.
let leaveSaving = null;
const saveBeforeLeave = () => {
    if (!leaveSaving) {
        leaveSaving = (async () => {
            if (State.isDataDirty) {
                try { await autoSaveProgress(); } catch (e) { console.warn('이동 전 저장 실패:', e && e.code); }
            }
            if (State.db) await waitForPendingWrites(State.db);
        })()
            .catch(e => console.warn('이동 전 저장 확인 실패:', e && e.code))
            .finally(() => { leaveSaving = null; });
    }
    return leaveSaving;
};

async function main() {
    onBeforeLeaveSave(saveBeforeLeave);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') saveBeforeLeave();
        // 숨겨진 동안 30초 주기 그리기를 건너뛰었으니 보이게 되면 바로 한 번 그린다(로그인해 주기가 돌고 있을 때만)
        else if (document.visibilityState === 'visible' && State.periodicRefreshTimer) render();
    });
    window.addEventListener('pagehide', () => { saveBeforeLeave(); });
    if (IS_DASHBOARD) {
        // 뒤로가기로 돌아온 대시보드가 멈춰 있던 화면(bfcache)이면 실시간 구독 상태를 믿을 수 없다 — 새로 연다.
        window.addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });
        // 대시보드에 있는 채로 #open= 주소가 바뀌어도 연다
        window.addEventListener('hashchange', () => { handleOpenHash(); });
    }
    if (DOM.loadingSpinner) DOM.loadingSpinner.style.display = 'block'; 

    try {
        const firebase = initializeFirebase();
        State.setDb(firebase.db);
        State.setAuth(firebase.auth);
    } catch (e) {
        return;
    }

    // ✅ 3. 알림 이벤트 리스너 세팅
    setupNotificationListeners();

    onAuthStateChanged(State.auth, async user => {
        if (user) {
            if (DOM.loginModal) DOM.loginModal.classList.add('hidden');
            await startAppAfterLogin(user);
            handleOpenHash();
        } else {
            // 로그아웃 초기화
            if (State.unsubscribeToday) State.unsubscribeToday();
            if (State.unsubscribeWorkRecords) State.unsubscribeWorkRecords();
            stopFirebaseListeners();       // 알림 등 구독 해제 + 초기화 잠금 풀기(다음 사람이 새로 구독)
            unsubscribeLeaveSchedule();
            unsubscribeEzadmin();
            unsubscribeIncomingSchedule();
            unsubscribeNotices();
            stopSuppliesAlert();

            State.appState.workRecords = [];
            State.appState.importantNotices = [];
            State.appState.notifications = [];   // 앞 사람 알림이 다음 사람 화면에 남지 않게
            document.querySelectorAll('.notification-badge').forEach(el => el.classList.add('hidden'));
            document.getElementById('notification-modal')?.classList.add('hidden');
            State.appState.currentUser = null;
            clearShellMenuCache();          // 다음 사람에게 앞 사람 메뉴가 남지 않게
            setShellContext({ signedIn: false });
            if (DOM.loginModal) DOM.loginModal.classList.remove('hidden');
        }
    });

    initializeAppListeners();
}

main();