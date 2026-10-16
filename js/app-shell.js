// === js/app-shell.js ===
// 공통 상단바 + 메뉴 서랍 (UI 1단계 1a, 2026-10-16). <script type="module" src="js/app-shell.js?v=202610161053"> 로 붙이면 스스로 돈다.
//   <body data-shell="페이지ID">              → 위쪽에 바를 얹는다(css/app-shell.css 가 본문을 그만큼 내린다)
//   <body data-shell="index" data-shell-bar="off"> → 바 없이 메뉴 캐시만 채운다(대시보드)
// 페이지는 js/app-shell-bridge.js 의 setShellContext 로 로그인 상태를 알려 준다.
//
// ⚠️ 봇 안전(업무마감봇·업무예상알림이 index/history 를 Playwright 로 연다):
//    - 그리는 것은 전부 섀도 DOM 안. 바깥 문서에는 사용자 정의 태그(app-shell-bar / app-shell-overlay) 하나씩만 붙는다.
//    - div[role=dialog]·[data-act]·봇이 읽는 id 를 쓰지 않는다. 메뉴 서랍은 열 때 만들고 닫을 때 없앤다.
// ⚠️ 절대경로('/js/…') 금지 — calculator/ 하위 폴더와 GitHub Pages 하위 경로에서도 맞도록 이 파일 위치 기준으로 계산한다.
// TODO(1d): Ctrl+K 명령 팔레트·검색 버튼. 그 전까지 Ctrl+K 는 아무 동작에도 묶지 않는다.

import { visibleMenuFor } from './menu-catalog.js?v=202610161053';
import { PAGE_DEFAULTS, HOME_FILE, resolveMenuGroups, absUrl, pageFileOf, currentTitle, shellLinkTarget } from './app-shell-data.js?v=202610161053';

const BASE = new URL('../', import.meta.url).href;      // 앱 폴더(js/ 의 부모)
const MENU_CACHE_KEY = 'appShell.menu.v1';              // js/app-shell-bridge.js 와 같은 키
const LEAVE_HOOK_TIMEOUT = 3000;

const 선 = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON_MENU = 선('<path d="M4 6h16M4 12h16M4 18h16"/>');
const ICON_HOME = 선('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>');
const ICON_CLOSE = 선('<path d="M6 6l12 12M18 6L6 18"/>');

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
    };

    // ── 바 ──
    let barHost = null, barRoot = null;
    const syncTheme = () => {
        const dark = document.documentElement.classList.contains('dark');
        [barHost, overlayHost].forEach(h => { if (h) { if (dark) h.setAttribute('data-theme', 'dark'); else h.removeAttribute('data-theme'); } });
    };

    function renderBar() {
        if (!barRoot) return;
        const title = currentTitle(pageId, groups, pageFile);
        barRoot.querySelector('.cur').textContent = title;
        // 확인 중(null)·로그아웃이면 메뉴 버튼을 숨긴다(앞 사람 캐시 메뉴가 잠깐 보이지 않게). 계산기는 예외.
        barRoot.querySelector('.menu').hidden = !(signedIn === true || (noCtxPage && signedIn === null));
        barRoot.querySelector('.state').hidden = signedIn !== false;
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
                const t = shellLinkTarget(i.link);   // 1a: 사이드바와 같은 이름 붙은 창(app-shell-data.js SHELL_OPEN_MODE)
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
        return true;
    }

    let leaving = false;
    async function navigate(url) {
        if (leaving) return;
        leaving = true;
        try {
            if (!(await runLeaveHooks())) return;   // 취소
            closeMenu();
            location.assign(url);
        } finally {
            leaving = false;
        }
    }

    // 대시보드가 이 창을 열었으면(사이드바의 이름 붙은 창) 그 창으로 돌아가고 이 창을 닫는다.
    // 아니면 이 탭에서 대시보드로 간다. (대시보드가 두 탭에서 돌지 않게 — 1a 는 열기 방식을 바꾸지 않는다)
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
