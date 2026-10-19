// === js/app-shell-bridge.js ===
// 페이지 → 공통 상단바(js/app-shell.js) 연결 창구. 의존성 없음 — 셸이 안 떠도(실패·미적용) 페이지는 그대로 돈다.
// ctx = { signedIn, uid?, email?, role?: 'admin'|'user', memberName?, menuConfig?: { dashboardMenu, memberMenuAccess, perm*… } }
//   menuConfig 는 js/lib/perm.js menuConfigOf(appConfig) 로 만든다(권한 계산에 쓰는 칸만).
//   menuConfig 를 주면 셸이 보이는 메뉴를 계산해 캐시하고, 안 주면(uid 만) 같은 uid 의 캐시를 쓴다.
//   memberName 을 주면 셸이 그 이름의 개인 알림을 구독한다(P2). 이름은 메모리에만 — 캐시(localStorage)에 넣지 않는다.

const MENU_CACHE_KEY = 'appShell.menu.v2';   // js/app-shell.js 와 같은 키(v2: 권한 개편 — 옛 기준 메뉴를 버린다)
const HOME = new URL('../index.html', import.meta.url).href;

export const setShellContext = (ctx) => {
    try {
        window.__appShellCtx = ctx || { signedIn: false };
        window.dispatchEvent(new CustomEvent('appshell:context'));
    } catch (e) { /* 셸 문제로 페이지를 멈추지 않는다 */ }
};

/** 다른 화면으로 가기 전에 부른다. fn 이 false 를 주면 이동 취소.
 *  ⚠️ 훅 안에서는 동기 confirm() 만 쓴다 — 페이지 모달(div[role=dialog]·data-act)을 띄우면 업무마감봇·업무예상알림이
 *     그 창을 자기 확인창으로 읽을 수 있다. Promise 를 돌려도 3초가 지나면 그냥 이동한다.
 *  저장처럼 '기다려야 하는' 일은 여기 말고 onBeforeLeaveSave 에 건다. */
export const onBeforeLeave = (fn) => {
    if (typeof fn !== 'function') return;
    (window.__appShellLeaveHooks = window.__appShellLeaveHooks || []).push(fn);
};

/** 이동 전 저장 — 확인 훅(onBeforeLeave)이 모두 통과한 뒤 셸이 부르고, 돌려준 Promise 를 최대 3초 기다린 뒤 이동한다.
 *  결과값은 보지 않는다(취소 못 함). 실패해도 이동한다. 저장할 것이 없으면 바로 끝나게 짤 것(dirty 확인). */
export const onBeforeLeaveSave = (fn) => {
    if (typeof fn !== 'function') return;
    (window.__appShellSaveHooks = window.__appShellSaveHooks || []).push(fn);
};

/** 이동 확인을 셸에서 이미 받았다는 표시 — 페이지의 beforeunload 경고가 한 번 더 묻지 않게 쓴다.
 *  셸이 확인 훅을 통과시킨 직후 세우고, 이동이 끝나지 않으면(같은 페이지에 남으면) 잠시 뒤 내린다. */
export const leaveAlreadyConfirmed = () => !!window.__appShellLeaveConfirmed;

export const goTo = (url) => {
    if (window.AppShell && typeof window.AppShell.navigate === 'function') return window.AppShell.navigate(url);
    location.assign(url);
};

/** 홈 — 셸이 있으면 셸의 goHome(대시보드가 연 창이면 그 창으로 돌아가고 이 창을 닫는다), 없으면 이 탭에서 이동. */
export const goHome = () => {
    if (window.AppShell && typeof window.AppShell.goHome === 'function') return window.AppShell.goHome();
    location.assign(HOME);
};

/** 로그아웃 때 — 다음 사람에게 앞 사람 메뉴가 보이지 않게 지운다. */
export const clearShellMenuCache = () => {
    try { localStorage.removeItem(MENU_CACHE_KEY); } catch (e) { /* 저장소 막힘 */ }
};
