// === js/app-shell.js ===
// 공통 상단바 + 메뉴 서랍 (UI 1단계 1a, 2026-10-16). <script type="module" src="js/app-shell.js?v=202610161144"> 로 붙이면 스스로 돈다.
//   <body data-shell="페이지ID">              → 위쪽에 바를 얹는다(css/app-shell.css 가 본문을 그만큼 내린다)
//   <body data-shell="index" data-shell-bar="off"> → 바 없이 메뉴 캐시만 채운다(대시보드)
// 페이지는 js/app-shell-bridge.js 의 setShellContext 로 로그인 상태를 알려 준다.
//
// ⚠️ 봇 안전(업무마감봇·업무예상알림이 index/history 를 Playwright 로 연다):
//    - 그리는 것은 전부 섀도 DOM 안. 바깥 문서에는 사용자 정의 태그(app-shell-bar / app-shell-overlay) 하나씩만 붙는다.
//    - div[role=dialog]·[data-act]·봇이 읽는 id 를 쓰지 않는다. 메뉴 서랍은 열 때 만들고 닫을 때 없앤다.
// ⚠️ 절대경로('/js/…') 금지 — calculator/ 하위 폴더와 GitHub Pages 하위 경로에서도 맞도록 이 파일 위치 기준으로 계산한다.
// 1b(2026-10-16): 메뉴·홈은 같은 탭 이동(app-shell-data.js SHELL_OPEN_MODE). 페이지 안 앱 링크도 이동 전 저장 훅을 거친다.
// P2(2026-10-16): 바에 개인 알림 종(안 읽은 수) + 새 알림 토스트(js/app-shell-noti.js 를 늦게 불러 구독).
// TODO(1d): Ctrl+K 명령 팔레트·검색 버튼. 그 전까지 Ctrl+K 는 아무 동작에도 묶지 않는다.

import { visibleMenuFor } from './menu-catalog.js?v=202610161144';
import { PAGE_DEFAULTS, HOME_FILE, resolveMenuGroups, absUrl, pageFileOf, currentTitle, shellLinkTarget } from './app-shell-data.js?v=202610161144';

const BASE = new URL('../', import.meta.url).href;      // 앱 폴더(js/ 의 부모)
const MENU_CACHE_KEY = 'appShell.menu.v1';              // js/app-shell-bridge.js 와 같은 키
const LEAVE_HOOK_TIMEOUT = 3000;
// 개인 알림 — 대시보드는 자체 구현(js/app-sync.js), 스캐너는 별도 앱(scanApp), 계산기는 Firebase 가 없다.
const NOTI_OFF_PAGES = ['index', 'scan', 'calculator'];
const NOTI_DELAY = 2500;            // 페이지가 첫 화면을 그리고 난 뒤에 구독한다
const NOTI_LINK = 'index.html#open=noti';
const TOAST_MS = 6000;

const 선 = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON_MENU = 선('<path d="M4 6h16M4 12h16M4 18h16"/>');
const ICON_HOME = 선('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>');
const ICON_CLOSE = 선('<path d="M6 6l12 12M18 6L6 18"/>');
const ICON_BELL = 선('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 색은 페이지 테마와 상관없이 고정(css/d-theme.css·dash-d.css 값 사본). 다크는 html.dark 를 따라간다.
const TOKENS = `
:host {
    --as-bg: #FFFFFF; --as-surface-2: #F7F8FA; --as-line: #E6E8EC; --as-line-strong: #D6DAE0;
    --as-text: #23272E; --as-text-2: #646B75; --as-text-3: #8A9099;
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

// 새 알림 토스트 — 보여 줄 때 만들고 사라질 때 없앤다. 알림 내용(이름 등)은 넣지 않는다.
const TOAST_CSS = `${TOKENS}
:host { all: initial; position: fixed; right: 16px; top: calc(var(--as-top, 0px) + var(--as-bar, 40px) + 10px); z-index: 2147483000;
        display: block; font-family: var(--as-font); font-size: 14px; line-height: 1.4; color: var(--as-text); }
* { box-sizing: border-box; }
.box { display: flex; align-items: center; gap: 10px; padding: 10px 10px 10px 14px; border-radius: 12px; max-width: calc(100vw - 32px);
       background: var(--as-bg); border: 1px solid var(--as-line-strong); box-shadow: var(--as-shadow); }
output { display: block; font-weight: 600; }
a { color: var(--as-accent-deep); font-weight: 600; text-decoration: none; padding: 6px 8px; border-radius: 8px; white-space: nowrap; }
a:hover { background: var(--as-accent-soft); }
.btn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 0;
       border-radius: 8px; background: transparent; color: var(--as-text-3); cursor: pointer; }
.btn:hover { background: var(--as-surface-2); }
a:focus-visible, .btn:focus-visible { outline: 2px solid var(--as-accent); outline-offset: 1px; }
@media (max-width: 767px) { :host { left: 12px; right: 12px; } }`;

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
    let toastHost = null, toastTimer = null;
    const noti = { name: null, timer: null, unsub: null, unread: 0 };

    const applyCtx = (ctx) => {
        if (!ctx) return;
        if (!ctx.signedIn) {
            signedIn = false;
            groups = [];
        } else {
            signedIn = true;
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
        [barHost, overlayHost, toastHost].forEach(h => { if (h) { if (dark) h.setAttribute('data-theme', 'dark'); else h.removeAttribute('data-theme'); } });
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
                <a class="btn bell" href="${esc(absUrl(NOTI_LINK, BASE))}" aria-label="알림" title="알림(대시보드에서 보기)" hidden>${ICON_BELL}<span class="count" hidden></span></a>
                <span class="state" hidden>로그인 안 됨</span>
            </div>`;
        barRoot.querySelector('.menu').addEventListener('click', () => openMenu());
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
        hideToast();
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
                const { watchNotifications } = await import('./app-shell-noti.js?v=202610161144');
                if (noti.name !== want) return;   // 그 사이 로그아웃·다른 사람
                const unsub = watchNotifications(want, {
                    onCount: (n) => { noti.unread = n; renderBell(); },
                    onNew: () => showToast()
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

    function hideToast() {
        if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
        if (toastHost) { toastHost.remove(); toastHost = null; }
    }

    function showToast() {
        hideToast();
        toastHost = document.createElement('app-shell-toast');
        const root = toastHost.attachShadow({ mode: 'open' });
        // role=status 의 output — 봇이 찾는 div[role=dialog]·[data-act]·#toast 와 겹치지 않게
        root.innerHTML = `<style>${TOAST_CSS}</style>
            <div class="box">
                <output role="status">🔔 새 알림이 도착했습니다.</output>
                <a href="${esc(absUrl(NOTI_LINK, BASE))}">보기</a>
                <button type="button" class="btn close" aria-label="알림 안내 닫기">${ICON_CLOSE}</button>
            </div>`;
        root.querySelector('.close').addEventListener('click', hideToast);
        root.addEventListener('click', interceptLink);
        document.body.appendChild(toastHost);
        syncTheme();
        toastTimer = setTimeout(hideToast, TOAST_MS);
    }

    // ── 메뉴 서랍 (열 때 만들고 닫을 때 없앤다) ──
    let overlayHost = null, prevFocus = null;

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
                html += `<a class="item" href="${esc(absUrl(i.link, BASE))}"${t ? ` target="${esc(t)}"` : ''}${cur(i.link)}><span>${esc(i.name)}</span></a>`;
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
        prevFocus = deepActive();
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
    async function navigate(url) {
        if (leaving) return;
        leaving = true;
        try {
            if (!(await runLeaveHooks())) return;   // 취소
            closeMenu();
            hideToast();
            markLeaveConfirmed();
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
        // 셸 자신의 링크(바·서랍·토스트)는 각자 가로챈다
        if (path.some(n => n && (n === barHost || n === overlayHost || n === toastHost))) return;
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
            hideToast();
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

    window.AppShell = { navigate, goHome, openMenu, closeMenu };

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
