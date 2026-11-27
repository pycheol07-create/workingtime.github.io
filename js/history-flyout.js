// === js/history-flyout.js ===
// 대시보드 왼쪽 메뉴 '데이터 관리'에 마우스를 올리면 2차 메뉴(데이터 관리 10개 화면)를 오른쪽에 펼친다(2026-11-26 사용자 요청).
//   목록은 js/history-sections.js SECTION_GROUPS·SECTIONS 한 벌에서 만든다(레일 마크업을 복제하지 않는다).
//   항목을 누르면 go('#tab=…[&sub=…]') — 로그인 확인·이동은 부르는 쪽(js/listeners-history.js openHistoryModalLogic)이 한다.
//   마우스가 있는 화면에서만(hover:hover · pointer:fine). 터치 화면은 예전처럼 눌러서 데이터 관리로 간다.
// 2026-11-27: 다른 화면의 공통 메뉴(js/app-shell.js 접힌 레일·메뉴 서랍)도 같은 2차 메뉴 — 목록·여닫기는 여기 한 벌
//   (flyoutCss · flyoutHtml · attachFlyout). 공통 메뉴는 섀도 DOM 안이라 단추·목록이 섀도 안에 있어도 되게 짰다(초점은 getRootNode 기준).
// ⚠️ 봇 안전: role=dialog·data-act 를 쓰지 않는다(업무마감봇 선택자). 모양 토큰은 #dash-root 것(css/dash-d.css)이라 그 안에 붙인다.
import { SECTIONS, SECTION_GROUPS, sectionIconSvg } from './history-sections.js?v=b52edcc3bc59-1af66818';

/** 2차 메뉴 모양 — sel 은 목록 요소 선택자(대시보드 '#history-flyout', 공통 메뉴 '.hf-panel'). 색은 --c-* 토큰(없으면 밝은 기본값) */
export const flyoutCss = (sel) => `
${sel} { position: fixed; z-index: 60; min-width: 190px; padding: 8px; display: none;
    background: var(--c-surface, #fff); border: 1px solid var(--c-line, #E6E8EC); border-radius: var(--r-sm, 10px);
    box-shadow: 6px 6px 18px rgba(16, 24, 40, .16); font-size: 13.5px; max-height: calc(100vh - 16px); overflow-y: auto; }
${sel}.is-open { display: block; }
${sel} .hf-group + .hf-group { margin-top: 8px; }
${sel} .hf-title { padding: 4px 10px 2px; font-size: 11.5px; font-weight: 600; color: var(--c-text-3, #69707A); }
${sel} .hf-ico { flex: none; width: 17px; height: 17px; color: var(--c-text-3, #69707A); }
${sel} .hf-item:hover .hf-ico, ${sel} .hf-item:focus-visible .hf-ico { color: inherit; }
${sel} .hf-item { display: flex; align-items: center; gap: 9px; width: 100%; padding: 7px 10px; border: 0; border-radius: 8px; background: transparent;
    text-align: left; font: inherit; color: var(--c-text, #23272E); cursor: pointer; white-space: nowrap; }
${sel} .hf-item:hover, ${sel} .hf-item:focus-visible { background: var(--c-accent-soft, #EAF0FD); color: var(--c-accent-deep, #1E4699); outline: none; }`;

/** 화면 id → 해시('#tab=forecast' · '#tab=rawdata&sub=work') — 형식은 js/hash-state.js */
export const sectionHash = (id) => {
    const s = SECTIONS[id];
    if (!s) return '';
    return `#tab=${encodeURIComponent(s.main)}${s.sub ? `&sub=${encodeURIComponent(s.sub)}` : ''}`;
};

/** 목록 안쪽 글(그룹 제목 + 화면 단추) */
export const flyoutHtml = () => SECTION_GROUPS.map(g => `<div class="hf-group"><div class="hf-title">${g.title}</div>${
    g.ids.filter(id => SECTIONS[id]).map(id => `<button type="button" class="hf-item" data-hf-id="${id}">${sectionIconSvg(id, 'hf-ico')}<span>${SECTIONS[id].label}</span></button>`).join('')
}</div>`).join('');

/** 2차 메뉴 목록 요소 — 붙이는 곳은 부르는 쪽이 정한다.
 *  tag: 기본 nav. 공통 메뉴는 'div'(+role=navigation) — 그 섀도 CSS 의 nav 규칙(높이 100%·hover 폭)이 목록에 먹지 않게 */
export function createFlyoutPanel({ id = '', cls = '', tag = 'nav' } = {}) {
    const panel = document.createElement(tag);
    if (tag !== 'nav') panel.setAttribute('role', 'navigation');
    if (id) panel.id = id;
    if (cls) panel.className = cls;
    panel.setAttribute('aria-label', '데이터 관리 화면');
    panel.innerHTML = flyoutHtml();
    return panel;
}

/**
 * 단추(btn)에 마우스·초점이 오면 panel 을 옆에 펼친다. 둘 다 이미 문서(또는 같은 섀도 루트)에 붙어 있어야 한다.
 *   go(hash, e)   항목을 눌렀을 때(목록은 먼저 닫힌다)
 *   edge()        목록 왼쪽이 붙을 x(기본: 단추가 든 <aside> 오른쪽, 없으면 단추 오른쪽)
 *   isAvailable() 지금 펼쳐도 되는지(기본: 단추가 보임 — 권한이 없어 숨은 단추는 안 펼친다)
 *   onToggle(open) 열고 닫을 때(공통 메뉴 레일이 펼친 폭을 붙잡는 데 쓴다)
 *   closeDelay    마우스가 단추·목록을 벗어난 뒤 닫기까지 ms(기본 200 — 그 사이 목록으로 옮겨 가면 안 닫힌다)
 * 돌려주는 것: { open, close, dismiss(=닫고 초점이 목록에 있었으면 단추로), isOpen, destroy, panel }
 */
export function attachFlyout(btn, panel, { go, edge, isAvailable, onToggle, closeDelay = 200 } = {}) {
    if (!btn || !panel || typeof go !== 'function') return null;
    const mq = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)') : null;
    const root = btn.getRootNode ? btn.getRootNode() : document;            // 섀도 안이면 그 섀도 루트
    const active = () => (root && 'activeElement' in root ? root.activeElement : document.activeElement);
    const subs = [];
    const on = (t, type, fn, opt) => { t.addEventListener(type, fn, opt); subs.push([t, type, fn, opt]); };

    let timer = null;
    const isOpen = () => panel.classList.contains('is-open');
    const place = () => {
        const r = btn.getBoundingClientRect();
        let left;
        if (typeof edge === 'function') left = edge();
        else { const side = btn.closest('aside'); left = side ? side.getBoundingClientRect().right : r.right; }
        panel.style.left = `${Math.round(left + 6)}px`;
        panel.style.top = '0px';
        const h = panel.offsetHeight;
        panel.style.top = `${Math.round(Math.max(8, Math.min(r.top - 8, window.innerHeight - h - 8)))}px`;
    };
    const dismiss = () => {
        const back = panel.contains(active());
        close();
        if (back) refocus();
    };
    const onEsc = (e) => {
        if (e.key !== 'Escape') return;
        e.stopImmediatePropagation(); e.preventDefault();
        dismiss();
    };
    let refocusing = false;   // dismiss·← 로 초점을 단추에 돌려줄 때는 focus → open 으로 다시 열지 않는다(리뷰 11/27)
    const refocus = () => { refocusing = true; try { btn.focus(); } finally { refocusing = false; } };
    const open = () => {
        if (refocusing) return;
        if (mq && !mq.matches) return;
        if (typeof isAvailable === 'function' ? !isAvailable() : btn.offsetParent === null) return;   // 권한이 없어 숨은 단추
        clearTimeout(timer);
        if (!isOpen()) {
            panel.classList.add('is-open');
            if (typeof onToggle === 'function') onToggle(true);
            place();
            window.addEventListener('keydown', onEsc, true);
        }
        btn.setAttribute('aria-expanded', 'true');
    };
    function close() {
        clearTimeout(timer);
        const was = isOpen();
        if (was) window.removeEventListener('keydown', onEsc, true);
        panel.classList.remove('is-open');
        btn.setAttribute('aria-expanded', 'false');
        if (was && typeof onToggle === 'function') onToggle(false);
    }
    const closeSoon = () => { clearTimeout(timer); timer = setTimeout(close, closeDelay); };
    // 키보드 초점이 단추·목록에 있으면 마우스가 스쳐 나가도 닫지 않는다
    const closeSoonByMouse = () => {
        const a = active();
        if (a === btn || panel.contains(a)) return;
        closeSoon();
    };

    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-expanded', 'false');
    on(btn, 'mouseenter', open);
    on(btn, 'mouseleave', closeSoonByMouse);
    on(btn, 'focus', open);
    on(panel, 'mouseenter', () => clearTimeout(timer));
    on(panel, 'mouseleave', closeSoonByMouse);
    on(panel, 'mousedown', () => clearTimeout(timer));   // 누르는 중에는 닫지 않는다(Safari 는 누른 단추에 초점을 주지 않는다)
    // 키보드: 단추에서 → 로 목록에 들어가고, 목록·단추 밖으로 초점이 나가면 닫는다
    on(btn, 'keydown', (e) => {
        if (e.key === 'ArrowRight' && isOpen()) { e.preventDefault(); panel.querySelector('.hf-item')?.focus(); }
    });
    const onFocusOut = (e) => {
        if (panel.contains(e.relatedTarget) || e.relatedTarget === btn) return;
        if (panel.matches(':hover') || btn.matches(':hover')) return;   // 마우스가 아직 위에 있다
        closeSoon();
    };
    on(btn, 'blur', onFocusOut);
    on(panel, 'focusout', onFocusOut);
    on(panel, 'keydown', (e) => {
        const list = [...panel.querySelectorAll('.hf-item')];
        const i = list.indexOf(active());
        const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
        if (step && i >= 0) { e.preventDefault(); list[(i + step + list.length) % list.length].focus(); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); close(); refocus(); }
    });
    on(panel, 'click', (e) => {
        const b = e.target.closest('.hf-item');
        if (!b) return;
        close();
        go(sectionHash(b.dataset.hfId), e);
    });
    on(window, 'resize', close);
    const onScroll = (e) => {
        const t = e.target;
        if (t === document || t === document.documentElement || (t && t.contains && t.contains(btn))) close();
    };
    on(window, 'scroll', onScroll, true);
    // 섀도 안 스크롤(공통 메뉴 목록)은 window 까지 오지 않는다
    if (root && root !== document && root.addEventListener) on(root, 'scroll', onScroll, true);

    const destroy = () => {
        close();
        subs.forEach(([t, type, fn, opt]) => t.removeEventListener(type, fn, opt));
        subs.length = 0;
        panel.remove();
    };
    return { open, close, dismiss, isOpen, destroy, panel };
}

/** 대시보드 사이드바 [데이터 관리] 단추 — 목록은 #dash-root 안에 하나만 */
export function initHistoryFlyout(btn, { go } = {}) {
    if (!btn || typeof go !== 'function' || document.getElementById('history-flyout')) return null;
    if (!document.getElementById('history-flyout-css')) {
        const st = document.createElement('style');
        st.id = 'history-flyout-css';
        st.textContent = flyoutCss('#history-flyout');
        document.head.appendChild(st);
    }
    const panel = createFlyoutPanel({ id: 'history-flyout' });
    (document.getElementById('dash-root') || document.body).appendChild(panel);
    return attachFlyout(btn, panel, { go });
}
