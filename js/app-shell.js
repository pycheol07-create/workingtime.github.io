// === js/app-shell.js ===
// 공통 상단바 + 메뉴 서랍 (UI 1단계 1a, 2026-10-16). <script type="module" src="js/app-shell.js?v=202611130915"> 로 붙이면 스스로 돈다.
//   <body data-shell="페이지ID">              → 위쪽에 바를 얹는다(css/app-shell.css 가 본문을 그만큼 내린다)
//   <body data-shell="index" data-shell-bar="off"> → 바 없이 메뉴 캐시만 채운다(대시보드)
// 페이지는 js/app-shell-bridge.js 의 setShellContext 로 로그인 상태를 알려 준다.
//
// ⚠️ 봇 안전(업무마감봇·업무예상알림이 index/history 를 Playwright 로 연다):
//    - 그리는 것은 전부 섀도 DOM 안. 바깥 문서에는 사용자 정의 태그(app-shell-bar / app-shell-overlay / app-shell-noti-pop 등) 하나씩만 붙는다.
//    - div[role=dialog]·[data-act]·봇이 읽는 id 를 쓰지 않는다. 메뉴 서랍은 열 때 만들고 닫을 때 없앤다.
// ⚠️ 절대경로('/js/…') 금지 — calculator/ 하위 폴더와 GitHub Pages 하위 경로에서도 맞도록 이 파일 위치 기준으로 계산한다.
// 1b(2026-10-16): 메뉴·홈은 같은 탭 이동(app-shell-data.js SHELL_OPEN_MODE). 페이지 안 앱 링크도 이동 전 저장 훅을 거친다.
// P2(2026-10-16): 바에 개인 알림 종(안 읽은 수) + 새 알림 토스트(js/app-shell-noti.js 를 늦게 불러 구독).
//   2026-10-22: 토스트 대신 가운데 알림 팝업 — 안 읽고 이 탭에서 닫지 않은 알림이 있으면 첫 화면에서도 뜬다(js/lib/noti-popup.js).
//   [확인] = 읽음 표시 · [나중에]/Esc = 이 탭에서 다시 안 띄움 · [알림센터] = 알림창. 봇(navigator.webdriver)에서는 띄우지 않는다.
//   2026-11-11: 종·[알림센터]는 대시보드로 가지 않고 지금 화면에서 알림창(app-shell-noti-panel — 목록·읽음·삭제)을 연다.
//   쪽지 보내기만 대시보드(NOTI_LINK). 이동 링크가 있는 알림(비품·기안서 — js/lib/noti-popup.js notiLink)은 눌러서 바로 간다.
// 1d(2026-10-16): Ctrl+K(⌘K) 빠른 이동 — 바의 [검색] 버튼·대시보드의 [data-shell-search] 버튼도 같다.
//   메뉴 이름 + 그 화면 안 탭(app-shell-data.js SUB_DESTINATIONS) + 홈. 같은 화면 안 이동은 해시 이동(뒤로가기로 되돌림),
//   다른 화면은 navigate(이동 전 저장 훅). 팔레트도 섀도 DOM 안, 열 때 만들고 닫을 때 없앤다.

import { visibleMenuFor } from './menu-catalog.js?v=202611130915';
import { PAGE_DEFAULTS, HOME_FILE, resolveMenuGroups, absUrl, pageFileOf, currentTitle, shellLinkTarget, buildDestinations, menuLabel } from './app-shell-data.js?v=202611130915';
import { rank } from './hangul-search.js?v=202611130915';
import { isAutomation, loadDismissed, addDismissed, pickPopup, findOpenModal, notiLink, notiLinkLabel, sortUnreadFirst } from './lib/noti-popup.js?v=202611130915';

const BASE = new URL('../', import.meta.url).href;      // 앱 폴더(js/ 의 부모)
const MENU_CACHE_KEY = 'appShell.menu.v2';              // js/app-shell-bridge.js 와 같은 키(v2: 권한 개편)
const LEAVE_HOOK_TIMEOUT = 3000;
// 개인 알림 — 대시보드는 자체 구현(js/app-sync.js), 스캐너는 별도 앱(scanApp).
//   계산기는 Firebase(calculator/firebase-init.js)를 쓰지만 상단바에 uid 만 넘기고 memberName 은 넘기지 않는다(logis-defaults.js)
//   → 여기서 빼도 알림은 켜지지 않는다. 켜려면 계산기가 memberName 을 찾아 넘겨야 한다(직원 목록 읽기 추가).
const NOTI_OFF_PAGES = ['index', 'scan', 'calculator'];
const NOTI_DELAY = 2500;            // 페이지가 첫 화면을 그리고 난 뒤에 구독한다
const NOTI_LINK = 'index.html#open=noti';
const POP_WAIT_STEP = 1000;            // 다른 창이 떠 있으면 1초마다 보고
const POP_READ_WAIT = 1500;            // 알림을 눌러 이동할 때 읽음 표시를 기다리는 최대 시간
const POP_WAIT_MAX = 30 * 60 * 1000;   // 30분 넘게 막히면 그만 기다린다(다음 알림 변경 때 다시 본다)

const 선 = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON_MENU = 선('<path d="M4 6h16M4 12h16M4 18h16"/>');
const ICON_HOME = 선('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>');
const ICON_CLOSE = 선('<path d="M6 6l12 12M18 6L6 18"/>');
const ICON_BELL = 선('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>');
const ICON_SEARCH = 선('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>');
const PALETTE_MAX = 60;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 색은 페이지 테마와 상관없이 고정(css/d-theme.css·dash-d.css 값 사본). 다크는 html.dark 를 따라간다.
const TOKENS = `
:host {
    --as-bg: #FFFFFF; --as-surface-2: #F7F8FA; --as-line: #E6E8EC; --as-line-strong: #D6DAE0;
    --as-text: #23272E; --as-text-2: #646B75; --as-text-3: #69707A;
    --as-accent: #2F62C9; --as-accent-deep: #1E4699; --as-accent-soft: #EAF0FD;
    --as-scrim: rgba(30,40,60,.40); --as-shadow: 0 8px 24px rgba(30,40,60,.18);
    --as-font: 'SUIT', 'Noto Sans KR', 'Malgun Gothic', system-ui, sans-serif;
}
:host([data-theme="dark"]) {
    --as-bg: #1A1E24; --as-surface-2: #20252C; --as-line: #2C323A; --as-line-strong: #3A414B;
    --as-text: #E6E8EC; --as-text-2: #A9B0BA; --as-text-3: #7D8590;
    --as-accent: #6E95E6; --as-accent-deep: #A9C1F2; --as-accent-soft: rgba(110,149,230,.18);
    --as-scrim: rgba(0,0,0,.55); --as-shadow: 0 8px 24px rgba(0,0,0,.5);
}`;

const BAR_CSS = `${TOKENS}
:host {
    all: initial; display: block; position: fixed; left: 0; right: 0; top: var(--as-top, 0px);
    height: var(--as-bar, 40px); z-index: 40; box-sizing: border-box;
    font-family: var(--as-font); font-size: 14px; line-height: 1.4; color: var(--as-text);
    -webkit-text-size-adjust: 100%;
}
* { box-sizing: border-box; }
.bar { height: 100%; display: flex; align-items: center; gap: 4px; padding: 0 10px;
       background: var(--as-bg); border-bottom: 1px solid var(--as-line); }
.btn { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; flex: none;
       padding: 0; border: 0; border-radius: 8px; background: transparent; color: var(--as-text-2);
       cursor: pointer; text-decoration: none; font: inherit; }
.btn:hover { background: var(--as-surface-2); color: var(--as-text); }
.btn:focus-visible, a:focus-visible { outline: 2px solid var(--as-accent); outline-offset: 1px; }
.crumb { display: flex; align-items: center; gap: 6px; min-width: 0; margin-left: 4px; white-space: nowrap; }
.brand { color: var(--as-text-3); font-weight: 500; }
.sep { color: var(--as-text-3); }
.cur { color: var(--as-text); font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
.spacer { flex: 1 1 auto; }
.state { font-size: 12px; color: var(--as-text-3); padding: 0 4px; white-space: nowrap; }
.bell { position: relative; }
.count { position: absolute; top: 2px; right: 0; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px;
         background: #C8443C; color: #FFFFFF; font-size: 10.5px; font-weight: 700; line-height: 16px; text-align: center; }
[hidden] { display: none !important; }
@media (max-width: 767px) {
    .bar { padding: 0 6px; }
    .btn { width: 36px; height: 36px; }
    .brand, .sep { display: none; }
    .cur { font-size: 15px; }
}`;

const OVERLAY_CSS = `${TOKENS}
:host { all: initial; position: fixed; inset: 0; z-index: 2147483000; display: block;
        font-family: var(--as-font); font-size: 14px; line-height: 1.4; color: var(--as-text); }
* { box-sizing: border-box; }
.scrim { position: absolute; inset: 0; background: var(--as-scrim); }
nav { position: absolute; top: var(--as-top, 0px); bottom: 0; left: 0; width: 288px; max-width: 86vw; display: flex; flex-direction: column;
      background: var(--as-bg); border-right: 1px solid var(--as-line); box-shadow: var(--as-shadow); }
.head { display: flex; align-items: center; justify-content: space-between; height: 48px; padding: 0 8px 0 16px;
        border-bottom: 1px solid var(--as-line); flex: none; }
.head b { font-size: 15px; font-weight: 600; }
.btn { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 0; border: 0;
       border-radius: 8px; background: transparent; color: var(--as-text-2); cursor: pointer; font: inherit; }
.btn:hover { background: var(--as-surface-2); color: var(--as-text); }
.list { flex: 1 1 auto; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 8px 10px 16px; }
.cat { margin: 14px 8px 4px; font-size: 11.5px; font-weight: 600; color: var(--as-text-3); letter-spacing: .02em; }
.item { display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 8px 10px; border-radius: 10px;
        color: var(--as-text); text-decoration: none; font-weight: 500; }
.item:hover { background: var(--as-surface-2); }
.item[aria-current="page"] { background: var(--as-accent-soft); color: var(--as-accent-deep); font-weight: 600; }
.item svg { color: var(--as-text-3); flex: none; }
.btn:focus-visible, a:focus-visible { outline: 2px solid var(--as-accent); outline-offset: -2px; }
.note { margin: 12px 8px 0; font-size: 12px; color: var(--as-text-3); line-height: 1.6; }`;

// 안 읽은 알림 팝업 — 띄울 때 만들고 닫을 때 없앤다. role=alertdialog 의 section(섀도 안) — 봇이 찾는 div[role=dialog]·[data-act] 와 겹치지 않게.
const POP_CSS = `${TOKENS}
:host { all: initial; position: fixed; inset: 0; z-index: 2147483000; display: block;
        font-family: var(--as-font); font-size: 14px; line-height: 1.45; color: var(--as-text); }
* { box-sizing: border-box; }
.scrim { position: absolute; inset: 0; background: var(--as-scrim); }
.panel { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
         width: min(420px, calc(100vw - 24px)); max-height: 80vh; max-height: 80dvh; display: flex; flex-direction: column;
         background: var(--as-bg); border: 1px solid var(--as-line-strong); border-radius: 14px; box-shadow: var(--as-shadow); overflow: hidden; }
header { display: flex; align-items: center; gap: 8px; padding: 14px 16px; border-bottom: 1px solid var(--as-line); flex: none; color: var(--as-accent); }
h2 { margin: 0; font-size: 16px; font-weight: 700; color: var(--as-text); }
ul { list-style: none; margin: 0; padding: 10px 12px; overflow-y: auto; flex: 1 1 auto; min-height: 0;
     -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
li { padding: 10px 12px; border-radius: 10px; border: 1px solid var(--as-line); border-left: 4px solid var(--as-accent); background: var(--as-accent-soft); }
li + li { margin-top: 8px; }
time { display: block; margin-bottom: 3px; font-size: 11.5px; font-weight: 600; color: var(--as-text-2); }
p { margin: 0; font-weight: 500; white-space: pre-line; overflow-wrap: anywhere; }
.acts { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--as-line); background: var(--as-bg); flex: none; }
.b { flex: 1 1 0; min-width: 0; min-height: 42px; display: inline-flex; align-items: center; justify-content: center; padding: 0 10px;
     border: 1px solid var(--as-line-strong); border-radius: 10px; background: var(--as-bg); color: var(--as-text);
     font: inherit; font-weight: 600; text-decoration: none; white-space: nowrap; cursor: pointer; }
.b:hover { background: var(--as-surface-2); }
.b.ok { background: var(--as-accent); border-color: var(--as-accent); color: #FFFFFF; }
.b.ok:hover { background: var(--as-accent-deep); border-color: var(--as-accent-deep); }
:host([data-theme="dark"]) .b.ok { color: #10141A; }
.b:disabled { opacity: .6; cursor: default; }
.b:focus-visible { outline: 2px solid var(--as-accent); outline-offset: 2px; }
.b.go { display: flex; margin-top: 8px; min-height: 38px; color: var(--as-accent-deep); }`;

// 알림창(2026-11-11) — 종·[알림센터]로 연다. 팝업과 같은 틀 + 읽은 알림·삭제. 열 때 만들고 닫을 때 없앤다.
const PANEL_CSS = `${POP_CSS}
.panel { width: min(460px, calc(100vw - 24px)); }
h2 { flex: 1 1 auto; }
.x { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0; border: 0;
     border-radius: 8px; background: transparent; color: var(--as-text-2); cursor: pointer; font: inherit; }
.x:hover { background: var(--as-surface-2); color: var(--as-text); }
.x:focus-visible { outline: 2px solid var(--as-accent); outline-offset: 1px; }
li { position: relative; padding-right: 40px; }
li.read { background: var(--as-surface-2); border-left-color: var(--as-line-strong); color: var(--as-text-2); }
li.read p { font-weight: 400; }
li .x { position: absolute; top: 4px; right: 4px; width: 30px; height: 30px; }
.new { display: inline-block; margin-right: 6px; padding: 0 5px; border-radius: 4px; background: var(--as-accent); color: #FFFFFF;
       font-size: 10px; font-weight: 800; vertical-align: 1px; }
:host([data-theme="dark"]) .new { color: #10141A; }
.empty { padding: 28px 8px; border: 0; background: transparent; text-align: center; color: var(--as-text-3); }
.b.msg { flex: 0 1 auto; color: var(--as-text-2); font-weight: 500; }`;

// Ctrl+K 빠른 이동 — 열 때 만들고 닫을 때 없앤다. role=dialog·data-act·id 를 바깥 문서에 만들지 않는다(섀도 안).
const PALETTE_CSS = `${TOKENS}
:host { all: initial; position: fixed; inset: 0; z-index: 2147483000; display: block;
        font-family: var(--as-font); font-size: 14px; line-height: 1.4; color: var(--as-text); }
* { box-sizing: border-box; }
.scrim { position: absolute; inset: 0; background: var(--as-scrim); }
.panel { position: absolute; left: 50%; top: calc(var(--as-top, 0px) + 12vh); transform: translateX(-50%);
         width: 560px; max-width: calc(100vw - 24px); max-height: 70vh; display: flex; flex-direction: column;
         background: var(--as-bg); border: 1px solid var(--as-line-strong); border-radius: 14px; box-shadow: var(--as-shadow); overflow: hidden; }
.search { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--as-line); color: var(--as-text-3); flex: none; }
input { flex: 1 1 auto; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--as-text);
        font: inherit; font-size: 16px; padding: 8px 2px; }
input::placeholder { color: var(--as-text-3); }
kbd { font: inherit; font-size: 11px; color: var(--as-text-3); border: 1px solid var(--as-line-strong); border-radius: 6px; padding: 1px 6px; }
ul { list-style: none; margin: 0; padding: 6px; overflow-y: auto; -webkit-overflow-scrolling: touch; }
li { display: flex; align-items: baseline; gap: 10px; min-height: 38px; padding: 9px 10px; border-radius: 10px; cursor: pointer; }
li .l { font-weight: 500; }
li .p { margin-left: auto; padding-left: 12px; font-size: 12px; color: var(--as-text-3); white-space: nowrap; }
li:hover { background: var(--as-surface-2); }
li[aria-selected="true"] { background: var(--as-accent-soft); color: var(--as-accent-deep); }
li[aria-selected="true"] .l { font-weight: 600; }
.empty { padding: 14px 12px; color: var(--as-text-3); }
@media (max-width: 767px) {
    .panel { top: calc(var(--as-top, 0px) + 8px); max-height: calc(100vh - 16px - var(--as-top, 0px)); }
    kbd { display: none; }
}`;

function readCache() {
    try {
        const c = JSON.parse(localStorage.getItem(MENU_CACHE_KEY) || 'null');
        if (c && typeof c.uid === 'string' && Array.isArray(c.groups)) return c;
    } catch (e) { /* 깨진 값·저장소 막힘 */ }
    return null;
}
function writeCache(obj) {
    try { localStorage.setItem(MENU_CACHE_KEY, JSON.stringify(obj)); } catch (e) { /* 저장소 막힘 — 이번 화면만 */ }
}

function start() {
    const body = document.body;
    const pageId = body && body.dataset.shell;
    if (!pageId) return;
    const barOff = body.dataset.shellBar === 'off';
    const pageFile = pageFileOf(location.href, BASE) || (PAGE_DEFAULTS[pageId] && PAGE_DEFAULTS[pageId].file);

    // ── 상태: signedIn = null(아직 모름) | true | false ──
    let signedIn = null;
    let groups = (readCache() || {}).groups || [];   // 컨텍스트가 오기 전·안 오는 페이지(계산기)는 캐시로
    groups = resolveMenuGroups(groups, BASE);
    // 로그인 확인이 없는 화면(계산기 — <body data-shell-ctx="none">)은 캐시 메뉴를 그대로 보여 준다
    const noCtxPage = body.dataset.shellCtx === 'none';
    // 개인 알림 상태(P2) — renderBar 가 처음부터 쓰므로 여기서 먼저 만든다
    let popHost = null, popPrev = null, popIds = [], popWait = null;
    let panelHost = null, panelPrev = null, panelShown = [], panelBusy = false;   // 알림창(2026-11-11)
    const noti = { name: null, timer: null, unsub: null, unread: 0, items: [], all: [], markRead: null, deleteNotis: null };
    // 빠른 이동(1d)의 관리자 전용 목적지용 — 컨텍스트의 role, 없으면 같은 uid 캐시의 role
    let role = noCtxPage ? ((readCache() || {}).role || null) : null;

    const applyCtx = (ctx) => {
        if (!ctx) return;
        if (!ctx.signedIn) {
            signedIn = false;
            groups = [];
            role = null;
        } else {
            signedIn = true;
            const c0 = readCache();
            role = (ctx.role === 'admin' || ctx.role === 'user') ? ctx.role
                : ((c0 && ctx.uid && c0.uid === ctx.uid) ? (c0.role || null) : null);
            // role·메뉴 목록이 없으면(설정을 못 읽었거나 저장된 메뉴가 없는 원본 문서) 계산하지 않고 캐시를 쓴다
            // — 빈 메뉴·다른 메뉴로 캐시를 덮지 않게. (대시보드는 config.js 기본 메뉴까지 합쳐서 넘긴다)
            const mc = ctx.menuConfig;
            if (mc && Array.isArray(mc.dashboardMenu) && mc.dashboardMenu.length && (ctx.role === 'admin' || ctx.role === 'user')) {
                const g = resolveMenuGroups(visibleMenuFor(ctx.menuConfig, ctx.email, ctx.role), BASE);
                // '보이는 메뉴'만 저장한다 — memberMenuAccess(전 직원 이메일) 원본은 남기지 않는다.
                if (ctx.uid) writeCache({ uid: ctx.uid, role: ctx.role, groups: g, at: Date.now() });
                groups = g;
            } else {
                const c = readCache();
                groups = (c && ctx.uid && c.uid === ctx.uid) ? resolveMenuGroups(c.groups, BASE) : [];
            }
        }
        renderBar();
        syncNoti(ctx);
    };

    // ── 바 ──
    let barHost = null, barRoot = null;
    const syncTheme = () => {
        const dark = document.documentElement.classList.contains('dark');
        [barHost, overlayHost, popHost, paletteHost, panelHost].forEach(h => { if (h) { if (dark) h.setAttribute('data-theme', 'dark'); else h.removeAttribute('data-theme'); } });
    };

    function renderBar() {
        if (!barRoot) return;
        const title = currentTitle(pageId, groups, pageFile);
        barRoot.querySelector('.cur').textContent = title;
        // 확인 중(null)·로그아웃이면 메뉴 버튼을 숨긴다(앞 사람 캐시 메뉴가 잠깐 보이지 않게). 계산기는 예외.
        barRoot.querySelector('.menu').hidden = !(signedIn === true || (noCtxPage && signedIn === null));
        barRoot.querySelector('.state').hidden = signedIn !== false;
        renderBell();
    }

    if (!barOff) {
        barHost = document.createElement('app-shell-bar');
        barRoot = barHost.attachShadow({ mode: 'open' });
        barRoot.innerHTML = `<style>${BAR_CSS}</style>
            <div class="bar">
                <button type="button" class="btn menu" aria-label="메뉴 열기" aria-expanded="false" title="메뉴">${ICON_MENU}</button>
                <a class="btn home js-home" href="${esc(absUrl(HOME_FILE, BASE))}" aria-label="홈으로" title="홈(대시보드)">${ICON_HOME}</a>
                <div class="crumb"><span class="brand">물류팀 업무관리</span><span class="sep">›</span><span class="cur"></span></div>
                <span class="spacer"></span>
                <button type="button" class="btn search" aria-label="빠른 이동 (Ctrl+K)" title="빠른 이동 (Ctrl+K)">${ICON_SEARCH}</button>
                <button type="button" class="btn bell" aria-label="알림" aria-haspopup="dialog" title="알림" hidden>${ICON_BELL}<span class="count" hidden></span></button>
                <span class="state" hidden>로그인 안 됨</span>
            </div>`;
        barRoot.querySelector('.menu').addEventListener('click', () => openMenu());
        barRoot.querySelector('.search').addEventListener('click', () => openPalette());
        barRoot.querySelector('.bell').addEventListener('click', () => { if (panelHost) closePanel(); else openPanel(); });
        barRoot.addEventListener('click', interceptLink);
        body.appendChild(barHost);
        renderBar();

        // 🧪 에뮬레이터 띠(js/firebase-emulator.js)가 있으면 바를 그 아래로 내린다(css/app-shell.css html.as-emu).
        const markEmu = () => {
            if (!document.getElementById('emulator-banner')) return false;
            document.documentElement.classList.add('as-emu');
            return true;
        };
        if (!markEmu()) {
            const mo = new MutationObserver(() => { if (markEmu()) mo.disconnect(); });
            mo.observe(body, { childList: true });
        }
    }

    // ── 개인 알림 (P2) ── 페이지가 memberName 을 준 경우에만. 이름은 이 함수 안 메모리에만 둔다(상태는 위 noti).
    function renderBell() {
        if (!barRoot) return;
        const bell = barRoot.querySelector('.bell');
        const cnt = barRoot.querySelector('.count');
        const on = !!noti.unsub && signedIn === true;
        bell.hidden = !on;
        cnt.hidden = !(on && noti.unread > 0);
        cnt.textContent = noti.unread > 99 ? '99+' : String(noti.unread);
        bell.setAttribute('aria-label', on && noti.unread > 0 ? `알림 ${noti.unread}건 안 읽음` : '알림');
    }

    function stopNoti() {
        if (noti.timer) { clearTimeout(noti.timer); noti.timer = null; }
        if (noti.unsub) { try { noti.unsub(); } catch (e) { /* 무시 */ } noti.unsub = null; }
        noti.name = null;
        noti.unread = 0;
        noti.items = [];
        noti.all = [];
        noti.markRead = null;
        noti.deleteNotis = null;
        closePop(false);
        closePanel(false);
        renderBell();
    }

    function syncNoti(ctx) {
        const want = (!barOff && !NOTI_OFF_PAGES.includes(pageId) && ctx && ctx.signedIn === true
            && typeof ctx.memberName === 'string' && ctx.memberName) ? ctx.memberName : null;
        if (want === noti.name) return;
        stopNoti();
        if (!want) return;
        noti.name = want;
        noti.timer = setTimeout(async () => {
            noti.timer = null;
            try {
                const { watchNotifications, markRead, deleteNotis } = await import('./app-shell-noti.js?v=202611130915');
                if (noti.name !== want) return;   // 그 사이 로그아웃·다른 사람
                noti.markRead = markRead;
                noti.deleteNotis = deleteNotis;
                // 알림 목록은 이 메모리에만 둔다(로그·저장소에 남기지 않는다). 첫 스냅샷·새 알림 모두 팝업을 다시 본다.
                const unsub = watchNotifications(want, {
                    onCount: (n, items, meta) => {
                        noti.unread = n;
                        noti.items = Array.isArray(items) ? items : [];
                        noti.all = meta && Array.isArray(meta.all) ? meta.all : noti.items;
                        renderBell();
                        renderPanel();
                        refreshPop();
                    }
                });
                if (!unsub) return;
                if (noti.name !== want) { unsub(); return; }
                noti.unsub = unsub;
                renderBell();
            } catch (e) {
                console.warn('[app-shell] 알림을 받지 못합니다(페이지는 그대로 씁니다):', e && e.message);
            }
        }, NOTI_DELAY);
    }

    // ── 안 읽은 알림 팝업 (2026-10-22) ── 띄울 때 만들고 닫을 때 없앤다. 알림 내용은 화면에만(esc), 로그 X.
    const popTime = (iso) => {
        const t = new Date(iso);
        return Number.isNaN(t.getTime()) ? '' : t.toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    function stopPopWait() {
        if (popWait) { clearInterval(popWait); popWait = null; }
    }

    // 스냅샷마다 부른다: 띄울 게 있으면 띄우고(다른 창이 떠 있으면 닫힐 때까지 기다림), 떠 있으면 목록만 고친다.
    function refreshPop() {
        if (isAutomation() || !noti.name) return;
        const items = pickPopup(noti.items, loadDismissed());
        if (popHost) {
            if (items.length) renderPop(items); else closePop();   // 다른 화면에서 다 읽었다
            return;
        }
        if (!items.length) { stopPopWait(); return; }
        if (findOpenModal(document)) {
            if (popWait) return;
            const until = Date.now() + POP_WAIT_MAX;
            const who = noti.name;
            popWait = setInterval(() => {
                if (noti.name !== who) { stopPopWait(); return; }          // 로그아웃·다른 사람
                if (findOpenModal(document) && Date.now() < until) return;
                const timedOut = Date.now() >= until;
                stopPopWait();
                if (!timedOut) refreshPop();                                // 그 사이 읽음·닫음이 반영된 목록으로
            }, POP_WAIT_STEP);
            return;
        }
        stopPopWait();
        openPop(items);
    }

    function renderPop(items) {
        if (!popHost) return;
        const root = popHost.shadowRoot;
        popIds = items.map(n => n.id);
        root.querySelector('h2').textContent = `새 알림 ${items.length}건`;
        root.querySelector('ul').innerHTML = items.map(n => {
            return `<li><time>${esc(popTime(n.createdAt))}</time><p>${esc(n.message)}</p>${goBtn(n)}</li>`;
        }).join('');
    }

    // 이동 링크가 있는 알림의 버튼(팝업·알림창 공용) — 주소는 고정 표에서만(notiLink)
    const goBtn = (n) => {
        const link = notiLink(n);
        return link ? `<a class="b go" href="${esc(absUrl(link, BASE))}" data-noti-id="${esc(n.id)}">${esc(notiLinkLabel(n) || '이동')}</a>` : '';
    };

    // 알림의 [비품 관리로 이동] — 그 항목만 읽음 처리한 뒤 이동한다. 오프라인이면 읽음 쓰기가 끝나지 않으므로 오래 기다리지 않는다.
    //   Ctrl·가운데 클릭은 브라우저가 새 탭으로 연다(interceptLink 와 같은 규칙).
    async function popGo(e) {
        const a = e.target.closest('a.go');
        if (!a || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        const id = a.dataset.notiId, url = a.href;
        addDismissed([id]);                // 읽음 반영이 늦게 와도 다시 뜨지 않게
        if (noti.markRead) {
            const ok = await Promise.race([noti.markRead([id]), new Promise(r => setTimeout(() => r(false), POP_READ_WAIT))]);
            if (!ok) console.warn('[app-shell] 알림을 읽음으로 표시하지 못했습니다 — 그대로 이동합니다.');
        }
        navigate(url, { reloadSameHash: true });
    }

    function popLater() {
        addDismissed(popIds);
        closePop();
    }

    async function popConfirm(btn) {
        const ids = popIds.slice();
        addDismissed(ids);                 // 읽음 반영이 늦게 와도 다시 뜨지 않게
        btn.disabled = true;
        const ok = noti.markRead ? await noti.markRead(ids) : false;
        if (!ok) console.warn('[app-shell] 알림을 읽음으로 표시하지 못했습니다 — 종 숫자는 그대로 남습니다.');
        closePop();
    }

    function onPopKey(e) {
        if (!popHost || overlayHost || paletteHost) return;   // 서랍·빠른 이동이 위에 있으면 그쪽 키
        const root = popHost.shadowRoot;
        if (e.key === 'Escape' || e.key === 'Esc') {
            // 팝업만 닫는다 — 페이지 모달 ESC(js/modal-esc.js)까지 가지 않게
            e.preventDefault();
            e.stopImmediatePropagation();
            popLater();
            return;
        }
        if (e.key === 'Tab') {
            // 포커스를 팝업 버튼 안에서만 돈다
            const els = Array.from(root.querySelectorAll('.b:not([disabled])'));
            if (!els.length) return;
            const i = els.indexOf(root.activeElement);
            e.preventDefault();
            e.stopImmediatePropagation();
            els[(i + (e.shiftKey ? -1 : 1) + els.length) % els.length].focus();
        }
    }

    function openPop(items) {
        if (popHost) { renderPop(items); return; }
        popPrev = deepActive();
        popHost = document.createElement('app-shell-noti-pop');
        const root = popHost.attachShadow({ mode: 'open' });
        root.innerHTML = `<style>${POP_CSS}</style>
            <div class="scrim"></div>
            <section class="panel" role="alertdialog" aria-modal="true" aria-labelledby="as-pop-title" aria-describedby="as-pop-list">
                <header>${ICON_BELL}<h2 id="as-pop-title"></h2></header>
                <ul id="as-pop-list"></ul>
                <div class="acts">
                    <button type="button" class="b center">알림센터</button>
                    <button type="button" class="b later">나중에</button>
                    <button type="button" class="b ok">확인</button>
                </div>
            </section>`;
        renderPop(items);
        root.querySelector('ul').addEventListener('click', popGo);                                  // root 의 interceptLink 보다 먼저(기본 이동을 막으면 그쪽은 건너뛴다)
        root.querySelector('.scrim').addEventListener('click', popLater);
        root.querySelector('.later').addEventListener('click', popLater);
        root.querySelector('.ok').addEventListener('click', (e) => popConfirm(e.currentTarget));
        root.querySelector('.center').addEventListener('click', () => {   // 지금 화면에서 알림창이 이어받는다
            addDismissed(popIds);
            const pf = popPrev;
            closePop(false);
            openPanel(pf);
        });
        root.addEventListener('click', interceptLink);
        document.body.appendChild(popHost);
        syncTheme();
        window.addEventListener('keydown', onPopKey, true);
        root.querySelector('.ok').focus({ preventScroll: true });
    }

    function closePop(restoreFocus = true) {
        stopPopWait();
        if (!popHost) return;
        window.removeEventListener('keydown', onPopKey, true);
        popHost.remove();
        popHost = null;
        popIds = [];
        const p = popPrev; popPrev = null;
        if (restoreFocus && p && p.isConnected && typeof p.focus === 'function') { try { p.focus({ preventScroll: true }); } catch (e) { /* 무시 */ } }
    }

    // ── 알림창 (2026-11-11) ── 종·팝업 [알림센터]로 지금 화면에서 연다(예전에는 대시보드로 이동).
    //   최근 3일(구독과 같은 창) — 안 읽은 것 위로. 닫을 때 그때 보이던 안 읽은 알림은 '닫은 것'으로(대시보드 알림창과 같다).
    function renderPanel() {
        if (!panelHost) return;
        const root = panelHost.shadowRoot;
        const list = sortUnreadFirst(noti.all);
        // 다시 그리면 목록 버튼이 새로 생긴다 — 포커스가 목록 안에 있었으면 같은 알림(없으면 그 자리 다음 알림, 그것도 없으면 닫기)으로 돌려준다
        const fa = root.activeElement;
        const inList = !!(fa && fa.closest && fa.closest('ul'));
        const focusKind = inList ? (fa.matches('[data-del]') ? 'del' : 'go') : null;
        const focusId = inList ? (fa.dataset.del || fa.dataset.notiId || '') : '';
        const oldIdx = inList ? Array.from(root.querySelectorAll('ul li')).findIndex(li => li.contains(fa)) : -1;
        panelShown = list.filter(n => !n.isRead).map(n => n.id);
        root.querySelector('h2').textContent = noti.unread > 0 ? `알림 · 안 읽음 ${noti.unread}건` : '알림';
        root.querySelector('ul').innerHTML = list.length ? list.map(n => `<li${n.isRead ? ' class="read"' : ''}>
                <time>${n.isRead ? '' : '<span class="new">NEW</span>'}${esc(popTime(n.createdAt))}</time><p>${esc(n.message)}</p>${goBtn(n)}
                <button type="button" class="x del" data-del="${esc(n.id)}" aria-label="이 알림 삭제" title="삭제">${ICON_CLOSE}</button></li>`).join('')
            : '<li class="empty">최근 3일 알림이 없습니다.</li>';
        root.querySelector('.readall').disabled = panelBusy || noti.unread === 0;
        root.querySelector('.delall').disabled = panelBusy || list.length === 0;
        if (inList) {
            const sel = focusKind === 'del' ? `[data-del="${CSS.escape(focusId)}"]` : `a.go[data-noti-id="${CSS.escape(focusId)}"]`;
            const lis = root.querySelectorAll('ul li:not(.empty)');
            const near = lis[Math.min(Math.max(oldIdx, 0), lis.length - 1)];
            const to = root.querySelector(sel) || (near && near.querySelector('[data-del]')) || root.querySelector('.close');
            if (to) to.focus({ preventScroll: true });
        } else if (fa && fa.disabled) {
            root.querySelector('.close').focus({ preventScroll: true });   // [모두 읽음]·[전체 삭제]가 잠겼다
        }
    }

    async function panelAct(fn) {
        if (panelBusy) return;
        panelBusy = true;
        renderPanel();
        try { await fn(); } finally { panelBusy = false; renderPanel(); }
    }

    async function onPanelClick(e) {
        const del = e.target.closest('[data-del]');
        if (del) {
            const id = del.dataset.del;
            panelAct(async () => {
                if (!noti.deleteNotis || !(await noti.deleteNotis([id]))) console.warn('[app-shell] 알림을 지우지 못했습니다.');
            });
            return;
        }
        popGo(e);   // [○○로 이동] — 그 알림만 읽음 처리 뒤 이동
    }

    function onPanelKey(e) {
        if (!panelHost || overlayHost || paletteHost) return;   // 서랍·빠른 이동이 위에 있으면 그쪽 키
        const root = panelHost.shadowRoot;
        if (e.key === 'Escape' || e.key === 'Esc') {
            e.preventDefault();
            e.stopImmediatePropagation();   // 페이지 모달 ESC(js/modal-esc.js)까지 가지 않게
            closePanel();
            return;
        }
        if (e.key === 'Tab') {
            const els = Array.from(root.querySelectorAll('.b:not([disabled]), .x'));
            if (!els.length) return;
            const i = els.indexOf(root.activeElement);
            e.preventDefault();
            e.stopImmediatePropagation();
            els[(i + (e.shiftKey ? -1 : 1) + els.length) % els.length].focus();
        }
    }

    function openPanel(prev) {
        if (panelHost) return;
        if (!noti.unsub) return;          // 구독 전(로그인 확인 중) — 종이 숨어 있어 보통 오지 않는다
        panelPrev = prev !== undefined ? prev : deepActive();
        panelHost = document.createElement('app-shell-noti-panel');
        const root = panelHost.attachShadow({ mode: 'open' });
        root.innerHTML = `<style>${PANEL_CSS}</style>
            <div class="scrim"></div>
            <section class="panel" role="dialog" aria-modal="true" aria-labelledby="as-panel-title">
                <header>${ICON_BELL}<h2 id="as-panel-title">알림</h2><button type="button" class="x close" aria-label="알림창 닫기">${ICON_CLOSE}</button></header>
                <ul></ul>
                <div class="acts">
                    <a class="b msg" href="${esc(absUrl(NOTI_LINK, BASE))}" title="쪽지는 대시보드 알림창에서 보냅니다">쪽지 보내기</a>
                    <button type="button" class="b delall">전체 삭제</button>
                    <button type="button" class="b ok readall">모두 읽음</button>
                </div>
            </section>`;
        root.querySelector('ul').addEventListener('click', onPanelClick);   // root 의 interceptLink 보다 먼저
        root.querySelector('.scrim').addEventListener('click', () => closePanel());
        root.querySelector('.close').addEventListener('click', () => closePanel());
        root.querySelector('.readall').addEventListener('click', () => panelAct(async () => {
            const ids = noti.all.filter(n => !n.isRead).map(n => n.id);
            if (ids.length && (!noti.markRead || !(await noti.markRead(ids)))) console.warn('[app-shell] 알림을 읽음으로 표시하지 못했습니다.');
        }));
        root.querySelector('.delall').addEventListener('click', () => {
            const ids = noti.all.map(n => n.id);
            if (!ids.length || !confirm('최근 3일 알림을 모두 삭제할까요?')) return;
            panelAct(async () => {
                if (!noti.deleteNotis || !(await noti.deleteNotis(ids))) console.warn('[app-shell] 알림을 지우지 못했습니다.');
            });
        });
        root.addEventListener('click', interceptLink);
        document.body.appendChild(panelHost);
        syncTheme();
        renderPanel();
        window.addEventListener('keydown', onPanelKey, true);
        if (barRoot) barRoot.querySelector('.bell').setAttribute('aria-expanded', 'true');
        root.querySelector('.close').focus({ preventScroll: true });
    }

    function closePanel(restoreFocus = true, recheck = restoreFocus) {
        if (!panelHost) return;
        if (panelShown.length) addDismissed(panelShown);   // 본 알림이 팝업으로 또 뜨지 않게(이 탭에서만)
        window.removeEventListener('keydown', onPanelKey, true);
        panelHost.remove();
        panelHost = null;
        panelShown = [];
        if (barRoot) barRoot.querySelector('.bell').setAttribute('aria-expanded', 'false');
        const p = panelPrev; panelPrev = null;
        if (restoreFocus && p && p.isConnected && typeof p.focus === 'function') { try { p.focus({ preventScroll: true }); } catch (e) { /* 무시 */ } }
        if (recheck) refreshPop();   // 창이 떠 있는 동안 온 새 알림(이동·로그아웃으로 닫을 때는 안 본다)
    }

    // ── 메뉴 서랍 (열 때 만들고 닫을 때 없앤다) ──
    let overlayHost = null, prevFocus = null;
    let paletteHost = null, palettePrev = null;

    function deepActive() {
        let a = document.activeElement;
        while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
        return a;
    }

    function menuHtml() {
        const home = absUrl(HOME_FILE, BASE);
        const cur = (rel) => (rel.split('#')[0].split('?')[0] === pageFile && !rel.includes('#')) ? ' aria-current="page"' : '';
        let html = `<a class="item js-home" href="${esc(home)}"${pageFile === HOME_FILE ? ' aria-current="page"' : ''}>${ICON_HOME}<span>홈</span></a>`;
        groups.forEach(g => {
            html += `<div class="cat">${esc(g.category)}</div>`;
            g.items.forEach(i => {
                if (i.link === HOME_FILE) return;   // '대시보드' 는 위의 '홈' 과 같다
                const t = shellLinkTarget(i.link);   // 'same-tab'(1b)이면 없음 — app-shell-data.js SHELL_OPEN_MODE
                html += `<a class="item" href="${esc(absUrl(i.link, BASE))}"${t ? ` target="${esc(t)}"` : ''}${cur(i.link)}><span>${esc(menuLabel(i.name))}</span></a>`;
            });
        });
        if (signedIn !== true && !groups.length) html += `<div class="note">로그인하면 메뉴가 보입니다.</div>`;
        return html;
    }

    function onKey(e) {
        if (e.key === 'Escape' || e.key === 'Esc') {
            // 셸 서랍만 닫는다 — 페이지 모달 ESC(js/modal-esc.js)까지 가지 않게
            e.preventDefault();
            e.stopImmediatePropagation();
            closeMenu();
        }
    }

    function openMenu() {
        if (overlayHost) return;
        let pf = deepActive();
        if (paletteHost) { pf = palettePrev; closePalette(false); }   // 팔레트에서 넘어오면 팔레트 열기 전 포커스를 이어받는다
        prevFocus = pf;
        overlayHost = document.createElement('app-shell-overlay');
        const root = overlayHost.attachShadow({ mode: 'open' });
        root.innerHTML = `<style>${OVERLAY_CSS}</style>
            <div class="scrim"></div>
            <nav aria-label="메뉴">
                <div class="head"><b>메뉴</b><button type="button" class="btn close" aria-label="메뉴 닫기">${ICON_CLOSE}</button></div>
                <div class="list">${menuHtml()}</div>
            </nav>`;
        root.querySelector('.scrim').addEventListener('click', closeMenu);
        root.querySelector('.close').addEventListener('click', closeMenu);
        root.addEventListener('click', interceptLink);
        document.body.appendChild(overlayHost);
        syncTheme();
        window.addEventListener('keydown', onKey, true);
        if (barRoot) barRoot.querySelector('.menu').setAttribute('aria-expanded', 'true');
        const first = root.querySelector('[aria-current="page"]') || root.querySelector('.item');
        if (first) first.focus({ preventScroll: true });
    }

    function closeMenu() {
        if (!overlayHost) return;
        window.removeEventListener('keydown', onKey, true);
        overlayHost.remove();
        overlayHost = null;
        if (barRoot) barRoot.querySelector('.menu').setAttribute('aria-expanded', 'false');
        // 이전 포커스로 돌려준다(입고 스캐너의 스캔 입력칸 등)
        const p = prevFocus; prevFocus = null;
        if (p && p.isConnected && typeof p.focus === 'function') { try { p.focus({ preventScroll: true }); } catch (e) { /* 무시 */ } }
    }

    // ── 이동 ── 진짜 <a href> 라 Ctrl·가운데 클릭은 브라우저가 새 탭으로 연다. 왼쪽 단순 클릭만 가로챈다.
    //   홈 링크 → goHome(대시보드 창으로 돌아가기) · target 있는 링크 → 브라우저 기본(이름 붙은 창) · 나머지 → navigate
    function interceptLink(e) {
        const a = e.composedPath().find(n => n && n.tagName === 'A' && n.hasAttribute('href'));
        if (!a) return;
        if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
        if (a.classList.contains('js-home')) { e.preventDefault(); goHome(); return; }
        const t = a.getAttribute('target');
        if (t && t !== '_self') { setTimeout(closeMenu, 0); return; }   // 다른 창으로 열린다 — 이 화면은 그대로, 서랍만 닫는다
        e.preventDefault();
        navigate(a.href);
    }

    // 이동 전 확인 훅(js/app-shell-bridge.js onBeforeLeave). 하나라도 false 면 false.
    // 통과하면 저장 훅(onBeforeLeaveSave)을 한꺼번에 부르고 최대 3초 기다린다(실패는 이동, 3초 초과는 confirm).
    async function runLeaveHooks() {
        for (const fn of (window.__appShellLeaveHooks || []).slice()) {
            let ok = true;
            try {
                // 훅이 끝나지 않아도 3초 뒤에는 간다(화면에 갇히지 않게)
                ok = await Promise.race([
                    Promise.resolve().then(() => fn()),
                    new Promise(r => setTimeout(() => r(true), LEAVE_HOOK_TIMEOUT))
                ]);
            } catch (err) {
                console.warn('[app-shell] 이동 전 확인 실패 — 그대로 이동합니다:', err && err.message);
            }
            if (ok === false) return false;
        }
        const saves = (window.__appShellSaveHooks || []).slice();
        if (saves.length) {
            const all = Promise.allSettled(saves.map(fn => Promise.resolve().then(() => fn())));
            const res = await Promise.race([all, new Promise(r => setTimeout(() => r(null), LEAVE_HOOK_TIMEOUT))]);
            // 3초 안에 안 끝나면(오프라인·느린 네트워크로 쓰기가 서버에 아직 안 감) 동기 confirm 으로 묻는다 — 취소면 머문다.
            // (페이지 모달이 아니라 브라우저 confirm — 봇이 읽는 div[role=dialog]·data-act 를 만들지 않는다)
            if (res === null && !confirm('아직 서버에 저장되지 않은 변경이 있습니다. 지금 이동하면 사라질 수 있습니다. 이동할까요?')) return false;
            if (res && res.some(x => x.status === 'rejected')) console.warn('[app-shell] 이동 전 저장 실패 — 그대로 이동합니다.');
        }
        return true;
    }

    // 셸에서 이미 '나가도 되는지' 물었다 — 페이지 beforeunload 경고가 한 번 더 묻지 않게(bridge leaveAlreadyConfirmed).
    // 이동이 막혀 이 화면에 남으면 잠시 뒤 내린다.
    function markLeaveConfirmed() {
        window.__appShellLeaveConfirmed = true;
        setTimeout(() => { window.__appShellLeaveConfirmed = false; }, 2000);
    }

    let leaving = false;
    // reloadSameHash: 알림 이동(popGo)만 — 같은 화면의 다른 해시면 다시 연다(다른 이동은 예전처럼 해시만 바뀐다)
    async function navigate(url, { reloadSameHash = false } = {}) {
        if (leaving) return;
        leaving = true;
        try {
            if (!(await runLeaveHooks())) return;   // 취소
            closeMenu();
            closePalette(false);
            closePop(false);
            closePanel(false);
            markLeaveConfirmed();
            // 같은 화면의 다른 해시(알림 → 기안서 화면에서 기안서 #todo 등) — 해시만 바뀌면 목록이 새로 읽히지 않으므로 다시 연다
            let u = null;
            if (reloadSameHash) { try { u = new URL(url, location.href); } catch (e) { /* 아래 assign 이 처리 */ } }
            if (u && u.hash && u.origin === location.origin && u.pathname === location.pathname && u.search === location.search) {
                history.replaceState(history.state, '', u.href);
                location.reload();
                return;
            }
            location.assign(url);
        } finally {
            leaving = false;
        }
    }

    // 페이지 안의 앱 링크(대시보드 사이드바 등)도 같은 탭 이동이면 이동 전 훅을 거치게 한다.
    // 훅이 하나도 없으면 손대지 않는다(브라우저 기본 이동). 페이지가 이미 처리한 클릭(defaultPrevented)·
    // 새 창(target)·다운로드·같은 화면 안 이동(#…)·앱 밖 주소는 건드리지 않는다.
    const hasHooks = () => !!((window.__appShellLeaveHooks || []).length || (window.__appShellSaveHooks || []).length);
    function interceptPageLink(e) {
        if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
        if (!hasHooks()) return;
        const path = e.composedPath();
        // 셸 자신의 링크(바·서랍·알림 팝업)는 각자 가로챈다
        if (path.some(n => n && (n === barHost || n === overlayHost || n === popHost || n === panelHost))) return;
        const a = path.find(n => n && n.tagName === 'A' && n.hasAttribute('href'));
        if (!a || a.hasAttribute('download')) return;
        const t = a.getAttribute('target');
        if (t && t !== '_self') return;
        let u;
        try { u = new URL(a.href, location.href); } catch (err) { return; }
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
        const file = pageFileOf(u.href, BASE);
        if (!file) return;                                                          // 앱 밖
        if (file === pageFile && u.search === location.search) return;            // 같은 화면(해시만 다름)
        e.preventDefault();
        navigate(u.href);
    }
    document.addEventListener('click', interceptPageLink);

    // 대시보드가 이 창을 열었으면(사이드바의 이름 붙은 창) 그 창으로 돌아가고 이 창을 닫는다.
    // 아니면 이 탭에서 대시보드로 간다. (대시보드가 두 탭에서 돌지 않게)
    // 1b(같은 탭)에서도 남겨 둔다 — 배포 전에 열어 둔 이름 붙은 창, 다른 앱이 새 창으로 연 화면이 한동안 남아 있다.
    // 같은 탭 이동만 했다면 opener 가 없으므로 그냥 이 탭에서 이동한다.
    const openerIsDashboard = () => {
        try {
            const o = window.opener;
            if (!o || o.closed || o === window) return false;
            return o.location.origin === location.origin && pageFileOf(o.location.href, BASE) === HOME_FILE;
        } catch (e) { return false; }   // 다른 출처 — 읽을 수 없다
    };
    async function goHome() {
        if (leaving) return;
        leaving = true;
        try {
            if (!(await runLeaveHooks())) return;
            closeMenu();
            closePalette(false);
            closePop(false);
            closePanel(false);
            markLeaveConfirmed();
            if (openerIsDashboard()) {
                try { window.opener.focus(); } catch (e) { /* 무시 */ }
                window.close();
                // 닫기가 막힌 창이면 그대로 남는다 — 이 탭에서 이동
                setTimeout(() => { if (!window.closed) location.assign(absUrl(HOME_FILE, BASE)); }, 300);
                return;
            }
            location.assign(absUrl(HOME_FILE, BASE));
        } finally {
            leaving = false;
        }
    }

    // ── 빠른 이동 (Ctrl+K, 1d) ── 열 때 만들고 닫을 때 없앤다. 키는 팔레트 안에서 끝낸다(페이지 키 처리로 새지 않게).
    let paletteSel = 0, paletteItems = [], pendingEnter = 0;   // pendingEnter: 조합 중 Enter 를 받은 시각(0 = 없음)
    const PENDING_ENTER_MS = 300;
    const enterPending = () => pendingEnter > 0 && Date.now() - pendingEnter <= PENDING_ENTER_MS;

    // 로그인 확인 중·로그아웃이면 '홈'만(앞 사람 캐시 메뉴가 보이지 않게). 계산기(확인 없는 화면)는 캐시 메뉴.
    function paletteDestinations() {
        const usable = signedIn === true || (noCtxPage && signedIn === null);
        return buildDestinations(usable ? groups : [], usable ? role : null);
    }

    function paintSel() {
        if (!paletteHost) return;
        const root = paletteHost.shadowRoot;
        root.querySelectorAll('li[data-i]').forEach(li => li.setAttribute('aria-selected', String(+li.dataset.i === paletteSel)));
        const input = root.querySelector('input');
        if (paletteItems.length) input.setAttribute('aria-activedescendant', `as-opt-${paletteSel}`);
        else input.removeAttribute('aria-activedescendant');
        const cur = root.querySelector(`li[data-i="${paletteSel}"]`);
        if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
    }

    function renderPalette() {
        if (!paletteHost) return;
        const root = paletteHost.shadowRoot;
        paletteItems = rank(root.querySelector('input').value, paletteDestinations()).slice(0, PALETTE_MAX);
        if (paletteSel >= paletteItems.length) paletteSel = 0;
        root.querySelector('ul').innerHTML = paletteItems.map((d, i) =>
            `<li role="option" id="as-opt-${i}" data-i="${i}"><span class="l">${esc(d.label)}</span>${d.parent ? `<span class="p">${esc(d.parent)}</span>` : ''}</li>`).join('');
        root.querySelector('.empty').hidden = paletteItems.length > 0;
        paintSel();
    }

    function moveSel(step) {
        const n = paletteItems.length;
        if (!n) return;
        paletteSel = (paletteSel + step + n) % n;
        paintSel();
    }

    function goPalette(d) {
        if (!d) return;
        const u = new URL(d.url, BASE);
        const samePage = pageFileOf(u.href, BASE) === pageFile && u.search === location.search;
        if (!samePage) {
            if (d.kind === 'home') goHome(); else navigate(u.href);   // 이동 전 확인·저장 훅을 거친다(통과하면 팔레트도 닫힌다)
            return;
        }
        // 같은 화면 — 해시만 바꾼다(hashchange → 화면이 그 탭으로. 기록이 남아 뒤로가기로 되돌아온다)
        closePalette();
        if (u.hash === location.hash) return;
        if (!u.hash) { if (d.kind === 'sub' && location.hash) location.hash = ''; return; }
        // 대시보드의 #open=(창 열기)은 기록을 남기지 않는다 — 대시보드가 읽고 바로 해시를 지운다(js/app.js handleOpenHash)
        if (u.hash.startsWith('#open=')) { location.replace(u.href); return; }
        location.assign(u.href);
    }

    const inPalette = (e) => !!paletteHost && e.composedPath().includes(paletteHost);

    function onPaletteKey(e) {
        if (!paletteHost) return;
        if (e.key === 'Escape' || e.key === 'Esc') {
            // 팔레트만 닫는다 — 아래 페이지 모달 ESC(js/modal-esc.js, 문서 캡처)까지 가지 않게
            e.preventDefault();
            e.stopImmediatePropagation();
            closePalette();
            return;
        }
        if (!inPalette(e)) return;
        e.stopImmediatePropagation();   // 페이지의 키 처리(스캐너 Enter 등)로 새지 않게
        if (e.isComposing) {
            // 한글 조합 중 Enter — 조합이 끝난(compositionend) 뒤 맞춘 결과로 간다(300ms 안에 끝나지 않으면 버린다)
            if (e.key === 'Enter') pendingEnter = Date.now();
            return;
        }
        if (e.keyCode === 229) {
            // 조합은 끝났는데 IME 가 229 로 보내는 Enter(일부 브라우저) — 바로 간다. 다른 키는 IME 몫
            if (e.key === 'Enter') { e.preventDefault(); if (!enterPending()) goPalette(paletteItems[paletteSel]); }
            return;
        }
        if (e.key === 'ArrowDown') { e.preventDefault(); moveSel(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); moveSel(-1); }
        else if (e.key === 'Enter') { e.preventDefault(); if (!enterPending()) goPalette(paletteItems[paletteSel]); }
        else if (e.key === 'Tab') { e.preventDefault(); }   // 포커스를 입력칸에 둔다
    }
    function swallowPaletteKey(e) { if (inPalette(e)) e.stopImmediatePropagation(); }

    function openPalette() {
        if (paletteHost) {
            const i = paletteHost.shadowRoot.querySelector('input');
            if (i) i.focus({ preventScroll: true });
            return;
        }
        let pf = deepActive();
        if (overlayHost) { pf = prevFocus; prevFocus = null; closeMenu(); }   // 서랍에서 넘어오면 서랍 열기 전 포커스를 이어받는다
        palettePrev = pf;
        paletteSel = 0;
        pendingEnter = 0;
        paletteHost = document.createElement('app-shell-palette');
        const root = paletteHost.attachShadow({ mode: 'open' });
        root.innerHTML = `<style>${PALETTE_CSS}</style>
            <div class="scrim"></div>
            <section class="panel" aria-label="빠른 이동">
                <div class="search">${ICON_SEARCH}<input type="text" role="combobox" aria-expanded="true" aria-controls="as-list" aria-autocomplete="list"
                     aria-label="이동할 화면 검색" placeholder="화면·탭 이름 (초성도 됩니다: ㄹㅋ)" autocomplete="off" spellcheck="false" enterkeyhint="go"><kbd>Esc</kbd></div>
                <ul id="as-list" role="listbox" aria-label="이동할 곳"></ul>
                <div class="empty" hidden>맞는 화면이 없습니다.</div>
            </section>`;
        root.querySelector('.scrim').addEventListener('click', () => closePalette());
        const input = root.querySelector('input');
        input.addEventListener('input', () => { paletteSel = 0; renderPalette(); });
        input.addEventListener('compositionend', () => {
            if (!enterPending()) { pendingEnter = 0; return; }
            setTimeout(() => {
                if (!paletteHost || !pendingEnter) return;
                pendingEnter = 0;
                renderPalette();
                goPalette(paletteItems[paletteSel]);
            }, 30);
        });
        root.querySelector('ul').addEventListener('click', (e) => {
            const li = e.target.closest && e.target.closest('li[data-i]');
            if (li) goPalette(paletteItems[+li.dataset.i]);
        });
        document.body.appendChild(paletteHost);
        syncTheme();
        window.addEventListener('keydown', onPaletteKey, true);
        window.addEventListener('keyup', swallowPaletteKey, true);
        window.addEventListener('keypress', swallowPaletteKey, true);
        renderPalette();
        input.focus({ preventScroll: true });
    }

    function closePalette(restoreFocus = true) {
        if (!paletteHost) return;
        window.removeEventListener('keydown', onPaletteKey, true);
        window.removeEventListener('keyup', swallowPaletteKey, true);
        window.removeEventListener('keypress', swallowPaletteKey, true);
        paletteHost.remove();
        paletteHost = null;
        paletteItems = [];
        pendingEnter = 0;
        // 이전 포커스로 돌려준다(입고 스캐너의 스캔 입력칸 등)
        const p = palettePrev; palettePrev = null;
        if (restoreFocus && p && p.isConnected && typeof p.focus === 'function') { try { p.focus({ preventScroll: true }); } catch (e) { /* 무시 */ } }
    }

    // Ctrl+K / ⌘K — 한글 입력 상태에서도 되게 e.code(KeyK)로 본다.
    // 매뉴얼 편집기(.ql-editor)에서는 Quill 의 링크 단축키에 양보하고, 글자 조합 중(isComposing)에도 양보한다.
    function onShortcut(e) {
        if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
        if (!(e.code === 'KeyK' || (!e.code && (e.key === 'k' || e.key === 'K')))) return;
        if (e.isComposing) return;
        if (e.composedPath().some(n => n && n.classList && n.classList.contains('ql-editor'))) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (paletteHost) closePalette(); else openPalette();
    }
    window.addEventListener('keydown', onShortcut, true);
    // 바가 없는 대시보드의 검색 버튼(index.html — 섀도 밖 일반 버튼, 봇 선택자와 무관한 id)
    document.querySelectorAll('[data-shell-search]').forEach(btn => btn.addEventListener('click', (e) => { e.preventDefault(); openPalette(); }));

    window.AppShell = { navigate, goHome, openMenu, closeMenu, openPalette, closePalette, openNoti: () => openPanel(), closeNoti: () => closePanel() };

    // ── 다크 모드 따라가기 ──
    syncTheme();
    new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    // ── 페이지 컨텍스트 ── (이미 와 있으면 바로, 이후는 이벤트로)
    window.addEventListener('appshell:context', () => applyCtx(window.__appShellCtx));
    if (window.__appShellCtx) applyCtx(window.__appShellCtx);
}

try {
    start();
} catch (e) {
    console.warn('[app-shell] 상단바를 띄우지 못했습니다(페이지는 그대로 씁니다):', e && e.message);
}
